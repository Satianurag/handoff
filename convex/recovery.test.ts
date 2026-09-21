/// <reference types="vite/client" />
import {convexTest} from "convex-test";
import {expect,test,vi,afterEach} from "vitest";
import workflowTest from "@convex-dev/workflow/test";
import schema from "./schema";
import {api,internal} from "./_generated/api";
const modules=import.meta.glob("./**/*.ts");afterEach(()=>vi.useRealTimers());
async function setup(){
 vi.useFakeTimers();const t=convexTest(schema,modules);workflowTest.register(t);workflowTest.register(t,"generationWorkflow");
 const userId=await t.run(ctx=>ctx.db.insert("users",{email:"verified@example.test",emailVerificationTime:1}));const user=t.withIdentity({subject:userId});
 const householdId=await user.mutation(api.households.create,{nickname:"Test",timezone:"UTC",firstTask:"Groceries",adultConfirmed:true,authorityStatement:"Synthetic",noticeVersion:"test",emailImport:false,aiProcessing:false,requestId:"new"});
 const sourceId=await t.run(ctx=>ctx.db.insert("sources",{householdId,kind:"manual",contentHash:"test",plaintext:"Use the east entrance.",capturedAt:Date.now(),publishedAt:null,retentionUntil:Date.now()+86400000,extractionState:"paused",warnings:[],truncated:false,unresolvedReferences:0,version:1}));
 return {t,user,userId,householdId,sourceId};
}
test("paused sources resume only after consent and enqueue one durable extraction",async()=>{
 const {t,user,householdId,sourceId}=await setup();
 await t.mutation(internal.recovery.resumeSources,{state:"paused"});expect(await t.run(ctx=>ctx.db.query("jobs").collect())).toHaveLength(0);
 await user.mutation(api.consents.set,{householdId,scope:"aiProcessing",granted:true,noticeVersion:"test",authorityStatement:"Grant synthetic processing"});
 await t.mutation(internal.recovery.resumeSources,{state:"paused"});await t.mutation(internal.recovery.resumeSources,{state:"pending"});
 const jobs=await t.run(ctx=>ctx.db.query("jobs").collect());expect(jobs).toHaveLength(1);expect(jobs[0]).toMatchObject({kind:"extractLogistics",state:"queued"});expect(jobs[0].workflowId).toBeDefined();
 expect(await t.run(ctx=>ctx.db.get(sourceId))).toMatchObject({extractionState:"pending"});
});
test("interrupted generation keeps its uncertain token reservation and pauses when consent is absent",async()=>{
 const {t,householdId,sourceId,userId}=await setup();
 const jobId=await t.run(async ctx=>{
  const id=await ctx.db.insert("jobs",{householdId,operationKey:"test-stale",kind:"extractLogistics",requestedBy:userId,target:{kind:"source",id:sourceId},state:"running",attempts:1,createdAt:Date.now()-3600000,updatedAt:Date.now()-3600000,consentVersion:1});
  await ctx.db.insert("generationRuns",{householdId,jobId:id,operation:"extractLogistics",provider:"gemini",model:"gemini-3.8-flash",state:"running",sourceId,expectedVersion:1,instruction:"",promptVersion:"test",schemaVersion:"1",inputHash:"test",reservedInput:100,reservedOutput:65536,budgetDay:"2026-09-19",createdAt:Date.now()-3600000});
  await ctx.db.patch(sourceId,{extractionState:"processing"});return id;
 });
 await t.mutation(internal.recovery.staleJobs,{});
 expect(await t.run(ctx=>ctx.db.get(jobId))).toMatchObject({state:"failed"});
 expect(await t.run(ctx=>ctx.db.query("generationRuns").withIndex("by_jobId",q=>q.eq("jobId",jobId)).unique())).toMatchObject({state:"failed",reservedOutput:65536,safeError:"INTERRUPTED_OPERATION"});
 expect(await t.run(ctx=>ctx.db.get(sourceId))).toMatchObject({extractionState:"paused"});
});
