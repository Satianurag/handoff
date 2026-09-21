import {v} from "convex/values";
import {internalMutation} from "./_generated/server";
import {internal} from "./_generated/api";
import {notify} from "./model/events";
import {queueOperation} from "./model/operations";
export const taskReminders=internalMutation({args:{},returns:v.null(),handler:async(ctx)=>{
 const state=await ctx.db.query("maintenanceCursors").withIndex("by_key",q=>q.eq("key","taskReminders")).unique(),cutoff=state?.cursor?state.cutoff!:Date.now();
 const page=await ctx.db.query("tasks").withIndex("by_status_and_dueAt",q=>q.eq("status","open").gt("dueAt",null).lte("dueAt",cutoff)).paginate({cursor:state?.cursor??null,numItems:25,maximumBytesRead:200000});
 for(const task of page.page){if(!task.ownerId)continue;const h=await ctx.db.get(task.householdId);if(h?.status!=="active")continue;
  await notify(ctx,{householdId:task.householdId,userId:task.ownerId,target:{kind:"task",id:task._id},type:"task.due",dedupeKey:`task-due:${task._id}:${task.dueAt}:${task.ownerId}`});
 }
 const fields={key:"taskReminders",cursor:page.isDone?null:page.continueCursor,cutoff};if(state)await ctx.db.patch(state._id,fields);else await ctx.db.insert("maintenanceCursors",fields);return null;
}});
export const waitingReminders=internalMutation({args:{},returns:v.null(),handler:async(ctx)=>{
 const state=await ctx.db.query("maintenanceCursors").withIndex("by_key",q=>q.eq("key","waitingReminders")).unique(),cutoff=state?.cursor?state.cutoff!:Date.now()-86400000;
 const page=await ctx.db.query("mailThreads").withIndex("by_state_and_lastMessageAt",q=>q.eq("state","waiting").lte("lastMessageAt",cutoff)).paginate({cursor:state?.cursor??null,numItems:10,maximumBytesRead:200000});
 for(const thread of page.page){if(thread.deleting||thread.quarantined||thread.archived)continue;const h=await ctx.db.get(thread.householdId);if(h?.status!=="active")continue;
  const members=await ctx.db.query("memberships").withIndex("by_householdId_and_status",q=>q.eq("householdId",thread.householdId).eq("status","active")).take(20);
  for(const member of members)await notify(ctx,{householdId:thread.householdId,userId:member.userId,target:{kind:"thread",id:thread._id},type:"mail.waiting",dedupeKey:`waiting:${thread._id}:${thread.lastMessageAt}:${member.userId}`});
 }
 const fields={key:"waitingReminders",cursor:page.isDone?null:page.continueCursor,cutoff};if(state)await ctx.db.patch(state._id,fields);else await ctx.db.insert("maintenanceCursors",fields);return null;
}});
export const dispatch=internalMutation({args:{},returns:v.null(),handler:async(ctx):Promise<null>=>{
 const pause=await ctx.db.query("operatorSettings").withIndex("by_key",q=>q.eq("key","pauseAutomaticOperations")).unique();if(pause?.enabled)return null;
 await ctx.runMutation(internal.notificationMaintenance.taskReminders,{});await ctx.runMutation(internal.notificationMaintenance.waitingReminders,{});
 const pending=await ctx.db.query("notifications").withIndex("by_emailState_and_createdAt",q=>q.eq("emailState","pending").lte("createdAt",Date.now()-60000)).take(20);
 for(const n of pending)if(await ctx.runMutation(internal.notificationStore.prepare,{notificationId:n._id}))await queueOperation(ctx,{householdId:n.householdId,kind:"notifyMember",key:`notify:${n._id}`,actorId:null,notificationId:n._id,target:n.target,automatic:true});
 for(const state of ["sending","unknown"] as const){const sends=await ctx.db.query("notificationSends").withIndex("by_state_and_retiring_and_lastCheckedAt",q=>q.eq("state",state).eq("retiring",undefined).lte("lastCheckedAt",Date.now()-3600000)).take(10);
  for(const send of sends)if(!send.retiring)await queueOperation(ctx,{householdId:send.householdId,kind:"reconcileNotification",key:`reconcile-notification:${send._id}:${send.lastCheckedAt}`,actorId:null,notificationId:send.notificationId,automatic:true});
 }return null;
}});
