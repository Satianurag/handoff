import {cleanSettledWorkflow} from "./model/workflowCleanup";
import {threadNeedsEvidence} from "./model/retention";
import {scrubMissingReferences} from "./privacyScopeStore";
import {v} from "convex/values";
import {internalMutation,internalQuery} from "./_generated/server";
import type {Id} from "./_generated/dataModel";
import type {WorkflowId} from "@convex-dev/workflow";
import {generationWorkflow} from "./model/workflows";
import {fail} from "./model/access";
import {record} from "./model/events";
const inspection=v.object({sourceId:v.id("sources"),sourceVersion:v.number(),materialRevision:v.number(),evidenceRevision:v.number(),alreadyClaimed:v.boolean()});
export const begin=internalMutation({args:{jobId:v.id("jobs")},returns:v.union(inspection,v.null()),handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.jobId),source=job?.sourceId?await ctx.db.get(job.sourceId):null,h=job?await ctx.db.get(job.householdId):null;
 if(!job)return null;
 if(!source||h?.status!=="active"){await ctx.db.patch(job._id,{state:"cancelled",updatedAt:Date.now()});return null;}
 if(!source.retiring&&(source.retentionUntil>Date.now()||source.unresolvedReferences>0||["pending","processing"].includes(source.extractionState))){
  await ctx.db.patch(source._id,{retentionUntil:Math.max(source.retentionUntil,Date.now()+86400000)});await ctx.db.patch(job._id,{state:"succeeded",updatedAt:Date.now()});return null;
 }
 await ctx.db.patch(job._id,{state:"running",attempts:job.attempts+1,updatedAt:Date.now()});
 return {sourceId:source._id,sourceVersion:source.version,materialRevision:h.materialRevision,evidenceRevision:h.evidenceRevision??0,alreadyClaimed:source.retiring??false};
}});
export const references=internalQuery({args:{sourceId:v.id("sources"),cursor:v.union(v.string(),v.null())},returns:v.object({protected:v.boolean(),done:v.boolean(),cursor:v.string()}),handler:async(ctx,args)=>{
 const page=await ctx.db.query("sourceUses").withIndex("by_sourceId_and_target",q=>q.eq("sourceId",args.sourceId)).paginate({cursor:args.cursor,numItems:25});
 for(const use of page.page){
  const target=await ctx.db.get(use.target.id);if(!target)continue;
  if(use.target.kind==="handover"&&"snapshotItemCount" in target&&["draft","pending"].includes(target.status))return {protected:true,done:true,cursor:page.continueCursor};
  if(!("sourceRefs" in target)||!target.sourceRefs.some(ref=>ref.sourceId===args.sourceId))continue;
  if((use.target.kind==="task"&&"status" in target&&target.status==="open")||(use.target.kind==="visit"&&"status" in target&&target.status==="upcoming")||(use.target.kind==="draft"&&"state" in target&&!["sent","deleted"].includes(target.state)))return {protected:true,done:true,cursor:page.continueCursor};
 }
 return {protected:false,done:page.isDone,cursor:page.continueCursor};
}});
export const defer=internalMutation({args:{jobId:v.id("jobs")},returns:v.null(),handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.jobId);if(!job)return null;const source=job.sourceId?await ctx.db.get(job.sourceId):null;
 if(source&&!source.retiring)await ctx.db.patch(source._id,{retentionUntil:Date.now()+86400000});
 await ctx.db.patch(job._id,{state:"succeeded",updatedAt:Date.now()});return null;
}});
export const claim=internalMutation({args:{jobId:v.id("jobs"),...inspection.fields},returns:v.boolean(),handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.jobId),source=await ctx.db.get(args.sourceId),h=job?await ctx.db.get(job.householdId):null;
 if(!job||!source||h?.status!=="active")return false;if(source.retiring)return true;
 let protectedSource=source.version!==args.sourceVersion||h.materialRevision!==args.materialRevision||(h.evidenceRevision??0)!==args.evidenceRevision||source.unresolvedReferences>0||["processing","pending"].includes(source.extractionState);
 if(source.threadId&&await threadNeedsEvidence(ctx,source.threadId))protectedSource=true;
 if(source.watchId){const watch=await ctx.db.get(source.watchId),visit=watch?await ctx.db.get(watch.visitId):null;if(watch?.lastSuccessfulSourceId===source._id&&visit?.status==="upcoming")protectedSource=true;}
 const pending=await ctx.db.query("proposals").withIndex("by_sourceId_and_status",q=>q.eq("sourceId",source._id).eq("status","pending")).first();if(pending)protectedSource=true;
 for(const state of ["pending","processing"] as const){const successor=await ctx.db.query("sources").withIndex("by_previousSourceId_and_extractionState",q=>q.eq("previousSourceId",source._id).eq("extractionState",state)).first();if(successor)protectedSource=true;}
 if(protectedSource){await ctx.db.patch(source._id,{retentionUntil:Date.now()+86400000});await ctx.db.patch(job._id,{state:"succeeded",updatedAt:Date.now()});return false;}
 await ctx.db.patch(source._id,{retiring:true});await record(ctx,{householdId:h._id,actorId:null,type:"source.retention",entity:{kind:"source",id:source._id},after:"Original source reached its retention limit and is being removed."});return true;
}});
export const providerContext=internalQuery({args:{jobId:v.id("jobs")},returns:v.union(v.object({inboxId:v.string(),messageId:v.string()}),v.null()),handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.jobId),source=job?.sourceId?await ctx.db.get(job.sourceId):null;if(!job||!source?.retiring)return null;
 const message=await ctx.db.query("mailMessages").withIndex("by_sourceId",q=>q.eq("sourceId",source._id)).first();if(!message)return null;return {inboxId:message.inboxId,messageId:message.providerMessageId};
}});
export const purge=internalMutation({args:{jobId:v.id("jobs")},returns:v.boolean(),handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.jobId),source=job?.sourceId?await ctx.db.get(job.sourceId):null;if(!job||!source)return true;if(!source.retiring||!source.providerRemoved)return false;
 const proposals=await ctx.db.query("proposals").withIndex("by_sourceId",q=>q.eq("sourceId",source._id)).take(25);for(const p of proposals)await ctx.db.delete(p._id);if(proposals.length===25)return false;
 const uses=await ctx.db.query("sourceUses").withIndex("by_sourceId_and_target",q=>q.eq("sourceId",source._id)).take(25);for(const use of uses)await ctx.db.delete(use._id);if(uses.length===25)return false;
 const runs=await ctx.db.query("generationRuns").withIndex("by_sourceId",q=>q.eq("sourceId",source._id)).take(10);
 for(const run of runs){const generation=await ctx.db.get(run.jobId);if(generation?.workflowId&&!await cleanSettledWorkflow(ctx,generationWorkflow,generation.workflowId,true))return false;if(generation)await ctx.db.delete(generation._id);await ctx.db.delete(run._id);}if(runs.length===10)return false;
 const messages=await ctx.db.query("mailMessages").withIndex("by_sourceId",q=>q.eq("sourceId",source._id)).take(25);for(const message of messages)await ctx.db.delete(message._id);if(messages.length===25)return false;
 if(source.threadId){const remaining=await ctx.db.query("mailMessages").withIndex("by_threadId_and_occurredAt",q=>q.eq("threadId",source.threadId!)).first();const thread=await ctx.db.get(source.threadId);if(!remaining&&thread)await ctx.db.patch(thread._id,{subject:"Original messages removed",version:thread.version+1});}
 await ctx.db.patch(source._id,{plaintext:"",warnings:[]});return true;
}});

export const providerRemoved=internalMutation({args:{jobId:v.id("jobs")},returns:v.null(),handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.jobId),source=job?.sourceId?await ctx.db.get(job.sourceId):null;if(source?.retiring)await ctx.db.patch(source._id,{providerRemoved:true});return null;
}});

export const redact=internalMutation({args:{jobId:v.id("jobs"),table:v.string(),cursor:v.union(v.string(),v.null())},returns:v.object({cursor:v.string(),done:v.boolean()}),handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.jobId);if(!job)return {cursor:"",done:true};return scrubMissingReferences(ctx,job.householdId,args.table,args.cursor);
}});
export const finish=internalMutation({args:{jobId:v.id("jobs"),success:v.boolean()},returns:v.null(),handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.jobId);if(!job||job.state==="cancelled")return null;
 if(args.success&&job.sourceId){const source=await ctx.db.get(job.sourceId);if(source&&(!source.retiring||!source.providerRemoved||source.plaintext!==""))return fail("RETENTION_INCOMPLETE","Provider and local source cleanup must complete before recording success.");}
 await ctx.db.patch(job._id,{state:args.success?"succeeded":"failed",updatedAt:Date.now(),safeError:args.success?undefined:"Retention cleanup is incomplete. Provider deletion will be retried; no completion is claimed."});
 if(args.success&&job.sourceId){const source=await ctx.db.get(job.sourceId);if(source?.retiring&&source.providerRemoved)await ctx.db.delete(source._id);}
 if(!args.success&&job.sourceId){const source=await ctx.db.get(job.sourceId);if(source)await ctx.db.patch(source._id,{retentionUntil:Date.now()+3600000});}return null;
}});
