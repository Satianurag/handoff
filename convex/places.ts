import { v } from "convex/values";
import schema from "./schema";
import { internalMutation, internalQuery } from "./_generated/server";
import { userQuery, userMutation, internalUserMutation, member, fail, text, checkVersion, activeAssignee, type UserQueryCtx, type UserMutationCtx } from "./model/access";
import { priorRequest, saveRequest } from "./model/requests";
import {record,notify} from "./model/events";
import { limits } from "./model/limits";
import { placeFields, geocodeCandidate } from "./placesSchema";
import type { Doc, Id } from "./_generated/dataModel";

const readable = (row: Doc<"places">, userId: Id<"users">) => row.visibility === "household" || row.createdBy === userId || row.readerIds.includes(userId);
async function accessible(ctx: UserQueryCtx | UserMutationCtx, id: Id<"places">) {
  const row = await ctx.db.get(id);
  if (!row) return fail("NOT_FOUND", "This place is unavailable.");
  await member(ctx, row.householdId);
  if (!readable(row, ctx.user._id)) return fail("NOT_FOUND", "This place is unavailable.");
  return row;
}
async function clean(ctx: UserMutationCtx, householdId: Id<"households">, fields: Omit<Doc<"places">, "_id"|"_creationTime"|"householdId"|"createdBy"|"updatedAt"|"version"|"confirmedAt">) {
  if ((fields.latitude === null) !== (fields.longitude === null)) fail("INVALID_PIN", "Choose both latitude and longitude, or leave both empty.");
  if (fields.latitude !== null && (!Number.isFinite(fields.latitude) || Math.abs(fields.latitude) > 85.051129)) fail("INVALID_PIN", "Choose a latitude between −85.05 and 85.05.");
  if (fields.longitude !== null && (!Number.isFinite(fields.longitude) || Math.abs(fields.longitude) > 180)) fail("INVALID_PIN", "Choose a longitude between −180 and 180.");
  if (fields.readerIds.length > 20) fail("INVALID_READERS", "Choose at most twenty people.");
  const readerIds = [...new Set(fields.readerIds)];
  for (const id of readerIds) await activeAssignee(ctx, householdId, id);
  return { ...fields, readerIds, name: text(fields.name,"Place name",160), address: text(fields.address,"Address",1000), phone: text(fields.phone,"Phone",80,true), entrance: text(fields.entrance,"Entrance",1000,true), parking: text(fields.parking,"Parking",1000,true), accessibility: text(fields.accessibility,"Accessibility",1000,true) };
}
export const list = userQuery({args:{householdId:v.id("households")},returns:v.array(schema.doc("places")),handler:async(ctx,args)=>{
  await member(ctx,args.householdId);
  // Creation enforces a hundred-place household limit; this is the complete bounded set.
  const rows=await ctx.db.query("places").withIndex("by_householdId",q=>q.eq("householdId",args.householdId)).take(101);
  return rows.filter(row=>readable(row,ctx.user._id)).sort((a,b)=>a.name.localeCompare(b.name));
}});
export const create = userMutation({args:{householdId:v.id("households"),...placeFields,requestId:v.string()},returns:v.id("places"),handler:async(ctx,args)=>{
  await member(ctx,args.householdId);
  const fingerprint=JSON.stringify(args),prior=await priorRequest(ctx,"places.create",args.requestId,fingerprint);
  if(prior){const id=ctx.db.normalizeId("places",prior.resultId);if(id)return id;}
  const rows=await ctx.db.query("places").withIndex("by_householdId",q=>q.eq("householdId",args.householdId)).take(100);
  if(rows.length>=100)fail("PLACE_LIMIT","This care space already has one hundred places. Remove an unused place first.");
  const {householdId,requestId,...fields}=args;
  const id=await ctx.db.insert("places",{householdId,...await clean(ctx,householdId,fields),createdBy:ctx.user._id,updatedAt:Date.now(),confirmedAt:Date.now(),version:1});
  await saveRequest(ctx,"places.create",requestId,fingerprint,id);return id;
}});
export const edit = userMutation({args:{placeId:v.id("places"),expectedVersion:v.number(),reconfirmTasks:v.optional(v.boolean()),...placeFields},returns:v.null(),handler:async(ctx,args)=>{
  const row=await accessible(ctx,args.placeId),{placeId,expectedVersion,reconfirmTasks,...fields}=args;
  checkVersion(row,expectedVersion);
  const {household}=await member(ctx,row.householdId);
  if(row.createdBy!==ctx.user._id&&household.ownerId!==ctx.user._id)fail("FORBIDDEN","Only the person who added this place or the coordinator can edit it.");
  if(row.address!==fields.address.trim()||row.latitude!==fields.latitude||row.longitude!==fields.longitude){
   const tasks=await ctx.db.query("tasks").withIndex("by_placeId_and_status",q=>q.eq("placeId",row._id).eq("status","open")).take(101);if(tasks.length>100)fail("PLACE_IN_USE","Review this location's open errands before changing it; more than one hundred depend on it.");
   if(tasks.some(t=>t.ownerId)&&!reconfirmTasks)fail("ASSIGNMENT_REVIEW_REQUIRED","Confirm requesting acceptance again for errands whose destination changes.");
   for(const task of tasks)if(task.ownerId)await requestPlaceAcceptance(ctx,task);
  }
  await ctx.db.patch(row._id,{...await clean(ctx,row.householdId,fields),version:row.version+1,updatedAt:Date.now(),confirmedAt:Date.now()});return null;
}});
export const remove = userMutation({args:{placeId:v.id("places"),expectedVersion:v.number()},returns:v.null(),handler:async(ctx,args)=>{
  const row=await accessible(ctx,args.placeId);checkVersion(row,args.expectedVersion);
  const {household}=await member(ctx,row.householdId);
  if(row.createdBy!==ctx.user._id&&household.ownerId!==ctx.user._id)fail("FORBIDDEN","Only the person who added this place or the coordinator can remove it.");
  const link=await ctx.db.query("visitPlaces").withIndex("by_placeId",q=>q.eq("placeId",row._id)).first();
  const task=await ctx.db.query("tasks").withIndex("by_placeId",q=>q.eq("placeId",row._id)).first();
  if(link||task)fail("PLACE_IN_USE","This place is linked to a visit or responsibility. Unlink it before removing it.");
  await ctx.db.delete(row._id);return null;
}});
export const forVisit = userQuery({args:{visitId:v.id("visits")},returns:v.union(schema.doc("places"),v.null()),handler:async(ctx,args)=>{
  const visit=await ctx.db.get(args.visitId);if(!visit)return fail("NOT_FOUND","Visit unavailable.");await member(ctx,visit.householdId);
  const link=await ctx.db.query("visitPlaces").withIndex("by_visitId",q=>q.eq("visitId",visit._id)).unique();
  if(!link)return null;const place=await ctx.db.get(link.placeId);return place&&readable(place,ctx.user._id)?place:null;
}});
export const linkVisit = userMutation({args:{visitId:v.id("visits"),placeId:v.union(v.id("places"),v.null())},returns:v.null(),handler:async(ctx,args)=>{
  const visit=await ctx.db.get(args.visitId);if(!visit)return fail("NOT_FOUND","Visit unavailable.");await member(ctx,visit.householdId);
  if(args.placeId){const place=await accessible(ctx,args.placeId);if(place.householdId!==visit.householdId)fail("NOT_FOUND","Choose a place from this care space.");}
  const link=await ctx.db.query("visitPlaces").withIndex("by_visitId",q=>q.eq("visitId",visit._id)).unique();
  if(link){if(args.placeId)await ctx.db.patch(link._id,{placeId:args.placeId,linkedBy:ctx.user._id,updatedAt:Date.now()});else await ctx.db.delete(link._id);}
  else if(args.placeId)await ctx.db.insert("visitPlaces",{householdId:visit.householdId,visitId:visit._id,placeId:args.placeId,linkedBy:ctx.user._id,updatedAt:Date.now()});
  return null;
}});
export const authorizeSearch = internalUserMutation({args:{householdId:v.id("households")},returns:v.null(),handler:async(ctx,args)=>{
  await member(ctx,args.householdId);
  await limits.limit(ctx,"placeSearchUser",{key:ctx.user._id,config:{kind:"token bucket",rate:6,period:60000,capacity:3},throws:true});
  await limits.limit(ctx,"placeSearchGlobal",{config:{kind:"token bucket",rate:30,period:60000,capacity:2},throws:true});return null;
}});
export const cached = internalQuery({args:{key:v.string()},returns:v.union(v.array(geocodeCandidate),v.null()),handler:async(ctx,args)=>{
  const row=await ctx.db.query("geocodeCache").withIndex("by_key",q=>q.eq("key",args.key)).unique();return row&&row.expiresAt>Date.now()?row.results:null;
}});
export const cache = internalMutation({args:{key:v.string(),results:v.array(geocodeCandidate)},returns:v.null(),handler:async(ctx,args)=>{
  const row=await ctx.db.query("geocodeCache").withIndex("by_key",q=>q.eq("key",args.key)).unique();
  const value={...args,expiresAt:Date.now()+86400000};if(row)await ctx.db.patch(row._id,value);else await ctx.db.insert("geocodeCache",value);
  const expired=await ctx.db.query("geocodeCache").withIndex("by_expiresAt",q=>q.lt("expiresAt",Date.now())).take(50);for(const item of expired)await ctx.db.delete(item._id);return null;
}});

export const forTask=userQuery({args:{taskId:v.id("tasks")},returns:v.union(schema.doc("places"),v.null()),handler:async(ctx,args)=>{
 const task=await ctx.db.get(args.taskId);if(!task)fail("NOT_FOUND","Responsibility unavailable.");await member(ctx,task.householdId);const place=task.placeId?await ctx.db.get(task.placeId):null;return place&&place.householdId===task.householdId&&readable(place,ctx.user._id)?place:null;
}});
export const linkTask=userMutation({args:{taskId:v.id("tasks"),placeId:v.union(v.id("places"),v.null()),expectedVersion:v.number(),requestAcceptance:v.optional(v.boolean())},returns:v.null(),handler:async(ctx,args)=>{
 const task=await ctx.db.get(args.taskId);if(!task)fail("NOT_FOUND","Responsibility unavailable.");await member(ctx,task.householdId);checkVersion(task,args.expectedVersion);if((task.placeId??null)===args.placeId)return null;
 if(args.placeId){const place=await accessible(ctx,args.placeId);if(place.householdId!==task.householdId)fail("NOT_FOUND","Choose a place from this care space.");if(task.visitId)fail("VISIT_LOCATION","Set travel destinations on the linked visit. Standalone errands can have their own place.");}
 const changed=(task.placeId??null)!==args.placeId;
 if(changed&&task.status==="open"&&task.ownerId){if(!args.requestAcceptance)fail("ASSIGNMENT_REVIEW_REQUIRED","Confirm requesting acceptance again for the changed destination.");await requestPlaceAcceptance(ctx,task);}
 await ctx.db.patch(task._id,{placeId:args.placeId,version:task.version+1,updatedAt:Date.now()});await record(ctx,{householdId:task.householdId,actorId:ctx.user._id,type:"task.locationLinked",entity:{kind:"task",id:task._id},after:args.placeId?"Saved location linked to this responsibility. Location sharing remains separate.":"Saved location unlinked from this responsibility."});return null;
}});

async function requestPlaceAcceptance(ctx:UserMutationCtx,task:Doc<"tasks">){
 if(!task.ownerId)return;await ctx.db.patch(task._id,{ownerId:null,requestedOwnerId:task.ownerId,version:task.version+1,updatedAt:Date.now()});
 const event=await record(ctx,{householdId:task.householdId,actorId:ctx.user._id,type:"task.locationChanged",entity:{kind:"task",id:task._id},after:"The errand destination changed. The previously assigned person must accept the updated responsibility."});
 await notify(ctx,{householdId:task.householdId,userId:task.ownerId,target:{kind:"task",id:task._id},type:"assignment.requested",eventId:event.eventId,dedupeKey:`${event.eventId}:${task.ownerId}`});
 const replacement=await ctx.db.query("replacementRequests").withIndex("by_target_and_status",q=>q.eq("target",{kind:"task",id:task._id}).eq("status","open")).first();if(replacement)await ctx.db.patch(replacement._id,{status:"cancelled",resolvedBy:ctx.user._id,resolvedAt:Date.now(),version:replacement.version+1,updatedAt:Date.now()});
}
