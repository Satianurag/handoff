import {ConvexHttpClient,ConvexClient} from "convex/browser";
import {api} from "../convex/_generated/api.js";
const sessions=[new ConvexHttpClient(process.env.CONVEX_URL),new ConvexHttpClient(process.env.CONVEX_URL)], live=[],subscriptions=[];
let householdId;
async function until(predicate){for(let n=0;n<150;n++){if(predicate())return;await new Promise(r=>setTimeout(r,100));}throw new Error("Realtime convergence timed out");}
try{
 const first=await sessions[0].action(api.auth.signIn,{provider:"anonymous"});sessions[0].setAuth(first.tokens.token);
 householdId=await sessions[0].action(api.demoTokens.create,{});
 const capability=await sessions[0].action(api.demoTokens.secondRoleLink,{householdId});
 const second=await sessions[1].action(api.auth.signIn,{provider:"demo-role",params:{token:capability}});sessions[1].setAuth(second.tokens.token);
 const tasks=await sessions[0].query(api.tasks.list,{householdId,status:"open",paginationOpts:{numItems:20,cursor:null}}),task=tasks.page.find(t=>t.ownerId===null);
 if(!task)throw new Error("Missing unassigned synthetic task");
 const observed=[null,null],tokens=[first.tokens.token,second.tokens.token];
 for(let index=0;index<2;index++){
  const connection=new ConvexClient(process.env.CONVEX_URL);live.push(connection);connection.setAuth(async()=>tokens[index]);
  subscriptions.push(connection.onUpdate(api.tasks.get,{taskId:task._id},value=>{observed[index]=value;}));
 }
 await until(()=>observed.every(value=>value?.version===task.version));
 const claims=await Promise.allSettled(sessions.map(session=>session.mutation(api.tasks.transition,{taskId:task._id,expectedVersion:task.version,operation:"claim"})));
 if(claims.filter(r=>r.status==="fulfilled").length!==1)throw new Error("Concurrent claims did not yield exactly one winner");
 await until(()=>observed.every(value=>value?.version===task.version+1&&value.ownerId===observed[0].ownerId));
 const winner=claims.findIndex(r=>r.status==="fulfilled");
 await sessions[winner].mutation(api.tasks.transition,{taskId:task._id,expectedVersion:task.version+1,operation:"complete"});
 await until(()=>observed.every(value=>value?.status==="done"&&value.version===task.version+2));
 console.log(JSON.stringify({twoIndependentAuthenticatedWebSockets:true,oneConcurrentClaimWinner:true,bothObservedOwnershipWithoutRefresh:true,bothObservedCompletionWithoutRefresh:true}));
 // Closing and creating a fresh connection exercises reconnect/resubscribe state.
 subscriptions[1]();await live[1].close();
 let restored;
 const connection=new ConvexClient(process.env.CONVEX_URL);live.push(connection);connection.setAuth(async()=>tokens[1]);
 subscriptions.push(connection.onUpdate(api.tasks.get,{taskId:task._id},value=>{restored=value;}));
 await until(()=>restored?.status==="done"&&restored.version===task.version+2);
 console.log(JSON.stringify({freshConnectionResynchronized:true}));
}catch(error){console.error(JSON.stringify({failed:true,detail:String(error?.message??"").replace(/[^\s]{45,}/g,"[REDACTED]").slice(0,500)}));process.exitCode=1;}
finally{
 subscriptions.forEach(unsubscribe=>unsubscribe());await Promise.allSettled(live.map(connection=>connection.close()));
 if(householdId)try{await sessions[0].mutation(api.privacyJobs.request,{householdId,kind:"delete",confirmed:true,requestId:"realtime-cleanup"});}catch{console.error("Synthetic household cleanup request needs retry");process.exitCode=1;}
 await Promise.allSettled(sessions.map(session=>session.action(api.auth.signOut,{})));
}
