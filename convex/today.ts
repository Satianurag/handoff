import {canReadMail,canReadSource,canReadEvent,redactSourceRefs} from "./model/mailAccess";
import { v } from "convex/values";
import schema from "./schema";
import { member, range, timestamp, userQuery } from "./model/access";

const limit = 20;
export const get = userQuery({
  args: { householdId: v.id("households"), now: v.number(), dayEnd: v.number(), mine: v.boolean() },
  returns: v.object({
    household: schema.doc("households"), coverage: v.union(schema.doc("coverage"), v.null()), coverageNeedsConfirmation: v.boolean(),
    baselineAt: v.union(v.number(), v.null()), requested: v.array(schema.doc("tasks")), undated: v.array(schema.doc("tasks")), later: v.array(schema.doc("tasks")), overdueVisits: v.array(schema.doc("visits")),
    tasks: v.array(schema.doc("tasks")), unassigned: v.array(schema.doc("tasks")), handovers: v.array(schema.doc("handovers")), outgoingHandovers: v.array(schema.doc("handovers")),
    nextVisit: v.union(schema.doc("visits"), v.null()), pendingProposals: v.array(schema.doc("proposals")), waitingThreads: v.array(schema.doc("mailThreads")),
    changes: v.array(schema.doc("events")), lastReceipt: v.union(schema.doc("handoverReceipts"), v.null()),
    more: v.object({ requested: v.boolean(), undated: v.boolean(), later: v.boolean(), overdueVisits: v.boolean(), tasks: v.boolean(), unassigned: v.boolean(), handovers: v.boolean(), outgoingHandovers: v.boolean(), proposals: v.boolean(), waitingThreads: v.boolean(), changes: v.boolean() }),
  }),
  handler: async (ctx, args) => {
    const { household, membership } = await member(ctx, args.householdId);
    timestamp(args.now); range(args.now, args.dayEnd, 2);
    const coverage = household.currentCoverageId ? await ctx.db.get(household.currentCoverageId) : null;
    const taskQuery = () => args.mine
      ? ctx.db.query("tasks").withIndex("by_householdId_and_ownerId_and_status_and_dueAt", q => q.eq("householdId", household._id).eq("ownerId", ctx.user._id).eq("status", "open").gte("dueAt", 0).lte("dueAt", args.dayEnd))
      : ctx.db.query("tasks").withIndex("by_householdId_and_status_and_dueAt", q => q.eq("householdId", household._id).eq("status", "open").gte("dueAt", 0).lte("dueAt", args.dayEnd));
    const tasks = await taskQuery().take(limit + 1);
    const requested = await ctx.db.query("tasks").withIndex("by_householdId_and_requestedOwnerId_and_status_and_dueAt", q => q.eq("householdId", household._id).eq("requestedOwnerId", ctx.user._id).eq("status", "open")).take(limit + 1);
    const undated = await (args.mine
      ? ctx.db.query("tasks").withIndex("by_householdId_and_ownerId_and_status_and_dueAt", q => q.eq("householdId", household._id).eq("ownerId", ctx.user._id).eq("status", "open").eq("dueAt", null))
      : ctx.db.query("tasks").withIndex("by_householdId_and_status_and_dueAt", q => q.eq("householdId", household._id).eq("status", "open").eq("dueAt", null))).take(limit + 1);
    const later = await ctx.db.query("tasks").withIndex("by_householdId_and_ownerId_and_status_and_dueAt", q => q.eq("householdId", household._id).eq("ownerId", ctx.user._id).eq("status", "open").gt("dueAt", args.dayEnd).lte("dueAt", 4102444800000)).take(limit + 1);
    const overdueVisits = await ctx.db.query("visits").withIndex("by_householdId_and_status_and_confirmedStartsAt", q => q.eq("householdId", household._id).eq("status", "upcoming").gte("confirmedStartsAt", 0).lt("confirmedStartsAt", args.now)).take(limit + 1);
    const unassigned = await ctx.db.query("tasks").withIndex("by_householdId_and_ownerId_and_status", q => q.eq("householdId", household._id).eq("ownerId", null).eq("status", "open")).take(limit + 1);
    const handovers = await ctx.db.query("handovers").withIndex("by_householdId_and_recipientId_and_status", q => q.eq("householdId", household._id).eq("recipientId", ctx.user._id).eq("status", "pending")).order("desc").take(limit + 1);
    const outgoingHandovers = await ctx.db.query("handovers").withIndex("by_householdId_and_senderId_and_status", q => q.eq("householdId", household._id).eq("senderId", ctx.user._id).eq("status", "pending")).order("desc").take(limit + 1);
    const nextVisit = await ctx.db.query("visits").withIndex("by_householdId_and_status_and_confirmedStartsAt", q => q.eq("householdId", household._id).eq("status", "upcoming").gte("confirmedStartsAt", args.now).lte("confirmedStartsAt", 4102444800000)).first();
    const proposals = await ctx.db.query("proposals").withIndex("by_householdId_and_status", q => q.eq("householdId", household._id).eq("status", "pending")).take(limit + 1);
    const waiting = await ctx.db.query("mailThreads").withIndex("by_waiting_view", q => q.eq("householdId", household._id).eq("deleting", false).eq("quarantined", false).eq("archived", false).eq("state", "waiting")).order("desc").take(limit + 1);
    const receipt = await ctx.db.query("handoverReceipts").withIndex("by_householdId_and_recipientId", q => q.eq("householdId", household._id).eq("recipientId", ctx.user._id)).order("desc").first();
    const changes = await ctx.db.query("events").withIndex("by_householdId_and_sequence", q => q.eq("householdId", household._id).gt("sequence", membership.lastAcceptedSequence ?? receipt?.eventSequence ?? 0).lte("sequence", household.eventSequence)).order("desc").take(limit + 1);
    const mailAccess=await canReadMail(ctx,household._id,ctx.user._id);
    const visibleHandovers=handovers.filter(row=>row.mailContextRestricted===false||mailAccess),visibleOutgoing=outgoingHandovers.filter(row=>row.mailContextRestricted===false||mailAccess);
    const visibleProposals=[];for(const proposal of proposals)if(await canReadSource(ctx,await ctx.db.get(proposal.sourceId),ctx.user._id))visibleProposals.push(proposal);
    const visibleChanges=[];for(const change of changes)if(await canReadEvent(ctx,change,ctx.user._id))visibleChanges.push(change);
    const safeTasks=async(rows:typeof tasks)=>Promise.all(rows.slice(0,limit).map(async row=>({...row,sourceRefs:await redactSourceRefs(ctx,row.sourceRefs,ctx.user._id)})));
    const safeVisits=async(rows:typeof overdueVisits)=>Promise.all(rows.slice(0,limit).map(async row=>({...row,sourceRefs:await redactSourceRefs(ctx,row.sourceRefs,ctx.user._id)})));
    return { household, coverage, baselineAt: membership.lastAcceptedAt ?? receipt?.acceptedAt ?? null, requested: await safeTasks(requested), undated: await safeTasks(undated), later: await safeTasks(later), overdueVisits: await safeVisits(overdueVisits), coverageNeedsConfirmation: !coverage || coverage.endsAt <= args.now, tasks: await safeTasks(tasks), unassigned: await safeTasks(unassigned), handovers: visibleHandovers.slice(0, limit), outgoingHandovers: visibleOutgoing.slice(0, limit), nextVisit:nextVisit?{...nextVisit,sourceRefs:await redactSourceRefs(ctx,nextVisit.sourceRefs,ctx.user._id)}:null, pendingProposals: visibleProposals.slice(0, limit), waitingThreads: mailAccess?waiting.slice(0, limit):[], changes: visibleChanges.slice(0, limit), lastReceipt: receipt,
      more: { requested: requested.length > limit, undated: undated.length > limit, later: later.length > limit, overdueVisits: overdueVisits.length > limit, tasks: tasks.length > limit, unassigned: unassigned.length > limit, handovers: visibleHandovers.length > limit, outgoingHandovers: visibleOutgoing.length > limit, proposals: visibleProposals.length > limit, waitingThreads: mailAccess&&waiting.length > limit, changes: visibleChanges.length > limit } };
  },
});
