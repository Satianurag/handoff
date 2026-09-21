"use node";
import {v} from "convex/values";
import {internalAction} from "./_generated/server";
import {internal} from "./_generated/api";
import {provisionMailbox,syncContacts,syncProviderDraft,sendApproved,reconcileSend,operationRetryDelay} from "./mail";
import {sendNotification,reconcileNotification} from "./notificationMail";
import {removeRaw} from "./retentionMail";
import {checkPublicSource} from "./web";
import type {Id} from "./_generated/dataModel";
export const perform=internalAction({
 args:{jobId:v.id("jobs")},returns:v.object({ok:v.boolean(),retryAfterMs:v.union(v.number(),v.null()),sourceId:v.union(v.id("sources"),v.null())}),
 handler:async(ctx,args):Promise<{ok:boolean;retryAfterMs:number|null;sourceId:Id<"sources">|null}>=>{
  const job=await ctx.runQuery(internal.operationStore.read,args);if(!job)return {ok:false,retryAfterMs:null,sourceId:null};
  try{
   if(job.kind==="retireMail"||job.kind==="retireNotification"){await removeRaw(ctx,job._id);return {ok:true,retryAfterMs:null,sourceId:null};}
   if(job.kind==="notifyMember"&&job.notificationId)return {ok:await sendNotification(ctx,job.notificationId),retryAfterMs:null,sourceId:null};
   else if(job.kind==="reconcileNotification"&&job.notificationId)return {ok:await reconcileNotification(ctx,job.notificationId),retryAfterMs:null,sourceId:null};
   else if(job.kind==="reconcileSend"&&job.sendIntentId){await reconcileSend(ctx,job.sendIntentId);return {ok:true,retryAfterMs:null,sourceId:null};}
   else if(job.kind==="provisionMail")await provisionMailbox(ctx,job.householdId);
   else if(job.kind==="syncContacts")await syncContacts(ctx,job.householdId);
   else if(job.kind==="syncDraft"&&job.draftId)await syncProviderDraft(ctx,job.draftId);
   else if(job.kind==="sendApprovedDraft"&&job.sendIntentId){
    await sendApproved(ctx,job.sendIntentId);const sent=await ctx.runQuery(internal.mailStore.sendContext,{sendIntentId:job.sendIntentId});
    return {ok:sent.intent.state==="sent",retryAfterMs:null,sourceId:null};
   }else if(job.kind==="refreshWatch"&&job.watchId){
    const sourceId=await checkPublicSource(ctx,{jobId:job._id,watchId:job.watchId});return {ok:sourceId!==null,retryAfterMs:null,sourceId};
   }else return {ok:false,retryAfterMs:null,sourceId:null};
   return {ok:true,retryAfterMs:null,sourceId:null};
  }catch(error){return {ok:false,retryAfterMs:job.kind==="sendApprovedDraft"||job.kind==="refreshWatch"?null:operationRetryDelay(error),sourceId:null};}
 }
});
