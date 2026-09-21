import {v} from "convex/values";
import {vWorkflowId,vResultValidator} from "@convex-dev/workflow";
import {internalMutation} from "./_generated/server";
import {internal} from "./_generated/api";
import {operationalWorkflow} from "./model/workflows";
import {householdTables} from "./model/privacy";
export const execute=operationalWorkflow.define({args:{privacyJobId:v.id("privacyJobs")},returns:v.boolean(),handler:async(step,args):Promise<boolean>=>{
 const job=await step.runQuery(internal.privacyStore.read,args);if(!job||job.state==="cancelled")return false;
 if(job.kind==="export"){
  for(const table of ["households",...householdTables]){
   let cursor:string|null=null,pageNumber=1;
   for(;;){const page:{cursor:string;done:boolean}=await step.runAction(internal.privacyExport.buildPage,{...args,table,cursor,pageNumber},{retry:false});if(page.done)break;cursor=page.cursor;pageNumber++;}
  }
  let fileCursor:string|null=null;for(;;){const page:{cursor:string;done:boolean}=await step.runAction(internal.privacyExport.buildFilePage,{...args,cursor:fileCursor},{retry:false});if(page.done)break;fileCursor=page.cursor;}
 }else if(job.kind==="delete"){
  for(;;){const quiet=await step.runMutation(internal.privacyStore.quiesce,args);if(quiet.more)continue;if(quiet.waitMs)await step.sleep(quiet.waitMs);break;}
  for(let attempt=0;attempt<4;attempt++){
   const result=await step.runAction(internal.mail.cleanupForWorkflow,args,{retry:false});if(result.ok)break;
   if(!result.retryAfterMs||attempt===3)return false;await step.sleep(Math.max(result.retryAfterMs,30000*2**attempt));
  }
  for(const table of householdTables)while(!await step.runMutation(internal.privacyStore.purgeBatch,{...args,table}))await step.sleep(1000);
  while(!await step.runMutation(internal.privacyStore.purgeStorage,args))await step.sleep(1000);
 }else{
  let prepareCursor:string|null=null;
  for(;;){const page:{cursor:string;done:boolean}=await step.runMutation(internal.privacyScopeStore.prepare,{...args,cursor:prepareCursor});if(page.done)break;prepareCursor=page.cursor;}
  await step.sleep(11*60000);
  for(let attempt=0;attempt<4;attempt++){
   const result=await step.runAction(internal.mail.cleanupForWorkflow,args,{retry:false});if(result.ok)break;
   if(!result.retryAfterMs||attempt===3)return false;await step.sleep(Math.max(result.retryAfterMs,30000*2**attempt));
  }
  while(!await step.runMutation(internal.privacyScopeStore.purge,args))await step.sleep(1000);
  for(const table of ["tasks","visits","mailDrafts","events","handoverItems","handoverChanges","handoverContextItems"]){
   let cursor:string|null=null;
   for(;;){const page:{cursor:string;done:boolean}=await step.runMutation(internal.privacyScopeStore.removeMissingReferences,{...args,table,cursor});if(page.done)break;cursor=page.cursor;}
  }
 }
 await step.runMutation(internal.privacyStore.finish,args);return true;
}});
export const completed=internalMutation({args:{workflowId:vWorkflowId,result:vResultValidator,context:v.object({privacyJobId:v.id("privacyJobs")})},returns:v.null(),handler:async(ctx,args):Promise<null>=>{
 const job=await ctx.db.get(args.context.privacyJobId);
 if(job?.workflowId===args.workflowId)await ctx.db.patch(job._id,{workflowId:undefined,...(!["succeeded","cancelled"].includes(job.state)?{state:"failed" as const,safeError:"Privacy processing did not complete. Retry the same request; completed processor steps remain recorded."}:{})});
 await operationalWorkflow.cleanup(ctx,args.workflowId);return null;
}});
