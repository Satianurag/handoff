import type {Doc,Id} from "./_generated/dataModel";
import {fail,type UserMutationCtx,type UserQueryCtx} from "./model/access";
import {canReadCare,canReadCareSource} from "./careAccess";
import {canReadRecordFor} from "./recordsAccess";

type Ctx=UserMutationCtx|UserQueryCtx;
async function jointlyVisible(ctx:Ctx,source:{documentId?:Id<"records">},senderId:Id<"users">,recipientId:Id<"users">){return await canReadCareSource(ctx,source,senderId)&&await canReadCareSource(ctx,source,recipientId);}

// Health information lives outside household-wide handover events and snapshots.
// Both named participants retain access only while the original care/record grants do.
export async function buildCareSnapshot(ctx:Ctx,householdId:Id<"households">,senderId:Id<"users">,recipientId:Id<"users">,since:number){
 if(!await canReadCare(ctx,householdId,senderId)||!await canReadCare(ctx,householdId,recipientId))return null;
 const profile=await ctx.db.query("careProfiles").withIndex("by_householdId",q=>q.eq("householdId",householdId)).unique();if(!profile)return null;
 const sources=new Set<Id<"records">>();
 const followUps=[];
 const waiting=await ctx.db.query("followUps").withIndex("by_householdId_and_status_and_dueAt",q=>q.eq("householdId",householdId).eq("status","waiting")).take(101);
 if(waiting.length>100)fail("HANDOVER_TOO_LARGE","Review unresolved care follow-ups before preparing a handover. No follow-ups were omitted.");
 for(const row of waiting)if(await jointlyVisible(ctx,row.source,senderId,recipientId)){if(row.source.documentId)sources.add(row.source.documentId);followUps.push({id:row._id,version:row.version,title:row.title,detail:row.detail,ownerId:row.ownerId,dueAt:row.dueAt,requestedAt:row.requestedAt??null,status:row.status,visitId:row.visitId??null,contactId:row.contactId??null,source:row.source,proposed:row.ownerId===senderId});}
 const medicines=[];
 for(const status of ["current","uncertain"] as const){const rows=await ctx.db.query("medicineEntries").withIndex("by_householdId_and_status",q=>q.eq("householdId",householdId).eq("status",status)).take(201);if(rows.length>200)fail("HANDOVER_TOO_LARGE","Review the medicine reference before preparing a handover.");for(const row of rows)if(await jointlyVisible(ctx,row.source,senderId,recipientId)){if(row.source.documentId)sources.add(row.source.documentId);medicines.push({id:row._id,version:row.version,name:row.name,strength:row.strength??"",route:row.route??"",instructions:row.instructions,status:row.status,reviewNote:row.reviewNote,source:row.source,reviewedAt:row.reviewedAt});}}
 const notes=[];
 const changedNotes=await ctx.db.query("careNotes").withIndex("by_householdId_and_updatedAt",q=>q.eq("householdId",householdId).gte("updatedAt",since).lte("updatedAt",4102444800000)).take(101);
 if(changedNotes.length>100)fail("HANDOVER_TOO_LARGE","More than one hundred care notes changed since the last handover. No notes were omitted.");
 for(const row of changedNotes)if(await jointlyVisible(ctx,row.source,senderId,recipientId)){if(row.source.documentId)sources.add(row.source.documentId);notes.push({id:row._id,version:row.version,body:row.body,occurredAt:row.occurredAt,updatedAt:row.updatedAt,source:row.source});}
 const changedRecords=await ctx.db.query("records").withIndex("by_householdId_and_updatedAt",q=>q.eq("householdId",householdId).gte("updatedAt",since).lte("updatedAt",4102444800000)).take(101);
 if(changedRecords.length>100)fail("HANDOVER_TOO_LARGE","More than one hundred records changed since the last handover. No record changes were omitted.");
 for(const row of changedRecords)if(await canReadRecordFor(ctx,row,senderId)&&await canReadRecordFor(ctx,row,recipientId))sources.add(row._id);
 if(sources.size>300)fail("HANDOVER_TOO_LARGE","Reduce the amount of source material for this handover.");
 const documents=[];
 for(const id of [...sources].sort()){const row=await ctx.db.get(id);if(row)documents.push({id:row._id,title:row.title,category:row.category,documentDate:row.documentDate??"",version:row.version,versionId:row.currentVersionId??null,status:row.status,updatedAt:row.updatedAt});}
 const data={schemaVersion:1,profile:{id:profile._id,version:profile.version,preferredName:profile.preferredName,allergiesState:profile.allergiesState,allergies:profile.allergies,preferences:profile.preferences,communication:profile.communication,emergencyInstructions:profile.emergencyInstructions,reviewedAt:profile.reviewedAt},medicines,notes,followUps,documents};
 const snapshot=JSON.stringify(data);
 if(new TextEncoder().encode(snapshot).length>500000)fail("HANDOVER_TOO_LARGE","The care handover exceeds the review limit. No information was silently omitted.");
 const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(snapshot));
 const fingerprint=Array.from(new Uint8Array(hash)).map(n=>n.toString(16).padStart(2,"0")).join("");
 return {snapshot,data,sourceDocumentIds:[...sources].sort(),fingerprint};
}
export async function captureCareSnapshot(ctx:UserMutationCtx,handoverId:Id<"handovers">,since:number){
 const h=await ctx.db.get(handoverId);if(!h)fail("NOT_FOUND","Handover unavailable.");
 const built=await buildCareSnapshot(ctx,h.householdId,h.senderId,h.recipientId,since);if(!built)return;
 await ctx.db.insert("handoverCareSnapshots",{householdId:h.householdId,handoverId:h._id,senderId:h.senderId,recipientId:h.recipientId,snapshot:built.snapshot,sourceDocumentIds:built.sourceDocumentIds,fingerprint:built.fingerprint,capturedAt:Date.now(),since});
 await ctx.db.patch(h._id,{careSnapshotCaptured:true});
}
export async function canReadCareHandover(ctx:Ctx,row:Doc<"handoverCareSnapshots">,userId:Id<"users">){
 if(row.senderId!==userId&&row.recipientId!==userId)return false;
 if(!await canReadCare(ctx,row.householdId,userId))return false;
 for(const documentId of row.sourceDocumentIds)if(!await canReadCareSource(ctx,{documentId},userId))return false;
 return true;
}
export async function verifyCareSnapshot(ctx:UserMutationCtx,h:Doc<"handovers">){
 const row=await ctx.db.query("handoverCareSnapshots").withIndex("by_handoverId",q=>q.eq("handoverId",h._id)).unique();if(!row){if(h.careSnapshotCaptured)fail("INCOMPLETE_SNAPSHOT","The care snapshot is missing. Refresh this handover before continuing.");return null;}
 if(!await canReadCareHandover(ctx,row,h.senderId)||!await canReadCareHandover(ctx,row,h.recipientId))fail("STALE_HANDOVER","Care information access changed. Refresh the handover before continuing.");
 const current=await buildCareSnapshot(ctx,h.householdId,h.senderId,h.recipientId,row.since);
 if(!current||current.fingerprint!==row.fingerprint)fail("STALE_HANDOVER","Care records, notes or follow-ups changed. Refresh the handover to review the new information.");
 return {row,current};
}
export async function acceptCareFollowUps(ctx:UserMutationCtx,h:Doc<"handovers">,selected:Id<"followUps">[]){
 const result=await verifyCareSnapshot(ctx,h);
 if(selected.length>100||new Set(selected).size!==selected.length)fail("INVALID_SELECTION","Choose each care follow-up once.");
 if(!result){if(selected.length)fail("INVALID_SELECTION","No care follow-ups were offered in this handover.");return;}
 for(const id of selected){const offered=result.current.data.followUps.find(f=>f.id===id&&f.proposed);if(!offered)fail("INVALID_SELECTION","Select only care follow-ups offered by the sender.");const row=await ctx.db.get(id);if(!row||row.version!==offered.version||row.ownerId!==h.senderId||row.status!=="waiting")fail("STALE_HANDOVER","A care follow-up changed. Refresh before accepting.");await ctx.db.patch(id,{ownerId:ctx.user._id,version:row.version+1,updatedAt:Date.now()});}
 const accepted=await buildCareSnapshot(ctx,h.householdId,h.senderId,h.recipientId,result.row.since);
 await ctx.db.patch(result.row._id,{acceptedFollowUpIds:selected,acceptedFingerprint:accepted?.fingerprint});
}
