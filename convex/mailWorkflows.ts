import {v} from "convex/values";
import {vWorkflowId,vResultValidator} from "@convex-dev/workflow";
import {internalMutation} from "./_generated/server";
import {internal} from "./_generated/api";
import {operationalWorkflow} from "./model/workflows";
export const ingestMessage=operationalWorkflow.define({
 args:{eventId:v.id("webhookEvents")},returns:v.boolean(),
 handler:async(step,args):Promise<boolean>=>{
  for(let attempt=0;attempt<4;attempt++){
   const work=await step.runMutation(internal.webhookStore.claim,args);if(!work)return true;
   const result=await step.runAction(internal.mail.ingestForWorkflow,work,{retry:false});
   if(!result.failed){if(result.messageId)await step.runMutation(internal.webhookStore.extractedSource,{messageId:result.messageId});return true;}
   if(!result.retryAfterMs||attempt===3)return false;
   await step.sleep(result.retryAfterMs*2**attempt);
  }
  return false;
 }
});
export const completed=internalMutation({
 args:{workflowId:vWorkflowId,result:vResultValidator,context:v.object({eventId:v.id("webhookEvents")})},returns:v.null(),
 handler:async(ctx,args):Promise<null>=>{
  const event=await ctx.db.get(args.context.eventId);
  if(event?.workflowId===args.workflowId)await ctx.db.patch(event._id,{state:event.state==="cancelled"?"cancelled":args.result.kind==="success"&&args.result.returnValue===true?"succeeded":"failed",safeError:args.result.kind==="success"&&args.result.returnValue===true?undefined:"Message processing did not finish. Operator retry can resume the same event.",workflowId:undefined});
  await operationalWorkflow.cleanup(ctx,args.workflowId);return null;
 }
});
export const retry=internalMutation({
 args:{eventId:v.id("webhookEvents")},returns:v.null(),
 handler:async(ctx,args):Promise<null>=>{
  const event=await ctx.db.get(args.eventId);if(!event||event.workflowId||event.state!=="failed")return null;
  await ctx.db.patch(event._id,{state:"queued",safeError:undefined});
  const workflowId=await operationalWorkflow.start(ctx,internal.mailWorkflows.ingestMessage,args,{startAsync:true,onComplete:internal.mailWorkflows.completed,context:args});
  await ctx.db.patch(event._id,{workflowId});return null;
 }
});
