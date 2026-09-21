import {ConvexHttpClient} from "convex/browser";
import {AgentMailClient} from "agentmail";
import {api} from "../convex/_generated/api.js";
const clients=[new ConvexHttpClient(process.env.CONVEX_URL),new ConvexHttpClient(process.env.CONVEX_URL)],provider=new AgentMailClient({apiKey:process.env.AGENTMAIL_API_KEY,maxRetries:0});
let householdId,deleteJobId,phase="sign in";
async function until(read,predicate,timeout=120000){const end=Date.now()+timeout;while(Date.now()<end){const value=await read();if(predicate(value))return value;if(value?.state==="failed")throw new Error("Background privacy operation failed");await new Promise(r=>setTimeout(r,1000));}throw new Error("Observation window expired");}
try{
 const auth=await clients[0].action(api.auth.signIn,{provider:"anonymous"});clients[0].setAuth(auth.tokens.token);
 householdId=await clients[0].action(api.demoTokens.create,{});
 const capability=await clients[0].action(api.demoTokens.secondRoleLink,{householdId});
 const role=await clients[1].action(api.auth.signIn,{provider:"demo-role",params:{token:capability}});clients[1].setAuth(role.tokens.token);
 phase="mail provisioning";const connection=await until(()=>clients[0].query(api.inbox.connection,{householdId}),v=>v?.status==="ready"&&v.contactSyncState==="ready");
 const inbox=await provider.inboxes.get(connection.address);
 phase="private export workflow";
 const privacyJobId=await clients[0].mutation(api.privacyJobs.request,{householdId,kind:"export",confirmed:false,requestId:"live-export"});
 await until(()=>clients[0].query(api.privacyJobs.get,{privacyJobId}),v=>v.state==="succeeded",300000);
 const parts=await clients[0].query(api.privacyExportStore.parts,{privacyJobId,paginationOpts:{numItems:100,cursor:null}});
 const part=parts.page.find(p=>p.filename.startsWith("tasks-"));if(!part)throw new Error("Export omitted responsibilities");
 const content=new TextDecoder().decode(await clients[0].action(api.privacyExport.download,{partId:part._id}));
 const records=content.trim().split("\n").map(line=>JSON.parse(line));if(!records.some(r=>r.record.title==="Prepare an evening meal"))throw new Error("Export contents invalid");
 let denied=false;try{await clients[1].action(api.privacyExport.download,{partId:part._id});}catch{denied=true;}if(!denied)throw new Error("Export readable by another household member");
 console.log(JSON.stringify({durablePrivateExport:true,ndjsonReadable:true,otherMemberDenied:true,publicDownloadUrl:false}));
 phase="household deletion workflow";
 deleteJobId=await clients[0].mutation(api.privacyJobs.request,{householdId,kind:"delete",confirmed:true,requestId:"live-delete"});
 let revoked=false;try{await clients[1].query(api.households.get,{householdId});}catch{revoked=true;}if(!revoked)throw new Error("Access not revoked immediately");
 const receipt=await until(()=>clients[0].query(api.privacyJobs.get,{privacyJobId:deleteJobId}),v=>v.state==="succeeded",20*60000);
 if(receipt.processors.some(p=>p.state!=="succeeded"))throw new Error("Incomplete processor receipt");
 let removed=false;try{await provider.inboxes.get(inbox.inboxId);}catch(e){if(e.statusCode===404)removed=true;else throw e;}if(!removed)throw new Error("Provider inbox still exists");
 let gone=false;try{await clients[0].action(api.privacyExport.download,{partId:part._id});}catch{gone=true;}if(!gone)throw new Error("Old export remains accessible");
 console.log(JSON.stringify({immediateAccessRevocation:true,providerInboxDeleted:true,allActiveDomainTablesPurged:true,exportDeleted:true,requesterPrivateReceipt:true}));
}catch(e){console.error(JSON.stringify({failed:true,phase,detail:String(e?.message??"").replace(/[^\s]{45,}/g,"[REDACTED]").slice(0,600)}));process.exitCode=1;}
finally{
 if(householdId&&!deleteJobId)try{await clients[0].mutation(api.privacyJobs.request,{householdId,kind:"delete",confirmed:true,requestId:"live-delete"});}catch{}
 for(const client of clients)await client.action(api.auth.signOut,{}).catch(()=>{});
}
