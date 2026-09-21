import {cleanSettledWorkflow} from "./model/workflowCleanup";
import {v} from "convex/values";
import type {WorkflowId} from "@convex-dev/workflow";
import {internalMutation,internalQuery} from "./_generated/server";
import {fail} from "./model/access";
import {householdTables,type HouseholdTable} from "./model/privacy";
import {operationalWorkflow,generationWorkflow,generationKinds} from "./model/workflows";
import schema from "./schema";
export const read=internalQuery({args:{privacyJobId:v.id("privacyJobs")},returns:v.union(schema.doc("privacyJobs"),v.null()),handler:async(ctx,args)=>ctx.db.get(args.privacyJobId)});
export const quiesce=internalMutation({args:{privacyJobId:v.id("privacyJobs")},returns:v.object({more:v.boolean(),waitMs:v.number()}),handler:async(ctx,args)=>{
 const request=await ctx.db.get(args.privacyJobId);if(!request||request.kind!=="delete")return fail("INVALID_DELETE","Household deletion request required.");
 const h=await ctx.db.get(request.householdId);if(h?.status==="active")return fail("INVALID_DELETE","Household must first revoke access.");
 let until=request.quiesceUntil??Date.now(),more=false;
 for(const state of ["queued","running"] as const){
  const jobs=await ctx.db.query("jobs").withIndex("by_householdId_and_state",q=>q.eq("householdId",request.householdId).eq("state",state)).take(20);
  more ||=jobs.length===20;
  for(const job of jobs){
   if(job.state==="running")until=Math.max(until,Date.now()+11*60000);
   if(job.workflowId)await (generationKinds.has(job.kind)?generationWorkflow:operationalWorkflow).cancel(ctx,job.workflowId as WorkflowId);
   await ctx.db.patch(job._id,{state:"cancelled",safeError:"Household deletion cancelled this operation.",updatedAt:Date.now()});
  }
 }
 for(const state of ["queued","running"] as const){
  const events=await ctx.db.query("webhookEvents").withIndex("by_householdId_and_state",q=>q.eq("householdId",request.householdId).eq("state",state)).take(20);more ||=events.length===20;
  for(const event of events){if(event.state==="running")until=Math.max(until,Date.now()+11*60000);if(event.workflowId)await operationalWorkflow.cancel(ctx,event.workflowId as WorkflowId);await ctx.db.patch(event._id,{state:"cancelled"});}
 }
 const extracting=await ctx.db.query("records").withIndex("by_householdId_and_status",q=>q.eq("householdId",request.householdId).eq("status","extracting")).take(20);more ||=extracting.length===20;
 for(const row of extracting){if(row.workflowId){await generationWorkflow.cancel(ctx,row.workflowId as WorkflowId);until=Math.max(until,Date.now()+11*60000);}await ctx.db.patch(row._id,{status:"failed",safeError:"Household deletion cancelled extraction."});}
 const account=await ctx.db.query("mailAccounts").withIndex("by_householdId",q=>q.eq("householdId",request.householdId)).unique();
 const syncingDraft=await ctx.db.query("mailDrafts").withIndex("by_householdId_and_syncUntil",q=>q.eq("householdId",request.householdId).gt("syncUntil",Date.now())).first();
 const sending=await ctx.db.query("sendIntents").withIndex("by_householdId_and_state",q=>q.eq("householdId",request.householdId).eq("state","sending")).first();
 if(!request.quiesceUntil&&(account?.status==="processing"||(account?.syncUntil??0)>Date.now()||syncingDraft||sending))until=Math.max(until,Date.now()+11*60000);
 for(const kind of ["export","deleteThread","deleteDraft"] as const)for(const state of ["queued","running"] as const){
  const exports=await ctx.db.query("privacyJobs").withIndex("by_householdId_and_kind_and_state",q=>q.eq("householdId",request.householdId).eq("kind",kind).eq("state",state)).take(20);more ||=exports.length===20;
  for(const job of exports){if(job.workflowId){until=Math.max(until,Date.now()+11*60000);await operationalWorkflow.cancel(ctx,job.workflowId as WorkflowId);}await ctx.db.patch(job._id,{state:"cancelled",safeError:"Household deletion cancelled this operation."});}
 }
 await ctx.db.patch(request._id,{state:"running",stage:"stoppingEffects",quiesceUntil:until});
 return {more,waitMs:Math.max(0,until-Date.now())};
}});
export const purgeBatch=internalMutation({args:{privacyJobId:v.id("privacyJobs"),table:v.string()},returns:v.boolean(),handler:async(ctx,args)=>{
 const request=await ctx.db.get(args.privacyJobId);if(!request||request.kind!=="delete"||request.processors.find(p=>p.name==="agentmail")?.state!=="succeeded"||(request.quiesceUntil??0)>Date.now())return fail("CLEANUP_NOT_READY","Provider cleanup and running actions must finish first.");
 if(!householdTables.includes(args.table as HouseholdTable))return fail("INVALID_TABLE","Cleanup table unavailable.");
 const rows=await ctx.db.query(args.table as HouseholdTable).withIndex("by_householdId",q=>q.eq("householdId",request.householdId)).take(25);
 for(const row of rows){
  if("workflowId" in row&&row.workflowId){
   const manager=args.table==="records"||("kind" in row&&generationKinds.has(String(row.kind)))?generationWorkflow:operationalWorkflow;
   if(!await cleanSettledWorkflow(ctx,manager,row.workflowId))return false;
  }
  const requests=await ctx.db.query("requests").withIndex("by_resultId",q=>q.eq("resultId",row._id)).take(50);
  for(const saved of requests)await ctx.db.delete(saved._id);
  if(requests.length===50)return false;
  if(args.table==="recordVersions"&&"storageId" in row)await ctx.storage.delete(row.storageId);
  await ctx.db.delete(row._id);
 }
 await ctx.db.patch(request._id,{stage:"removingActiveData"});return rows.length<25;
}});
export const purgeStorage=internalMutation({args:{privacyJobId:v.id("privacyJobs")},returns:v.boolean(),handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.privacyJobId);if(!job||job.kind!=="delete")return fail("INVALID_DELETE","Household deletion request required.");
 const parts=await ctx.db.query("exportParts").withIndex("by_householdId",q=>q.eq("householdId",job.householdId)).take(25);
 for(const part of parts){await ctx.storage.delete(part.storageId);await ctx.db.delete(part._id);}
 const requests=await ctx.db.query("requests").withIndex("by_resultId",q=>q.eq("resultId",job.householdId)).take(50);for(const request of requests)await ctx.db.delete(request._id);
 return parts.length<25&&requests.length<50;
}});
export const finish=internalMutation({args:{privacyJobId:v.id("privacyJobs")},returns:v.null(),handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.privacyJobId);if(!job||job.state==="cancelled")return null;
 if(job.kind!=="export"&&job.processors.find(p=>p.name==="agentmail")?.state!=="succeeded")return fail("PROVIDER_NOT_DELETED","Provider deletion is incomplete.");
 if(job.kind==="delete"){
  if(job.processors.find(p=>p.name==="agentmail")?.state!=="succeeded")return fail("PROVIDER_NOT_DELETED","Provider deletion is incomplete.");
  for(const table of householdTables)if(await ctx.db.query(table).withIndex("by_householdId",q=>q.eq("householdId",job.householdId)).first())return fail("PURGE_INCOMPLETE","Active data remains.");
  if(await ctx.db.query("exportParts").withIndex("by_householdId",q=>q.eq("householdId",job.householdId)).first())return fail("PURGE_INCOMPLETE","Export data remains.");
  const h=await ctx.db.get(job.householdId);if(h)await ctx.db.delete(h._id);
 }else if(job.kind==="export"){
  const h=await ctx.db.get(job.householdId),m=await ctx.db.query("memberships").withIndex("by_householdId_and_userId",q=>q.eq("householdId",job.householdId).eq("userId",job.requestedBy)).unique();
  if(h?.status!=="active"||m?.status!=="active"||job.expiresAt<=Date.now())return fail("EXPORT_CANCELLED","Export no longer available.");
 }
 await ctx.db.patch(job._id,{state:"succeeded",stage:"complete",processors:job.processors.map(p=>({name:p.name,state:"succeeded" as const})),completedAt:Date.now(),safeError:undefined});return null;
}});
