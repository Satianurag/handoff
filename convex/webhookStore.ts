import {v} from "convex/values";
import {internalMutation,internalQuery} from "./_generated/server";
import {internal} from "./_generated/api";
import {operationalWorkflow} from "./model/workflows";
import {deliveryRank,projectDelivery} from "./model/delivery";
import {generationKinds} from "./model/workflows";
import type {Doc} from "./_generated/dataModel";
export const receive=internalMutation({
 args:{providerEventId:v.string(),eventType:v.string(),inboxId:v.string(),providerMessageId:v.string(),occurredAt:v.number(),payloadHash:v.string()},returns:v.boolean(),
 handler:async(ctx,args):Promise<boolean>=>{
  const prior=await ctx.db.query("webhookEvents").withIndex("by_providerEventId",q=>q.eq("providerEventId",args.providerEventId)).unique();
  if(prior)return prior.payloadHash===args.payloadHash;
  const account=await ctx.db.query("mailAccounts").withIndex("by_inboxId",q=>q.eq("inboxId",args.inboxId)).unique();
  const household=account?await ctx.db.get(account.householdId):null;
  if(!household||household.status!=="active"||(household.expiresAt&&household.expiresAt<=Date.now()))return true;
  const received=args.eventType.startsWith("message.received");
  if(received&&!household.emailImport)return true;
  const id=await ctx.db.insert("webhookEvents",{...args,householdId:household._id,receivedAt:Date.now(),retentionUntil:Date.now()+30*86400000,state:received?"queued":"succeeded"});
  if(received){
   const workflowId=await operationalWorkflow.start(ctx,internal.mailWorkflows.ingestMessage,{eventId:id},{startAsync:true,onComplete:internal.mailWorkflows.completed,context:{eventId:id}});
   await ctx.db.patch(id,{workflowId});
  }else{
   const state:Doc<"sendIntents">["delivery"]|null=args.eventType==="message.sent"?"sent":args.eventType==="message.delivered"?"delivered":args.eventType==="message.bounced"?"bounced":["message.rejected","message.complained"].includes(args.eventType)?"rejected":null;
   if(!state)return true;
   const priorReceipt=await ctx.db.query("deliveryReceipts").withIndex("by_inboxId_and_providerMessageId",q=>q.eq("inboxId",args.inboxId).eq("providerMessageId",args.providerMessageId)).unique();
   if(!priorReceipt)await ctx.db.insert("deliveryReceipts",{householdId:household._id,inboxId:args.inboxId,providerMessageId:args.providerMessageId,delivery:state,occurredAt:args.occurredAt,retentionUntil:Date.now()+90*86400000});
   else if(deliveryRank[state]>deliveryRank[priorReceipt.delivery])await ctx.db.patch(priorReceipt._id,{delivery:state,occurredAt:args.occurredAt});
   await projectDelivery(ctx,household._id,args.inboxId,args.providerMessageId);
  }
  return true;
 }
});
export const claim=internalMutation({
 args:{eventId:v.id("webhookEvents")},returns:v.union(v.object({inboxId:v.string(),messageId:v.string(),quarantine:v.boolean()}),v.null()),
 handler:async(ctx,args)=>{
  const event=await ctx.db.get(args.eventId);if(!event?.householdId||!event.providerMessageId||!["queued","running"].includes(event.state))return null;
  const h=await ctx.db.get(event.householdId);if(!h||h.status!=="active"||!h.emailImport||(h.expiresAt&&h.expiresAt<=Date.now())){await ctx.db.patch(event._id,{state:"cancelled"});return null;}
  await ctx.db.patch(event._id,{state:"running"});return {inboxId:event.inboxId,messageId:event.providerMessageId,quarantine:event.eventType!=="message.received"};
 }
});
export const extractedSource=internalMutation({
 args:{messageId:v.id("mailMessages")},returns:v.null(),
 handler:async(ctx,args):Promise<null>=>{
  const message=await ctx.db.get(args.messageId);const source=message?.sourceId?await ctx.db.get(message.sourceId):null;
  if(!source||source.extractionState!=="pending")return null;
  const h=await ctx.db.get(source.householdId);if(!h||h.status!=="active"||!h.emailImport||!h.aiProcessing)return null;
  const jobId=await ctx.runMutation(internal.generationStore.requestSourceInternal,{sourceId:source._id});
  await ctx.runMutation(internal.generationWorkflows.start,{jobId});return null;
 }
});
