import { v } from "convex/values";
import { vResultValidator, vWorkflowId } from "@convex-dev/workflow";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { generationWorkflow } from "./model/workflows";

export const execute = generationWorkflow.define({
 args:{jobId:v.id("jobs")},returns:v.boolean(),
 handler:async(step,args):Promise<boolean>=>{
  for(let attempt=0;attempt<4;attempt++){
   await step.runAction(internal.generate.performInternal,args,{retry:false});
   const state=await step.runQuery(internal.generationWorkflows.progress,args);
   if(state.done)return true;
   if(!state.retryAfterMs||attempt===3)return false;
   await step.sleep(state.retryAfterMs);
  }
  return false;
 }
});
export const progress=internalQuery({
 args:{jobId:v.id("jobs")},returns:v.object({done:v.boolean(),retryAfterMs:v.union(v.number(),v.null())}),
 handler:async(ctx,args)=>{
  const job=await ctx.db.get(args.jobId),run=await ctx.db.query("generationRuns").withIndex("by_jobId",q=>q.eq("jobId",args.jobId)).unique();
  // Delay was persisted by the action. No query-side wall clock is needed.
  return {done:job?.state==="succeeded",retryAfterMs:job?.state==="failed"&&run?.retryable&&job.retryAt?Math.max(1000,job.retryAt-job.updatedAt):null};
 }
});
export const completed=internalMutation({
 args:{workflowId:vWorkflowId,result:vResultValidator,context:v.object({jobId:v.id("jobs")})},returns:v.null(),
 handler:async(ctx,args):Promise<null>=>{
  const job=await ctx.db.get(args.context.jobId);
  if(job?.workflowId===args.workflowId){
   if(!["succeeded","failed","cancelled"].includes(job.state))await ctx.runMutation(internal.generationStore.failed,{jobId:job._id,reason:"MODEL_WORKFLOW_INTERRUPTED",retryable:false});
   await ctx.db.patch(job._id,{workflowId:undefined,updatedAt:Date.now()});
  }
  await generationWorkflow.cleanup(ctx,args.workflowId);
  return null;
 }
});
export const start=internalMutation({
 args:{jobId:v.id("jobs")},returns:v.null(),
 handler:async(ctx,args):Promise<null>=>{
  const job=await ctx.db.get(args.jobId);
  if(!job||job.workflowId||!["queued","failed"].includes(job.state))return null;
  const id=await generationWorkflow.start(ctx,internal.generationWorkflows.execute,args,{startAsync:true,onComplete:internal.generationWorkflows.completed,context:args});
  await ctx.db.patch(job._id,{workflowId:id});return null;
 }
});
