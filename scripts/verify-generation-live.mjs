import { ConvexHttpClient, ConvexClient } from "convex/browser";
import { AgentMailClient } from "agentmail";
import { execFileSync } from "node:child_process";
import { api } from "../convex/_generated/api.js";
const client = new ConvexHttpClient(process.env.CONVEX_URL), leo = new ConvexHttpClient(process.env.CONVEX_URL);
const realtimeClients=[], subscriptions=[];
const provider = new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY, maxRetries: 0 });
let householdId, privacyJobId, phase = "previous authorized cleanup";
function internalCall(name, args) { const output=execFileSync("npx", ["convex", "run", name, JSON.stringify(args)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); return output ? JSON.parse(output) : null; }
async function observe(sessionToken,householdId){
 const connection=new ConvexClient(process.env.CONVEX_URL);realtimeClients.push(connection);connection.setAuth(async()=>sessionToken);
 const state={proposals:0,threads:0};
 for(const [key,query,args] of [["proposals",api.proposals.list,{householdId,status:"pending",paginationOpts:{numItems:20,cursor:null}}],["threads",api.inbox.list,{householdId,filter:"new",paginationOpts:{numItems:10,cursor:null}}]]){
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("Realtime subscription did not initialize")),15000);subscriptions.push(connection.onUpdate(query,args,value=>{state[key]=value.page.length;clearTimeout(timer);resolve();},error=>{clearTimeout(timer);reject(error);}));});
 }
 return state;
}
async function observed(predicate){for(let n=0;n<100;n++){if(predicate())return;await new Promise(r=>setTimeout(r,100));}throw new Error("Both sessions did not observe the live update");}
async function completed(jobId) {
 const deadline=Date.now()+20*60*1000;
 while(Date.now()<deadline){
  const job=await client.query(api.jobs.get,{jobId});
  if(job.state==="succeeded")return;
  if(["failed","cancelled","needsReview"].includes(job.state)&&!job.workflowId)throw new Error("Generation workflow did not finish successfully");
  await new Promise(r=>setTimeout(r,1000));
 }
 throw new Error("Generation workflow exceeded verification observation window");
}

try {
  // Finish only already-authorized provider deletions before testing new capacity.
  const ids=JSON.parse(execFileSync("npx", ["convex","run","--inline-query",'return (await ctx.db.query("privacyJobs").withIndex("by_state_and_requestedAt",q=>q.eq("state","queued")).take(50)).filter(j=>j.kind==="delete"&&j.processors.some(p=>p.name==="agentmail"&&p.state!=="succeeded")).map(j=>j._id);'], {encoding:"utf8",stdio:["ignore","pipe","pipe"]}));
  for(const privacyJobId of ids) internalCall("mail:cleanupProvider",{privacyJobId});
  phase="anonymous authentication";
  const auth=await client.action(api.auth.signIn,{provider:"anonymous"});client.setAuth(auth.tokens.token);
  phase="demo creation";
  householdId=await client.action(api.demoTokens.create,{});
  const capability=await client.action(api.demoTokens.secondRoleLink,{householdId});
  const role=await leo.action(api.auth.signIn,{provider:"demo-role",params:{token:capability}});leo.setAuth(role.tokens.token);
  const [mayaLive,leoLive]=await Promise.all([observe(auth.tokens.token,householdId),observe(role.tokens.token,householdId)]);
  phase="controlled inbox preparation";
  await client.action(api.mail.provision,{householdId});
  await client.action(api.mail.demoOfficeMessage,{householdId,scenario:"initial"});
  const account=await client.query(api.inbox.connection,{householdId});
  let incoming;
  for(let n=0;n<20;n++){const r=await provider.inboxes.messages.list(account.address,{labels:["received"],limit:10});if(r.messages[0]){incoming=r.messages[0];break;}await new Promise(r=>setTimeout(r,2000));}
  if(!incoming)throw new Error("Controlled mail missing");
  internalCall("mail:ingestMessage",{inboxId:account.address,messageId:incoming.messageId});
  await observed(()=>mayaLive.threads>0&&leoLive.threads>0);
  const threads=await client.query(api.inbox.list,{householdId,filter:"new",paginationOpts:{numItems:10,cursor:null}}),thread=threads.page[0];
  const visits=await client.query(api.upcoming.list,{householdId,kind:"visits",from:Date.now()-86400000,to:Date.now()+30*86400000,paginationOpts:{numItems:10,cursor:null}});
  const visit=visits.page[0];if(!visit)throw new Error("Missing sample visit");
  await client.mutation(api.threads.attach,{threadId:thread._id,expectedVersion:thread.version,related:{kind:"visit",id:visit._id}});
  const messages=await client.query(api.threads.messages,{threadId:thread._id,paginationOpts:{numItems:10,cursor:null}}),sourceId=messages.page[0].sourceId;
  phase="live source extraction";
  await completed(await client.action(api.generate.extractLogistics,{sourceId}));
  await observed(()=>mayaLive.proposals>0&&leoLive.proposals>0);
  const proposals=await client.query(api.proposals.list,{householdId,status:"pending",paginationOpts:{numItems:20,cursor:null}});
  if(!proposals.page.length)throw new Error("No logistical proposals");
  const source=await client.query(api.sources.get,{sourceId});
  for(const p of proposals.page)if(source.plaintext.slice(p.quoteStart,p.quoteEnd)!==p.quote)throw new Error("Quote mismatch");
  const unchanged=await client.query(api.visits.get,{visitId:visit._id});
  if(unchanged.visit.version!==visit.version)throw new Error("Extraction changed confirmed visit");
  console.log(JSON.stringify({genuineIncomingSourceExtracted:true,exactQuotes:true,confirmedVisitUnchanged:true,twoSessionsObservedMailAndProposalsWithoutRefresh:true}));
  phase="question generation";
  const contacts=await client.query(api.contacts.list,{householdId,state:"approved",paginationOpts:{numItems:10,cursor:null}}),contact=contacts.page[0];
  const p=proposals.page[0],refs=[{sourceId,quote:p.quote,start:p.quoteStart,end:p.quoteEnd}];
  const draftId=await client.mutation(api.drafts.create,{householdId,related:{kind:"visit",id:visit._id},recipient:contact.email,subject:"Entrance question",body:"Which entrance should we use?",sourceRefs:refs,requestId:"generation-question"});
  await completed(await client.action(api.generate.draftQuestion,{draftId,expectedVersion:1,instruction:"Ask whether the east entrance is accessible. Do not add patient information."}));
  const draft=await client.query(api.drafts.get,{draftId});
  if(draft.state!=="editable"||draft.version!==2||!draft.body.trim())throw new Error("Generated draft unavailable");
  await client.action(api.mail.syncDraft,{draftId});
  console.log(JSON.stringify({generatedEditableQuestion:true,savedToAgentMail:true,noAutomaticSend:true}));
  phase="handover introduction";
  const recipient=await leo.query(api.households.me,{});
  const tasks=await client.query(api.tasks.list,{householdId,status:"open",paginationOpts:{numItems:20,cursor:null}}),ride=tasks.page.find(t=>t.category==="ride");
  const handoverId=await client.mutation(api.handovers.prepare,{householdId,recipientId:recipient.id,proposedTaskIds:[ride._id],introduction:"",note:"Synthetic verification",requestId:"generation-handover"});
  await completed(await client.action(api.generate.introduceHandover,{handoverId,expectedVersion:1}));
  const handover=await client.query(api.handovers.get,{handoverId});
  if(!handover.handover.introduction||handover.handover.status!=="draft"||handover.items.length!==handover.handover.snapshotItemCount)throw new Error("Invalid generated introduction");
  if((await client.query(api.tasks.get,{taskId:ride._id})).ownerId!==ride.ownerId)throw new Error("Generation transferred ownership");
  console.log(JSON.stringify({editableIntroduction:true,completeDeterministicList:true,noOwnershipTransfer:true}));
} catch(e){console.error(JSON.stringify({failed:true,phase,appCode:typeof e?.data?.code==="string"?e.data.code:null,errorName:e?.name,detail:String(e?.stderr ?? e?.message ?? "").replace(/[^\s]{45,}/g,"[REDACTED]").slice(0,1200)}));process.exitCode=1;}
finally{
 subscriptions.forEach(unsubscribe=>unsubscribe());await Promise.allSettled(realtimeClients.map(connection=>connection.close()));
 if(householdId){try{privacyJobId=await client.mutation(api.privacyJobs.request,{householdId,kind:"delete",confirmed:true,requestId:"generation-cleanup"});internalCall("mail:cleanupProvider",{privacyJobId});console.log("Synthetic provider resources deleted; local purge remains tracked.");}catch(e){console.error(JSON.stringify({cleanupNeedsRetry:true,detail:String(e?.stderr ?? e?.message ?? "").replace(/[^\s]{45,}/g,"[REDACTED]").slice(0,1200)}));process.exitCode=1;}}
 await Promise.allSettled([client.action(api.auth.signOut,{}),leo.action(api.auth.signOut,{})]);
}
