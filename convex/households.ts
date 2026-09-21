import {accessPreset} from "./validators";
import { queueOperation } from "./model/operations";
import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import schema from "./schema";
import { userMutation, userQuery, member, fail, text, timezone } from "./model/access";
import { record } from "./model/events";
import { priorRequest, saveRequest } from "./model/requests";

export const me = userQuery({
  args: {}, returns: v.object({ id: v.id("users"), anonymous: v.boolean(), email: v.union(v.string(), v.null()) }),
  handler: async ctx => ({ id: ctx.user._id, anonymous: ctx.user.isAnonymous ?? false, email: ctx.user.email ?? null }),
});

export const list = userQuery({
  args: { paginationOpts: paginationOptsValidator }, returns: paginationResultValidator(v.object({ membershipId: v.id("memberships"), accessPreset, householdId: v.id("households"), role: v.union(v.literal("owner"), v.literal("member")), nickname: v.string(), mode: v.union(v.literal("real"), v.literal("demo")), status: v.union(v.literal("active"), v.literal("deleting"), v.literal("deleted")) })),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("memberships").withIndex("by_userId_and_status", q => q.eq("userId", ctx.user._id).eq("status", "active")).paginate(args.paginationOpts);
    const rows = await Promise.all(page.page.map(async membership => {
      const household = await ctx.db.get(membership.householdId);
      if (!household || (ctx.user.isAnonymous && household.mode !== "demo")) return null;
      return { membershipId: membership._id, accessPreset:membership.accessPreset??"care_circle" as const, householdId: household._id, role: membership.role, nickname: household.nickname, mode: household.mode, status: household.status };
    }));
    return { ...page, page: rows.filter(row => row !== null) };
  },
});

export const get = userQuery({
  args: { householdId: v.id("households") }, returns: schema.doc("households"),
  handler: async (ctx, args) => (await member(ctx, args.householdId)).household,
});

export const create = userMutation({
  args: { nickname: v.string(), timezone: v.string(), firstTask: v.optional(v.string()), displayName: v.optional(v.string()), adultConfirmed: v.boolean(), authorityStatement: v.string(), noticeVersion: v.string(), emailImport: v.boolean(), aiProcessing: v.boolean(), requestId: v.string() },
  returns: v.id("households"),
  handler: async (ctx, args) => {
    if (ctx.user.isAnonymous || !ctx.user.email || !ctx.user.emailVerificationTime) fail("VERIFIED_ACCOUNT_REQUIRED", "Verify your email before creating a real household.");
    const nickname = text(args.nickname, "Nickname", 80), zone = timezone(args.timezone), title = args.firstTask === undefined ? null : text(args.firstTask, "First responsibility", 160);
    const authorityStatement = text(args.authorityStatement, "Authority statement", 1000), noticeVersion = text(args.noticeVersion, "Notice version", 80);
    if (!args.adultConfirmed) fail("ADULT_CONFIRMATION_REQUIRED", "This product is for adults coordinating care for an adult.");
    const fingerprint = JSON.stringify(args);
    const prior = await priorRequest(ctx, "households.create", args.requestId, fingerprint);
    if (prior) {
      const id = ctx.db.normalizeId("households", prior.resultId);
      if (!id) return fail("NOT_FOUND", "Prior household unavailable.");
      await member(ctx, id); return id;
    }
    const now = Date.now();
    if (args.displayName !== undefined) {
      const displayName = text(args.displayName, "Your name", 80);
      const profile = await ctx.db.query("profiles").withIndex("by_userId", q => q.eq("userId", ctx.user._id)).unique();
      if (profile) await ctx.db.patch(profile._id, { displayName, updatedAt: now });
      else await ctx.db.insert("profiles", { userId: ctx.user._id, displayName, updatedAt: now });
    }
    const householdId = await ctx.db.insert("households", { ownerId: ctx.user._id, nickname, timezone: zone, mode: "real", status: "active", materialRevision: 0, eventSequence: 0, consentVersion: 1, currentCoverageId: null, lastReceiptId: null, provisioning: args.emailImport ? "pending" : "paused", emailImport: args.emailImport, aiProcessing: args.aiProcessing, createdAt: now, updatedAt: now });
    await ctx.db.insert("memberships", { householdId, userId: ctx.user._id, role: "owner", status: "active", joinedAt: now, emailNotifications: false, lastReadSequence: 0 });
    for (const scope of ["coordination", "emailImport", "aiProcessing"] as const) await ctx.db.insert("consents", { householdId, actorId: ctx.user._id, scope, granted: scope === "coordination" ? true : args[scope], noticeVersion, authorityStatement, adultConfirmed: true, recordedAt: now });
    const taskId = title === null ? null : await ctx.db.insert("tasks", { householdId, title, category: "logistics", dueAt: null, ownerId: null, requestedOwnerId: null, status: "open", note: "", sourceRefs: [], version: 1, createdBy: ctx.user._id, updatedAt: now });
    await ctx.db.insert("mailAccounts", { householdId, status: args.emailImport ? "pending" : "paused", contactSyncState: "pending", version: 1 });
    await record(ctx, { householdId, actorId: ctx.user._id, type: "household.created", entity: { kind: "household", id: householdId }, after: title === null ? "Household created." : "Household created with first responsibility." });
    if (taskId && title !== null) await record(ctx, { householdId, actorId: ctx.user._id, type: "task.created", entity: { kind: "task", id: taskId }, after: title });
    await saveRequest(ctx, "households.create", args.requestId, fingerprint, householdId);
    if(args.emailImport) await queueOperation(ctx,{householdId,kind:"provisionMail",key:`provision:${householdId}`,actorId:ctx.user._id,automatic:true});
    return householdId;
  },
});

export const rename = userMutation({
  args: { householdId: v.id("households"), nickname: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const { household } = await member(ctx, args.householdId, true);
    const nickname = text(args.nickname, "Nickname", 80);
    if (household.nickname === nickname) return null;
    await ctx.db.patch(household._id, { nickname });
    await record(ctx, { householdId: household._id, actorId: ctx.user._id, type: "household.renamed", entity: { kind: "household", id: household._id }, before: household.nickname, after: nickname });
    return null;
  },
});
