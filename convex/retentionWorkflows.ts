import {v} from "convex/values";
import {operationalWorkflow} from "./model/workflows";
import {internal} from "./_generated/api";
export const source=operationalWorkflow.define({args:{jobId:v.id("jobs")},returns:v.boolean(),handler:async(step,args):Promise<boolean>=>{
 const inspection=await step.runMutation(internal.retentionSourceStore.begin,args);if(!inspection)return true;
 if(!inspection.alreadyClaimed){
  let cursor:string|null=null;
  for(;;){const page:{protected:boolean;done:boolean;cursor:string}=await step.runQuery(internal.retentionSourceStore.references,{sourceId:inspection.sourceId,cursor});
   if(page.protected){await step.runMutation(internal.retentionSourceStore.defer,args);return true;}if(page.done)break;cursor=page.cursor;
  }
  if(!await step.runMutation(internal.retentionSourceStore.claim,{...args,...inspection}))return true;
 }
 let removed=false;
 for(let attempt=0;attempt<4;attempt++){
  const result=await step.runAction(internal.retentionMail.removeSource,args,{retry:false});if(result.ok){removed=true;break;}
  if(!result.retryAfterMs||attempt===3)break;await step.sleep(Math.max(result.retryAfterMs,30000*2**attempt));
 }
 if(!removed){await step.runMutation(internal.retentionSourceStore.finish,{...args,success:false});return false;}
 while(!await step.runMutation(internal.retentionSourceStore.purge,args))await step.sleep(1000);
 for(const table of ["tasks","visits","mailDrafts","events","handoverItems","handoverChanges","handoverContextItems"]){
  let cursor:string|null=null;
  for(;;){const page:{cursor:string;done:boolean}=await step.runMutation(internal.retentionSourceStore.redact,{...args,table,cursor});if(page.done)break;cursor=page.cursor;}
 }
 await step.runMutation(internal.retentionSourceStore.finish,{...args,success:true});return true;
}});
