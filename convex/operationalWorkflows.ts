import {v} from "convex/values";
import {vWorkflowId,vResultValidator} from "@convex-dev/workflow";
import {internalMutation} from "./_generated/server";
import {internal} from "./_generated/api";
import {operationalWorkflow} from "./model/workflows";
export const execute=operationalWorkflow.define({args:{jobId:v.id("jobs")},returns:v.boolean(),handler:async(step,args):Promise<boolean>=>{
 for(let attempt=0;attempt<4;attempt++){
  if(!await step.runMutation(internal.operationStore.claim,args))return true;
  const result=await step.runAction(internal.operationActions.perform,args,{retry:false});
  const retryAfterMs=result.retryAfterMs&&attempt<3?Math.max(result.retryAfterMs,30000*2**attempt):null;
  await step.runMutation(internal.operationStore.outcome,{...args,ok:result.ok,retryAfterMs});
  if(result.ok){if(result.sourceId)await step.runMutation(internal.operationStore.extractSource,{sourceId:result.sourceId});return true;}
  if(!retryAfterMs)return false;
  await step.sleep(retryAfterMs);
 }
 return false;
}});
export const completed=internalMutation({args:{workflowId:vWorkflowId,result:vResultValidator,context:v.object({jobId:v.id("jobs")})},returns:v.null(),handler:async(ctx,args):Promise<null>=>{
 const job=await ctx.db.get(args.context.jobId);
 if(job?.workflowId===args.workflowId){
  if(["retireMail","retireNotification"].includes(job.kind)&&!["succeeded","cancelled"].includes(job.state))await ctx.runMutation(internal.retentionRawStore.retryLater,{jobId:job._id});
  if(job.kind==="retireSource"&&!["succeeded","cancelled"].includes(job.state))await ctx.runMutation(internal.retentionSourceStore.finish,{jobId:job._id,success:false});
  if(job.kind==="notifyMember"&&job.notificationId&&job.state!=="succeeded"){
   const n=await ctx.db.get(job.notificationId);if(n?.emailState==="pending")await ctx.db.patch(n._id,{emailState:"failed"});
  }
  await ctx.db.patch(job._id,{workflowId:undefined,...(!["succeeded","failed","cancelled","needsReview"].includes(job.state)?{state:"failed" as const,safeError:"Background processing was interrupted. Retry from the related resource."}:{}),updatedAt:Date.now()});
 }
 await operationalWorkflow.cleanup(ctx,args.workflowId);return null;
}});
