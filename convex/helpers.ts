import {v} from "convex/values";
import {paginationOptsValidator,paginationResultValidator} from "convex/server";
import type {Doc,Id} from "./_generated/dataModel";
import {userQuery,userMutation,member,type UserQueryCtx,type UserMutationCtx,clearCareGrant,fail,checkVersion,range} from "./model/access";
import {record,notify} from "./model/events";
import {syncPolicies} from "./model/operations";
import {accessPreset,category,taskStatus,visitStatus} from "./validators";
import schema from "./schema";

const hid={householdId:v.id("households")};
const travel=v.object({status:visitStatus,entrance:v.string(),parking:v.string(),locationShared:v.boolean(),when:v.number(),timezone:v.string(),address:v.string(),phone:v.string(),pickupAddress:v.string(),pickupAt:v.union(v.number(),v.null()),arrivalAt:v.union(v.number(),v.null()),returnAt:v.union(v.number(),v.null()),returnAddress:v.string(),accessibilityNote:v.string(),accompanyingNote:v.string()});
const taskPlace=v.object({name:v.string(),address:v.string(),phone:v.string(),entrance:v.string(),parking:v.string(),accessibility:v.string(),locationShared:v.boolean()});
const item=v.object({place:v.union(taskPlace,v.null()),_id:v.id("tasks"),_creationTime:v.number(),title:v.string(),note:v.string(),category,status:taskStatus,dueAt:v.union(v.number(),v.null()),version:v.number(),assignment:v.union(v.literal("requested"),v.literal("accepted")),travelRole:v.union(v.literal("outbound"),v.literal("return"),v.literal("accompany"),v.null()),visit:v.union(travel,v.null())});

async function practicalTaskPlace(ctx:UserQueryCtx|UserMutationCtx,task:Doc<"tasks">,userId:Id<"users">){
 if(!task.placeId)return null;const place=await ctx.db.get(task.placeId),allowed=place&&place.householdId===task.householdId&&(place.visibility==="household"||place.createdBy===userId||place.readerIds.includes(userId));
 return {name:allowed?place.name:"",address:allowed?place.address:"",phone:allowed?place.phone:"",entrance:allowed?place.entrance:"",parking:allowed?place.parking:"",accessibility:allowed?place.accessibility:"",locationShared:!!allowed};
}
async function practicalVisit(ctx:UserQueryCtx|UserMutationCtx,task:Doc<"tasks">,userId:Id<"users">){
 let visit=null,travelRole:"outbound"|"return"|"accompany"|null=null;
 if(task.visitId){const row=await ctx.db.get(task.visitId);if(row&&row.householdId===task.householdId){
  travelRole=row.rideTaskId===task._id?"outbound":row.returnRideTaskId===task._id?"return":row.companionTaskId===task._id?"accompany":null;
  if(travelRole){const t=row.transport,link=await ctx.db.query("visitPlaces").withIndex("by_visitId",q=>q.eq("visitId",row._id)).unique(),place=link?await ctx.db.get(link.placeId):null;
   const locationShared=!link||!!place&&(place.visibility==="household"||place.createdBy===userId||place.readerIds.includes(userId));
   const address=locationShared?(place?.address??row.confirmedAddress):"",phone=locationShared?(place?.phone??row.phone):"";
   visit={status:row.status,entrance:locationShared?place?.entrance??"":"",parking:locationShared?place?.parking??"":"",locationShared,when:row.confirmedStartsAt,timezone:row.timezone,address,phone,pickupAddress:travelRole==="outbound"?t?.pickupAddress??"":travelRole==="return"?address:"",pickupAt:travelRole==="outbound"?t?.pickupAt??null:travelRole==="return"?t?.returnAt??null:null,arrivalAt:travelRole!=="return"?t?.arrivalAt??null:null,returnAt:travelRole==="return"?t?.returnAt??null:null,returnAddress:travelRole==="return"?t?.returnAddress??"":"",accessibilityNote:[t?.accessibilityNote,locationShared?place?.accessibility:null].filter(Boolean).join(" · "),accompanyingNote:travelRole==="accompany"?t?.accompanyingNote??"":""};
  }
 }}return {visit,travelRole};
}

export const context=userQuery({args:hid,returns:v.object({householdId:v.id("households"),nickname:v.string(),timezone:v.string(),mode:v.union(v.literal("real"),v.literal("demo")),ownerName:v.string(),accessPreset}),handler:async(ctx,args)=>{const {household,membership}=await member(ctx,args.householdId,false,true);const p=await ctx.db.query("profiles").withIndex("by_userId",q=>q.eq("userId",household.ownerId)).unique();return {householdId:household._id,nickname:household.nickname,timezone:household.timezone,mode:household.mode,ownerName:p?.displayName??"Household coordinator",accessPreset:membership.accessPreset??"care_circle" as const};}});
export const home=userQuery({
 args:{...hid,lane:v.union(v.literal("requested"),v.literal("mine"),v.literal("done"),v.literal("cancelled")),paginationOpts:paginationOptsValidator},returns:paginationResultValidator(item),
 handler:async(ctx,args)=>{
  await member(ctx,args.householdId,false,true);
  const rows=args.lane==="cancelled"?ctx.db.query("tasks").withIndex("by_householdId_and_status_and_dueAt",q=>q.eq("householdId",args.householdId).eq("status","cancelled")):args.lane==="requested"?ctx.db.query("tasks").withIndex("by_householdId_and_requestedOwnerId_and_status_and_dueAt",q=>q.eq("householdId",args.householdId).eq("requestedOwnerId",ctx.user._id).eq("status","open")):ctx.db.query("tasks").withIndex("by_householdId_and_ownerId_and_status_and_dueAt",q=>q.eq("householdId",args.householdId).eq("ownerId",ctx.user._id).eq("status",args.lane==="done"?"done":"open"));
  const result=await rows.paginate(args.paginationOpts),page=[];
  for(const task of result.page){
   if(args.lane==="cancelled"&&task.ownerId!==ctx.user._id&&task.requestedOwnerId!==ctx.user._id)continue;
   const {visit,travelRole}=await practicalVisit(ctx,task,ctx.user._id);
   page.push({place:await practicalTaskPlace(ctx,task,ctx.user._id),_id:task._id,_creationTime:task._creationTime,title:task.title,note:task.note,category:task.category,status:task.status,dueAt:task.dueAt,version:task.version,assignment:task.ownerId===ctx.user._id?"accepted" as const:"requested" as const,travelRole,visit});
  }
  return {...result,page};
 }
});
export const respond=userMutation({
 args:{taskId:v.id("tasks"),expectedVersion:v.number(),operation:v.union(v.literal("accept"),v.literal("decline"),v.literal("complete"),v.literal("release"))},returns:v.null(),
 handler:async(ctx,args)=>{
  const task=await ctx.db.get(args.taskId);if(!task)fail("NOT_FOUND","Responsibility unavailable.");const {household}=await member(ctx,task.householdId,false,true);checkVersion(task,args.expectedVersion);
  if(task.status!=="open")fail("INVALID_STATE","This responsibility is no longer open.");const requested=args.operation==="accept"||args.operation==="decline";
  if(requested?task.requestedOwnerId!==ctx.user._id:task.ownerId!==ctx.user._id)fail("NOT_FOUND","Only a responsibility assigned or requested directly to you can be changed.");
  const patch:Partial<Doc<"tasks">>={version:task.version+1,updatedAt:Date.now()};
  if(requested){patch.requestedOwnerId=null;if(args.operation==="accept")patch.ownerId=ctx.user._id;}
  if(args.operation==="release"){patch.ownerId=null;patch.requestedOwnerId=null;}
  if(args.operation==="complete"){patch.status="done";patch.completedAt=Date.now();patch.completedBy=ctx.user._id;patch.requestedOwnerId=null;patch.retentionUntil=Date.now()+90*86400000;}
  await ctx.db.patch(task._id,patch);
  const event=await record(ctx,{householdId:task.householdId,actorId:ctx.user._id,type:`task.helper.${args.operation}`,entity:{kind:"task",id:task._id},after:args.operation==="accept"?"Assigned helper explicitly accepted responsibility.":args.operation==="decline"?"Assigned helper declined the request.":args.operation==="release"?"Assigned helper released responsibility; reassignment is needed.":"Assigned helper marked the responsibility complete."});
  if(household.ownerId!==ctx.user._id)await notify(ctx,{householdId:household._id,userId:household.ownerId,target:{kind:"task",id:task._id},type:`task.helper.${args.operation}`,eventId:event.eventId,dedupeKey:`${event.eventId}:${household.ownerId}`});return null;
 }
});
export const availability=userQuery({args:{...hid,from:v.number(),to:v.number()},returns:v.array(schema.doc("memberAvailability")),handler:async(ctx,args)=>{await member(ctx,args.householdId,false,true);range(args.from,args.to,93);const rows=await ctx.db.query("memberAvailability").withIndex("by_householdId_and_userId_and_startsAt",q=>q.eq("householdId",args.householdId).eq("userId",ctx.user._id).gte("startsAt",Math.max(0,args.from-93*86400000)).lt("startsAt",args.to)).take(201);if(rows.length>200)fail("RANGE_TOO_DENSE","Choose a smaller availability date range.");return rows.filter(r=>r.endsAt>args.from);}});
export const leave=userMutation({args:hid,returns:v.null(),handler:async(ctx,args)=>{const {household,membership}=await member(ctx,args.householdId,false,true);if(household.ownerId===ctx.user._id)fail("LAST_OWNER","The coordinator must transfer ownership before leaving.");await ctx.db.patch(membership._id,{status:"left",endedAt:Date.now(),privacyRevokedAt:Date.now(),emailNotifications:false});await clearCareGrant(ctx,household._id,ctx.user._id);await syncPolicies(ctx,household._id);await record(ctx,{householdId:household._id,actorId:ctx.user._id,type:"team.left",entity:{kind:"household",id:household._id},after:"Member left; unfinished responsibilities retain their attribution until reassigned."});return null;}});

const replacementItem=v.object({place:v.union(taskPlace,v.null()),_id:v.id("replacementRequests"),version:v.number(),taskId:v.id("tasks"),title:v.string(),note:v.string(),dueAt:v.union(v.number(),v.null()),travelRole:item.fields.travelRole,visit:v.union(travel,v.null())});
export const replacements=userQuery({args:{...hid,paginationOpts:paginationOptsValidator},returns:paginationResultValidator(replacementItem),handler:async(ctx,args)=>{
 await member(ctx,args.householdId,false,true);
 const result=await ctx.db.query("replacementRequests").withIndex("by_householdId_and_requestedMemberId_and_status",q=>q.eq("householdId",args.householdId).eq("requestedMemberId",ctx.user._id).eq("status","open")).paginate(args.paginationOpts),page=[];
 for(const r of result.page){if(r.target.kind!=="task")continue;const task=await ctx.db.get(r.target.id);if(!task||task.householdId!==args.householdId||task.status!=="open"||task.ownerId!==r.previousOwnerId||task.version!==r.targetVersion)continue;const practical=await practicalVisit(ctx,task,ctx.user._id);page.push({place:await practicalTaskPlace(ctx,task,ctx.user._id),_id:r._id,version:r.version,taskId:task._id,title:task.title,note:task.note,dueAt:task.dueAt,...practical});}return {...result,page};
}});
export const respondReplacement=userMutation({args:{replacementId:v.id("replacementRequests"),expectedVersion:v.number(),operation:v.union(v.literal("accept"),v.literal("decline"))},returns:v.null(),handler:async(ctx,args)=>{
 const row=await ctx.db.get(args.replacementId);if(!row)fail("NOT_FOUND","Replacement unavailable.");await member(ctx,row.householdId,false,true);if(row.requestedMemberId!==ctx.user._id||row.target.kind!=="task")fail("NOT_FOUND","Only a task replacement requested directly from you can be changed.");checkVersion(row,args.expectedVersion);if(row.status!=="open")fail("INVALID_STATE","This request has already been resolved.");
 const task=await ctx.db.get(row.target.id);if(!task||task.householdId!==row.householdId)fail("NOT_FOUND","Responsibility unavailable.");
 if(args.operation==="accept"){checkVersion(task,row.targetVersion);if(task.status!=="open"||task.ownerId!==row.previousOwnerId)fail("CONFLICT","The responsibility changed. Ask for a fresh request.");await ctx.db.patch(task._id,{ownerId:ctx.user._id,requestedOwnerId:null,version:task.version+1,updatedAt:Date.now()});}
 await ctx.db.patch(row._id,{status:args.operation==="accept"?"accepted":"declined",resolvedBy:ctx.user._id,resolvedAt:Date.now(),version:row.version+1,updatedAt:Date.now()});const event=await record(ctx,{householdId:row.householdId,actorId:ctx.user._id,type:`replacement.${args.operation}`,entity:row.target,after:args.operation==="accept"?"Assigned helper explicitly accepted replacement responsibility.":"Assigned helper declined replacement; responsibility remains with the current person."});await notify(ctx,{householdId:row.householdId,userId:row.createdBy,target:row.target,type:`replacement.${args.operation}`,eventId:event.eventId,dedupeKey:`${event.eventId}:${row.createdBy}`});return null;
}});
