import {startPrivacy} from "./model/privacy";
import {operationalWorkflow} from "./model/workflows";
import type {WorkflowId} from "@convex-dev/workflow";
import {v} from "convex/values";
import {internalMutation} from "./_generated/server";
import {internal} from "./_generated/api";
export const dueWatches=internalMutation({args:{},returns:v.null(),handler:async(ctx):Promise<null>=>{
 const pause=await ctx.db.query("operatorSettings").withIndex("by_key",q=>q.eq("key","pauseAutomaticOperations")).unique();if(pause?.enabled)return null;
 const watches=await ctx.db.query("watches").withIndex("by_active_and_nextCheckAt",q=>q.eq("active",true).lte("nextCheckAt",Date.now())).take(20);
 for(const watch of watches)try{await ctx.runMutation(internal.webStore.beginAutomatic,{watchId:watch._id});}catch{
  await ctx.db.patch(watch._id,{state:"failed",lastResult:"Automatic check paused by service limits. Manual logistics remain available.",nextCheckAt:Date.now()+3600000});
 }return null;
}});
export const recurrence=internalMutation({args:{},returns:v.null(),handler:async(ctx):Promise<null>=>{
 const series=await ctx.db.query("taskSeries").withIndex("by_status_and_nextGenerationAt",q=>q.eq("status","active").lte("nextGenerationAt",Date.now())).take(10);
 for(const row of series)await ctx.runMutation(internal.recurrence.generate,{seriesId:row._id});return null;
}});

export const expireDemo=internalMutation({args:{householdId:v.id("households")},returns:v.null(),handler:async(ctx,args):Promise<null>=>{
 const h=await ctx.db.get(args.householdId);if(!h||h.mode!=="demo"||h.status!=="active"||!h.expiresAt||h.expiresAt>Date.now())return null;
 await ctx.db.patch(h._id,{status:"deleting",emailImport:false,aiProcessing:false,consentVersion:h.consentVersion+1,materialRevision:h.materialRevision+1,updatedAt:Date.now()});
 const id=await ctx.db.insert("privacyJobs",{householdId:h._id,requestedBy:h.ownerId,kind:"delete",state:"queued",stage:"demoExpired",processors:["agentmail","convex","workflow","storage"].map(name=>({name,state:"queued" as const})),requestedAt:Date.now(),expiresAt:Date.now()+30*86400000});
 await startPrivacy(ctx,id);return null;
}});
export const privacy=internalMutation({args:{},returns:v.null(),handler:async(ctx):Promise<null>=>{
 const expired=await ctx.db.query("households").withIndex("by_mode_and_status_and_expiresAt",q=>q.eq("mode","demo").eq("status","active").lte("expiresAt",Date.now())).take(20);
 for(const h of expired)await ctx.runMutation(internal.maintenance.expireDemo,{householdId:h._id});
 const queued=await ctx.db.query("privacyJobs").withIndex("by_state_and_requestedAt",q=>q.eq("state","queued")).take(25);
 for(const job of queued)await startPrivacy(ctx,job._id);
 const parts=await ctx.db.query("exportParts").withIndex("by_expiresAt",q=>q.lte("expiresAt",Date.now())).take(25);
 for(const part of parts){await ctx.storage.delete(part.storageId);await ctx.db.delete(part._id);}
 const state=await ctx.db.query("maintenanceCursors").withIndex("by_key",q=>q.eq("key","privacyReceipts")).unique(),cutoff=state?.cursor?state.cutoff!:Date.now();
 const page=await ctx.db.query("privacyJobs").withIndex("by_expiresAt",q=>q.lte("expiresAt",cutoff)).paginate({cursor:state?.cursor??null,numItems:25});
 const fields={key:"privacyReceipts",cursor:page.isDone?null:page.continueCursor,cutoff};if(state)await ctx.db.patch(state._id,fields);else await ctx.db.insert("maintenanceCursors",fields);
 for(const receipt of page.page){
  if(receipt.kind==="export"&&receipt.workflowId)await operationalWorkflow.cancel(ctx,receipt.workflowId as WorkflowId);
  if(receipt.workflowId||(!["succeeded","cancelled"].includes(receipt.state)&&receipt.kind!=="export"))continue;
  if(await ctx.db.query("exportParts").withIndex("by_privacyJobId_and_partKey",q=>q.eq("privacyJobId",receipt._id)).first())continue;
  if(receipt.exportStorageId)await ctx.storage.delete(receipt.exportStorageId);
  const requests=await ctx.db.query("requests").withIndex("by_resultId",q=>q.eq("resultId",receipt._id)).take(25);for(const request of requests)await ctx.db.delete(request._id);
  if(requests.length<25)await ctx.db.delete(receipt._id);
 }
 return null;
}});
