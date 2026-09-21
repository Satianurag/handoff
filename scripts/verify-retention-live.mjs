import {ConvexHttpClient} from "convex/browser";
import {AgentMailClient} from "agentmail";
import {execFileSync} from "node:child_process";
import {api} from "../convex/_generated/api.js";
const client=new ConvexHttpClient(process.env.CONVEX_URL),provider=new AgentMailClient({apiKey:process.env.AGENTMAIL_API_KEY,maxRetries:0});
let householdId,phase="sign in";
function internalCall(name,args){const out=execFileSync("npx",["convex","run",name,JSON.stringify(args)],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();return out?JSON.parse(out):null;}
async function until(read,predicate,timeout=180000){const end=Date.now()+timeout;while(Date.now()<end){const value=await read();if(predicate(value))return value;if(value?.state==="failed")throw new Error("Background operation failed");await new Promise(r=>setTimeout(r,1500));}throw new Error("Observation window expired");}
async function isGone(read){try{await read();return false;}catch(e){if(e.statusCode===404)return true;throw e;}}
async function newThread(subject){return until(()=>client.query(api.inbox.list,{householdId,filter:"new",paginationOpts:{numItems:30,cursor:null}}),v=>v.page.some(t=>t.subject===subject));}
try{
 const auth=await client.action(api.auth.signIn,{provider:"anonymous"});client.setAuth(auth.tokens.token);
 householdId=await client.action(api.demoTokens.create,{});
 const connection=await until(()=>client.query(api.inbox.connection,{householdId}),v=>v?.status==="ready"&&v.contactSyncState==="ready");
 await client.mutation(api.consents.set,{householdId,scope:"aiProcessing",granted:false,noticeVersion:"synthetic-retention",authorityStatement:"Synthetic mail retention verification; no model work needed"});
 const contacts=await client.query(api.contacts.list,{householdId,state:"approved",paginationOpts:{numItems:10,cursor:null}}),recipient=contacts.page[0].email;
 const family=await provider.inboxes.get(connection.address),office=await provider.inboxes.get(recipient);
 phase="genuine incoming mail";
 await client.action(api.mail.demoOfficeMessage,{householdId,scenario:"initial"});
 const listed=await newThread("Synthetic visit logistics"),thread=listed.page.find(t=>t.subject==="Synthetic visit logistics");
 const messages=await client.query(api.threads.messages,{threadId:thread._id,paginationOpts:{numItems:10,cursor:null}}),incoming=messages.page.find(m=>m.sourceId);
 if(!incoming)throw new Error("Incoming source missing");
 phase="controlled approved outgoing mail";
 const draftId=await client.mutation(api.drafts.create,{householdId,threadId:thread._id,inReplyTo:incoming.providerMessageId,related:null,recipient,subject:"Synthetic cleanup question",body:"SYNTHETIC TEST ONLY. Which entrance should we use?",sourceRefs:[],requestId:"retention-send-draft"});
 const draft=await until(()=>client.query(api.drafts.get,{draftId}),v=>v.providerSyncedVersion===v.version&&!v.syncToken);
 const sendIntentId=await client.mutation(api.drafts.approveSend,{draftId,expectedVersion:draft.version,expectedHash:draft.contentHash,logicalSendId:"retention-controlled-send"});
 await until(()=>client.query(api.sendIntents.get,{sendIntentId}),v=>v.state==="sent"&&v.delivery==="delivered");
 let current=await client.query(api.threads.get,{threadId:thread._id});
 if(current.related){await client.mutation(api.threads.attach,{threadId:thread._id,expectedVersion:current.version,related:null});current=await client.query(api.threads.get,{threadId:thread._id});}
 await client.mutation(api.threads.update,{threadId:thread._id,expectedVersion:current.version,operation:"resolve"});
 phase="source retention provider removal";
 const sourceJob=internalCall("retentionFixtures:age",{messageId:incoming._id});
 await until(()=>client.query(api.jobs.get,{jobId:sourceJob}),v=>v.state==="succeeded"&&!v.workflowId);
 if(!await isGone(()=>provider.inboxes.messages.get(family.inboxId,incoming.providerMessageId)))throw new Error("Provider source message survived retention");
 let sourceGone=false;try{await client.query(api.sources.get,{sourceId:incoming.sourceId});}catch{sourceGone=true;}if(!sourceGone)throw new Error("Raw source survived retention");
 console.log(JSON.stringify({genuineProviderSourceDeleted:true,localSourceDeleted:true,retentionWorkflowCompleted:true}));
 phase="outgoing mail retention";
 const outbound=(await client.query(api.threads.messages,{threadId:thread._id,paginationOpts:{numItems:10,cursor:null}})).page.find(m=>m.direction==="outbound");
 const mailJob=internalCall("retentionFixtures:age",{messageId:outbound._id});
 await until(()=>client.query(api.jobs.get,{jobId:mailJob}),v=>v.state==="succeeded"&&!v.workflowId);
 if(!await isGone(()=>provider.inboxes.messages.get(family.inboxId,outbound.providerMessageId)))throw new Error("Provider sent message survived retention");
 const savedDraft=await client.query(api.drafts.get,{draftId}),intent=await client.query(api.sendIntents.get,{sendIntentId});
 if(savedDraft.body||intent.body||intent.subject||intent.recipient)throw new Error("Raw approval copies survived retention");
 console.log(JSON.stringify({genuineProviderSentMessageDeleted:true,rawDraftAndApprovalRedacted:true,minimalDeliveryReceiptPreserved:true}));
 phase="scoped source and draft deletion";
 const uniqueSubject=`Synthetic scoped cleanup ${Date.now()}`;
 await provider.inboxes.messages.send(office.inboxId,{to:[family.email],subject:uniqueSubject,text:"SYNTHETIC TEST ONLY. Original source for explicit scoped deletion."},{idempotencyKey:`scope-${householdId}`});
 const scopedList=await newThread(uniqueSubject),scoped=scopedList.page.find(t=>t.subject===uniqueSubject);
 const scopedMessages=await client.query(api.threads.messages,{threadId:scoped._id,paginationOpts:{numItems:10,cursor:null}}),scopedIncoming=scopedMessages.page.find(m=>m.sourceId);
 const discardId=await client.mutation(api.drafts.create,{householdId,related:null,recipient,subject:"Synthetic discarded draft",body:"SYNTHETIC TEST ONLY. Do not send this draft.",sourceRefs:[],requestId:"retention-discard-draft"});
 const discard=await until(()=>client.query(api.drafts.get,{draftId:discardId}),v=>v.providerSyncedVersion===v.version&&!v.syncToken);
 const discardJob=await client.mutation(api.drafts.discard,{draftId:discardId,expectedVersion:discard.version});
 const scopeJob=await client.mutation(api.privacyJobs.deleteThread,{threadId:scoped._id,expectedVersion:scoped.version,confirmed:true,requestId:"retention-scope-delete"});
 console.log(JSON.stringify({scopedDeletesQueued:true,waitingForInFlightActionSafetyWindow:true}));
 await until(()=>client.query(api.privacyJobs.get,{privacyJobId:scopeJob}),v=>v.state==="succeeded"&&!v.workflowId,20*60000);
 await until(()=>client.query(api.privacyJobs.get,{privacyJobId:discardJob}),v=>v.state==="succeeded"&&!v.workflowId,20*60000);
 if(!await isGone(()=>provider.inboxes.threads.get(family.inboxId,scoped.providerThreadId)))throw new Error("Scoped provider thread survives");
 if(!await isGone(()=>provider.inboxes.drafts.get(family.inboxId,discard.providerDraftId)))throw new Error("Discarded provider draft survives");
 let scopedSourceGone=false;try{await client.query(api.sources.get,{sourceId:scopedIncoming.sourceId});}catch{scopedSourceGone=true;}if(!scopedSourceGone)throw new Error("Scoped source survives");
 console.log(JSON.stringify({scopedProviderThreadDeleted:true,scopedProviderDraftDeleted:true,scopedSourceRemoved:true}));
}catch(error){console.error(JSON.stringify({failed:true,phase,detail:String(error?.stderr??error?.message??"").replace(/[^\s]{45,}/g,"[REDACTED]").slice(0,700)}));process.exitCode=1;}
finally{
 if(householdId)try{const privacyJobId=await client.mutation(api.privacyJobs.request,{householdId,kind:"delete",confirmed:true,requestId:"retention-cleanup"});await until(()=>client.query(api.privacyJobs.get,{privacyJobId}),v=>v.state==="succeeded",20*60000);console.log(JSON.stringify({syntheticHouseholdAndProviderResourcesDeleted:true}));}catch{console.error("Synthetic cleanup needs retry");process.exitCode=1;}
 await client.action(api.auth.signOut,{}).catch(()=>{});
}
