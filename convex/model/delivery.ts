import type {MutationCtx} from "../_generated/server";
import type {Doc,Id} from "../_generated/dataModel";
import {notify} from "./events";
export const deliveryRank:Record<Doc<"sendIntents">["delivery"],number>={pending:0,unknown:0,sent:1,delivered:2,bounced:3,rejected:3};
export async function projectDelivery(ctx:MutationCtx,householdId:Id<"households">,inboxId:string,providerMessageId:string){
 const receipt=await ctx.db.query("deliveryReceipts").withIndex("by_inboxId_and_providerMessageId",q=>q.eq("inboxId",inboxId).eq("providerMessageId",providerMessageId)).unique();
 if(!receipt||receipt.householdId!==householdId)return;
 const message=await ctx.db.query("mailMessages").withIndex("by_inboxId_and_providerMessageId",q=>q.eq("inboxId",inboxId).eq("providerMessageId",providerMessageId)).unique();
 if(message?.householdId===householdId&&message.direction==="outbound"&&deliveryRank[receipt.delivery]>deliveryRank[message.delivery])await ctx.db.patch(message._id,{delivery:receipt.delivery,deliveryAt:receipt.occurredAt});
 const intents=await ctx.db.query("sendIntents").withIndex("by_providerMessageId",q=>q.eq("providerMessageId",providerMessageId)).take(10);
 for(const intent of intents){
  if(intent.householdId!==householdId||deliveryRank[receipt.delivery]<=deliveryRank[intent.delivery])continue;
  await ctx.db.patch(intent._id,{delivery:receipt.delivery});
  if(message&&["bounced","rejected"].includes(receipt.delivery))await notify(ctx,{householdId,userId:intent.approvedBy,target:{kind:"thread",id:message.threadId},type:"mail.deliveryFailure",dedupeKey:`delivery-failure:${intent._id}`});
 }
}
