/// <reference types="vite/client" />
import {convexTest} from "convex-test";
import {afterEach,expect,test,vi} from "vitest";
import {Webhook} from "svix";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workflowTest from "@convex-dev/workflow/test";
import schema from "./schema";
import {api,internal} from "./_generated/api";
const modules=import.meta.glob("./**/*.ts");
const secret="whsec_"+Buffer.from("synthetic-verification-secret-32bytes").toString("base64");
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
async function setup(){
 vi.stubEnv("AGENTMAIL_WEBHOOK_SECRET",secret);
 const t=convexTest(schema,modules);rateLimiterTest.register(t);workflowTest.register(t);workflowTest.register(t,"generationWorkflow");
 const userId=await t.run(ctx=>ctx.db.insert("users",{email:"test@example.test",emailVerificationTime:1}));const user=t.withIdentity({subject:userId});
 const householdId=await user.mutation(api.households.create,{nickname:"Synthetic",timezone:"UTC",firstTask:"Groceries",adultConfirmed:true,authorityStatement:"Synthetic",noticeVersion:"test",emailImport:true,aiProcessing:false,requestId:"create"});
 await t.mutation(internal.mailStore.provisioned,{householdId,podId:"pod",inboxId:"family@example.test",address:"family@example.test"});
 return {t,user,userId,householdId};
}
function signed(payload:unknown,date=new Date()){
 const raw=JSON.stringify(payload),id="msg_synthetic",timestamp=String(Math.floor(date.getTime()/1000));
 return {raw,id,timestamp,signature:new Webhook(secret).sign(id,date,raw)};
}
const delivered={event_id:"evt-delivered",event_type:"message.delivered",delivery:{inbox_id:"family@example.test",message_id:"m1",timestamp:new Date().toISOString()}};
test("raw signature tampering, stale replay and unknown inbox produce no stored event",async()=>{
 const {t}=await setup();const good=signed(delivered);
 expect(await t.action(internal.agentmailWebhook.receive,{...good,raw:good.raw+" "})).toBe(400);
 expect(await t.action(internal.agentmailWebhook.receive,signed(delivered,new Date(Date.now()-10*60000)))).toBe(400);
 expect(await t.action(internal.agentmailWebhook.receive,signed({...delivered,delivery:{...delivered.delivery,inbox_id:"unknown@example.test"}}))).toBe(204);
 expect(await t.run(ctx=>ctx.db.query("webhookEvents").take(10))).toHaveLength(0);
});
test("verified duplicate events are idempotent and delivery cannot regress after a bounce",async()=>{
 const {t}=await setup();const input=signed(delivered);
 expect(await t.action(internal.agentmailWebhook.receive,input)).toBe(204);
 expect(await t.action(internal.agentmailWebhook.receive,input)).toBe(204);
 expect(await t.run(ctx=>ctx.db.query("webhookEvents").take(10))).toHaveLength(1);
 await t.action(internal.agentmailWebhook.receive,signed({event_id:"bounce",event_type:"message.bounced",bounce:delivered.delivery}));
 await t.action(internal.agentmailWebhook.receive,signed({event_id:"late-sent",event_type:"message.sent",send:delivered.delivery}));
 const receipt=await t.run(ctx=>ctx.db.query("deliveryReceipts").withIndex("by_inboxId_and_providerMessageId",q=>q.eq("inboxId","family@example.test").eq("providerMessageId","m1")).unique());
 expect(receipt?.delivery).toBe("bounced");
 expect(await t.action(internal.agentmailWebhook.receive,signed({...delivered,delivery:{...delivered.delivery,message_id:"m2"}}))).toBe(409);
});
test("a delivery event arriving before the send response is applied when the message is projected",async()=>{
 const {t,user,userId,householdId}=await setup();
 await t.action(internal.agentmailWebhook.receive,signed(delivered));
 const now=Date.now();
 const draftId=await t.run(ctx=>ctx.db.insert("mailDrafts",{householdId,providerDraftId:"d1",related:null,recipient:"office@example.test",subject:"Question",body:"Which entrance?",sourceRefs:[],version:1,contentHash:"hash",editorId:userId,state:"sending",updatedAt:now}));
 const sendIntentId=await t.run(ctx=>ctx.db.insert("sendIntents",{householdId,draftId,draftVersion:1,contentHash:"hash",logicalSendId:"logical",idempotencyKey:"key",approvedBy:userId,recipient:"office@example.test",subject:"Question",body:"Which entrance?",providerDraftId:"d1",consentVersion:1,state:"sending",delivery:"pending",attempts:1,createdAt:now,firstAttemptAt:now,reconciliation:"none"}));
 await t.mutation(internal.mailStore.sent,{sendIntentId,messageId:"m1",threadId:"t1"});
 expect((await user.query(api.sendIntents.get,{sendIntentId})).delivery).toBe("delivered");
 expect((await t.run(ctx=>ctx.db.query("mailMessages").take(1)))[0].delivery).toBe("delivered");
});
