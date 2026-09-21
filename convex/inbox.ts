import { requireMailAccess, canReadMail } from "./model/mailAccess";
import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import schema from "./schema";
import { member, userQuery } from "./model/access";

export const connection = userQuery({
  args: { householdId: v.id("households") }, returns: v.union(v.object({ address: v.union(v.string(), v.null()), status: v.string(), contactSyncState: v.string(), lastError: v.union(v.string(), v.null()), capacityReached: v.boolean() }), v.null()),
  handler: async (ctx, args) => {
    await requireMailAccess(ctx, args.householdId);
    const account = await ctx.db.query("mailAccounts").withIndex("by_householdId", q => q.eq("householdId", args.householdId)).unique();
    return account ? { address: account.address ?? null, status: account.status, contactSyncState: account.contactSyncState, lastError: account.lastError ?? null, capacityReached: account.capacityReached ?? false } : null;
  },
});

export const list = userQuery({
  args: { householdId: v.id("households"), filter: v.union(v.literal("new"), v.literal("waiting"), v.literal("archived"), v.literal("quarantine"), v.literal("all")), paginationOpts: paginationOptsValidator }, returns: paginationResultValidator(schema.doc("mailThreads")),
  handler: async (ctx, args) => {
    await requireMailAccess(ctx, args.householdId);
    const pagination=args.paginationOpts;
    if(args.filter==="all")return ctx.db.query("mailThreads").withIndex("by_householdId_and_deleting_and_lastMessageAt",q=>q.eq("householdId",args.householdId).eq("deleting",false)).order("desc").paginate(pagination);
    if(args.filter==="archived")return ctx.db.query("mailThreads").withIndex("by_householdId_and_archived_and_lastMessageAt",q=>q.eq("householdId",args.householdId).eq("archived",true)).filter(q=>q.eq(q.field("deleting"),false)).order("desc").paginate(pagination);
    if(args.filter==="waiting")return ctx.db.query("mailThreads").withIndex("by_waiting_view",q=>q.eq("householdId",args.householdId).eq("deleting",false).eq("quarantined",false).eq("archived",false).eq("state","waiting")).order("desc").paginate(pagination);
    const base=ctx.db.query("mailThreads").withIndex("by_inbox_view",q=>q.eq("householdId",args.householdId).eq("deleting",false).eq("quarantined",args.filter==="quarantine").eq("archived",args.filter==="archived"));
    if(args.filter==="new")return base.filter(q=>q.or(q.eq(q.field("state"),"new"),q.eq(q.field("state"),"replyReceived"))).order("desc").paginate(pagination);
    return base.order("desc").paginate(pagination);
  },
});

export const access=userQuery({args:{householdId:v.id("households")},returns:v.object({allowed:v.boolean()}),handler:async(ctx,args)=>{await member(ctx,args.householdId);return {allowed:await canReadMail(ctx,args.householdId,ctx.user._id)};}});
