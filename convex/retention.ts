import {v} from "convex/values";
import {internalMutation} from "./_generated/server";
import {internal} from "./_generated/api";
import {queueOperation} from "./model/operations";
import {linkEvidence} from "./model/sourceUses";
import {digest} from "./model/sourceText";
export const backfillReferences=internalMutation({args:{table:v.union(v.literal("tasks"),v.literal("visits"),v.literal("mailDrafts"),v.literal("handoverItems"),v.literal("handoverChanges"),v.literal("handoverContextItems"))},returns:v.boolean(),handler:async(ctx,args)=>{
 const key=`sourceUsesBackfill:${args.table}`,state=await ctx.db.query("maintenanceCursors").withIndex("by_key",q=>q.eq("key",key)).unique();if(state?.cutoff===1)return true;
 const page=await ctx.db.query(args.table).paginate({cursor:state?.cursor??null,numItems:10,maximumBytesRead:200000});
 for(const row of page.page){
  const target=args.table==="tasks"?{kind:"task" as const,id:ctx.db.normalizeId("tasks",row._id)!}:args.table==="visits"?{kind:"visit" as const,id:ctx.db.normalizeId("visits",row._id)!}:args.table==="mailDrafts"?{kind:"draft" as const,id:ctx.db.normalizeId("mailDrafts",row._id)!}:"handoverId" in row?{kind:"handover" as const,id:row.handoverId}:null;
  if(!target)continue;const refs="sourceRefs" in row?row.sourceRefs:row.snapshot.sourceRefs;
  const existing=[];for(const ref of refs)if(await ctx.db.get(ref.sourceId))existing.push(ref);
  await linkEvidence(ctx,row.householdId,target,existing);
 }
 const fields={key,cursor:page.isDone?null:page.continueCursor,cutoff:page.isDone?1:0};if(state)await ctx.db.patch(state._id,fields);else await ctx.db.insert("maintenanceCursors",fields);return page.isDone;
}});
export const hashRequests=internalMutation({args:{},returns:v.null(),handler:async(ctx)=>{
 const key="requestFingerprintHashes",state=await ctx.db.query("maintenanceCursors").withIndex("by_key",q=>q.eq("key",key)).unique();if(state?.cutoff===1)return null;
 const page=await ctx.db.query("requests").paginate({cursor:state?.cursor??null,numItems:50,maximumBytesRead:200000});for(const row of page.page)if(!/^[a-f0-9]{64}$/.test(row.fingerprint))await ctx.db.patch(row._id,{fingerprint:digest(row.fingerprint)});
 const fields={key,cursor:page.isDone?null:page.continueCursor,cutoff:page.isDone?1:0};if(state)await ctx.db.patch(state._id,fields);else await ctx.db.insert("maintenanceCursors",fields);return null;
}});
export const sources=internalMutation({args:{},returns:v.null(),handler:async(ctx):Promise<null>=>{
 const pause=await ctx.db.query("operatorSettings").withIndex("by_key",q=>q.eq("key","pauseAutomaticOperations")).unique();if(pause?.enabled)return null;
 let ready=true;for(const table of ["tasks","visits","mailDrafts","handoverItems","handoverChanges","handoverContextItems"] as const)if(!await ctx.runMutation(internal.retention.backfillReferences,{table}))ready=false;
 await ctx.runMutation(internal.retention.hashRequests,{});if(!ready)return null;
 const state=await ctx.db.query("maintenanceCursors").withIndex("by_key",q=>q.eq("key","sourceRetention")).unique(),cutoff=state?.cursor?state.cutoff!:Date.now();
 const page=await ctx.db.query("sources").withIndex("by_unresolvedReferences_and_retentionUntil",q=>q.eq("unresolvedReferences",0).lte("retentionUntil",cutoff)).paginate({cursor:state?.cursor??null,numItems:10,maximumBytesRead:200000});
 const fields={key:"sourceRetention",cursor:page.isDone?null:page.continueCursor,cutoff};if(state)await ctx.db.patch(state._id,fields);else await ctx.db.insert("maintenanceCursors",fields);
 for(const source of page.page)await queueOperation(ctx,{householdId:source.householdId,kind:"retireSource",key:`retire-source:${source._id}:${source.retentionUntil}`,actorId:null,sourceId:source._id,target:{kind:"source",id:source._id},automatic:true});return null;
}});
export const mail=internalMutation({args:{},returns:v.null(),handler:async(ctx):Promise<null>=>{
 const pause=await ctx.db.query("operatorSettings").withIndex("by_key",q=>q.eq("key","pauseAutomaticOperations")).unique();if(pause?.enabled)return null;
 const state=await ctx.db.query("maintenanceCursors").withIndex("by_key",q=>q.eq("key","mailRetention")).unique(),cutoff=state?.cursor?state.cutoff!:Date.now();
 const page=await ctx.db.query("mailMessages").withIndex("by_unresolvedReferences_and_retentionUntil",q=>q.eq("unresolvedReferences",0).lte("retentionUntil",cutoff)).paginate({cursor:state?.cursor??null,numItems:10,maximumBytesRead:200000});
 const fields={key:"mailRetention",cursor:page.isDone?null:page.continueCursor,cutoff};if(state)await ctx.db.patch(state._id,fields);else await ctx.db.insert("maintenanceCursors",fields);
 for(const message of page.page)await queueOperation(ctx,{householdId:message.householdId,kind:"retireMail",key:`retire-mail:${message._id}:${message.retentionUntil}`,actorId:null,messageId:message._id,automatic:true});
 await ctx.runMutation(internal.retention.notifications,{});return null;
}});
export const notifications=internalMutation({args:{},returns:v.null(),handler:async(ctx):Promise<null>=>{
 const state=await ctx.db.query("maintenanceCursors").withIndex("by_key",q=>q.eq("key","notificationRetention")).unique(),cutoff=state?.cursor?state.cutoff!:Date.now();
 const page=await ctx.db.query("notificationSends").withIndex("by_retentionUntil",q=>q.lte("retentionUntil",cutoff)).paginate({cursor:state?.cursor??null,numItems:10,maximumBytesRead:200000});
 const fields={key:"notificationRetention",cursor:page.isDone?null:page.continueCursor,cutoff};if(state)await ctx.db.patch(state._id,fields);else await ctx.db.insert("maintenanceCursors",fields);
 for(const send of page.page){
  if(send.rawRemovedAt){await ctx.db.delete(send._id);continue;}
  await queueOperation(ctx,{householdId:send.householdId,kind:"retireNotification",key:`retire-notification:${send._id}:${send.retentionUntil}`,actorId:null,notificationId:send.notificationId,automatic:true});
 }return null;
}});
