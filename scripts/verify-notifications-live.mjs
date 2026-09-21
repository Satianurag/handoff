import {ConvexHttpClient} from "convex/browser";
import {AgentMailClient} from "agentmail";
import {execFileSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {api} from "../convex/_generated/api.js";
const client=new ConvexHttpClient(process.env.CONVEX_URL),provider=new AgentMailClient({apiKey:process.env.AGENTMAIL_API_KEY,maxRetries:0});
let householdId,pod,inbox,deleteJobId,phase="controlled recipient provisioning";
function internalCall(name,args){const out=execFileSync("npx",["convex","run",...(process.env.CONVEX_URL==="https://admired-fish-176.convex.cloud"?["--prod"]:[]),name,JSON.stringify(args)],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();return out?JSON.parse(out):null;}
async function until(read,predicate,timeout=120000){const end=Date.now()+timeout;while(Date.now()<end){const value=await read();if(predicate(value))return value;await new Promise(r=>setTimeout(r,1000));}throw new Error("Observation window expired");}
try{
 pod=await provider.pods.create({clientId:`handoff-notification-verification-${randomUUID()}`,name:"Synthetic notification verification"});inbox=await provider.pods.inboxes.create(pod.podId,{displayName:"Synthetic verified recipient"});
 phase="OTP verification";await client.action(api.auth.signIn,{provider:"agentmail-otp",params:{email:inbox.email}});
 const mail=await until(()=>provider.inboxes.messages.list(inbox.inboxId,{labels:["received"],limit:10}),r=>r.messages.some(m=>m.subject==="Your Handoff sign-in code"));
 const message=await provider.inboxes.messages.get(inbox.inboxId,mail.messages.find(m=>m.subject==="Your Handoff sign-in code").messageId),code=message.text?.match(/\b\d{8}\b/)?.[0];if(!code)throw new Error("OTP missing");
 const auth=await client.action(api.auth.signIn,{provider:"agentmail-otp",params:{email:inbox.email,code}});client.setAuth(auth.tokens.token);
 householdId=await client.mutation(api.households.create,{nickname:"Synthetic private nickname",timezone:"UTC",firstTask:"Private synthetic logistics",adultConfirmed:true,authorityStatement:"Synthetic operator-owned verification",noticeVersion:"test",emailImport:false,aiProcessing:false,requestId:"household"});
 await client.mutation(api.notifications.preferences,{householdId,emailNotifications:true});const me=await client.query(api.households.me,{});
 const taskId=await client.mutation(api.tasks.create,{householdId,title:"PRIVATE_SYNTHETIC_TITLE",category:"logistics",note:"PRIVATE_SYNTHETIC_NOTE",dueAt:Date.now()-1000,requestedOwnerId:me.id,requestId:"due"});
 phase="generic notification workflow";internalCall("notificationMaintenance:taskReminders",{});
 const rows=await client.query(api.notifications.list,{householdId,unreadOnly:true,paginationOpts:{numItems:20,cursor:null}}),notice=rows.page.find(n=>n.target.id===taskId);if(!notice)throw new Error("Due notification absent");
 await until(async()=>Date.now(),now=>now>=notice.createdAt+61000,90000);internalCall("notificationMaintenance:dispatch",{});
 await until(()=>client.query(api.notifications.list,{householdId,unreadOnly:true,paginationOpts:{numItems:20,cursor:null}}),r=>r.page.some(n=>n._id===notice._id&&n.emailState==="sent"),300000);
 const delivered=await until(()=>provider.inboxes.messages.list(inbox.inboxId,{labels:["received"],limit:20}),r=>r.messages.some(m=>m.subject==="You have an update in Handoff"));
 const generic=await provider.inboxes.messages.get(inbox.inboxId,delivered.messages.find(m=>m.subject==="You have an update in Handoff").messageId);
 if(/PRIVATE_SYNTHETIC|private nickname|householdId/i.test(generic.text??""))throw new Error("Private details leaked into generic email");
 internalCall("notificationMaintenance:dispatch",{});internalCall("notificationMaintenance:taskReminders",{});
 const again=await provider.inboxes.messages.list(inbox.inboxId,{labels:["received"],limit:20});if(again.messages.filter(m=>m.subject==="You have an update in Handoff").length!==1)throw new Error("Duplicate generic email");
 console.log(JSON.stringify({verifiedOptIn:true,genuineGenericEmailReceived:true,privateDetailsExcluded:true,deduplicated:true}));
 phase="privacy cleanup";deleteJobId=await client.mutation(api.privacyJobs.request,{householdId,kind:"delete",confirmed:true,requestId:"cleanup"});await until(()=>client.query(api.privacyJobs.get,{privacyJobId:deleteJobId}),j=>j.state==="succeeded",20*60000);
 console.log(JSON.stringify({householdAndSenderCopyDeleted:true}));
}catch(e){console.error(JSON.stringify({failed:true,phase,appCode:e?.data?.code??null,providerStatus:e?.statusCode??null,detail:String(e?.message??"").replace(/[^\s]{45,}/g,"[REDACTED]").slice(0,500)}));process.exitCode=1;}
finally{
 if(householdId&&!deleteJobId)try{await client.mutation(api.privacyJobs.request,{householdId,kind:"delete",confirmed:true,requestId:"cleanup"});}catch{}
 if(inbox)await provider.inboxes.delete(inbox.inboxId).catch(()=>{});if(pod)await provider.pods.delete(pod.podId).catch(()=>{});await client.action(api.auth.signOut,{}).catch(()=>{});
}
