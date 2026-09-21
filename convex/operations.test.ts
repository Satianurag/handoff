/// <reference types="vite/client" />
import {convexTest} from "convex-test";
import {afterEach,expect,test,vi} from "vitest";
import workflowTest from "@convex-dev/workflow/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import schema from "./schema";
import {api,internal} from "./_generated/api";
const modules=import.meta.glob("./**/*.ts");
afterEach(()=>vi.useRealTimers());
async function setup(){
 vi.useFakeTimers();const t=convexTest(schema,modules);workflowTest.register(t);workflowTest.register(t,"generationWorkflow");rateLimiterTest.register(t);
 const ownerId=await t.run(ctx=>ctx.db.insert("users",{email:"owner@example.test",emailVerificationTime:1}));
 const owner=t.withIdentity({subject:ownerId});
 const householdId=await owner.mutation(api.households.create,{nickname:"Test",timezone:"UTC",firstTask:"Groceries",adultConfirmed:true,authorityStatement:"Synthetic",noticeVersion:"test",emailImport:true,aiProcessing:false,requestId:"create"});
 return {t,owner,ownerId,householdId};
}
test("creation enqueues durable provisioning once and revocation closes provider policy lists",async()=>{
 const {t,owner,householdId}=await setup();
 const jobs=await t.run(ctx=>ctx.db.query("jobs").collect());expect(jobs).toHaveLength(1);expect(jobs[0]).toMatchObject({kind:"provisionMail",state:"queued"});expect(jobs[0].workflowId).toBeDefined();
 await owner.action(api.mail.provision,{householdId});expect(await t.run(ctx=>ctx.db.query("jobs").collect())).toHaveLength(1);
 await t.mutation(internal.mailStore.provisioned,{householdId,podId:"p",inboxId:"i",address:"family@example.test"});
 await owner.mutation(api.contacts.set,{householdId,email:"office@example.test",label:"Office",relationship:"Approved",state:"approved",allowSend:true,allowReceive:true,allowReply:true});
 await owner.mutation(api.consents.set,{householdId,scope:"emailImport",granted:false,noticeVersion:"test",authorityStatement:"Withdraw"});
 const sync=await t.mutation(internal.mailStore.beginContactSync,{householdId,token:"revoked"});expect(sync.send).toEqual([]);expect(sync.receive).toEqual([]);expect(sync.reply).toEqual([]);
 expect(await t.mutation(internal.mailStore.finishContactSync,{householdId,version:sync.version,token:"revoked"})).toBe(true);
 expect(await owner.query(api.inbox.connection,{householdId})).toMatchObject({status:"paused",contactSyncState:"ready"});
});
test("removed membership enqueues actor-independent policy revocation and blocks a queued draft save",async()=>{
 const {t,owner,householdId}=await setup();
 await t.mutation(internal.mailStore.provisioned,{householdId,podId:"p",inboxId:"i",address:"family@example.test"});
 const bob=await t.run(async ctx=>{const userId=await ctx.db.insert("users",{email:"bob@example.test",emailVerificationTime:1});const memberId=await ctx.db.insert("memberships",{householdId,userId,role:"member",status:"active",joinedAt:1,emailNotifications:false,lastReadSequence:0});return {userId,memberId};});
 await owner.mutation(api.contacts.set,{householdId,email:"office@example.test",label:"Office",relationship:"Approved",state:"approved",allowSend:true,allowReceive:true,allowReply:true});
 await owner.mutation(api.care.saveProfile,{householdId,expectedVersion:0,preferredName:"Synthetic parent",dateOfBirth:"",allergiesState:"unknown",allergies:"",conditions:"",preferences:"",communication:"",emergencyInstructions:"",authorizedUserIds:[bob.userId],authorityStatement:"Synthetic test only"});
 const member=t.withIdentity({subject:bob.userId});
 const draftId=await member.mutation(api.drafts.create,{householdId,related:null,recipient:"office@example.test",subject:"Entrance",body:"Which entrance?",sourceRefs:[],requestId:"draft"});
 await owner.mutation(api.team.remove,{householdId,memberId:bob.memberId});
 const sync=await t.mutation(internal.mailStore.beginContactSync,{householdId,token:"removed"});expect(sync.receive).not.toContain("bob@example.test");
 const jobs=await t.run(ctx=>ctx.db.query("jobs").collect());expect(jobs.filter(j=>j.kind==="syncContacts").every(j=>j.requestedBy===null)).toBe(true);
 const job=jobs.find(j=>j.draftId===draftId)!;expect(await t.mutation(internal.operationStore.claim,{jobId:job._id})).toBe(false);
 expect(await t.run(ctx=>ctx.db.get(job._id))).toMatchObject({state:"cancelled"});
});

test("local recurrence maintenance does not duplicate occurrences and demo expiry immediately revokes reads",async()=>{
 const {t,owner,householdId}=await setup();
 const today=new Date().toISOString().slice(0,10);
 const seriesId=await owner.mutation(api.recurrence.create,{householdId,title:"Meal",category:"meal",note:"",localTime:"18:00",timezone:"UTC",weekdays:[1,2,3,4,5,6,7],activeFrom:today,activeUntil:null,proposedOwnerId:null,requestId:"series"});
 const count=await t.run(ctx=>ctx.db.query("tasks").withIndex("by_seriesId_and_occurrenceKey",q=>q.eq("seriesId",seriesId)).collect());
 await t.mutation(internal.maintenance.recurrence,{});await t.mutation(internal.maintenance.recurrence,{});
 expect(await t.run(ctx=>ctx.db.query("tasks").withIndex("by_seriesId_and_occurrenceKey",q=>q.eq("seriesId",seriesId)).collect())).toHaveLength(count.length);
 await t.run(ctx=>ctx.db.patch(householdId,{mode:"demo",expiresAt:Date.now()-1}));
 await t.mutation(internal.maintenance.expireDemo,{householdId});
 await expect(owner.query(api.households.get,{householdId})).rejects.toThrow("unavailable");
 const requests=await t.run(ctx=>ctx.db.query("privacyJobs").withIndex("by_householdId",q=>q.eq("householdId",householdId)).collect());expect(requests).toHaveLength(1);
 await t.mutation(internal.maintenance.expireDemo,{householdId});expect(await t.run(ctx=>ctx.db.query("privacyJobs").withIndex("by_householdId",q=>q.eq("householdId",householdId)).collect())).toHaveLength(1);
});
