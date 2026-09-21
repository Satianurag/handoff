import {v} from "convex/values";
import {internalMutation,internalQuery,type QueryCtx,type MutationCtx,env} from "./_generated/server";
import type {Doc,Id} from "./_generated/dataModel";
import {dailyAllowance} from "./model/limits";
import {digest} from "./model/sourceText";
import schema from "./schema";

async function eligible(ctx:QueryCtx|MutationCtx,n:Doc<"notifications">,now:number){
 const h=await ctx.db.get(n.householdId),u=await ctx.db.get(n.userId),m=await ctx.db.query("memberships").withIndex("by_householdId_and_userId",q=>q.eq("householdId",n.householdId).eq("userId",n.userId)).unique();
 if(h?.status!=="active"||h.mode!=="real"||m?.status!=="active"||m.accessPreset==="limited_helper"||!m.emailNotifications||!u?.email||!u.emailVerificationTime||u.isAnonymous||n.readAt!==null||now-n.createdAt>86400000)return null;
 const target=await ctx.db.get(n.target.id);if(!target)return null;
 if(n.target.kind==="task"&&"status" in target){
  if(target.status!=="open")return null;
  if(n.type==="assignment.requested"&&("requestedOwnerId" in target&&target.requestedOwnerId!==n.userId))return null;
  if(n.type==="task.due"&&("ownerId" in target&&target.ownerId!==n.userId))return null;
 }
 if(n.type==="handover.incoming"&&("status" in target&&target.status!=="pending"))return null;
 if(n.target.kind==="thread"&&"deleting" in target){
  if(target.deleting||target.quarantined||target.state==="resolved")return null;
  if(n.type==="mail.waiting"&&(target.state!=="waiting"||target.lastMessageAt>n.createdAt))return null;
 }
 if(n.type==="source.review"){
  const pending=await ctx.db.query("proposals").withIndex("by_sourceId_and_status",q=>q.eq("sourceId",n.target.id as Id<"sources">).eq("status","pending")).first();if(!pending)return null;
 }
 return u.email.trim().toLowerCase();
}
export const prepare=internalMutation({args:{notificationId:v.id("notifications")},returns:v.boolean(),handler:async(ctx,args)=>{
 const n=await ctx.db.get(args.notificationId);if(!n||n.emailState!=="pending")return false;
 if(!await eligible(ctx,n,Date.now())){await ctx.db.patch(n._id,{emailState:"cancelled"});return false;}return true;
}});
export const claim=internalMutation({args:{notificationId:v.id("notifications"),inboxId:v.string()},returns:v.union(schema.doc("notificationSends"),v.null()),handler:async(ctx,args)=>{
 const n=await ctx.db.get(args.notificationId);if(!n||n.emailState!=="pending")return null;
 const prior=await ctx.db.query("notificationSends").withIndex("by_notificationId",q=>q.eq("notificationId",n._id)).unique();if(prior)return null;
 const recipient=await eligible(ctx,n,Date.now());if(!recipient){await ctx.db.patch(n._id,{emailState:"cancelled"});return null;}
 await dailyAllowance(ctx,"householdSends",n.householdId);await dailyAllowance(ctx,"globalSends");
 const id=await ctx.db.insert("notificationSends",{householdId:n.householdId,notificationId:n._id,userId:n.userId,recipient,inboxId:args.inboxId,subject:"You have an update in Handoff",body:`Open Handoff to review your update. You can change email preferences in household settings.\n\n${env.CONVEX_SITE_URL}/`,idempotencyKey:`notification-${digest(n._id)}`,state:"sending",createdAt:Date.now(),lastCheckedAt:Date.now(),retentionUntil:Date.now()+30*86400000});
 await ctx.db.patch(n._id,{emailState:"sending"});return ctx.db.get(id);
}});
export const read=internalQuery({args:{notificationId:v.id("notifications")},returns:v.union(schema.doc("notificationSends"),v.null()),handler:async(ctx,args)=>ctx.db.query("notificationSends").withIndex("by_notificationId",q=>q.eq("notificationId",args.notificationId)).unique()});
export const sent=internalMutation({args:{notificationId:v.id("notifications"),messageId:v.string(),threadId:v.string()},returns:v.null(),handler:async(ctx,args)=>{
 const s=await ctx.db.query("notificationSends").withIndex("by_notificationId",q=>q.eq("notificationId",args.notificationId)).unique();if(!s||s.state==="sent")return null;
 await ctx.db.patch(s._id,{state:"sent",providerMessageId:args.messageId,providerThreadId:args.threadId,lastCheckedAt:Date.now()});
 const n=await ctx.db.get(args.notificationId);if(n)await ctx.db.patch(n._id,{emailState:"sent"});return null;
}});
export const failed=internalMutation({args:{notificationId:v.id("notifications"),uncertain:v.boolean()},returns:v.null(),handler:async(ctx,args)=>{
 const s=await ctx.db.query("notificationSends").withIndex("by_notificationId",q=>q.eq("notificationId",args.notificationId)).unique();if(!s||s.state==="sent")return null;
 const state=args.uncertain||s.state==="unknown"?"unknown":"failed";await ctx.db.patch(s._id,{state,lastCheckedAt:Date.now()});
 const n=await ctx.db.get(args.notificationId);if(n)await ctx.db.patch(n._id,{emailState:state});return null;
}});
