import type {MutationCtx} from "../_generated/server";
import type {Doc,Id} from "../_generated/dataModel";
import {internal} from "../_generated/api";
import {operationalWorkflow} from "./workflows";
export type OperationKind="provisionMail"|"syncContacts"|"syncDraft"|"sendApprovedDraft"|"refreshWatch"|"notifyMember"|"reconcileNotification"|"reconcileSend"|"retireSource"|"retireMail"|"retireNotification";
export async function startOperation(ctx:MutationCtx,jobId:Id<"jobs">){
 const job=await ctx.db.get(jobId);if(!job||job.workflowId||!["queued","failed"].includes(job.state))return;
 const workflowId=await operationalWorkflow.start(ctx,job.kind==="retireSource"?internal.retentionWorkflows.source:internal.operationalWorkflows.execute,{jobId},{startAsync:true,onComplete:internal.operationalWorkflows.completed,context:{jobId}});
 await ctx.db.patch(job._id,{workflowId,state:"queued",safeError:undefined});
}
export async function queueOperation(ctx:MutationCtx,args:{householdId:Id<"households">;kind:OperationKind;key:string;actorId:Id<"users">|null;target?:Doc<"jobs">["target"];draftId?:Id<"mailDrafts">;sendIntentId?:Id<"sendIntents">;watchId?:Id<"watches">;notificationId?:Id<"notifications">;sourceId?:Id<"sources">;messageId?:Id<"mailMessages">;automatic?:boolean}){
 const household=await ctx.db.get(args.householdId);if(!household||household.status!=="active")return null;
 if(args.automatic){const pause=await ctx.db.query("operatorSettings").withIndex("by_key",q=>q.eq("key","pauseAutomaticOperations")).unique();if(pause?.enabled)return null;}
 const prior=await ctx.db.query("jobs").withIndex("by_householdId_and_operationKey",q=>q.eq("householdId",household._id).eq("operationKey",args.key)).unique();
 if(prior){
  if(args.automatic)return prior._id;
  if(!prior.workflowId && !args.automatic && ["failed","cancelled"].includes(prior.state)) await ctx.db.patch(prior._id,{state:"queued",requestedBy:args.actorId,consentVersion:household.consentVersion,retryAt:undefined,updatedAt:Date.now()});
  await startOperation(ctx,prior._id);return prior._id;
 }
 const jobId=await ctx.db.insert("jobs",{householdId:household._id,operationKey:args.key,kind:args.kind,requestedBy:args.actorId,target:args.target??{kind:"household",id:household._id},state:"queued",attempts:0,createdAt:Date.now(),updatedAt:Date.now(),consentVersion:household.consentVersion,...(args.draftId?{draftId:args.draftId}:{}),...(args.sendIntentId?{sendIntentId:args.sendIntentId}:{}),...(args.watchId?{watchId:args.watchId}:{}),...(args.notificationId?{notificationId:args.notificationId}:{}),...(args.sourceId?{sourceId:args.sourceId}:{}),...(args.messageId?{messageId:args.messageId}:{})});
 await startOperation(ctx,jobId);return jobId;
}
export async function syncPolicies(ctx:MutationCtx,householdId:Id<"households">){
 const account=await ctx.db.query("mailAccounts").withIndex("by_householdId",q=>q.eq("householdId",householdId)).unique();if(!account)return;
 await ctx.db.patch(account._id,{version:account.version+1,contactSyncState:"pending"});
 if(account.inboxId)await queueOperation(ctx,{householdId,kind:"syncContacts",key:`contacts:${account.version+1}`,actorId:null,automatic:true});
}
