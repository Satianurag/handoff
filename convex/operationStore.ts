import { requireMailAccess,canReadMail } from "./model/mailAccess";
import {v} from "convex/values";
import {internalMutation,internalQuery} from "./_generated/server";
import {internal} from "./_generated/api";
import schema from "./schema";
import {internalUserMutation,member,fail} from "./model/access";
import {queueOperation,startOperation} from "./model/operations";
const kind=v.union(v.literal("provisionMail"),v.literal("syncContacts"),v.literal("syncDraft"),v.literal("sendApprovedDraft"));
export const request=internalUserMutation({
 args:{householdId:v.id("households"),kind,draftId:v.optional(v.id("mailDrafts")),sendIntentId:v.optional(v.id("sendIntents"))},returns:v.null(),
 handler:async(ctx,args):Promise<null>=>{
  await member(ctx,args.householdId,args.kind==="provisionMail");await requireMailAccess(ctx,args.householdId);
  let key:string;
  if(args.kind==="syncDraft"){
   const draft=args.draftId?await ctx.db.get(args.draftId):null;if(!draft||draft.householdId!==args.householdId)return fail("NOT_FOUND","Draft unavailable.");key=`draft:${draft._id}:${draft.version}`;
  }else if(args.kind==="sendApprovedDraft"){
   const intent=args.sendIntentId?await ctx.db.get(args.sendIntentId):null;if(!intent||intent.householdId!==args.householdId)return fail("NOT_FOUND","Send unavailable.");key=`send:${intent._id}`;
  }else if(args.kind==="syncContacts"){
   const account=await ctx.db.query("mailAccounts").withIndex("by_householdId",q=>q.eq("householdId",args.householdId)).unique();if(!account)return fail("NOT_FOUND","Mailbox unavailable.");key=`contacts:${account.version}`;
  }else key=`provision:${args.householdId}`;
  await queueOperation(ctx,{...args,key,actorId:ctx.user._id});return null;
 }
});
export const start=internalMutation({args:{jobId:v.id("jobs"),watchId:v.optional(v.id("watches"))},returns:v.null(),handler:async(ctx,args):Promise<null>=>{
 const job=await ctx.db.get(args.jobId);if(!job)return null;
 if(args.watchId){const watch=await ctx.db.get(args.watchId);if(!watch||watch.householdId!==job.householdId)return fail("NOT_FOUND","Watch unavailable.");await ctx.db.patch(job._id,{watchId:args.watchId});}
 await startOperation(ctx,args.jobId);return null;
}});
export const read=internalQuery({args:{jobId:v.id("jobs")},returns:v.union(schema.doc("jobs"),v.null()),handler:async(ctx,args)=>ctx.db.get(args.jobId)});
export const claim=internalMutation({
 args:{jobId:v.id("jobs")},returns:v.boolean(),
 handler:async(ctx,args)=>{
  const job=await ctx.db.get(args.jobId);if(!job||["succeeded","cancelled","needsReview"].includes(job.state))return false;
  const household=await ctx.db.get(job.householdId),actor=job.requestedBy?await ctx.db.query("memberships").withIndex("by_householdId_and_userId",q=>q.eq("householdId",job.householdId).eq("userId",job.requestedBy!)).unique():null;
  if(!household||household.status!=="active"||(household.expiresAt&&household.expiresAt<=Date.now())||(job.requestedBy&&(actor?.status!=="active"||actor.accessPreset==="limited_helper"))||(!["syncContacts","refreshWatch","notifyMember","reconcileNotification","reconcileSend","retireMail","retireNotification"].includes(job.kind)&&!household.emailImport)){await ctx.db.patch(job._id,{state:"cancelled",updatedAt:Date.now()});return false;}
  if(job.requestedBy&&["provisionMail","syncContacts","syncDraft","sendApprovedDraft"].includes(job.kind)&&!await canReadMail(ctx,job.householdId,job.requestedBy)){await ctx.db.patch(job._id,{state:"cancelled",updatedAt:Date.now()});return false;}
  if(job.kind==="refreshWatch")return job.state==="queued";
  await ctx.db.patch(job._id,{state:"running",attempts:job.attempts+1,updatedAt:Date.now(),retryAt:undefined});return true;
 }
});
export const outcome=internalMutation({
 args:{jobId:v.id("jobs"),ok:v.boolean(),retryAfterMs:v.union(v.number(),v.null())},returns:v.null(),
 handler:async(ctx,args)=>{
  const job=await ctx.db.get(args.jobId);if(!job||["succeeded","cancelled"].includes(job.state))return null;
  await ctx.db.patch(job._id,{state:args.ok?"succeeded":args.retryAfterMs?"running":"failed",retryAt:args.retryAfterMs?Date.now()+args.retryAfterMs:undefined,safeError:args.ok?undefined:"External processing could not finish. Manual coordination is still available; check the related resource before retrying.",updatedAt:Date.now()});return null;
 }
});
export const extractSource=internalMutation({args:{sourceId:v.id("sources")},returns:v.null(),handler:async(ctx,args):Promise<null>=>{
 const pause=await ctx.db.query("operatorSettings").withIndex("by_key",q=>q.eq("key","pauseAutomaticOperations")).unique();if(pause?.enabled)return null;
 const source=await ctx.db.get(args.sourceId);if(!source||source.extractionState!=="pending")return null;const h=await ctx.db.get(source.householdId);if(!h||h.status!=="active"||!h.aiProcessing||(source.kind==="email"&&!h.emailImport))return null;
 const jobId=await ctx.runMutation(internal.generationStore.requestSourceInternal,args);await ctx.runMutation(internal.generationWorkflows.start,{jobId});return null;
}});
