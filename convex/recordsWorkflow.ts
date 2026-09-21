import { v } from "convex/values";
import { vWorkflowId,vResultValidator } from "@convex-dev/workflow";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { generationWorkflow } from "./model/workflows";
export const extract=generationWorkflow.define({args:{recordId:v.id("records"),versionId:v.id("recordVersions")},returns:v.null(),handler:async(step,args):Promise<null>=>{await step.runAction(internal.model.documentExtraction.extract,args,{retry:false});return null;}});
export const completed=internalMutation({args:{workflowId:vWorkflowId,result:vResultValidator,context:v.object({recordId:v.id("records")})},returns:v.null(),handler:async(ctx,args):Promise<null>=>{
 const row=await ctx.db.get(args.context.recordId);if(row?.workflowId===args.workflowId)await ctx.db.patch(row._id,{workflowId:undefined,...(row.status==="extracting"?{status:"failed" as const,safeError:"The document could not be processed. Your original is saved; file it manually or retry when AI processing is available."}:{})});await generationWorkflow.cleanup(ctx,args.workflowId);return null;
}});
