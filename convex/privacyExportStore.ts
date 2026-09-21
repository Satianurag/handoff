import {v} from "convex/values";
import {paginationOptsValidator,paginationResultValidator} from "convex/server";
import {internalMutation,internalQuery,type QueryCtx,type MutationCtx} from "./_generated/server";
import type {Doc,Id} from "./_generated/dataModel";
import {fail,internalUserQuery,member,userQuery} from "./model/access";
import {householdTables,type HouseholdTable} from "./model/privacy";
import {canReadRecordFor} from "./recordsAccess";
import {canReadCare,canReadCareSource,canReadVisitPack} from "./careAccess";
import schema from "./schema";
import {canReadMail,canReadSource,canReadEvent} from "./model/mailAccess";
const healthTables=new Set(["careProfiles","careProviders","medicineEntries","medicineVersions","careNotes","visitQuestions","visitPacks","followUps","handoverCareSnapshots","careShares","followUpReads"]);
const mailTables=new Set(["mailAccounts","contacts","mailThreads","mailMessages","mailDrafts","sendIntents","webhookEvents","deliveryReceipts","notificationSends","generationRuns","recordMailOrigins"]);
const grants={requiresMailAccess:v.optional(v.boolean()),accessRecordIds:v.optional(v.array(v.id("records"))),requiresCareAccess:v.optional(v.boolean()),visitPackIds:v.optional(v.array(v.id("visitPacks"))),accessPlaceIds:v.optional(v.array(v.id("places")))};
async function allowed(ctx:QueryCtx|MutationCtx,part:{householdId:Id<"households">;accessRecordIds?:Id<"records">[];requiresCareAccess?:boolean;requiresMailAccess?:boolean;visitPackIds?:Id<"visitPacks">[];accessPlaceIds?:Id<"places">[]},userId:Id<"users">){
 if(part.requiresMailAccess&&!await canReadMail(ctx,part.householdId,userId))return false;
 if(part.requiresCareAccess&&!await canReadCare(ctx,part.householdId,userId))return false;
 for(const id of part.accessRecordIds??[]){const record=await ctx.db.get(id);if(!record||!await canReadRecordFor(ctx,record,userId))return false;}
 for(const id of part.visitPackIds??[]){const pack=await ctx.db.get(id);if(!pack||!await canReadVisitPack(ctx,pack,userId))return false;}
 for(const id of part.accessPlaceIds??[]){const place=await ctx.db.get(id);if(!place||(place.visibility!=="household"&&place.createdBy!==userId&&!place.readerIds.includes(userId)))return false;}
 return true;
}
async function jobAccess(ctx:QueryCtx|MutationCtx,id:Id<"privacyJobs">){
 const job=await ctx.db.get(id);if(!job||job.kind!=="export"||!["queued","running"].includes(job.state)||job.expiresAt<=Date.now())return fail("NOT_FOUND","Export unavailable.");
 const h=await ctx.db.get(job.householdId),m=await ctx.db.query("memberships").withIndex("by_householdId_and_userId",q=>q.eq("householdId",job.householdId).eq("userId",job.requestedBy)).unique();if(!h||h.status!=="active"||m?.status!=="active")return fail("NOT_FOUND","Household unavailable.");return {job,h,m};
}
export const authorize=internalUserQuery({args:{partId:v.id("exportParts"),now:v.number()},returns:v.id("_storage"),handler:async(ctx,args)=>{
 const part=await ctx.db.get(args.partId),job=part?await ctx.db.get(part.privacyJobId):null;
 if(!part||!job||job.kind!=="export"||job.requestedBy!==ctx.user._id||job.state!=="succeeded"||job.expiresAt<=Date.now())return fail("NOT_FOUND","Export unavailable or expired.");
 await member(ctx,job.householdId);if(!await allowed(ctx,part,ctx.user._id))fail("ACCESS_CHANGED","Access to this export changed. Request a fresh export of what you can currently see.");return part.storageId;
}});
export const parts=userQuery({args:{privacyJobId:v.id("privacyJobs"),paginationOpts:paginationOptsValidator},returns:paginationResultValidator(schema.doc("exportParts").omit("storageId")),handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.privacyJobId);if(!job||job.kind!=="export"||job.requestedBy!==ctx.user._id)return fail("NOT_FOUND","Export unavailable.");await member(ctx,job.householdId);
 const page=await ctx.db.query("exportParts").withIndex("by_privacyJobId_and_partKey",q=>q.eq("privacyJobId",job._id)).paginate(args.paginationOpts);const visible=[];for(const part of page.page)if(await allowed(ctx,part,ctx.user._id)){const {storageId,...row}=part;visible.push(row);}return {...page,page:visible};
}});
export const page=internalQuery({args:{privacyJobId:v.id("privacyJobs"),table:v.string(),cursor:v.union(v.string(),v.null())},returns:v.object({text:v.string(),cursor:v.string(),done:v.boolean(),rows:v.number(),...grants}),handler:async(ctx,args)=>{
 const {job,h,m}=await jobAccess(ctx,args.privacyJobId);const empty={text:"",cursor:"",done:true,rows:0,accessRecordIds:[] as Id<"records">[],requiresCareAccess:false,requiresMailAccess:false,visitPackIds:[] as Id<"visitPacks">[],accessPlaceIds:[] as Id<"places">[]};
 if(args.table==="households")return {...empty,text:JSON.stringify({table:"households",record:h})+"\n",rows:1};
 if(!householdTables.includes(args.table as HouseholdTable))return fail("INVALID_TABLE","Export table unavailable.");
 if(args.table==="invites"&&m.role!=="owner")return empty;
 const requiresCareAccess=healthTables.has(args.table);if(requiresCareAccess&&!await canReadCare(ctx,h._id,job.requestedBy))return empty;
 const mailAllowed=await canReadMail(ctx,h._id,job.requestedBy);let requiresMailAccess=mailTables.has(args.table);if(requiresMailAccess&&!mailAllowed)return empty;
 const page=await ctx.db.query(args.table as HouseholdTable).withIndex("by_householdId",q=>q.eq("householdId",job.householdId)).paginate({cursor:args.cursor,numItems:25,maximumBytesRead:200000});
 const rows:string[]=[],recordIds=new Set<Id<"records">>(),packIds:Id<"visitPacks">[]=[],placeIds=new Set<Id<"places">>();
 for(const row of page.page){
  if(args.table==="records"){const record=row as Doc<"records">;if(!await canReadRecordFor(ctx,record,job.requestedBy))continue;recordIds.add(record._id);}
  if(["recordVersions","recordProposals","recordVisitLinks","recordShares","recordMailOrigins"].includes(args.table)&&"recordId" in row){const record=await ctx.db.get(row.recordId);if(!record||!await canReadRecordFor(ctx,record,job.requestedBy))continue;if(args.table==="recordShares"&&record.createdBy!==job.requestedBy)continue;recordIds.add(record._id);}
  if(requiresCareAccess&&"source" in row){if(!await canReadCareSource(ctx,row.source,job.requestedBy))continue;if(row.source.documentId)recordIds.add(row.source.documentId);}
  if(args.table==="handoverCareSnapshots"){const snapshot=row as Doc<"handoverCareSnapshots">;if(snapshot.senderId!==job.requestedBy&&snapshot.recipientId!==job.requestedBy)continue;let readable=true;for(const id of snapshot.sourceDocumentIds){if(!await canReadCareSource(ctx,{documentId:id},job.requestedBy)){readable=false;break;}}if(!readable)continue;for(const id of snapshot.sourceDocumentIds)recordIds.add(id);}
  if(args.table==="followUpReads"){const read=row as Doc<"followUpReads">;if(read.userId!==job.requestedBy||!mailAllowed)continue;const followUp=await ctx.db.get(read.followUpId);if(!followUp||!await canReadCareSource(ctx,followUp.source,job.requestedBy))continue;if(followUp.source.documentId)recordIds.add(followUp.source.documentId);requiresMailAccess=true;}
  if(args.table==="careShares"){const share=row as Doc<"careShares">;if(share.createdBy!==job.requestedBy)continue;const pack=await ctx.db.get(share.packId);if(!pack||!await canReadVisitPack(ctx,pack,job.requestedBy))continue;packIds.push(pack._id);for(const id of pack.sourceDocumentIds??pack.documentIds)recordIds.add(id);}
  if(args.table==="visitPacks"){const pack=row as Doc<"visitPacks">;if(!await canReadVisitPack(ctx,pack,job.requestedBy))continue;packIds.push(pack._id);for(const id of pack.sourceDocumentIds??pack.documentIds)recordIds.add(id);}
  if(args.table==="places"||args.table==="visitPlaces"){const place=args.table==="places"?row as Doc<"places">:await ctx.db.get((row as Doc<"visitPlaces">).placeId);if(!place||(place.visibility!=="household"&&place.createdBy!==job.requestedBy&&!place.readerIds.includes(job.requestedBy)))continue;placeIds.add(place._id);}
  if(["handovers","handoverItems","handoverChanges","handoverContextItems"].includes(args.table)){const handover=args.table==="handovers"?row as Doc<"handovers">:await ctx.db.get((row as Doc<"handoverItems">).handoverId);if(!handover)continue;if(handover.mailContextRestricted!==false){if(!mailAllowed)continue;requiresMailAccess=true;}}
  if(args.table==="sources"){const source=row as Doc<"sources">;if(!await canReadSource(ctx,source,job.requestedBy))continue;if(source.kind==="email")requiresMailAccess=true;}
  if((args.table==="proposals"||args.table==="sourceUses")&&"sourceId" in row){const source=await ctx.db.get(row.sourceId!);if(!await canReadSource(ctx,source,job.requestedBy))continue;if(source?.kind==="email")requiresMailAccess=true;}
  if(args.table==="events"){if(!await canReadEvent(ctx,row as Doc<"events">,job.requestedBy))continue;if(mailAllowed)requiresMailAccess=true;}
  if(args.table==="handoverContextItems"&&(row as Doc<"handoverContextItems">).snapshot.kind==="thread"){if(!mailAllowed)continue;requiresMailAccess=true;}
  if(args.table==="handoverChanges"){const change=row as Doc<"handoverChanges">;let accessible=true;if(change.kind==="event"){const id=ctx.db.normalizeId("events",change.referenceId),event=id?await ctx.db.get(id):null;if(!event||!await canReadEvent(ctx,event,job.requestedBy))accessible=false;}else{const id=ctx.db.normalizeId("proposals",change.referenceId),proposal=id?await ctx.db.get(id):null,source=proposal?await ctx.db.get(proposal.sourceId):null;if(!await canReadSource(ctx,source,job.requestedBy))accessible=false;}if(!accessible)continue;if(mailAllowed)requiresMailAccess=true;}
  const record:Record<string,unknown>={...row};
  if(args.table==="followUps"){if(!mailAllowed){delete record.mailRevision;delete record.latestMailAt;}else if("mailRevision" in row||"latestMailAt" in row)requiresMailAccess=true;const visible=[];for(const id of (row as Doc<"followUps">).recordIds??[]){const original=await ctx.db.get(id);if(original&&await canReadRecordFor(ctx,original,job.requestedBy)){visible.push(id);recordIds.add(id);}}record.recordIds=visible;}
  if("sourceRefs" in row){const visible=[];for(const ref of row.sourceRefs){const source=await ctx.db.get(ref.sourceId);if(await canReadSource(ctx,source,job.requestedBy)){visible.push(ref);if(source?.kind==="email")requiresMailAccess=true;}}record.sourceRefs=visible;}
  if(args.table==="handoverItems"){const item=row as Doc<"handoverItems">,visible=[];for(const ref of item.snapshot.sourceRefs){const source=await ctx.db.get(ref.sourceId);if(await canReadSource(ctx,source,job.requestedBy)){visible.push(ref);if(source?.kind==="email")requiresMailAccess=true;}}record.snapshot={...item.snapshot,sourceRefs:visible};}
for(const key of ["tokenHash","capabilityHash","syncToken","workflowId","idempotencyKey","storageId","extractionBudget"])delete record[key];rows.push(JSON.stringify({table:args.table,record}));
 }
 return {text:rows.length?rows.join("\n")+"\n":"",cursor:page.continueCursor,done:page.isDone,rows:rows.length,accessRecordIds:[...recordIds],requiresCareAccess,requiresMailAccess,visitPackIds:packIds,accessPlaceIds:[...placeIds]};
}});
export const filePage=internalQuery({args:{privacyJobId:v.id("privacyJobs"),cursor:v.union(v.string(),v.null())},returns:v.object({files:v.array(schema.doc("recordVersions")),cursor:v.string(),done:v.boolean()}),handler:async(ctx,args)=>{
 const {job}=await jobAccess(ctx,args.privacyJobId),page=await ctx.db.query("recordVersions").withIndex("by_householdId",q=>q.eq("householdId",job.householdId)).paginate({cursor:args.cursor,numItems:5});const files=[];for(const file of page.page){const record=await ctx.db.get(file.recordId);if(record&&await canReadRecordFor(ctx,record,job.requestedBy))files.push(file);}return {files,cursor:page.continueCursor,done:page.isDone};
}});
export const saved=internalMutation({args:{privacyJobId:v.id("privacyJobs"),partKey:v.string(),filename:v.string(),storageId:v.id("_storage"),bytes:v.number(),sha256:v.string(),rows:v.number(),...grants},returns:v.null(),handler:async(ctx,args)=>{
 const {job}=await jobAccess(ctx,args.privacyJobId);if(!await allowed(ctx,{householdId:job.householdId,...args},job.requestedBy))return fail("ACCESS_CHANGED","Access changed while preparing the export.");
 const prior=await ctx.db.query("exportParts").withIndex("by_privacyJobId_and_partKey",q=>q.eq("privacyJobId",job._id).eq("partKey",args.partKey)).unique();if(prior)await ctx.storage.delete(prior.storageId);
 const data={...args,householdId:job.householdId,createdAt:Date.now(),expiresAt:job.expiresAt};if(prior)await ctx.db.replace(prior._id,data);else await ctx.db.insert("exportParts",data);await ctx.db.patch(job._id,{state:"running",stage:"exporting"});return null;
}});
