import {cleanSettledWorkflow} from "./model/workflowCleanup";
import {v} from "convex/values";
import type {WorkflowId} from "@convex-dev/workflow";
import {internalMutation,type MutationCtx} from "./_generated/server";
import type {Id} from "./_generated/dataModel";
import {fail} from "./model/access";
import {generationKinds,generationWorkflow,operationalWorkflow} from "./model/workflows";
async function eraseRequests(ctx:MutationCtx,id:string){
 const rows=await ctx.db.query("requests").withIndex("by_resultId",q=>q.eq("resultId",id)).take(50);for(const row of rows)await ctx.db.delete(row._id);return rows.length<50;
}
async function eraseJob(ctx:MutationCtx,jobId:Id<"jobs">){
 const job=await ctx.db.get(jobId);if(!job)return true;
 if(job.workflowId&&!await cleanSettledWorkflow(ctx,generationKinds.has(job.kind)?generationWorkflow:operationalWorkflow,job.workflowId))return false;
 await ctx.db.delete(job._id);return true;
}
export const prepare=internalMutation({args:{privacyJobId:v.id("privacyJobs"),cursor:v.union(v.string(),v.null())},returns:v.object({cursor:v.string(),done:v.boolean()}),handler:async(ctx,args)=>{
 const request=await ctx.db.get(args.privacyJobId);if(!request||!["deleteThread","deleteDraft"].includes(request.kind))return fail("INVALID_DELETE","Scoped deletion required.");
 const page=await ctx.db.query("jobs").withIndex("by_householdId",q=>q.eq("householdId",request.householdId)).paginate({cursor:args.cursor,numItems:25});
 for(const job of page.page){
  if(!job.workflowId&&!['queued','running'].includes(job.state))continue;
  const run=generationKinds.has(job.kind)?await ctx.db.query("generationRuns").withIndex("by_jobId",q=>q.eq("jobId",job._id)).unique():null;
  const draft=job.draftId||run?.draftId?await ctx.db.get((job.draftId??run!.draftId)!):null;
  const source=run?.sourceId?await ctx.db.get(run.sourceId):null;
  const matches=request.kind==="deleteDraft"?draft?._id===request.draftId:((request.threadId&&draft?.threadId===request.threadId)||(request.threadId&&source?.threadId===request.threadId)||(job.target?.kind==="thread"&&job.target.id===request.threadId));
  if(!matches)continue;
  if(job.workflowId)await (generationKinds.has(job.kind)?generationWorkflow:operationalWorkflow).cancel(ctx,job.workflowId as WorkflowId);
  await ctx.db.patch(job._id,{state:"cancelled",updatedAt:Date.now()});
 }
 await ctx.db.patch(request._id,{state:"running",stage:"stoppingEffects"});return {cursor:page.continueCursor,done:page.isDone};
}});
export const purge=internalMutation({args:{privacyJobId:v.id("privacyJobs")},returns:v.boolean(),handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.privacyJobId);if(!job||!["deleteThread","deleteDraft"].includes(job.kind)||job.processors.find(p=>p.name==="agentmail")?.state!=="succeeded")return fail("INVALID_DELETE","Provider deletion must finish first.");
 if(job.threadId){
  const sources=await ctx.db.query("sources").withIndex("by_threadId",q=>q.eq("threadId",job.threadId)).take(10);
  for(const source of sources){
   const proposals=await ctx.db.query("proposals").withIndex("by_sourceId",q=>q.eq("sourceId",source._id)).take(25);
   for(const p of proposals)await ctx.db.delete(p._id);if(proposals.length===25)return false;
   const runs=await ctx.db.query("generationRuns").withIndex("by_sourceId",q=>q.eq("sourceId",source._id)).take(25);
   for(const run of runs){if(!await eraseJob(ctx,run.jobId))return false;await ctx.db.delete(run._id);}if(runs.length===25)return false;
   const uses=await ctx.db.query("sourceUses").withIndex("by_sourceId_and_target",q=>q.eq("sourceId",source._id)).take(25);for(const use of uses)await ctx.db.delete(use._id);if(uses.length===25)return false;
   if(!await eraseRequests(ctx,source._id))return false;await ctx.db.delete(source._id);
  }
  if(sources.length===10)return false;
  const messages=await ctx.db.query("mailMessages").withIndex("by_threadId_and_occurredAt",q=>q.eq("threadId",job.threadId!)).take(25);
  for(const message of messages)await ctx.db.delete(message._id);if(messages.length===25)return false;
 }
 const draft=job.draftId?await ctx.db.get(job.draftId):null;
 const drafts=job.threadId?await ctx.db.query("mailDrafts").withIndex("by_threadId",q=>q.eq("threadId",job.threadId)).take(10):draft?[draft]:[];
 for(const d of drafts){
  const intents=await ctx.db.query("sendIntents").withIndex("by_draftId",q=>q.eq("draftId",d._id)).take(25);for(const intent of intents)await ctx.db.delete(intent._id);if(intents.length===25)return false;
  const runs=await ctx.db.query("generationRuns").withIndex("by_draftId",q=>q.eq("draftId",d._id)).take(25);for(const run of runs){if(!await eraseJob(ctx,run.jobId))return false;await ctx.db.delete(run._id);}if(runs.length===25)return false;
  const jobs=await ctx.db.query("jobs").withIndex("by_draftId",q=>q.eq("draftId",d._id)).take(25);for(const operation of jobs)if(!await eraseJob(ctx,operation._id))return false;if(jobs.length===25)return false;
  if(!await eraseRequests(ctx,d._id))return false;await ctx.db.delete(d._id);
 }
 if(drafts.length===10)return false;
 if(job.threadId){const thread=await ctx.db.get(job.threadId);if(thread){if(!await eraseRequests(ctx,thread._id))return false;await ctx.db.delete(thread._id);}}
 return true;
}});
export async function scrubMissingReferences(ctx:MutationCtx,householdId:Id<"households">,table:string,cursor:string|null){
 const tables=["tasks","visits","mailDrafts","events","handoverItems","handoverChanges","handoverContextItems"] as const;
 if(!tables.includes(table as typeof tables[number]))return fail("INVALID_TABLE","Reference table unavailable.");
 const page=await ctx.db.query(table as typeof tables[number]).withIndex("by_householdId",q=>q.eq("householdId",householdId)).paginate({cursor:cursor,numItems:25,maximumBytesRead:200000});
 for(const row of page.page){
  const refs="sourceRefs" in row?row.sourceRefs:row.snapshot.sourceRefs;
  const remaining=[];for(const ref of refs){const source=await ctx.db.get(ref.sourceId);if(source&&!(source.retiring&&source.providerRemoved))remaining.push(ref);}
  if(refs.length===remaining.length)continue;
  if(!("sourceRefs" in row))await ctx.db.patch(row._id,{snapshot:{...row.snapshot,sourceRefs:remaining}});
  else if("summary" in row)await ctx.db.patch(row._id,{sourceRefs:remaining,summary:"Original source removed."});
  else await ctx.db.patch(row._id,{sourceRefs:remaining,...("version" in row?{version:row.version+1}:{})});
 }
 return {cursor:page.continueCursor,done:page.isDone};
}
export const removeMissingReferences=internalMutation({args:{privacyJobId:v.id("privacyJobs"),table:v.string(),cursor:v.union(v.string(),v.null())},returns:v.object({cursor:v.string(),done:v.boolean()}),handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.privacyJobId);if(!job||!["deleteThread","deleteDraft"].includes(job.kind))return fail("INVALID_DELETE","Scoped deletion required.");
 return scrubMissingReferences(ctx,job.householdId,args.table,args.cursor);
}});
