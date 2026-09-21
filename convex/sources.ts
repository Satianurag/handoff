import { requireSourceAccess } from "./model/mailAccess";
import { v } from "convex/values";
import schema from "./schema";
import { fail, member, userQuery } from "./model/access";

export const get = userQuery({
  args: { sourceId: v.id("sources") }, returns: schema.doc("sources"),
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId); if (!source || source.retiring) return fail("NOT_FOUND", "Original source unavailable or removed.");
    await requireSourceAccess(ctx,source); return source;
  },
});

// Consumer projection: provider identity comes from the actual retained message,
// never from a sender name mentioned inside forwarded/plaintext content.
export const view = userQuery({
  args: { sourceId: v.id("sources") },
  returns: v.object({
    source: schema.doc("sources"), sender: v.union(v.string(),v.null()), receivedAt: v.union(v.number(),v.null()),
    threadAvailable: v.boolean(), extractionBlockedReason: v.union(v.string(),v.null()),
    latestExtraction: v.union(schema.doc("jobs").pick("_id","state","updatedAt","safeError","retryAt"),v.null()),
  }),
  handler: async (ctx,args) => {
    const source=await ctx.db.get(args.sourceId);
    if(!source||source.retiring)return fail("NOT_FOUND","Original source unavailable or removed.");
    const {household}=await member(ctx,source.householdId);await requireSourceAccess(ctx,source);
    const thread=source.threadId?await ctx.db.get(source.threadId):null;
    const threadAvailable=!!thread&&!thread.deleting&&thread.householdId===source.householdId;
    const message=source.kind==="email"?await ctx.db.query("mailMessages").withIndex("by_sourceId",q=>q.eq("sourceId",source._id)).first():null;
    const messageAvailable=!!message&&!message.retiring&&message.householdId===source.householdId&&message.threadId===source.threadId&&threadAvailable;
    const job=await ctx.db.query("jobs").withIndex("by_householdId_and_target_and_kind",q=>q.eq("householdId",source.householdId).eq("target",{kind:"source",id:source._id}).eq("kind","extractLogistics")).order("desc").first();
    const extractionBlockedReason=!household.aiProcessing?"AI processing is off. You can still review the original and update confirmed details manually."
      :source.kind==="email"&&!household.emailImport?"Email processing is paused in household settings."
      :source.extractionState==="quarantined"||thread?.quarantined?"Review the actual email sender in the conversation before extracting suggestions."
      :source.extractionState==="unsupported"||!source.plaintext.trim()?"This source has no supported text for extraction. Review its original content manually."
      :source.threadId&&!threadAvailable?"The original conversation is unavailable. Update confirmed details manually.":null;
    return {source,sender:messageAvailable?message.from:null,receivedAt:messageAvailable?message.occurredAt:null,threadAvailable,extractionBlockedReason,
      latestExtraction:job?{_id:job._id,state:job.state,updatedAt:job.updatedAt,...(job.safeError?{safeError:job.safeError}:{}),...(job.retryAt!==undefined?{retryAt:job.retryAt}:{})}:null};
  },
});
