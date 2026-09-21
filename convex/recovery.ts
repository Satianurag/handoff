import {v} from "convex/values";
import type {WorkflowId} from "@convex-dev/workflow";
import {internalMutation} from "./_generated/server";
import {internal} from "./_generated/api";
import {queueOperation} from "./model/operations";
import {generationKinds,generationWorkflow,operationalWorkflow} from "./model/workflows";
export const resumeSources=internalMutation({args:{state:v.union(v.literal("pending"),v.literal("paused"))},returns:v.null(),handler:async(ctx,args):Promise<null>=>{
 const key=`resumeSources:${args.state}`,state=await ctx.db.query("maintenanceCursors").withIndex("by_key",q=>q.eq("key",key)).unique();
 const page=await ctx.db.query("sources").withIndex("by_extractionState",q=>q.eq("extractionState",args.state)).paginate({cursor:state?.cursor??null,numItems:10,maximumBytesRead:200000});
 for(const source of page.page){
  const h=await ctx.db.get(source.householdId);if(source.retiring||h?.status!=="active"||!h.aiProcessing||(source.kind==="email"&&!h.emailImport)||!source.plaintext.trim()||(h.expiresAt&&h.expiresAt<=Date.now()))continue;
  const thread=source.threadId?await ctx.db.get(source.threadId):null;if(source.threadId&&(!thread||thread.deleting||thread.quarantined))continue;
  if(args.state==="paused")await ctx.db.patch(source._id,{extractionState:"pending"});
  try{await ctx.runMutation(internal.operationStore.extractSource,{sourceId:source._id});}catch{await ctx.db.patch(source._id,{extractionState:"failed"});}
 }
 const fields={key,cursor:page.isDone?null:page.continueCursor};if(state)await ctx.db.patch(state._id,fields);else await ctx.db.insert("maintenanceCursors",fields);return null;
}});
export const staleJobs=internalMutation({args:{},returns:v.null(),handler:async(ctx):Promise<null>=>{
 const jobs=await ctx.db.query("jobs").withIndex("by_state_and_updatedAt",q=>q.eq("state","running").lte("updatedAt",Date.now()-30*60000)).take(20);
 for(const job of jobs){
  const manager=generationKinds.has(job.kind)?generationWorkflow:operationalWorkflow;
  if(job.workflowId){
   try{
    const status=await manager.status(ctx,job.workflowId as WorkflowId);
    if(status.type==="inProgress")continue;
    await manager.cleanup(ctx,job.workflowId as WorkflowId);
   }catch(error){if(!(error instanceof Error)||!error.message.includes(`Workflow not found: ${job.workflowId}`))continue;}
   await ctx.db.patch(job._id,{workflowId:undefined});
  }
  if(generationKinds.has(job.kind))await ctx.runMutation(internal.generationStore.failed,{jobId:job._id,reason:"INTERRUPTED_OPERATION",retryable:false});
  else if(job.kind==="retireSource")await ctx.runMutation(internal.retentionSourceStore.finish,{jobId:job._id,success:false});
  else if(job.kind==="refreshWatch"&&job.watchId)await ctx.runMutation(internal.webStore.failed,{watchId:job.watchId,jobId:job._id,reason:"Source check was interrupted. The last successful source remains available."});
  else{
   if(["retireMail","retireNotification"].includes(job.kind))await ctx.runMutation(internal.retentionRawStore.retryLater,{jobId:job._id});
   if(job.kind==="sendApprovedDraft"&&job.sendIntentId){const intent=await ctx.db.get(job.sendIntentId);if(intent?.state==="sending")await ctx.runMutation(internal.mailStore.sendFailed,{sendIntentId:intent._id,uncertain:true});}
   if(job.kind==="notifyMember"&&job.notificationId){const send=await ctx.runQuery(internal.notificationStore.read,{notificationId:job.notificationId});if(send?.state==="sending")await ctx.runMutation(internal.notificationStore.failed,{notificationId:job.notificationId,uncertain:true});}
   await ctx.db.patch(job._id,{state:"failed",safeError:"Operation was interrupted. Check its current state before retrying.",updatedAt:Date.now()});
  }
 }return null;
}});
export const run=internalMutation({args:{},returns:v.null(),handler:async(ctx):Promise<null>=>{
 const pause=await ctx.db.query("operatorSettings").withIndex("by_key",q=>q.eq("key","pauseAutomaticOperations")).unique();if(pause?.enabled)return null;
 await ctx.runMutation(internal.recovery.resumeSources,{state:"pending"});await ctx.runMutation(internal.recovery.resumeSources,{state:"paused"});await ctx.runMutation(internal.recovery.staleJobs,{});
 for(const state of ["sending","unknown"] as const){const sends=await ctx.db.query("sendIntents").withIndex("by_state_and_lastReconciledAt",q=>q.eq("state",state).lte("lastReconciledAt",Date.now()-3600000)).take(10);
  for(const send of sends){if((send.lastAttemptAt??send.createdAt)>Date.now()-10*60000)continue;
   await queueOperation(ctx,{householdId:send.householdId,kind:"reconcileSend",key:`reconcile-send:${send._id}:${send.lastReconciledAt??0}`,actorId:null,sendIntentId:send._id,automatic:true});
  }
 }return null;
}});
