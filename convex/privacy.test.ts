/// <reference types="vite/client" />
import {convexTest} from "convex-test";
import {afterEach,expect,test,vi} from "vitest";
import workflowTest from "@convex-dev/workflow/test";
import schema from "./schema";
import {api,internal} from "./_generated/api";
import {householdTables} from "./model/privacy";
const modules=import.meta.glob("./**/*.ts");
afterEach(()=>vi.useRealTimers());
async function setup(){
 vi.useFakeTimers();const t=convexTest(schema,modules);workflowTest.register(t);workflowTest.register(t,"generationWorkflow");
 const ids=await t.run(async ctx=>({owner:await ctx.db.insert("users",{email:"owner@example.test",emailVerificationTime:1}),other:await ctx.db.insert("users",{email:"other@example.test",emailVerificationTime:1})}));
 const owner=t.withIdentity({subject:ids.owner}),other=t.withIdentity({subject:ids.other});
 const householdId=await owner.mutation(api.households.create,{nickname:"Synthetic",timezone:"UTC",firstTask:"Groceries",adultConfirmed:true,authorityStatement:"Synthetic adult",noticeVersion:"test",emailImport:false,aiProcessing:false,requestId:"household"});
 return {t,owner,other,householdId};
}
test("export pages yield private usable NDJSON, no reusable download URL, and rejects another account",async()=>{
 const {t,owner,other,householdId}=await setup();
 await t.run(ctx=>ctx.db.insert("operatorSettings",{key:"pauseAutomaticOperations",enabled:true,updatedAt:Date.now()}));
 const privacyJobId=await owner.mutation(api.privacyJobs.request,{householdId,kind:"export",confirmed:false,requestId:"export"});
 for(const table of ["households",...householdTables])await t.action(internal.privacyExport.buildPage,{privacyJobId,table,cursor:null,pageNumber:1});
 await t.mutation(internal.privacyStore.finish,{privacyJobId});
 expect(await owner.query(api.privacyJobs.get,{privacyJobId})).toMatchObject({state:"succeeded",stage:"complete"});
 const parts=await owner.query(api.privacyExportStore.parts,{privacyJobId,paginationOpts:{numItems:50,cursor:null}});expect(parts.page.length).toBeGreaterThan(3);expect(parts.page[0]).not.toHaveProperty("storageId");
 const taskPart=parts.page.find(p=>p.filename.startsWith("tasks-"))!;
 const bytes=await owner.action(api.privacyExport.download,{partId:taskPart._id});const text=new TextDecoder().decode(bytes);expect(JSON.parse(text.trim()).record.title).toBe("Groceries");
 await expect(owner.action(api.privacyExport.confirmDownload,{partId:taskPart._id})).resolves.toBeNull();
 await expect(other.action(api.privacyExport.confirmDownload,{partId:taskPart._id})).rejects.toThrow("unavailable");
 await expect(t.action(api.privacyExport.confirmDownload,{partId:taskPart._id})).rejects.toThrow();
 await expect(other.action(api.privacyExport.download,{partId:taskPart._id})).rejects.toThrow("unavailable");
 await expect(other.query(api.privacyExportStore.parts,{privacyJobId,paginationOpts:{numItems:10,cursor:null}})).rejects.toThrow("unavailable");
 const membership=await t.run(ctx=>ctx.db.query("memberships").withIndex("by_householdId",q=>q.eq("householdId",householdId)).first());
 await t.run(ctx=>ctx.db.patch(membership!._id,{status:"removed"}));
 await expect(owner.query(api.privacyJobs.get,{privacyJobId})).rejects.toThrow("unavailable");
 await expect(owner.query(api.privacyExportStore.parts,{privacyJobId,paginationOpts:{numItems:10,cursor:null}})).rejects.toThrow("unavailable");
 await expect(owner.action(api.privacyExport.download,{partId:taskPart._id})).rejects.toThrow("unavailable");
 // Bytes and a previously successful receipt check are already in this client's
 // possession. Final confirmation must still reject the now-removed member.
 await expect(owner.action(api.privacyExport.confirmDownload,{partId:taskPart._id})).rejects.toThrow("unavailable");
 await t.run(ctx=>ctx.db.patch(membership!._id,{status:"active"}));
 vi.setSystemTime(Date.now()+86400001);await expect(owner.action(api.privacyExport.download,{partId:taskPart._id})).rejects.toThrow("expired");
 await expect(owner.action(api.privacyExport.confirmDownload,{partId:taskPart._id})).rejects.toThrow("expired");
});
test("household purge cannot precede provider success and removes all domain rows, exports, and request copies",async()=>{
 const {t,owner,householdId}=await setup();
 await t.run(ctx=>ctx.db.insert("operatorSettings",{key:"pauseAutomaticOperations",enabled:true,updatedAt:Date.now()}));
 const privacyJobId=await owner.mutation(api.privacyJobs.request,{householdId,kind:"delete",confirmed:true,requestId:"delete"});
 await expect(t.mutation(internal.privacyStore.purgeBatch,{privacyJobId,table:"tasks"})).rejects.toThrow("Provider cleanup");
 await t.mutation(internal.privacyStore.quiesce,{privacyJobId});
 await t.mutation(internal.mailStore.providerCleaned,{privacyJobId,success:true});
 await expect(t.mutation(internal.privacyStore.finish,{privacyJobId})).rejects.toThrow("Active data remains");
 for(const table of householdTables)while(!await t.mutation(internal.privacyStore.purgeBatch,{privacyJobId,table})){}
 while(!await t.mutation(internal.privacyStore.purgeStorage,{privacyJobId})){}
 await t.mutation(internal.privacyStore.finish,{privacyJobId});
 expect(await t.run(ctx=>ctx.db.get(householdId))).toBeNull();
 expect(await owner.query(api.privacyJobs.get,{privacyJobId})).toMatchObject({state:"succeeded"});
 const requests=await t.run(ctx=>ctx.db.query("requests").collect());expect(requests).toHaveLength(1);expect(requests[0].operation).toBe("privacy.request");
});

test("thread deletion removes source proposals and quotes while preserving confirmed responsibilities",async()=>{
 const {t,owner,householdId}=await setup();
 await t.run(ctx=>ctx.db.insert("operatorSettings",{key:"pauseAutomaticOperations",enabled:true,updatedAt:Date.now()}));
 const fixture=await t.run(async ctx=>{
  const task=(await ctx.db.query("tasks").withIndex("by_householdId",q=>q.eq("householdId",householdId)).first())!;
  const threadId=await ctx.db.insert("mailThreads",{householdId,inboxId:"test",providerThreadId:"thread",related:{kind:"task",id:task._id},subject:"Source",state:"resolved",archived:false,quarantined:false,deleting:false,lastMessageAt:1,version:1});
  const sourceId=await ctx.db.insert("sources",{householdId,kind:"email",threadId,providerMessageId:"m",contentHash:"hash",plaintext:"Use east entrance.",capturedAt:1,publishedAt:null,retentionUntil:100,extractionState:"ready",warnings:[],truncated:false,unresolvedReferences:0,version:1});
  const ref={sourceId,quote:"Use east entrance.",start:0,end:18};await ctx.db.patch(task._id,{note:"Confirmed east entrance",sourceRefs:[ref]});
  await ctx.db.insert("proposals",{householdId,sourceId,target:{kind:"task",id:task._id},targetVersion:1,field:"note",proposedValue:"Use east entrance.",previousValue:"",quote:ref.quote,quoteStart:0,quoteEnd:18,status:"approved",version:1});
  return {threadId,sourceId,taskId:task._id};
 });
 const privacyJobId=await owner.mutation(api.privacyJobs.deleteThread,{threadId:fixture.threadId,expectedVersion:1,confirmed:true,requestId:"delete-thread"});
 await t.mutation(internal.mailStore.providerCleaned,{privacyJobId,success:true});
 while(!await t.mutation(internal.privacyScopeStore.purge,{privacyJobId})){}
 for(const table of ["tasks","visits","mailDrafts","events","handoverItems","handoverChanges"])await t.mutation(internal.privacyScopeStore.removeMissingReferences,{privacyJobId,table,cursor:null});
 await t.mutation(internal.privacyStore.finish,{privacyJobId});
 expect(await t.run(ctx=>ctx.db.get(fixture.sourceId))).toBeNull();expect(await t.run(ctx=>ctx.db.query("proposals").collect())).toHaveLength(0);
 expect(await owner.query(api.tasks.get,{taskId:fixture.taskId})).toMatchObject({note:"Confirmed east entrance",sourceRefs:[]});
});

test('an in-flight export download rechecks membership and expiry before returning file bytes',async()=>{
 const {t,owner,householdId}=await setup();
 await t.run(ctx=>ctx.db.insert('operatorSettings',{key:'pauseAutomaticOperations',enabled:true,updatedAt:Date.now()}));
 const privacyJobId=await owner.mutation(api.privacyJobs.request,{householdId,kind:'export',confirmed:false,requestId:'download-race'});
 await t.action(internal.privacyExport.buildPage,{privacyJobId,table:'tasks',cursor:null,pageNumber:1});
 await t.mutation(internal.privacyStore.finish,{privacyJobId});
 const part=(await owner.query(api.privacyExportStore.parts,{privacyJobId,paginationOpts:{numItems:10,cursor:null}})).page[0];
 const membership=await t.run(ctx=>ctx.db.query('memberships').withIndex('by_householdId',q=>q.eq('householdId',householdId)).first());
 const original=Blob.prototype.arrayBuffer;
 for(const condition of ['removed','expired']){
  let release!:()=>void,entered!:()=>void;
  const pending=new Promise<void>(resolve=>release=resolve),reading=new Promise<void>(resolve=>entered=resolve);
  const spy=vi.spyOn(Blob.prototype,'arrayBuffer').mockImplementationOnce(async function(this:Blob){const bytes=await original.call(this);entered();await pending;return bytes;});
  try{
   const download=owner.action(api.privacyExport.download,{partId:part._id});
   const rejected=expect(download).rejects.toThrow(/unavailable|expired/);
   await reading;
   if(condition==='removed')await t.run(ctx=>ctx.db.patch(membership!._id,{status:'removed'}));
   else vi.setSystemTime(Date.now()+86400001);
   release();await rejected;
  }finally{release();spy.mockRestore();}
  if(condition==='removed')await t.run(ctx=>ctx.db.patch(membership!._id,{status:'active'}));
 }
});
