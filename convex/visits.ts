import {canReadCare,requireHealthAccess} from "./careAccess";
import {redactSourceRefs} from "./model/mailAccess";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { visitStatus, visitTransport } from "./validators";
import { range } from "./model/access";
import {linkEvidence} from "./model/sourceUses";
import { v } from "convex/values";
import schema from "./schema";
import { checklistItem } from "./validators";
import { activeAssignee, type UserMutationCtx, checkVersion, fail, member, text, timestamp, timezone, userMutation, userQuery } from "./model/access";
import { record, notify } from "./model/events";
import { priorRequest, saveRequest } from "./model/requests";
import type {Doc,Id} from "./_generated/dataModel";

function checklist(items: { key: string; label: string; done: boolean }[]) {
  if (items.length > 50 || new Set(items.map(i => i.key)).size !== items.length) fail("INVALID_CHECKLIST", "Use at most fifty checklist items with distinct keys.");
  return items.map(item => ({ key: text(item.key, "Checklist key", 80), label: text(item.label, "Checklist item", 200), done: item.done }));
}

export const get = userQuery({
  args: { visitId: v.id("visits") }, returns: v.object({ visit: schema.doc("visits"), ride: v.union(schema.doc("tasks"), v.null()), returnRide:v.union(schema.doc("tasks"),v.null()), companion:v.union(schema.doc("tasks"),v.null()), watches: v.array(schema.doc("watches")) }),
  handler: async (ctx, args) => {
    const visit = await ctx.db.get(args.visitId); if (!visit) return fail("NOT_FOUND", "Visit unavailable.");
    await member(ctx, visit.householdId);
    const ride = visit.rideTaskId ? await ctx.db.get(visit.rideTaskId) : null;
    const returnRide=visit.returnRideTaskId?await ctx.db.get(visit.returnRideTaskId):null,companion=visit.companionTaskId?await ctx.db.get(visit.companionTaskId):null;
    const watches = await ctx.db.query("watches").withIndex("by_visitId", q => q.eq("visitId", visit._id)).take(6);
    const sanitize=async(task:Doc<"tasks">|null)=>task?.householdId===visit.householdId?{...task,sourceRefs:await redactSourceRefs(ctx,task.sourceRefs,ctx.user._id)}:null;
    return { visit:{...visit,sourceRefs:await redactSourceRefs(ctx,visit.sourceRefs,ctx.user._id)},ride:await sanitize(ride),returnRide:await sanitize(returnRide),companion:await sanitize(companion),watches };
  },
});

const fields = { title: v.string(), confirmedStartsAt: v.number(), timezone: v.string(), confirmedAddress: v.string(), phone: v.string(), note: v.string(), checklist: v.array(checklistItem) };

export const create = userMutation({
  args: { householdId: v.id("households"), ...fields, requestId: v.string() }, returns: v.id("visits"),
  handler: async (ctx, args) => {
    await member(ctx, args.householdId);
    const fingerprint = JSON.stringify(args), prior = await priorRequest(ctx, "visits.create", args.requestId, fingerprint);
    if (prior) { const id = ctx.db.normalizeId("visits", prior.resultId); if (!id) return fail("NOT_FOUND", "Visit unavailable."); return id; }
    const id = await ctx.db.insert("visits", { householdId: args.householdId, title: text(args.title, "Title", 160), confirmedStartsAt: timestamp(args.confirmedStartsAt), timezone: timezone(args.timezone), confirmedAddress: text(args.confirmedAddress, "Address", 1000, true), phone: text(args.phone, "Phone", 80, true), note: text(args.note, "Note", 4000, true), checklist: checklist(args.checklist), rideTaskId: null, status: "upcoming", version: 1, sourceRefs: [], createdBy: ctx.user._id, updatedAt: Date.now() });
    await record(ctx, { householdId: args.householdId, actorId: ctx.user._id, type: "visit.created", entity: { kind: "visit", id }, after: args.title });
    await saveRequest(ctx, "visits.create", args.requestId, fingerprint, id); return id;
  },
});

async function openTravel(ctx:UserMutationCtx,visit:Doc<"visits">){
 const rows=[];for(const id of new Set([visit.rideTaskId,visit.returnRideTaskId,visit.companionTaskId].filter((id):id is Id<"tasks">=>!!id))){const task=await ctx.db.get(id);if(task&&task.householdId===visit.householdId&&task.visitId===visit._id&&task.status==="open")rows.push(task);}return rows;
}
async function reconcileTravel(ctx:UserMutationCtx,visit:Doc<"visits">,tasks:Doc<"tasks">[],operation:"reschedule"|"cancel",delta=0){
 for(const task of tasks){const dueAt=task.dueAt===null?null:timestamp(task.dueAt+delta),assignee=task.ownerId??task.requestedOwnerId;
  await ctx.db.patch(task._id,operation==="cancel"?{status:"cancelled",cancelledAt:Date.now(),retentionUntil:Date.now()+90*86400000,version:task.version+1,updatedAt:Date.now()}:{dueAt,ownerId:null,requestedOwnerId:assignee,version:task.version+1,updatedAt:Date.now()});
  const event=await record(ctx,{householdId:visit.householdId,actorId:ctx.user._id,type:`task.travel.${operation}`,entity:{kind:"task",id:task._id},after:operation==="cancel"?"Visit cancelled. This travel responsibility was explicitly cancelled too.":"Visit details changed. Travel time updated and acceptance requested again."});
  if(assignee)await notify(ctx,{householdId:visit.householdId,userId:assignee,target:{kind:"task",id:task._id},type:`task.travel.${operation}`,eventId:event.eventId,dedupeKey:`${event.eventId}:${assignee}`});
  const replacement=await ctx.db.query("replacementRequests").withIndex("by_target_and_status",q=>q.eq("target",{kind:"task",id:task._id}).eq("status","open")).first();if(replacement)await ctx.db.patch(replacement._id,{status:"cancelled",resolvedBy:ctx.user._id,resolvedAt:Date.now(),version:replacement.version+1,updatedAt:Date.now()});
 }
}

export const edit = userMutation({
  args: { visitId: v.id("visits"), expectedVersion: v.number(), reconcileTravel:v.optional(v.boolean()), ...fields }, returns: v.null(),
  handler: async (ctx, args) => {
    const visit = await ctx.db.get(args.visitId); if (!visit) return fail("NOT_FOUND", "Visit unavailable.");
    await member(ctx, visit.householdId); checkVersion(visit, args.expectedVersion);
    if (visit.status !== "upcoming") fail("INVALID_STATE", "Restore this visit before editing it.");
    const changed=args.confirmedStartsAt!==visit.confirmedStartsAt||args.timezone!==visit.timezone||args.confirmedAddress.trim()!==visit.confirmedAddress;
    const travel=changed?await openTravel(ctx,visit):[];
    if((travel.length||changed&&visit.transport)&&!args.reconcileTravel)fail("TRAVEL_REVIEW_REQUIRED","Confirm updating linked travel times and requesting acceptance again before changing this visit.");
    const delta=args.confirmedStartsAt-visit.confirmedStartsAt;
    if(changed&&args.reconcileTravel){await reconcileTravel(ctx,visit,travel,"reschedule",delta);if(visit.transport&&delta){const t=visit.transport;await ctx.db.patch(visit._id,{transport:{...t,pickupAt:t.pickupAt===null?null:timestamp(t.pickupAt+delta),arrivalAt:t.arrivalAt===null?null:timestamp(t.arrivalAt+delta),returnAt:t.returnAt===null?null:timestamp(t.returnAt+delta)}});}}
    await ctx.db.patch(visit._id, { title: text(args.title, "Title", 160), confirmedStartsAt: timestamp(args.confirmedStartsAt), timezone: timezone(args.timezone), confirmedAddress: text(args.confirmedAddress, "Address", 1000, true), phone: text(args.phone, "Phone", 80, true), note: text(args.note, "Note", 4000, true), checklist: checklist(args.checklist), version: visit.version + 1, updatedAt: Date.now() });
    await record(ctx, { householdId: visit.householdId, actorId: ctx.user._id, type: "visit.edited", entity: { kind: "visit", id: visit._id }, before: JSON.stringify({ title: visit.title, time: visit.confirmedStartsAt, address: visit.confirmedAddress }), after: JSON.stringify({ title: args.title, time: args.confirmedStartsAt, address: args.confirmedAddress }) });
    return null;
  },
});

type TravelKind="outbound"|"return"|"accompany";
const travelKind=v.union(v.literal("outbound"),v.literal("return"),v.literal("accompany"));
const travelField=(kind:TravelKind)=>kind==="return"?"returnRideTaskId":kind==="accompany"?"companionTaskId":"rideTaskId";
async function linkTravel(ctx:UserMutationCtx,visit:Doc<"visits">,kind:TravelKind,taskId:Id<"tasks">|null){
 const field=travelField(kind),oldId=visit[field]??null;if(oldId===taskId)return;
 if(taskId){const task=await ctx.db.get(taskId);if(!task||task.householdId!==visit.householdId)fail("NOT_FOUND","Travel responsibility unavailable.");
  if(task.status!=="open"||(kind!=="accompany"&&task.category!=="ride")||(task.visitId&&task.visitId!==visit._id))fail("INVALID_RIDE","Choose an open responsibility that is not linked to another visit.");
  const others=[visit.rideTaskId,visit.returnRideTaskId,visit.companionTaskId].filter(id=>id&&id!==oldId);if(others.includes(taskId))fail("DUPLICATE_TRAVEL_TASK","Use separate responsibilities for the outward journey, return and accompaniment.");
  await ctx.db.patch(taskId,{visitId:visit._id,version:task.version+1,updatedAt:Date.now()});
 }
 if(oldId){const old=await ctx.db.get(oldId);if(old?.visitId===visit._id)await ctx.db.patch(oldId,{visitId:undefined,version:old.version+1,updatedAt:Date.now()});}
 await ctx.db.patch(visit._id,{[field]:taskId,version:visit.version+1,updatedAt:Date.now()});
 await record(ctx,{householdId:visit.householdId,actorId:ctx.user._id,type:"visit.rideLinked",entity:{kind:"visit",id:visit._id},before:oldId??"none",after:`${kind}: ${taskId??"unlinked"}`});
}
export const linkRide=userMutation({args:{visitId:v.id("visits"),expectedVersion:v.number(),taskId:v.union(v.id("tasks"),v.null()),leg:v.optional(v.union(v.literal("outbound"),v.literal("return")))},returns:v.null(),handler:async(ctx,args)=>{const visit=await ctx.db.get(args.visitId);if(!visit)fail("NOT_FOUND","Visit unavailable.");await member(ctx,visit.householdId);checkVersion(visit,args.expectedVersion);await linkTravel(ctx,visit,args.leg??"outbound",args.taskId);return null;}});
export const linkCompanion=userMutation({args:{visitId:v.id("visits"),expectedVersion:v.number(),taskId:v.union(v.id("tasks"),v.null())},returns:v.null(),handler:async(ctx,args)=>{const visit=await ctx.db.get(args.visitId);if(!visit)fail("NOT_FOUND","Visit unavailable.");await member(ctx,visit.householdId);checkVersion(visit,args.expectedVersion);await linkTravel(ctx,visit,"accompany",args.taskId);return null;}});
export const createTravelTask=userMutation({
 args:{visitId:v.id("visits"),expectedVersion:v.number(),kind:travelKind,title:v.string(),dueAt:v.union(v.number(),v.null()),note:v.string(),requestedOwnerId:v.union(v.id("users"),v.null()),requestId:v.string()},returns:v.id("tasks"),
 handler:async(ctx,args)=>{
  const visit=await ctx.db.get(args.visitId);if(!visit)fail("NOT_FOUND","Visit unavailable.");await member(ctx,visit.householdId);
  const fingerprint=JSON.stringify(args),prior=await priorRequest(ctx,"visits.createTravelTask",args.requestId,fingerprint);if(prior){const id=ctx.db.normalizeId("tasks",prior.resultId);if(!id)fail("NOT_FOUND","Travel responsibility unavailable.");return id;}
  checkVersion(visit,args.expectedVersion);if(visit.status==="cancelled")fail("INVALID_STATE","Restore this visit before planning travel.");
  const linkedId=visit[travelField(args.kind)];if(linkedId&&await ctx.db.get(linkedId))fail("TRAVEL_EXISTS","A responsibility is already linked. Review it before replacing it.");
  if(args.dueAt!==null)timestamp(args.dueAt);if(args.requestedOwnerId)await activeAssignee(ctx,visit.householdId,args.requestedOwnerId);
  const self=args.requestedOwnerId===ctx.user._id,title=text(args.title,"Responsibility",160);
  const id=await ctx.db.insert("tasks",{householdId:visit.householdId,visitId:visit._id,title,category:args.kind==="accompany"?"logistics":"ride",dueAt:args.dueAt,note:text(args.note,"Travel details",4000,true),ownerId:self?ctx.user._id:null,requestedOwnerId:self?null:args.requestedOwnerId,status:"open",version:1,sourceRefs:[],createdBy:ctx.user._id,updatedAt:Date.now()});
  const event=await record(ctx,{householdId:visit.householdId,actorId:ctx.user._id,type:"task.created",entity:{kind:"task",id},after:title});
  if(args.requestedOwnerId&&!self)await notify(ctx,{householdId:visit.householdId,userId:args.requestedOwnerId,target:{kind:"task",id},type:"assignment.requested",dedupeKey:`${event.eventId}:${args.requestedOwnerId}`,eventId:event.eventId});
  await linkTravel(ctx,visit,args.kind,id);await saveRequest(ctx,"visits.createTravelTask",args.requestId,fingerprint,id);return id;
 }
});
export const saveTransport=userMutation({args:{visitId:v.id("visits"),expectedVersion:v.number(),transport:visitTransport},returns:v.null(),handler:async(ctx,args)=>{
 const visit=await ctx.db.get(args.visitId);if(!visit)fail("NOT_FOUND","Visit unavailable.");await member(ctx,visit.householdId);checkVersion(visit,args.expectedVersion);if(visit.status==="cancelled")fail("INVALID_STATE","Restore this visit before changing travel plans.");
 const t=args.transport;for(const value of [t.pickupAt,t.arrivalAt,t.returnAt])if(value!==null)timestamp(value);
 if(t.pickupAt!==null&&t.arrivalAt!==null&&t.pickupAt>t.arrivalAt)fail("INVALID_TIME","Arrival cannot be before pickup.");
 if(t.returnAt!==null&&t.arrivalAt!==null&&t.returnAt<t.arrivalAt)fail("INVALID_TIME","Return pickup cannot be before arrival.");
 const transport={pickupAddress:text(t.pickupAddress,"Pickup address",1000,true),pickupAt:t.pickupAt,arrivalAt:t.arrivalAt,returnAt:t.returnAt,returnAddress:text(t.returnAddress,"Return destination",1000,true),accessibilityNote:text(t.accessibilityNote,"Travel access details",2000,true),accompanyingNote:text(t.accompanyingNote,"Accompaniment details",2000,true)};
 await ctx.db.patch(visit._id,{transport,version:visit.version+1,updatedAt:Date.now()});await record(ctx,{householdId:visit.householdId,actorId:ctx.user._id,type:"visit.transportUpdated",entity:{kind:"visit",id:visit._id},after:"Pickup, arrival and return details reviewed. Travel responsibilities remain separate."});return null;
}});

export const transition = userMutation({
  args: { visitId: v.id("visits"), expectedVersion: v.number(), operation: v.union(v.literal("complete"), v.literal("cancel"), v.literal("restore")),reconcileTravel:v.optional(v.boolean()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const visit = await ctx.db.get(args.visitId); if (!visit) return fail("NOT_FOUND", "Visit unavailable.");
    await member(ctx, visit.householdId); checkVersion(visit, args.expectedVersion);
    if (args.operation === "restore" ? visit.status === "upcoming" : visit.status !== "upcoming") fail("INVALID_STATE", "This visit is already in a different state.");
    if(args.operation==="restore")await linkEvidence(ctx,visit.householdId,{kind:"visit",id:visit._id},visit.sourceRefs);
    if(args.operation==="cancel"){const travel=await openTravel(ctx,visit);if(travel.length&&!args.reconcileTravel)fail("TRAVEL_REVIEW_REQUIRED","Confirm cancelling the linked travel responsibilities too.");await reconcileTravel(ctx,visit,travel,"cancel");}
    const status = args.operation === "complete" ? "completed" : args.operation === "cancel" ? "cancelled" : "upcoming";
    await ctx.db.patch(visit._id, { status, completedAt: args.operation === "complete" ? Date.now() : visit.completedAt, retentionUntil: status === "upcoming" ? undefined : Date.now() + 90 * 86400000, version: visit.version + 1, updatedAt: Date.now() });
    await record(ctx, { householdId: visit.householdId, actorId: ctx.user._id, type: `visit.${args.operation}`, entity: { kind: "visit", id: visit._id }, before: visit.status, after: args.operation==="cancel"?"Visit and remaining linked travel responsibilities cancelled.":`${status}; travel responsibilities retain their own status` });
    return null;
  },
});

export const list = userQuery({
  args: { householdId: v.id("households"), status: visitStatus, from: v.number(), to: v.number(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("visits")),
  handler: async (ctx, args) => {
    await member(ctx, args.householdId); range(args.from, args.to, 366);
    const result=await ctx.db.query("visits").withIndex("by_householdId_and_status_and_confirmedStartsAt", q => q.eq("householdId", args.householdId).eq("status", args.status).gte("confirmedStartsAt", args.from).lte("confirmedStartsAt", args.to)).paginate(args.paginationOpts);
    return {...result,page:await Promise.all(result.page.map(async row=>({...row,sourceRefs:await redactSourceRefs(ctx,row.sourceRefs,ctx.user._id)})))};
  },
});

export const provider=userQuery({args:{visitId:v.id("visits")},returns:v.object({provider:v.union(schema.doc("careProviders"),v.null()),canEdit:v.boolean(),restricted:v.boolean()}),handler:async(ctx,args)=>{
 const visit=await ctx.db.get(args.visitId);if(!visit)fail("NOT_FOUND","Visit unavailable.");await member(ctx,visit.householdId);if(!await canReadCare(ctx,visit.householdId,ctx.user._id))return {provider:null,canEdit:false,restricted:true};
 const provider=visit.providerId?await ctx.db.get(visit.providerId):null;return {provider:provider?.householdId===visit.householdId?provider:null,canEdit:true,restricted:false};
}});
export const setProvider=userMutation({args:{visitId:v.id("visits"),providerId:v.union(v.id("careProviders"),v.null()),expectedVersion:v.number()},returns:v.null(),handler:async(ctx,args)=>{
 const visit=await ctx.db.get(args.visitId);if(!visit)fail("NOT_FOUND","Visit unavailable.");await requireHealthAccess(ctx,visit.householdId,true);checkVersion(visit,args.expectedVersion);if((visit.providerId??null)===args.providerId)return null;
 if(args.providerId){const provider=await ctx.db.get(args.providerId);if(!provider||provider.householdId!==visit.householdId)fail("NOT_FOUND","Choose a provider from this care space.");}
 await ctx.db.patch(visit._id,{providerId:args.providerId,version:visit.version+1,updatedAt:Date.now()});await record(ctx,{householdId:visit.householdId,actorId:ctx.user._id,type:"visit.providerChanged",entity:{kind:"visit",id:visit._id},after:args.providerId?"Care provider selected for the visit. Details remain restricted to care readers.":"Visit provider selection removed."});return null;
}});
