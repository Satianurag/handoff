import {v,type Infer} from "convex/values";
import {internalMutation,type MutationCtx} from "./_generated/server";
import type {Id} from "./_generated/dataModel";
import {entity} from "./validators";
import {threadNeedsEvidence} from "./model/retention";
const DAY=86400000;
const table=v.union(v.literal("tasks"),v.literal("visits"),v.literal("coverage"),v.literal("events"),v.literal("handovers"),v.literal("handoverReceipts"),v.literal("webhookEvents"),v.literal("deliveryReceipts"));
async function pendingHandover(ctx:MutationCtx,householdId:Id<"households">){
 for(const status of ["draft","pending"] as const)if(await ctx.db.query("handovers").withIndex("by_householdId_and_status",q=>q.eq("householdId",householdId).eq("status",status)).first())return true;
 return false;
}
export async function activeEntity(ctx:MutationCtx,target:Infer<typeof entity>){
 if(target.kind==="thread")return threadNeedsEvidence(ctx,target.id);
 const row=await ctx.db.get(target.id);if(!row)return false;
 if("extractionState" in row)return row.unresolvedReferences>0||["pending","processing"].includes(row.extractionState);
 if("status" in row)return ["open","upcoming","draft","pending"].includes(row.status);
 if("state" in row)return ["planned","committed","active"].includes(row.state);
 return false;
}
async function resetReceiptPointer(ctx:MutationCtx,receiptId:Id<"handoverReceipts">){
 const receipt=await ctx.db.get(receiptId);if(!receipt)return;
 const h=await ctx.db.get(receipt.householdId);
 const membership=await ctx.db.query("memberships").withIndex("by_householdId_and_userId",q=>q.eq("householdId",receipt.householdId).eq("userId",receipt.recipientId)).unique();
 if(membership&&(membership.lastAcceptedSequence??0)<receipt.eventSequence)await ctx.db.patch(membership._id,{lastAcceptedSequence:receipt.eventSequence,lastAcceptedAt:receipt.acceptedAt});
 if(h?.lastReceiptId===receipt._id)await ctx.db.patch(h._id,{lastReceiptId:null,lastAcceptedSequence:Math.max(h.lastAcceptedSequence??0,receipt.eventSequence)});
}
export const operational=internalMutation({args:{table},returns:v.null(),handler:async(ctx,args)=>{
 const pause=await ctx.db.query("operatorSettings").withIndex("by_key",q=>q.eq("key","pauseAutomaticOperations")).unique();if(pause?.enabled)return null;
 const key=`history:${args.table}`,state=await ctx.db.query("maintenanceCursors").withIndex("by_key",q=>q.eq("key",key)).unique(),cutoff=state?.cursor?state.cutoff!:Date.now();
 const page=await ctx.db.query(args.table).withIndex("by_retentionUntil",q=>q.gt("retentionUntil",undefined).lte("retentionUntil",cutoff)).paginate({cursor:state?.cursor??null,numItems:10,maximumBytesRead:200000});
 for(const row of page.page){
  if(row.householdId&&await pendingHandover(ctx,row.householdId))continue;
  if("workflowId" in row&&row.workflowId)continue;
  if("eventType" in row&&["queued","running"].includes(row.state))continue;
  if("title" in row&&"status" in row&&["open","upcoming"].includes(row.status))continue;
  if("activeOwnerId" in row&&["planned","committed","active"].includes(row.state))continue;
  if("entity" in row&&await activeEntity(ctx,row.entity))continue;
  if("confirmedStartsAt" in row){
   const linked=await ctx.db.query("tasks").withIndex("by_visitId_and_status",q=>q.eq("visitId",row._id).eq("status","open")).first();if(linked)continue;
   const watches=await ctx.db.query("watches").withIndex("by_visitId",q=>q.eq("visitId",row._id)).take(25);
   for(const watch of watches){if(watch.currentJobId){const job=await ctx.db.get(watch.currentJobId);if(job?.workflowId)continue;}await ctx.db.delete(watch._id);}
   if(watches.length)continue;
  }
  if("snapshotItemCount" in row){
   if(["draft","pending"].includes(row.status))continue;
   await ctx.db.patch(row._id,{retiring:true});
   const receipt=await ctx.db.query("handoverReceipts").withIndex("by_handoverId",q=>q.eq("handoverId",row._id)).unique();if(receipt)await resetReceiptPointer(ctx,receipt._id);
   const items=await ctx.db.query("handoverItems").withIndex("by_handoverId",q=>q.eq("handoverId",row._id)).take(25);for(const item of items)await ctx.db.delete(item._id);
   const changes=await ctx.db.query("handoverChanges").withIndex("by_handoverId",q=>q.eq("handoverId",row._id)).take(25);for(const change of changes)await ctx.db.delete(change._id);
   const context=await ctx.db.query("handoverContextItems").withIndex("by_handoverId",q=>q.eq("handoverId",row._id)).take(25);for(const item of context)await ctx.db.delete(item._id);
   const care=await ctx.db.query("handoverCareSnapshots").withIndex("by_handoverId",q=>q.eq("handoverId",row._id)).unique();if(care)await ctx.db.delete(care._id);
   if(items.length===25||changes.length===25||context.length===25)continue;
  }
  if("receiptRevision" in row)await resetReceiptPointer(ctx,row._id);
  await ctx.db.delete(row._id);
 }
 const fields={key,cursor:page.isDone?null:page.continueCursor,cutoff};if(state)await ctx.db.patch(state._id,fields);else await ctx.db.insert("maintenanceCursors",fields);return null;
}});

const auxiliaryTable=v.union(v.literal("requests"),v.literal("notifications"),v.literal("jobs"),v.literal("generationRuns"),v.literal("evaluationReservations"),v.literal("mailDrafts"),v.literal("sendIntents"),v.literal("mailThreads"),v.literal("sourceUses"),v.literal("invites"),v.literal("taskSeries"));
export const auxiliary=internalMutation({args:{table:auxiliaryTable},returns:v.null(),handler:async(ctx,args)=>{
 const pause=await ctx.db.query("operatorSettings").withIndex("by_key",q=>q.eq("key","pauseAutomaticOperations")).unique();if(pause?.enabled)return null;
 const key=`auxiliary:${args.table}`,state=await ctx.db.query("maintenanceCursors").withIndex("by_key",q=>q.eq("key",key)).unique(),cutoff=Date.now()-90*DAY;
 const page=await ctx.db.query(args.table).paginate({cursor:state?.cursor??null,numItems:25,maximumBytesRead:200000});
 for(const row of page.page){
  if("fingerprint" in row){if(row.expiresAt<=Date.now())await ctx.db.delete(row._id);continue;}
  if("sourceId" in row&&"target" in row&&!('operationKey' in row)){
   if(!await ctx.db.get(row.sourceId)||!await ctx.db.get(row.target.id))await ctx.db.delete(row._id);continue;
  }
  if(row._creationTime>(args.table==="generationRuns"?Date.now()-30*DAY:cutoff))continue;
  if("dedupeKey" in row){
   // Keeping a live reminder's key prevents a second reminder after TTL cleanup.
   if(await activeEntity(ctx,row.target))continue;
   const send=await ctx.db.query("notificationSends").withIndex("by_notificationId",q=>q.eq("notificationId",row._id)).unique();if(send)continue;
   await ctx.db.delete(row._id);continue;
  }
  if("operationKey" in row){
   if(row.workflowId||["queued","running","needsReview"].includes(row.state)||row.updatedAt>cutoff)continue;
   if(row.target&&await activeEntity(ctx,row.target))continue;
   const run=await ctx.db.query("generationRuns").withIndex("by_jobId",q=>q.eq("jobId",row._id)).unique();if(run)continue;
   await ctx.db.delete(row._id);continue;
  }
  if("operation" in row&&"inputHash" in row){
   if(["queued","running"].includes(row.state))continue;
   const job=await ctx.db.get(row.jobId);if(job?.workflowId)continue;
   // Preserve the idempotency/retry metadata while its domain target exists.
   // A completed generation no longer needs its user-written instruction.
   if(row.state==="succeeded"&&row.instruction)await ctx.db.patch(row._id,{instruction:""});
   const targetId=row.sourceId??row.draftId??row.handoverId;
   if(targetId&&await ctx.db.get(targetId))continue;
   if(row._creationTime<=cutoff)await ctx.db.delete(row._id);continue;
  }
  if("fixtureId" in row){await ctx.db.delete(row._id);continue;}
  if("editorId" in row){if(row.state!=="sent"||!row.rawRemovedAt)continue;const intent=await ctx.db.query("sendIntents").withIndex("by_draftId",q=>q.eq("draftId",row._id)).first();if(intent)continue;await ctx.db.delete(row._id);continue;}
  if("logicalSendId" in row){if(row.state!=="sent"||!row.rawRemovedAt)continue;await ctx.db.delete(row._id);continue;}
  if("providerThreadId" in row){
   if(await threadNeedsEvidence(ctx,row._id)||row.lastMessageAt>cutoff)continue;
   if(await ctx.db.query("mailMessages").withIndex("by_threadId_and_occurredAt",q=>q.eq("threadId",row._id)).first())continue;
   if(await ctx.db.query("mailDrafts").withIndex("by_threadId",q=>q.eq("threadId",row._id)).first())continue;
   if(await ctx.db.query("sources").withIndex("by_threadId",q=>q.eq("threadId",row._id)).first())continue;
   await ctx.db.delete(row._id);continue;
  }
  if("tokenHash" in row){if(row.expiresAt>cutoff)continue;await ctx.db.delete(row._id);continue;}
  if("generatedThrough" in row){if(row.status!=="cancelled"||row.updatedAt>cutoff)continue;const task=await ctx.db.query("tasks").withIndex("by_seriesId_and_occurrenceKey",q=>q.eq("seriesId",row._id)).first();if(!task)await ctx.db.delete(row._id);}
 }
 const fields={key,cursor:page.isDone?null:page.continueCursor};if(state)await ctx.db.patch(state._id,fields);else await ctx.db.insert("maintenanceCursors",fields);return null;
}});

// Additive migration: preserve recipient baselines before old receipts expire.
export const backfillAcceptance = internalMutation({
 args:{cursor:v.union(v.string(),v.null())},returns:v.object({done:v.boolean(),cursor:v.string()}),
 handler:async(ctx,args)=>{
  const page=await ctx.db.query("memberships").paginate({cursor:args.cursor,numItems:50});
  for(const membership of page.page){
   const receipt=await ctx.db.query("handoverReceipts").withIndex("by_householdId_and_recipientId",q=>q.eq("householdId",membership.householdId).eq("recipientId",membership.userId)).order("desc").first();
   if(receipt&&(membership.lastAcceptedSequence??0)<receipt.eventSequence)await ctx.db.patch(membership._id,{lastAcceptedSequence:receipt.eventSequence,lastAcceptedAt:receipt.acceptedAt});
  }
  return {done:page.isDone,cursor:page.continueCursor};
 }
});
