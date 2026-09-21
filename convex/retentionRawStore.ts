import {v} from "convex/values";
import {internalMutation} from "./_generated/server";
import {threadNeedsEvidence} from "./model/retention";
const DAY=86400000;
export const prepare=internalMutation({args:{jobId:v.id("jobs")},returns:v.union(v.object({inboxId:v.string(),messageId:v.union(v.string(),v.null()),label:v.union(v.string(),v.null()),draftIds:v.array(v.string())}),v.null()),handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.jobId);if(!job)return null;
 const h=await ctx.db.get(job.householdId);if(h?.status!=="active")return null;
 if(job.kind==="retireNotification"&&job.notificationId){
  const send=await ctx.db.query("notificationSends").withIndex("by_notificationId",q=>q.eq("notificationId",job.notificationId!)).unique();
  if(!send||send.rawRemovedAt||send.retentionUntil>Date.now())return null;
  await ctx.db.patch(send._id,{retiring:true});
  return {inboxId:send.inboxId,messageId:send.providerMessageId??null,label:send.providerMessageId?null:`handoff-notification-${send.notificationId}`,draftIds:[]};
 }
 const message=job.messageId?await ctx.db.get(job.messageId):null;if(!message||message.householdId!==h._id)return null;
 if(!message.retiring){
  if(message.retentionUntil>Date.now())return null;
  const source=message.sourceId?await ctx.db.get(message.sourceId):null;
  if(source||message.unresolvedReferences>0||await threadNeedsEvidence(ctx,message.threadId)){
   await ctx.db.patch(message._id,{retentionUntil:Date.now()+DAY});return null;
  }
  await ctx.db.patch(message._id,{retiring:true});
 }
 const intents=await ctx.db.query("sendIntents").withIndex("by_providerMessageId",q=>q.eq("providerMessageId",message.providerMessageId)).take(26);
 if(intents.length>25)throw new Error("Provider message has too many send references; operator review required.");
 const draftIds=[];for(const intent of intents){if(intent.householdId!==h._id)continue;const d=await ctx.db.get(intent.draftId);if(d?.state==="sent"&&d.providerDraftId)draftIds.push(d.providerDraftId);}
 return {inboxId:message.inboxId,messageId:message.providerMessageId,label:null,draftIds};
}});
export const finish=internalMutation({args:{jobId:v.id("jobs")},returns:v.null(),handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.jobId);if(!job)return null;
 if(job.kind==="retireNotification"&&job.notificationId){
  const send=await ctx.db.query("notificationSends").withIndex("by_notificationId",q=>q.eq("notificationId",job.notificationId!)).unique();
  if(send?.retiring)await ctx.db.patch(send._id,{recipient:"",subject:"",body:"",rawRemovedAt:Date.now(),retentionUntil:Math.max(Date.now(),send.createdAt+90*DAY)});
  return null;
 }
 const message=job.messageId?await ctx.db.get(job.messageId):null;if(!message?.retiring)return null;
 const intents=await ctx.db.query("sendIntents").withIndex("by_providerMessageId",q=>q.eq("providerMessageId",message.providerMessageId)).take(26);
 if(intents.length>25)throw new Error("Too many send references.");
 for(const intent of intents){
  if(intent.householdId!==message.householdId)continue;
  await ctx.db.patch(intent._id,{recipient:"",subject:"",body:"",rawRemovedAt:Date.now()});
  const draft=await ctx.db.get(intent.draftId);if(draft?.state==="sent")await ctx.db.patch(draft._id,{recipient:"",subject:"Original message removed",body:"",sourceRefs:[],rawRemovedAt:Date.now(),providerDraftId:undefined});
 }
 await ctx.db.delete(message._id);
 const remaining=await ctx.db.query("mailMessages").withIndex("by_threadId_and_occurredAt",q=>q.eq("threadId",message.threadId)).first();
 const thread=await ctx.db.get(message.threadId);if(!remaining&&thread)await ctx.db.patch(thread._id,{subject:"Original messages removed",version:thread.version+1});
 return null;
}});
export const retryLater=internalMutation({args:{jobId:v.id("jobs")},returns:v.null(),handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.jobId);if(!job)return null;
 if(job.messageId){const m=await ctx.db.get(job.messageId);if(m)await ctx.db.patch(m._id,{retentionUntil:Date.now()+3600000});}
 if(job.kind==="retireNotification"&&job.notificationId){const s=await ctx.db.query("notificationSends").withIndex("by_notificationId",q=>q.eq("notificationId",job.notificationId!)).unique();if(s&&!s.rawRemovedAt)await ctx.db.patch(s._id,{retentionUntil:Date.now()+3600000});}
 return null;
}});
