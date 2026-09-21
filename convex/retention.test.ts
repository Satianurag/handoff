/// <reference types="vite/client" />
import {convexTest} from "convex-test";
import {afterEach,expect,test,vi} from "vitest";
import workflowTest from "@convex-dev/workflow/test";
import schema from "./schema";
import {api,internal} from "./_generated/api";
import {linkEvidence} from "./model/sourceUses";
const modules=import.meta.glob("./**/*.ts");
afterEach(()=>vi.useRealTimers());
async function setup(){
 vi.useFakeTimers();const t=convexTest(schema,modules);workflowTest.register(t);workflowTest.register(t,"generationWorkflow");
 const userId=await t.run(ctx=>ctx.db.insert("users",{email:"retention@example.test",emailVerificationTime:1})),user=t.withIdentity({subject:userId});
 const creation={nickname:"Synthetic",timezone:"UTC",firstTask:"Groceries",adultConfirmed:true,authorityStatement:"Synthetic authority",noticeVersion:"test",emailImport:false,aiProcessing:false,requestId:"retention-household"};
 const householdId=await user.mutation(api.households.create,creation);
 const sourceId=await t.run(ctx=>ctx.db.insert("sources",{householdId,kind:"manual",contentHash:"synthetic",plaintext:"Use the east entrance.",capturedAt:Date.now()-31*86400000,publishedAt:null,retentionUntil:Date.now()-86400000,extractionState:"ready",warnings:[],truncated:false,unresolvedReferences:0,version:1}));
 const jobId=await t.run(ctx=>ctx.db.insert("jobs",{householdId,operationKey:"retire",kind:"retireSource",requestedBy:null,target:{kind:"source",id:sourceId},sourceId,state:"queued",attempts:0,createdAt:Date.now(),updatedAt:Date.now(),consentVersion:1}));
 const task=await t.run(ctx=>ctx.db.query("tasks").withIndex("by_householdId",q=>q.eq("householdId",householdId)).first());
 const ref={sourceId,quote:"east entrance",start:8,end:21};
 return {t,user,userId,householdId,sourceId,jobId,taskId:task!._id,ref,creation};
}
test("active responsibility protects expired evidence; a newly linked responsibility invalidates a retention inspection",async()=>{
 const {t,householdId,sourceId,jobId,taskId,ref}=await setup();
 const inspection=await t.mutation(internal.retentionSourceStore.begin,{jobId});expect(inspection).not.toBeNull();
 expect(await t.query(internal.retentionSourceStore.references,{sourceId,cursor:null})).toMatchObject({protected:false});
 await t.run(async ctx=>{await ctx.db.patch(taskId,{sourceRefs:[ref]});await linkEvidence(ctx,householdId,{kind:"task",id:taskId},[ref]);});
 expect(await t.mutation(internal.retentionSourceStore.claim,{jobId,...inspection!})).toBe(false);
 expect(await t.query(internal.retentionSourceStore.references,{sourceId,cursor:null})).toMatchObject({protected:true});
 expect(await t.run(ctx=>ctx.db.get(sourceId))).toMatchObject({plaintext:"Use the east entrance."});
});
test("provider removal precedes raw purge; a tombstone survives until references are scrubbed and cleanup finishes",async()=>{
 const {t,householdId,sourceId,jobId,taskId,ref}=await setup();
 await t.run(async ctx=>{await ctx.db.patch(taskId,{sourceRefs:[ref],status:"done"});await linkEvidence(ctx,householdId,{kind:"task",id:taskId},[ref]);});
 const inspection=await t.mutation(internal.retentionSourceStore.begin,{jobId});
 expect(await t.query(internal.retentionSourceStore.references,{sourceId,cursor:null})).toMatchObject({protected:false});
 expect(await t.mutation(internal.retentionSourceStore.claim,{jobId,...inspection!})).toBe(true);
 await expect(t.run(ctx=>linkEvidence(ctx,householdId,{kind:"task",id:taskId},[ref]))).rejects.toThrow(/SOURCE_REMOVED/);
 expect(await t.mutation(internal.retentionSourceStore.purge,{jobId})).toBe(false);
 expect((await t.run(ctx=>ctx.db.get(sourceId)))?.plaintext).toBe("Use the east entrance.");
 await t.mutation(internal.retentionSourceStore.providerRemoved,{jobId});
 expect(await t.mutation(internal.retentionSourceStore.purge,{jobId})).toBe(true);
 expect(await t.run(ctx=>ctx.db.get(sourceId))).toMatchObject({plaintext:"",retiring:true,providerRemoved:true});
 await t.mutation(internal.retentionSourceStore.finish,{jobId,success:false});
 expect((await t.run(ctx=>ctx.db.get(sourceId)))?.retentionUntil).toBeGreaterThan(Date.now());
 await t.mutation(internal.retentionSourceStore.redact,{jobId,table:"tasks",cursor:null});
 expect(await t.run(ctx=>ctx.db.get(taskId))).toMatchObject({title:"Groceries",status:"done",sourceRefs:[]});
 await t.mutation(internal.retentionSourceStore.finish,{jobId,success:true});
 expect(await t.run(ctx=>ctx.db.get(sourceId))).toBeNull();
});
test("unresolved conversation protects raw source even without a task backlink",async()=>{
 const {t,householdId,sourceId,jobId}=await setup();
 await t.run(async ctx=>{const threadId=await ctx.db.insert("mailThreads",{householdId,inboxId:"synthetic",providerThreadId:"synthetic",related:null,subject:"Synthetic question",state:"waiting",archived:false,quarantined:false,deleting:false,lastMessageAt:Date.now()-31*86400000,version:1});await ctx.db.patch(sourceId,{threadId});});
 const inspection=await t.mutation(internal.retentionSourceStore.begin,{jobId});
 expect(await t.mutation(internal.retentionSourceStore.claim,{jobId,...inspection!})).toBe(false);
 expect((await t.run(ctx=>ctx.db.get(sourceId)))?.retiring).toBeUndefined();
});
test("idempotency storage hashes inputs and preserves retries before and after the legacy backfill",async()=>{
 const {t,user,householdId,creation}=await setup();
 const request=await t.run(ctx=>ctx.db.query("requests").first());expect(request?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
 expect(await user.mutation(api.households.create,creation)).toBe(householdId);
 await t.run(ctx=>ctx.db.patch(request!._id,{fingerprint:JSON.stringify(Object.fromEntries(Object.entries(creation).sort(([a],[b])=>a.localeCompare(b))))}));
 expect(await user.mutation(api.households.create,creation)).toBe(householdId);
 await t.mutation(internal.retention.hashRequests,{});
 expect(await user.mutation(api.households.create,creation)).toBe(householdId);
 await expect(user.mutation(api.households.create,{...creation,nickname:"Different"})).rejects.toThrow(/IDEMPOTENCY_CONFLICT/);
});
test("resolved outgoing mail retires its provider draft and raw approval copies, but waiting mail is deferred",async()=>{
 const {t,householdId,userId,jobId}=await setup();
 const {threadId,messageId,draftId,intentId}=await t.run(async ctx=>{
  const threadId=await ctx.db.insert("mailThreads",{householdId,inboxId:"synthetic",providerThreadId:"synthetic-thread",related:null,subject:"Private subject",state:"waiting",archived:false,quarantined:false,deleting:false,lastMessageAt:Date.now()-31*86400000,version:1});
  const draftId=await ctx.db.insert("mailDrafts",{householdId,providerDraftId:"synthetic-draft",threadId,related:null,recipient:"office@example.test",subject:"Private subject",body:"Private question",sourceRefs:[],version:1,contentHash:"test",editorId:userId,state:"sent",updatedAt:Date.now()-31*86400000});
  const intentId=await ctx.db.insert("sendIntents",{householdId,draftId,draftVersion:1,contentHash:"test",logicalSendId:"synthetic-send",idempotencyKey:"synthetic-key",approvedBy:userId,recipient:"office@example.test",subject:"Private subject",body:"Private question",providerDraftId:"synthetic-draft",consentVersion:1,state:"sent",delivery:"delivered",providerMessageId:"synthetic-message",attempts:1,createdAt:Date.now()-31*86400000,reconciliation:"confirmed"});
  const messageId=await ctx.db.insert("mailMessages",{householdId,threadId,providerMessageId:"synthetic-message",inboxId:"synthetic",direction:"outbound",from:"family@example.test",to:["office@example.test"],plaintext:"Private question",subject:"Private subject",occurredAt:Date.now()-31*86400000,delivery:"delivered",attachmentOnly:false,truncated:false,retentionUntil:Date.now()-1,unresolvedReferences:0});
  await ctx.db.patch(jobId,{kind:"retireMail",messageId,sourceId:undefined});return {threadId,messageId,draftId,intentId};
 });
 expect(await t.mutation(internal.retentionRawStore.prepare,{jobId})).toBeNull();
 await t.run(async ctx=>{await ctx.db.patch(threadId,{state:"resolved"});await ctx.db.patch(messageId,{retentionUntil:Date.now()-1});});
 expect(await t.mutation(internal.retentionRawStore.prepare,{jobId})).toEqual({inboxId:"synthetic",messageId:"synthetic-message",label:null,draftIds:["synthetic-draft"]});
 expect((await t.run(ctx=>ctx.db.get(messageId)))?.plaintext).toBe("Private question");
 // This internal step is reached only after provider deletion succeeds.
 await t.mutation(internal.retentionRawStore.finish,{jobId});
 expect(await t.run(ctx=>ctx.db.get(messageId))).toBeNull();
 expect(await t.run(ctx=>ctx.db.get(draftId))).toMatchObject({body:"",recipient:"",sourceRefs:[]});
 expect(await t.run(ctx=>ctx.db.get(intentId))).toMatchObject({body:"",subject:"",state:"sent",delivery:"delivered"});
 expect(await t.run(ctx=>ctx.db.get(threadId))).toMatchObject({subject:"Original messages removed"});
});
test("history removes closed items but keeps active work, and expiring the last receipt preserves its event baseline",async()=>{
 const {t,householdId,userId,taskId}=await setup();
 const receiptId=await t.run(async ctx=>{
  await ctx.db.patch(taskId,{retentionUntil:Date.now()-1});
  const handoverId=await ctx.db.insert("handovers",{householdId,senderId:userId,recipientId:userId,baseMaterialRevision:0,lastReceiptId:null,introduction:"",note:"",coverage:null,status:"accepted",version:1,snapshotItemCount:0,snapshotChangeCount:0,snapshotProposalCount:0,createdAt:Date.now()-91*86400000,updatedAt:Date.now()-91*86400000,retentionUntil:Date.now()-1});
  const receiptId=await ctx.db.insert("handoverReceipts",{householdId,handoverId,senderId:userId,recipientId:userId,acceptedAt:Date.now()-91*86400000,receiptRevision:0,eventSequence:123,tookCoverage:false,transferredTaskIds:[],retainedTaskIds:[],unassignedTaskIds:[],retentionUntil:Date.now()-1});
  await ctx.db.patch(householdId,{lastReceiptId:receiptId});return receiptId;
 });
 await t.mutation(internal.retentionHistory.operational,{table:"tasks"});expect(await t.run(ctx=>ctx.db.get(taskId))).not.toBeNull();
 await t.run(ctx=>ctx.db.patch(taskId,{status:"done"}));
 await t.mutation(internal.retentionHistory.operational,{table:"tasks"});expect(await t.run(ctx=>ctx.db.get(taskId))).toBeNull();
 await t.mutation(internal.retentionHistory.operational,{table:"handoverReceipts"});expect(await t.run(ctx=>ctx.db.get(receiptId))).toBeNull();
 expect(await t.run(ctx=>ctx.db.get(householdId))).toMatchObject({lastReceiptId:null,lastAcceptedSequence:123});
});
