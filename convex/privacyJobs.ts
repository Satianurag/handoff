import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import {startPrivacy} from "./model/privacy";
import { v } from "convex/values";
import schema from "./schema";
import { fail, member, userMutation, userQuery } from "./model/access";
import { priorRequest, saveRequest } from "./model/requests";

export const get = userQuery({
  args: { privacyJobId: v.id("privacyJobs") }, returns: schema.doc("privacyJobs").omit("exportStorageId"),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.privacyJobId);
    if (!job || job.requestedBy !== ctx.user._id) return fail("NOT_FOUND", "Privacy request unavailable.");
    if (job.kind !== "delete") await member(ctx, job.householdId);
    const { exportStorageId: _storageId, ...result } = job; return result;
  },
});

export const request = userMutation({
  args: { householdId: v.id("households"), kind: v.union(v.literal("export"), v.literal("delete")), confirmed: v.boolean(), requestId: v.string() }, returns: v.id("privacyJobs"),
  handler: async (ctx, args) => {
    const fingerprint = JSON.stringify(args), prior = await priorRequest(ctx, "privacy.request", args.requestId, fingerprint);
    if (prior) {
      const id = ctx.db.normalizeId("privacyJobs", prior.resultId); if (!id) return fail("NOT_FOUND", "Privacy request unavailable.");
      const job = await ctx.db.get(id);
      if (!job || job.requestedBy !== ctx.user._id) return fail("NOT_FOUND", "Privacy request unavailable.");
      if (args.kind !== "delete") await member(ctx, args.householdId);
      return id;
    }
    const { household } = await member(ctx, args.householdId, args.kind === "delete");
    if (args.kind === "delete" && !args.confirmed) fail("CONFIRMATION_REQUIRED", "Confirm permanent household deletion.");
    const now = Date.now();
    const processors = args.kind === "delete" ? ["agentmail", "convex", "workflow", "storage"].map(name => ({ name, state: "queued" as const })) : [{ name: "convex", state: "queued" as const }];
    const id = await ctx.db.insert("privacyJobs", { householdId: household._id, requestedBy: ctx.user._id, kind: args.kind, state: "queued", stage: "requested", processors, requestedAt: now, expiresAt: now + (args.kind === "delete" ? 30 : 1) * 86400000 });
    if (args.kind === "delete") {
      // This transaction revokes access immediately. A later worker must prove
      // each processor deletion before the receipt may say succeeded.
      await ctx.db.patch(household._id, { status: "deleting", emailImport: false, aiProcessing: false, consentVersion: household.consentVersion + 1, materialRevision: household.materialRevision + 1, updatedAt: now });
    }
    await saveRequest(ctx, "privacy.request", args.requestId, fingerprint, id);await startPrivacy(ctx,id);return id;
  },
});

export const deleteThread = userMutation({
  args: { threadId: v.id("mailThreads"), expectedVersion: v.number(), confirmed: v.boolean(), requestId: v.string() }, returns: v.id("privacyJobs"),
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId); if (!thread) return fail("NOT_FOUND", "Thread unavailable.");
    await member(ctx, thread.householdId);
    const fingerprint = JSON.stringify(args), prior = await priorRequest(ctx, "privacy.deleteThread", args.requestId, fingerprint);
    if (prior) { const id = ctx.db.normalizeId("privacyJobs", prior.resultId); if (!id) return fail("NOT_FOUND", "Privacy request unavailable."); return id; }
    if (!args.confirmed) fail("CONFIRMATION_REQUIRED", "Confirm deletion of the thread and its source evidence. External copies cannot be recalled.");
    if (thread.version !== args.expectedVersion || thread.deleting) fail("CONFLICT", "Thread changed or deletion is already in progress.");
    await ctx.db.patch(thread._id, { deleting: true, version: thread.version + 1 });
    const id = await ctx.db.insert("privacyJobs", { householdId: thread.householdId, requestedBy: ctx.user._id, kind: "deleteThread", threadId: thread._id, state: "queued", stage: "requested", processors: [{ name: "agentmail", state: "queued" }, { name: "convex", state: "queued" }], requestedAt: Date.now(), expiresAt: Date.now() + 30 * 86400000 });
    await saveRequest(ctx, "privacy.deleteThread", args.requestId, fingerprint, id);await startPrivacy(ctx,id);return id;
  },
});

export const retry=userMutation({args:{privacyJobId:v.id("privacyJobs")},returns:v.null(),handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.privacyJobId);if(!job||job.requestedBy!==ctx.user._id)return fail("NOT_FOUND","Privacy request unavailable.");
 if(job.kind!=="delete")await member(ctx,job.householdId);
 await startPrivacy(ctx,job._id);return null;
}});

export const listMine = userQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("privacyJobs").omit("exportStorageId")),
  handler: async (ctx, args) => {
    const result = await ctx.db.query("privacyJobs").withIndex("by_requestedBy", q => q.eq("requestedBy", ctx.user._id)).order("desc").paginate(args.paginationOpts);
    const page = [];
    for (const { exportStorageId: _storage, ...job } of result.page) {
      if (job.kind !== "delete") {
        const household = await ctx.db.get(job.householdId);
        const membership = await ctx.db.query("memberships").withIndex("by_householdId_and_userId", q => q.eq("householdId", job.householdId).eq("userId", ctx.user._id)).unique();
        if (!household || household.status !== "active" || membership?.status !== "active" || (ctx.user.isAnonymous && household.mode !== "demo")) continue;
      }
      page.push(job);
    }
    return { ...result, page };
  },
});
