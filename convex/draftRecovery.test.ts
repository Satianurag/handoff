/// <reference types="vite/client" />
import {convexTest} from "convex-test";
import {expect,test} from "vitest";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import schema from "./schema";
import {api,internal} from "./_generated/api";
const modules=import.meta.glob("./**/*.ts");
async function setup(){
 const t=convexTest(schema,modules);rateLimiterTest.register(t);
 const ids=await t.run(async ctx=>{await ctx.db.insert("operatorSettings",{key:"pauseAutomaticOperations",enabled:true,updatedAt:Date.now()});return {owner:await ctx.db.insert("users",{email:"owner@example.test",emailVerificationTime:1}),outsider:await ctx.db.insert("users",{email:"outsider@example.test",emailVerificationTime:1})};});
 const owner=t.withIdentity({subject:ids.owner}),outsider=t.withIdentity({subject:ids.outsider});
 const householdId=await owner.mutation(api.households.create,{nickname:"Synthetic recovery",timezone:"UTC",firstTask:"Task",adultConfirmed:true,authorityStatement:"Synthetic test",noticeVersion:"test",emailImport:true,aiProcessing:false,requestId:"setup"});
 for(const email of ["first@example.test","second@example.test"])await owner.mutation(api.contacts.set,{householdId,email,label:"Synthetic office",relationship:"Test",state:"approved",allowSend:true,allowReceive:true,allowReply:true});
 const sourceId=await t.run(ctx=>ctx.db.insert("sources",{householdId,kind:"manual",contentHash:"test",plaintext:"East entrance.",capturedAt:Date.now(),publishedAt:null,retentionUntil:Date.now()+86400000,extractionState:"ready",warnings:[],truncated:false,unresolvedReferences:0,version:1}));
 const sourceRefs=[{sourceId,start:0,end:14,quote:"East entrance."}];
 const draftId=await owner.mutation(api.drafts.create,{householdId,related:null,recipient:"first@example.test",subject:"Original",body:"Saved text",sourceRefs,requestId:"draft"});
 const input={draftId,expectedVersion:1,recipient:"second@example.test",subject:"Current unsaved subject",body:"Current unsaved text",requestId:"replace"};
 return {t,ids,owner,outsider,householdId,draftId,sourceRefs,input};
}
test("recipient replacement saves current text atomically, detaches reply metadata and survives old-draft purge",async()=>{
 const {t,owner,outsider,draftId,sourceRefs,input}=await setup();
 await t.run(ctx=>ctx.db.patch(draftId,{inReplyTo:"old-message",providerDraftId:"synthetic-old-provider-draft",providerSyncedVersion:1,approvedThreadVersion:9}));
 const id=await owner.mutation(api.drafts.recreate,input),replacement=await owner.query(api.drafts.get,{draftId:id});
 expect(replacement).toMatchObject({subject:input.subject,body:input.body,recipient:input.recipient,state:"editable",version:1,sourceRefs,replacesDraftId:draftId});
 for(const field of ["inReplyTo","threadId","providerDraftId","providerSyncedVersion","approvedThreadVersion"])expect(replacement).not.toHaveProperty(field);
 expect(await owner.query(api.drafts.view,{draftId})).toEqual({kind:"replaced",replacementId:id});
 await expect(outsider.query(api.drafts.view,{draftId})).rejects.toThrow("unavailable");
 expect(await owner.mutation(api.drafts.recreate,input)).toBe(id);
 await expect(owner.mutation(api.drafts.recreate,{...input,body:"different"})).rejects.toThrow("already used");
 await expect(owner.mutation(api.drafts.approveSend,{draftId:id,expectedVersion:1,expectedHash:replacement.contentHash,logicalSendId:"new"})).rejects.toThrow("provider draft");
 const job=await owner.query(api.privacyJobs.get,{privacyJobId:replacement.replacementCleanupJobId!});expect(job).toMatchObject({kind:"deleteDraft",draftId,state:"queued"});
 await t.run(ctx=>ctx.db.patch(job._id,{processors:[{name:"agentmail",state:"succeeded"},{name:"convex",state:"queued"}]}));
 expect(await t.mutation(internal.privacyScopeStore.purge,{privacyJobId:job._id})).toBe(true);
 expect(await t.run(ctx=>ctx.db.get(draftId))).toBeNull();
 expect(await owner.mutation(api.drafts.recreate,input)).toBe(id);
 expect(await owner.query(api.drafts.view,{draftId})).toEqual({kind:"replaced",replacementId:id});
 expect((await owner.query(api.drafts.get,{draftId:id})).sourceRefs).toEqual(sourceRefs);
 expect(await t.run(ctx=>ctx.db.query("sourceUses").withIndex("by_sourceId_and_target",q=>q.eq("sourceId",sourceRefs[0].sourceId).eq("target",{kind:"draft",id})).unique())).not.toBeNull();
});
test("invalid recipient, stale version and outsider attempts leave original text and cleanup untouched",async()=>{
 const {t,owner,outsider,draftId,input}=await setup();
 await expect(outsider.mutation(api.drafts.recreate,input)).rejects.toThrow("unavailable");
 await expect(owner.mutation(api.drafts.recreate,{...input,recipient:"blocked@example.test"})).rejects.toThrow("Confirm this contact");
 await expect(owner.mutation(api.drafts.recreate,{...input,recipient:"first@example.test"})).rejects.toThrow("different recipient");
 await owner.mutation(api.drafts.edit,{draftId,expectedVersion:1,subject:"Someone else's edit",body:"Newer text",sourceRefs:[]});
 await expect(owner.mutation(api.drafts.recreate,input)).rejects.toThrow("changed");
 expect((await owner.query(api.drafts.get,{draftId})).body).toBe("Newer text");
 expect(await t.run(ctx=>ctx.db.query("privacyJobs").take(10))).toHaveLength(0);
});
test("concurrent replacements create exactly one successor and cleanup request",async()=>{
 const {t,owner,input}=await setup();
 const results=await Promise.allSettled([owner.mutation(api.drafts.recreate,input),owner.mutation(api.drafts.recreate,{...input,requestId:"second-click"})]);
 expect(results.filter(x=>x.status==="fulfilled")).toHaveLength(1);
 expect(await t.run(ctx=>ctx.db.query("privacyJobs").take(10))).toHaveLength(1);
 expect(await t.run(ctx=>ctx.db.query("mailDrafts").withIndex("by_replacesDraftId",q=>q.eq("replacesDraftId",input.draftId)).take(10))).toHaveLength(1);
});
test.each(["unknown","sending","approved"] as const)("%s send cannot be replaced or corrected",async state=>{
 const {t,owner,ids,householdId,draftId,input}=await setup();
 const draft=await owner.query(api.drafts.get,{draftId});
 const sendIntentId=await t.run(async ctx=>{await ctx.db.patch(draftId,{state:state==="approved"?"approved":"sending"});return ctx.db.insert("sendIntents",{householdId,draftId,draftVersion:1,contentHash:draft.contentHash,logicalSendId:"synthetic",idempotencyKey:"synthetic",approvedBy:ids.owner,recipient:draft.recipient,subject:draft.subject,body:draft.body,providerDraftId:"synthetic",consentVersion:1,state,delivery:"bounced",attempts:1,createdAt:Date.now(),reconciliation:"required"});});
 await expect(owner.mutation(api.drafts.recreate,input)).rejects.toThrow("uncertain");
 await expect(owner.mutation(api.drafts.recreate,{...input,sendIntentId})).rejects.toThrow("confirmed failed delivery");
 expect(await t.run(ctx=>ctx.db.query("privacyJobs").take(10))).toHaveLength(0);
});
test.each(["sent","failed"] as const)("%s bounced/rejected correction preserves receipt and locks original against reuse",async state=>{
 const {t,owner,ids,householdId,draftId,input}=await setup();
 const draft=await owner.query(api.drafts.get,{draftId});
 const sendIntentId=await t.run(async ctx=>{await ctx.db.patch(draftId,{state});return ctx.db.insert("sendIntents",{householdId,draftId,draftVersion:1,contentHash:draft.contentHash,logicalSendId:"synthetic",idempotencyKey:"synthetic",approvedBy:ids.owner,recipient:draft.recipient,subject:draft.subject,body:draft.body,providerDraftId:"synthetic",consentVersion:1,state,delivery:state==="sent"?"bounced":"rejected",attempts:1,createdAt:Date.now(),reconciliation:"confirmed"});});
 const before=await owner.query(api.sendIntents.get,{sendIntentId});
 const id=await owner.mutation(api.drafts.recreate,{...input,sendIntentId});
 expect(await owner.query(api.sendIntents.get,{sendIntentId})).toEqual({...before,correctionDraftId:id});
 expect((await owner.query(api.drafts.get,{draftId:id}))).toMatchObject({state:"editable",correctsSendIntentId:sendIntentId});
 expect(await owner.mutation(api.drafts.recreate,{...input,sendIntentId})).toBe(id);
 await expect(owner.mutation(api.drafts.edit,{draftId,expectedVersion:2,subject:"Retry original",body:"Unsafe retry",sourceRefs:[]})).rejects.toThrow("locked");
 await expect(owner.mutation(api.drafts.discard,{draftId,expectedVersion:2})).rejects.toThrow();
 await expect(owner.mutation(api.drafts.approveSend,{draftId,expectedVersion:2,expectedHash:draft.contentHash,logicalSendId:"unsafe-reuse"})).rejects.toThrow("provider draft");
 expect(await t.run(ctx=>ctx.db.query("privacyJobs").take(10))).toHaveLength(0);
});

test("an older failed receipt cannot fork a correction after a later send, even if the original draft is editable",async()=>{
 const {t,owner,ids,householdId,draftId,input}=await setup();
 const draft=await owner.query(api.drafts.get,{draftId});
 const sendIntentId=await t.run(async ctx=>{
  const base={householdId,draftId,draftVersion:1,contentHash:draft.contentHash,idempotencyKey:"synthetic",approvedBy:ids.owner,recipient:draft.recipient,subject:draft.subject,body:draft.body,providerDraftId:"synthetic",consentVersion:1,attempts:1,reconciliation:"confirmed" as const};
  const id=await ctx.db.insert("sendIntents",{...base,logicalSendId:"old",state:"failed",delivery:"rejected",createdAt:1});
  await ctx.db.insert("sendIntents",{...base,logicalSendId:"new",state:"sent",delivery:"delivered",createdAt:2});return id;
 });
 await expect(owner.mutation(api.drafts.recreate,{...input,sendIntentId})).rejects.toThrow("latest send receipt");
 await expect(owner.mutation(api.drafts.recreate,input)).rejects.toThrow("latest send receipt");
 expect((await owner.query(api.drafts.get,{draftId})).body).toBe(draft.body);
});

test("a stale provider sync cannot reopen an original draft after a correction",async()=>{
 const {t,owner,ids,householdId,draftId,input}=await setup();
 const draft=await owner.query(api.drafts.get,{draftId});
 const sendIntentId=await t.run(async ctx=>{
  await ctx.db.patch(draftId,{state:"failed",syncToken:"pending",syncUntil:Date.now()+120000});
  return ctx.db.insert("sendIntents",{householdId,draftId,draftVersion:1,contentHash:draft.contentHash,logicalSendId:"failed",idempotencyKey:"synthetic",approvedBy:ids.owner,recipient:draft.recipient,subject:draft.subject,body:draft.body,providerDraftId:"synthetic",consentVersion:1,state:"failed",delivery:"rejected",attempts:1,createdAt:Date.now(),reconciliation:"confirmed"});
 });
 const id=await owner.mutation(api.drafts.recreate,{...input,sendIntentId});
 expect(await t.mutation(internal.mailStore.finishDraftSync,{draftId,token:"pending",version:1,success:true,providerDraftId:"late-provider-draft"})).toBe(false);
 expect(await owner.query(api.drafts.get,{draftId})).toMatchObject({state:"failed",correctionDraftId:id,version:2});
});
