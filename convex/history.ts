import { canReadEvent } from "./model/mailAccess";
import { entity } from "./validators";
import { authorizeEntity } from "./model/entities";
import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import schema from "./schema";
import type { Doc } from "./_generated/dataModel";
import { member, range, userQuery, fail, type UserQueryCtx } from "./model/access";

const kind = v.union(v.literal("task"), v.literal("visit"), v.literal("coverage"), v.literal("handover"), v.literal("thread"), v.literal("source"), v.literal("household"));
const historyEvent = schema.doc("events").extend({
  targetAvailable: v.boolean(), receiptAvailable: v.boolean(),
  sourceLinks: v.array(v.object({ sourceId: v.id("sources"), available: v.boolean() })),
});
async function withLinks(ctx: UserQueryCtx, event: Doc<"events">) {
  const target = await ctx.db.get(event.entity.id);
  const targetAvailable = !!target && (event.entity.kind === "household" ? target._id === event.householdId : "householdId" in target && target.householdId === event.householdId)
    && !("retiring" in target && target.retiring) && !("deleting" in target && target.deleting);
  const handoverId = event.handoverId ?? (event.entity.kind === "handover" ? event.entity.id : null);
  const handover = handoverId ? await ctx.db.get(handoverId) : null;
  const receipt = handover && !handover.retiring && handover.householdId === event.householdId && handover.status === "accepted"
    ? await ctx.db.query("handoverReceipts").withIndex("by_handoverId", q => q.eq("handoverId", handover._id)).unique() : null;
  const sourceLinks = await Promise.all([...new Set(event.sourceRefs.map(ref => ref.sourceId))].map(async sourceId => {
    const source = await ctx.db.get(sourceId);
    return { sourceId, available: !!source && !source.retiring && source.householdId === event.householdId };
  }));
  return { ...event, targetAvailable, receiptAvailable: !!receipt && receipt.householdId === event.householdId, sourceLinks };
}

export const list = userQuery({
  args: { householdId: v.id("households"), from: v.number(), to: v.number(), type: v.optional(v.string()), kind: v.optional(kind), paginationOpts: paginationOptsValidator }, returns: paginationResultValidator(historyEvent),
  handler: async (ctx, args) => {
    await member(ctx, args.householdId); range(args.from, args.to, 366);
    let query = args.kind
      ? ctx.db.query("events").withIndex("by_householdId_and_entityKind_and_timestamp", q => q.eq("householdId", args.householdId).eq("entity.kind", args.kind!).gte("timestamp", args.from).lte("timestamp", args.to))
      : args.type
        ? ctx.db.query("events").withIndex("by_householdId_and_type_and_timestamp", q => q.eq("householdId", args.householdId).eq("type", args.type!).gte("timestamp", args.from).lte("timestamp", args.to))
        : ctx.db.query("events").withIndex("by_householdId_and_timestamp", q => q.eq("householdId", args.householdId).gte("timestamp", args.from).lte("timestamp", args.to));
    if (args.kind && args.type) query = query.filter(q => q.eq(q.field("type"), args.type));
    const result = await query.order("desc").paginate(args.paginationOpts);
    return { ...result, page: await permittedHistory(ctx,result.page) };
  },
});

export const forEntity = userQuery({
  args: { householdId: v.id("households"), target: entity, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("events")),
  handler: async (ctx, args) => {
    await authorizeEntity(ctx, args.householdId, args.target);
    const result=await ctx.db.query("events").withIndex("by_householdId_and_entity", q => q.eq("householdId", args.householdId).eq("entity", args.target)).order("desc").paginate(args.paginationOpts);const visible=await Promise.all(result.page.map(e=>canReadEvent(ctx,e,ctx.user._id)));return {...result,page:result.page.filter((_,i)=>visible[i])};
  },
});

async function acceptance(ctx: UserQueryCtx, membership: Doc<"memberships">) {
  const receipt = membership.lastAcceptedSequence === undefined
    ? await ctx.db.query("handoverReceipts").withIndex("by_householdId_and_recipientId", q => q.eq("householdId", membership.householdId).eq("recipientId", ctx.user._id)).order("desc").first() : null;
  return { sequence: membership.lastAcceptedSequence ?? receipt?.eventSequence ?? 0, at: membership.lastAcceptedAt ?? receipt?.acceptedAt ?? null };
}
export const acceptanceBaseline = userQuery({
  args: { householdId: v.id("households") },
  returns: v.object({ sequence: v.number(), at: v.union(v.number(), v.null()) }),
  handler: async (ctx, args) => {
    const { membership } = await member(ctx, args.householdId);
    return acceptance(ctx, membership);
  },
});

export const sinceAcceptance = userQuery({
  args: { householdId: v.id("households"), kind: v.optional(kind), afterSequence: v.optional(v.number()), paginationOpts: paginationOptsValidator },
  returns: v.object({ baselineAt: v.union(v.number(), v.null()), result: paginationResultValidator(historyEvent) }),
  handler: async (ctx, args) => {
    const { membership } = await member(ctx, args.householdId);
    const baseline = await acceptance(ctx, membership);
    // The client watches acceptanceBaseline separately and starts fresh pages
    // when it changes. Keep each cursor's range stable as new events arrive.
    const sequence = args.afterSequence ?? baseline.sequence;
    if (!Number.isSafeInteger(sequence) || sequence < 0) fail("INVALID_SEQUENCE", "Reload history to refresh its starting point.");
    const query = args.kind
      ? ctx.db.query("events").withIndex("by_householdId_and_entityKind_and_sequence", q => q.eq("householdId", args.householdId).eq("entity.kind", args.kind!).gt("sequence", sequence))
      : ctx.db.query("events").withIndex("by_householdId_and_sequence", q => q.eq("householdId", args.householdId).gt("sequence", sequence));
    const result = await query.order("desc").paginate(args.paginationOpts);
    return { baselineAt: sequence === baseline.sequence ? baseline.at : null, result: { ...result, page: await permittedHistory(ctx,result.page) } };
  },
});

async function permittedHistory(ctx:UserQueryCtx,rows:Doc<"events">[]){const visible=await Promise.all(rows.map(e=>canReadEvent(ctx,e,ctx.user._id)));return Promise.all(rows.filter((_,i)=>visible[i]).map(e=>withLinks(ctx,e)));}
