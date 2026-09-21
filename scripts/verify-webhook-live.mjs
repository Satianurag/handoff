import {ConvexHttpClient,ConvexClient} from "convex/browser";
import {api} from "../convex/_generated/api.js";
const client=new ConvexHttpClient(process.env.CONVEX_URL);
let householdId,phase="sign in";

async function until(read,predicate,timeout=120000){const end=Date.now()+timeout;while(Date.now()<end){const value=await read();if(predicate(value))return value;await new Promise(r=>setTimeout(r,1000));}throw new Error("Observation window expired");}
try{
 const auth=await client.action(api.auth.signIn,{provider:"anonymous"});client.setAuth(auth.tokens.token);
 householdId=await client.action(api.demoTokens.create,{});
 await until(()=>client.query(api.inbox.connection,{householdId}),v=>v?.status==="ready"&&v.contactSyncState==="ready");
 phase="two authenticated realtime sessions";
 const capability=await client.action(api.demoTokens.secondRoleLink,{householdId});
 const second=new ConvexHttpClient(process.env.CONVEX_URL),role=await second.action(api.auth.signIn,{provider:"demo-role",params:{token:capability}});second.setAuth(role.tokens.token);
 const tasks=await client.query(api.tasks.list,{householdId,status:"open",paginationOpts:{numItems:20,cursor:null}}),task=tasks.page.find(t=>t.ownerId===null);
 const sockets=[new ConvexClient(process.env.CONVEX_URL),new ConvexClient(process.env.CONVEX_URL)],observed=[null,null],tokens=[auth.tokens.token,role.tokens.token],subscriptions=[];
 try{
  sockets.forEach((socket,index)=>{socket.setAuth(async()=>tokens[index]);subscriptions.push(socket.onUpdate(api.tasks.get,{taskId:task._id},value=>{observed[index]=value;}));});
  await until(async()=>observed,v=>v.every(t=>t?.version===task.version));
  const claims=await Promise.allSettled([client,second].map(c=>c.mutation(api.tasks.transition,{taskId:task._id,expectedVersion:task.version,operation:"claim"})));
  if(claims.filter(c=>c.status==="fulfilled").length!==1)throw new Error("Claim conflict did not preserve a single owner");
  await until(async()=>observed,v=>v.every(t=>t?.ownerId&&t.version===task.version+1));
  const winner=[client,second][claims.findIndex(c=>c.status==="fulfilled")];
  await winner.mutation(api.tasks.transition,{taskId:task._id,expectedVersion:task.version+1,operation:"complete"});
  await until(async()=>observed,v=>v.every(t=>t?.status==="done"));
  console.log(JSON.stringify({twoAuthenticatedWebSockets:true,exactlyOneClaimWinner:true,bothReceivedCompletion:true}));
 }finally{subscriptions.forEach(fn=>fn());await Promise.all(sockets.map(s=>s.close()));await second.action(api.auth.signOut,{});}
 phase="forged HTTP event";
 const denied=await fetch(process.env.CONVEX_URL.replace(".cloud",".site")+"/agentmail/webhook",{method:"POST",headers:{"svix-id":"fake","svix-timestamp":String(Math.floor(Date.now()/1000)),"svix-signature":"v1,invalid"},body:"{}"});
 if(denied.status!==400)throw new Error("Forged signature was not rejected");
 phase="genuine received webhook";
 await client.action(api.mail.demoOfficeMessage,{householdId,scenario:"initial"});
 const threads=await until(()=>client.query(api.inbox.list,{householdId,filter:"new",paginationOpts:{numItems:10,cursor:null}}),v=>v.page.length>0);
 const thread=threads.page[0];
 const messages=await client.query(api.threads.messages,{threadId:thread._id,paginationOpts:{numItems:10,cursor:null}}),incoming=messages.page.find(m=>m.direction==="inbound");
 if(!incoming?.sourceId)throw new Error("No source from webhook ingestion");
 console.log(JSON.stringify({forgedSignatureRejected:true,genuineSignedWebhookProjectedMail:true,noManualIngestCall:true}));
 phase="automatic generation workflow";
 const proposals=await until(()=>client.query(api.proposals.list,{householdId,status:"pending",paginationOpts:{numItems:20,cursor:null}}),v=>v.page.length>0,20*60000);
 const source=await client.query(api.sources.get,{sourceId:incoming.sourceId});
 if(proposals.page.some(p=>p.sourceId===source._id&&source.plaintext.slice(p.quoteStart,p.quoteEnd)!==p.quote))throw new Error("Unverifiable source quote");
 console.log(JSON.stringify({automaticDurableExtraction:true,proposalsRequireReview:true}));
 await client.mutation(api.consents.set,{householdId,scope:"aiProcessing",granted:false,noticeVersion:"synthetic-test",authorityStatement:"Pause model work for controlled reply transport verification"});
 phase="approved controlled send and delivery webhook";
 const contacts=await client.query(api.contacts.list,{householdId,state:"approved",paginationOpts:{numItems:10,cursor:null}});
 const draftId=await client.mutation(api.drafts.create,{householdId,threadId:thread._id,inReplyTo:incoming.providerMessageId,related:null,recipient:contacts.page[0].email,subject:"Synthetic entrance question",body:"SYNTHETIC TEST ONLY. Which entrance should we use?",sourceRefs:[],requestId:"webhook-draft"});
 const draft=await until(()=>client.query(api.drafts.get,{draftId}),v=>v.providerSyncedVersion===v.version&&!v.syncToken);
 const sendIntentId=await client.mutation(api.drafts.approveSend,{draftId,expectedVersion:draft.version,expectedHash:draft.contentHash,logicalSendId:"webhook-controlled-send"});

 const delivered=await until(()=>client.query(api.sendIntents.get,{sendIntentId}),v=>v.delivery==="delivered");
 if(delivered.state!=="sent")throw new Error("Delivery did not preserve send receipt");
 phase="genuine reply webhook";
 await until(async()=>{try{return await client.action(api.mail.demoOfficeMessage,{householdId,scenario:"reply"});}catch(e){if(e?.data?.code==="NO_QUESTION"||String(e?.message).includes("NO_QUESTION"))return null;throw e;}},v=>v!==null);
 await until(()=>client.query(api.threads.get,{threadId:thread._id}),v=>v.state==="replyReceived");
 console.log(JSON.stringify({providerDeliveryWebhookApplied:true,genuineReplyRoutedToOriginalThread:true}));
}catch(error){console.error(JSON.stringify({failed:true,phase,detail:String(error?.stderr??error?.message??"").replace(/[^\s]{45,}/g,"[REDACTED]").slice(0,800)}));process.exitCode=1;}
finally{
 if(householdId)try{const privacyJobId=await client.mutation(api.privacyJobs.request,{householdId,kind:"delete",confirmed:true,requestId:"webhook-cleanup"});await until(()=>client.query(api.privacyJobs.get,{privacyJobId}),v=>v.state==="succeeded"&&!v.workflowId,20*60000);console.log(JSON.stringify({controlledProviderAndLocalResourcesDeleted:true}));}catch{console.error("Controlled cleanup needs retry");process.exitCode=1;}
 await client.action(api.auth.signOut,{}).catch(()=>{});
}
