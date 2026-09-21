/// <reference types="vite/client" />
import {convexTest} from "convex-test";
import {expect,test,vi,afterEach} from "vitest";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import schema from "./schema";
import {api,internal} from "./_generated/api";
import {notify} from "./model/events";
const modules=import.meta.glob("./**/*.ts");
afterEach(()=>vi.unstubAllEnvs());
async function setup(){
 vi.stubEnv("CONVEX_SITE_URL","https://test.convex.site");const t=convexTest(schema,modules);rateLimiterTest.register(t);
 const userId=await t.run(ctx=>ctx.db.insert("users",{email:"verified@example.test",emailVerificationTime:1}));const user=t.withIdentity({subject:userId});
 const householdId=await user.mutation(api.households.create,{nickname:"Private recipient name",timezone:"UTC",firstTask:"Private appointment details",adultConfirmed:true,authorityStatement:"Synthetic",noticeVersion:"test",emailImport:false,aiProcessing:false,requestId:"new"});
 await user.mutation(api.notifications.preferences,{householdId,emailNotifications:true});
 const task=await t.run(async ctx=>{const row=(await ctx.db.query("tasks").withIndex("by_householdId",q=>q.eq("householdId",householdId)).first())!;await ctx.db.patch(row._id,{ownerId:userId});return row;});
 const notificationId=(await t.run(ctx=>notify(ctx,{householdId,userId,target:{kind:"task",id:task._id},type:"task.due",dedupeKey:"once"})))!;
 return {t,user,userId,householdId,taskId:task._id,notificationId};
}
test("generic notifications claim once, omit private details, and never reclaim an uncertain send",async()=>{
 const {t,notificationId}=await setup();
 const send=await t.mutation(internal.notificationStore.claim,{notificationId,inboxId:"system@example.test"});expect(send?.recipient).toBe("verified@example.test");expect(send?.body).not.toMatch(/recipient|appointment|householdId/i);
 expect(await t.mutation(internal.notificationStore.claim,{notificationId,inboxId:"system@example.test"})).toBeNull();
 await t.mutation(internal.notificationStore.failed,{notificationId,uncertain:true});expect(await t.mutation(internal.notificationStore.claim,{notificationId,inboxId:"system@example.test"})).toBeNull();
 await t.mutation(internal.notificationStore.sent,{notificationId,messageId:"actual-message",threadId:"actual-thread"});
 expect(await t.query(internal.notificationStore.read,{notificationId})).toMatchObject({state:"sent",providerMessageId:"actual-message"});
});
test("read, completed, revoked, and opt-out notifications cancel before provider send",async()=>{
 for(const reason of ["read","completed","revoked","optout"]){
  const {t,user,householdId,userId,taskId,notificationId}=await setup();
  if(reason==="read")await user.mutation(api.notifications.read,{notificationId});
  if(reason==="completed")await t.run(ctx=>ctx.db.patch(taskId,{status:"done"}));
  if(reason==="revoked")await t.run(async ctx=>{const m=(await ctx.db.query("memberships").withIndex("by_householdId_and_userId",q=>q.eq("householdId",householdId).eq("userId",userId)).unique())!;await ctx.db.patch(m._id,{status:"removed"});});
  if(reason==="optout")await user.mutation(api.notifications.preferences,{householdId,emailNotifications:false});
  expect(await t.mutation(internal.notificationStore.claim,{notificationId,inboxId:"system@example.test"})).toBeNull();expect(await t.query(internal.notificationStore.read,{notificationId})).toBeNull();
 }
});

test("unread counts are personal, capped honestly, and mark-all drains beyond one batch",async()=>{
 const {t,user,userId,householdId,taskId,notificationId}=await setup();
 const otherId=await t.run(ctx=>ctx.db.insert('users',{email:'other@example.test',emailVerificationTime:1}));
 const other=t.withIdentity({subject:otherId});
 await t.run(async ctx=>{
  await ctx.db.insert('memberships',{householdId,userId:otherId,role:'member',status:'active',joinedAt:1,emailNotifications:false,lastReadSequence:0});
  for(let i=0;i<503;i++)await ctx.db.insert('notifications',{householdId,userId,target:{kind:'task',id:taskId},type:'task.due',dedupeKey:`batch-${i}`,readAt:null,createdAt:i,emailState:'pending'});
  await ctx.db.insert('notifications',{householdId,userId:otherId,target:{kind:'task',id:taskId},type:'task.due',dedupeKey:'other',readAt:null,createdAt:1,emailState:'pending'});
 });
 expect(await user.query(api.notifications.unreadCount,{householdId})).toEqual({count:99,capped:true});
 expect(await other.query(api.notifications.unreadCount,{householdId})).toEqual({count:1,capped:false});
 await expect(other.mutation(api.notifications.read,{notificationId})).rejects.toThrow('unavailable');
 expect(await user.mutation(api.notifications.readAll,{householdId})).toEqual({updated:500,hasMore:true});
 expect(await user.query(api.notifications.unreadCount,{householdId})).toEqual({count:4,capped:false});
 expect(await user.mutation(api.notifications.readAll,{householdId})).toEqual({updated:4,hasMore:false});
 expect(await user.query(api.notifications.unreadCount,{householdId})).toEqual({count:0,capped:false});
 expect(await other.query(api.notifications.unreadCount,{householdId})).toEqual({count:1,capped:false});
 const foreignRows=await other.query(api.notifications.list,{householdId,unreadOnly:true,paginationOpts:{numItems:25,cursor:null}});
 expect(foreignRows.page).toHaveLength(1);expect(foreignRows.page[0].emailState).toBe('pending');
 await t.run(async ctx=>{const membership=await ctx.db.query('memberships').withIndex('by_householdId_and_userId',q=>q.eq('householdId',householdId).eq('userId',otherId)).unique();await ctx.db.patch(membership!._id,{status:'removed'});});
 await expect(other.query(api.notifications.unreadCount,{householdId})).rejects.toThrow('unavailable');
});
