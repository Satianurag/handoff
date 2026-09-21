import {paginationOptsValidator,paginationResultValidator} from "convex/server";
import { v } from "convex/values";
import schema from "./schema";
import { checkVersion, fail, member, range, text, timestamp, userMutation, userQuery } from "./model/access";
import { record } from "./model/events";
import { priorRequest, saveRequest } from "./model/requests";

export const get = userQuery({
  args: { coverageId: v.id("coverage") }, returns: schema.doc("coverage"),
  handler: async (ctx, args) => { const block = await ctx.db.get(args.coverageId); if (!block) return fail("NOT_FOUND", "Coverage unavailable."); await member(ctx, block.householdId); return block; },
});

export const create = userMutation({
  args: { householdId: v.id("households"), startsAt: v.number(), endsAt: v.number(), volunteer: v.boolean(), note: v.string(), requestId: v.string() }, returns: v.id("coverage"),
  handler: async (ctx, args) => {
    await member(ctx, args.householdId); range(args.startsAt, args.endsAt, 7);
    const note = text(args.note, "Note", 4000, true), fingerprint = JSON.stringify(args);
    const prior = await priorRequest(ctx, "coverage.create", args.requestId, fingerprint);
    if (prior) { const id = ctx.db.normalizeId("coverage", prior.resultId); if (!id) return fail("NOT_FOUND", "Coverage unavailable."); return id; }
    const id = await ctx.db.insert("coverage", { householdId: args.householdId, startsAt: args.startsAt, endsAt: args.endsAt, plannedOwnerId: args.volunteer ? ctx.user._id : null, activeOwnerId: null, state: args.volunteer ? "committed" : "planned", version: 1, note, createdBy: ctx.user._id, updatedAt: Date.now() });
    await record(ctx, { householdId: args.householdId, actorId: ctx.user._id, type: "coverage.created", entity: { kind: "coverage", id }, after: args.volunteer ? "Committed, not started." : "Unassigned planned coverage." });
    await saveRequest(ctx, "coverage.create", args.requestId, fingerprint, id); return id;
  },
});

export const edit = userMutation({
  args: { coverageId: v.id("coverage"), expectedVersion: v.number(), startsAt: v.number(), endsAt: v.number(), note: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const block = await ctx.db.get(args.coverageId); if (!block) return fail("NOT_FOUND", "Coverage unavailable.");
    await member(ctx, block.householdId); checkVersion(block, args.expectedVersion); range(args.startsAt, args.endsAt, 7);
    if (["ended", "cancelled"].includes(block.state)) fail("INVALID_STATE", "Ended or cancelled coverage cannot be edited.");
    if (block.state === "active" && args.startsAt !== block.startsAt) fail("INVALID_TIME", "Active coverage retains its original planned start.");
    await ctx.db.patch(block._id, { startsAt: args.startsAt, endsAt: args.endsAt, note: text(args.note, "Note", 4000, true), version: block.version + 1, updatedAt: Date.now() });
    await record(ctx, { householdId: block.householdId, actorId: ctx.user._id, type: "coverage.edited", entity: { kind: "coverage", id: block._id }, before: `${block.startsAt}/${block.endsAt}`, after: `${args.startsAt}/${args.endsAt}` });
    return null;
  },
});

export const transition = userMutation({
  args: { coverageId: v.id("coverage"), expectedVersion: v.number(), operation: v.union(v.literal("volunteer"), v.literal("withdraw"), v.literal("start"), v.literal("end"), v.literal("cancel")), reason: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const block = await ctx.db.get(args.coverageId); if (!block) return fail("NOT_FOUND", "Coverage unavailable.");
    const { household } = await member(ctx, block.householdId); checkVersion(block, args.expectedVersion);
    const now = Date.now(), op = args.operation;
    if (["ended", "cancelled"].includes(block.state)) fail("INVALID_STATE", "This coverage is already resolved.");
    if (op === "volunteer") {
      if (block.state !== "planned" || block.plannedOwnerId) fail("ALREADY_CLAIMED", "This coverage already has an owner.");
      await ctx.db.patch(block._id, { plannedOwnerId: ctx.user._id, state: "committed" });
    } else if (op === "withdraw") {
      if (block.plannedOwnerId !== ctx.user._id || block.state !== "committed") fail("INVALID_STATE", "You can withdraw only from your unstarted commitment.");
      await ctx.db.patch(block._id, { plannedOwnerId: null, state: "planned" });
    } else if (op === "start") {
      if (household.currentCoverageId) fail("COVERAGE_CONFLICT", "End or explicitly accept a handover of current coverage first.");
      if (block.plannedOwnerId && block.plannedOwnerId !== ctx.user._id) fail("FORBIDDEN", "Another member committed to this coverage.");
      if (block.endsAt <= now) fail("EXPIRED_COVERAGE", "Update the coverage end before starting it.");
      await ctx.db.patch(block._id, { plannedOwnerId: ctx.user._id, activeOwnerId: ctx.user._id, state: "active", actualStart: now });
      await ctx.db.patch(household._id, { currentCoverageId: block._id });
    } else if (op === "end") {
      if (block.state !== "active" || household.currentCoverageId !== block._id) fail("INVALID_STATE", "This coverage is not active.");
      if (block.activeOwnerId !== ctx.user._id) {
        if (household.ownerId !== ctx.user._id) fail("FORBIDDEN", "Only the active member or household owner can end this coverage.");
        text(args.reason ?? "", "Owner correction reason", 1000);
      }
      await ctx.db.patch(block._id, { activeOwnerId: null, state: "ended", actualEnd: now, retentionUntil: now + 90 * 86400000 });
      await ctx.db.patch(household._id, { currentCoverageId: null });
    } else {
      if (block.state === "active") fail("INVALID_STATE", "End active coverage explicitly before cancellation.");
      await ctx.db.patch(block._id, { state: "cancelled", retentionUntil: now + 90 * 86400000 });
    }
    await ctx.db.patch(block._id, { version: block.version + 1, updatedAt: now });
    await record(ctx, { householdId: block.householdId, actorId: ctx.user._id, type: `coverage.${op}`, entity: { kind: "coverage", id: block._id }, before: block.state, after: `${op}; ${args.reason ?? ""}` });
    return null;
  },
});

export const overlaps = userQuery({
  args: { householdId: v.id("households"), startsAt: v.number(), endsAt: v.number() }, returns: v.array(schema.doc("coverage")),
  handler: async (ctx, args) => {
    await member(ctx, args.householdId); range(args.startsAt, args.endsAt, 7);
    // All coverage blocks are bounded to seven days; this captures every block
    // that could overlap, including those beginning before the requested range.
    const rows = await ctx.db.query("coverage").withIndex("by_householdId_and_startsAt", q => q.eq("householdId", args.householdId).gte("startsAt", Math.max(0, args.startsAt - 7 * 86400000)).lt("startsAt", args.endsAt)).take(501);
    if (rows.length > 500) fail("RANGE_TOO_DENSE", "Narrow the coverage range.");
    return rows.filter(row => row.endsAt > args.startsAt && row.state !== "cancelled");
  },
});

export const handoverOptions=userQuery({
 args:{householdId:v.id("households"),state:v.union(v.literal("planned"),v.literal("committed")),now:v.number(),paginationOpts:paginationOptsValidator},returns:paginationResultValidator(schema.doc("coverage")),
 handler:async(ctx,args)=>{
  await member(ctx,args.householdId);timestamp(args.now);
  return ctx.db.query("coverage").withIndex("by_householdId_and_plannedOwnerId_and_state_and_endsAt",q=>q.eq("householdId",args.householdId).eq("plannedOwnerId",args.state==="planned"?null:ctx.user._id).eq("state",args.state).gt("endsAt",args.now).lte("endsAt",4102444800000)).paginate(args.paginationOpts);
 }
});
