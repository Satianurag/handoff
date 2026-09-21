import {internal} from "./_generated/api";
import { queueOperation } from "./model/operations";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internalUserMutation, fail, member } from "./model/access";
import { limits, numericSetting } from "./model/limits";
import { record } from "./model/events";

export const create = internalUserMutation({
  args: { capabilityHash: v.string() }, returns: v.id("households"),
  handler: async (ctx, args) => {
    if (!ctx.user.isAnonymous) fail("DEMO_SESSION_REQUIRED", "Start a separate anonymous sample session.");
    const existing = await ctx.db.query("demoSessions").withIndex("by_creatorId", q => q.eq("creatorId", ctx.user._id)).order("desc").first();
    const deletions = await ctx.db.query("privacyJobs").withIndex("by_requestedBy", q => q.eq("requestedBy", ctx.user._id)).order("desc").take(101);
    if (deletions.length > 100 || deletions.some(job => job.kind === "delete" && job.state !== "succeeded")) fail("CLEANUP_PENDING", "Finish sample cleanup before creating another sample.");
    if (existing) {
      const household = await ctx.db.get(existing.householdId);
      if (household?.status === "active" && existing.expiresAt > Date.now()) return household._id;
    }
    const activeLimit = await numericSetting(ctx, "demoActiveLimit", 10);
    const active = await ctx.db.query("households").withIndex("by_mode_and_status_and_expiresAt", q => q.eq("mode", "demo").eq("status", "active").gt("expiresAt", Date.now())).take(activeLimit);
    if (active.length >= activeLimit) fail("DEMO_CAPACITY", "Sample households are at capacity. Try again later.");
    await limits.limit(ctx, "demoUserCreates", { key: ctx.user._id, throws: true });
    await limits.limit(ctx, "demoCreates", { config: { kind: "fixed window", rate: await numericSetting(ctx, "demoDailyLimit", 30), period: 86400000 }, throws: true });
    const now = Date.now(), expiresAt = now + 86400000;
    const householdId = await ctx.db.insert("households", { ownerId: ctx.user._id, nickname: "Sample Pat", timezone: "America/New_York", mode: "demo", status: "active", materialRevision: 0, eventSequence: 0, consentVersion: 1, currentCoverageId: null, lastReceiptId: null, provisioning: "pending", emailImport: true, aiProcessing: true, createdAt: now, updatedAt: now, expiresAt });
    const leoId = await ctx.db.insert("users", { name: "Leo (demo)", isAnonymous: true });
    const profile = await ctx.db.query("profiles").withIndex("by_userId", q => q.eq("userId", ctx.user._id)).unique();
    if (profile) await ctx.db.patch(profile._id, { displayName: "Maya (demo)", updatedAt: now });
    else await ctx.db.insert("profiles", { userId: ctx.user._id, displayName: "Maya (demo)", updatedAt: now });
    for (const userId of [ctx.user._id, leoId]) await ctx.db.insert("memberships", { householdId, userId, role: userId === ctx.user._id ? "owner" : "member", status: "active", joinedAt: now, emailNotifications: false, lastReadSequence: 0 });
    const visitId = await ctx.db.insert("visits", { householdId, title: "Sample Clinic logistics visit", confirmedStartsAt: now + 86400000, timezone: "America/New_York", confirmedAddress: "Sample Clinic — synthetic location", phone: "", note: "Synthetic demonstration; no real appointment.", rideTaskId: null, checklist: [{ key: "keys", label: "Bring house keys", done: false }], status: "upcoming", version: 1, sourceRefs: [], createdBy: ctx.user._id, updatedAt: now });
    const baseTask = { householdId, dueAt: now + 7200000, ownerId: ctx.user._id, requestedOwnerId: null, status: "open" as const, note: "Synthetic sample responsibility.", sourceRefs: [], version: 1, createdBy: ctx.user._id, updatedAt: now };
    await ctx.db.insert("tasks", { ...baseTask, title: "Prepare an evening meal", category: "meal" });
    await ctx.db.insert("tasks", { ...baseTask, title: "Pick up groceries", category: "errand", status: "done", completedBy: ctx.user._id, completedAt: now, retentionUntil: expiresAt });
    const rideId = await ctx.db.insert("tasks", { ...baseTask, title: "Drive to the sample visit", category: "ride", ownerId: null, visitId, dueAt: now + 23 * 3600000 });
    await ctx.db.patch(visitId, { rideTaskId: rideId });
    await ctx.db.insert("tasks", { ...baseTask, title: "Confirm the clinic entrance", category: "logistics", visitId, note: "An office question still needs an answer. Sample mail is sent only to operator-controlled inboxes." });
    const coverageId = await ctx.db.insert("coverage", { householdId, startsAt: now, endsAt: now + 4 * 3600000, plannedOwnerId: ctx.user._id, activeOwnerId: null, state: "committed", note: "Start explicitly when ready.", version: 1, createdBy: ctx.user._id, updatedAt: now });
    await ctx.db.insert("mailAccounts", { householdId, status: "pending", contactSyncState: "pending", version: 1 });
    await ctx.db.insert("demoSessions", { householdId, creatorId: ctx.user._id, secondRoleId: leoId, capabilityHash: args.capabilityHash, fixtureVersion: 1, expiresAt });
    await record(ctx, { householdId, actorId: ctx.user._id, type: "demo.created", entity: { kind: "household", id: householdId }, after: "Isolated synthetic household created. Provider scenario transport has separate, visible progress." });
    await record(ctx, { householdId, actorId: ctx.user._id, type: "coverage.planned", entity: { kind: "coverage", id: coverageId }, after: "Committed coverage is not started automatically." });
    await ctx.scheduler.runAt(expiresAt,internal.maintenance.expireDemo,{householdId});
    await queueOperation(ctx,{householdId,kind:"provisionMail",key:`provision:${householdId}`,actorId:ctx.user._id,automatic:true});
    return householdId;
  },
});

export const issueCapability = internalUserMutation({
  args: { householdId: v.id("households"), capabilityHash: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const { household } = await member(ctx, args.householdId, true);
    const demo = await ctx.db.query("demoSessions").withIndex("by_householdId", q => q.eq("householdId", household._id)).unique();
    if (!demo || household.mode !== "demo" || demo.creatorId !== ctx.user._id || demo.expiresAt <= Date.now()) fail("DEMO_UNAVAILABLE", "This sample household is unavailable.");
    await ctx.db.patch(demo._id, { capabilityHash: args.capabilityHash, capabilityUsedAt: undefined }); return null;
  },
});

export const consumeCapability = internalMutation({
  args: { capabilityHash: v.string() }, returns: v.id("users"),
  handler: async (ctx, args) => {
    const demo = await ctx.db.query("demoSessions").withIndex("by_capabilityHash", q => q.eq("capabilityHash", args.capabilityHash)).unique();
    if (!demo || demo.capabilityUsedAt !== undefined || demo.expiresAt <= Date.now() || !demo.secondRoleId) return fail("DEMO_UNAVAILABLE", "This sample role link expired or was already used.");
    const household = await ctx.db.get(demo.householdId);
    const user = await ctx.db.get(demo.secondRoleId);
    const membership = await ctx.db.query("memberships").withIndex("by_householdId_and_userId", q => q.eq("householdId", demo.householdId).eq("userId", demo.secondRoleId!)).unique();
    if (!household || household.mode !== "demo" || household.status !== "active" || !user?.isAnonymous || membership?.status !== "active") fail("DEMO_UNAVAILABLE", "This sample household is unavailable.");
    await ctx.db.patch(demo._id, { capabilityUsedAt: Date.now() }); return demo.secondRoleId;
  },
});

export const authorizeReset = internalUserMutation({
  args: { householdId: v.id("households") }, returns: v.null(),
  handler: async (ctx, args) => {
    const household = await ctx.db.get(args.householdId);
    const demo = await ctx.db.query("demoSessions").withIndex("by_householdId", q => q.eq("householdId", args.householdId)).unique();
    if (!household || household.mode !== "demo" || !demo || demo.creatorId !== ctx.user._id || !ctx.user.isAnonymous) fail("DEMO_UNAVAILABLE", "Only the sample creator can reset this sample.");
    return null;
  },
});

export const authorizeReplacement = internalUserMutation({
  args: { cleanupJobId: v.id("privacyJobs") }, returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.cleanupJobId);
    if (!ctx.user.isAnonymous || !job || job.requestedBy !== ctx.user._id || job.kind !== "delete") fail("DEMO_UNAVAILABLE", "This sample reset is unavailable.");
    if (job.state !== "succeeded") fail("CLEANUP_PENDING", "Wait for sample cleanup to finish before creating its replacement.");
    return null;
  },
});
