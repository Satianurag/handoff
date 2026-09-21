import {v} from 'convex/values';
import {internalMutation,env,type MutationCtx} from './_generated/server';
import type {Id} from './_generated/dataModel';
import {fail} from './model/access';
const inboxId='ui-fixture-not-a-provider-inbox';
async function household(ctx:MutationCtx,id:Id<'households'>){
 if(env.CONVEX_SITE_URL!=='https://befitting-cobra-234.convex.site')fail('DEVELOPMENT_ONLY','UI fixtures are development-only.');
 const h=await ctx.db.get(id);
 if(!h||h.mode!=='demo'||h.status!=='active'||!h.expiresAt||h.expiresAt<=Date.now())fail('DEMO_REQUIRED','An active synthetic household is required.');
 return h;
}
// Internal CLI-only fixtures. Every record says it is synthetic. No provider
// account, delivery receipt, source evidence or successful send is fabricated.
export const inbox=internalMutation({
 args:{householdId:v.id('households')},returns:v.array(v.id('mailThreads')),
 handler:async(ctx,args)=>{
  const h=await household(ctx,args.householdId),ids:Id<'mailThreads'>[]=[];
  for(let threadIndex=0;threadIndex<32;threadIndex++){
   const key=`ui-fixture:${h._id}:${threadIndex}`;
   const existing=await ctx.db.query('mailThreads').withIndex('by_inboxId_and_providerThreadId',q=>q.eq('inboxId',inboxId).eq('providerThreadId',key)).unique();
   if(existing){ids.push(existing._id);continue;}
   const now=Date.now(),threadId=await ctx.db.insert('mailThreads',{householdId:h._id,inboxId,providerThreadId:key,related:null,subject:`UI fixture ${threadIndex+1} — synthetic conversation, not provider mail`,state:'new',archived:false,quarantined:true,deleting:false,lastMessageAt:now,version:1});ids.push(threadId);
   for(let i=0;i<(threadIndex===0?61:threadIndex===1?2:0);i++)await ctx.db.insert('mailMessages',{householdId:h._id,threadId,providerMessageId:`${key}:message:${i}`,inboxId,direction:'inbound',from:'fixture-sender@example.test',to:['fixture-household@example.test'],plaintext:`Synthetic UI fixture message ${i+1}. This message was inserted for interface testing and was not received from an email provider.\n\n`+`Reading-position test paragraph. Confirming this fixture must not change any real responsibility. `.repeat(8),subject:'Synthetic UI fixture',occurredAt:now-(62-i)*60000,delivery:'unknown',attachmentOnly:false,truncated:false,retentionUntil:now+86400000,unresolvedReferences:1});
   if(threadIndex===0)for(let i=0;i<31;i++)await ctx.db.insert('mailDrafts',{householdId:h._id,threadId,related:null,recipient:'fixture-recipient@example.test',subject:`UI fixture draft ${i+1} — never send`,body:'Synthetic rendering fixture. No provider draft exists.',sourceRefs:[],version:1,contentHash:'ui-fixture-not-approved',editorId:h.ownerId,state:'failed',updatedAt:now+i,lastError:'UI fixture only. No provider operation was attempted.'});
  }
  return ids;
 }
});
export const reply=internalMutation({
 args:{threadId:v.id('mailThreads'),requestId:v.string()},returns:v.id('mailMessages'),
 handler:async(ctx,args)=>{
  const t=await ctx.db.get(args.threadId);if(!t||t.inboxId!==inboxId)fail('FIXTURE_REQUIRED','Only a UI fixture can receive this simulated update.');await household(ctx,t.householdId);
  const key=`${t.providerThreadId}:reply:${args.requestId}`;
  const prior=await ctx.db.query('mailMessages').withIndex('by_inboxId_and_providerMessageId',q=>q.eq('inboxId',inboxId).eq('providerMessageId',key)).unique();if(prior)return prior._id;
  const now=Date.now(),id=await ctx.db.insert('mailMessages',{householdId:t.householdId,threadId:t._id,providerMessageId:key,inboxId,direction:'inbound',from:'fixture-sender@example.test',to:['fixture-household@example.test'],plaintext:'Synthetic new-reply UI fixture. This update tests live reading position; no provider message was received.',subject:'Synthetic UI fixture reply',occurredAt:now,delivery:'unknown',attachmentOnly:false,truncated:false,retentionUntil:now+86400000,unresolvedReferences:1});
  await ctx.db.patch(t._id,{lastMessageAt:now,lastInboundAt:now,state:'replyReceived',version:t.version+1});return id;
 }
});
export const cleanup=internalMutation({
 args:{householdId:v.id('households')},returns:v.object({threads:v.number(),messages:v.number(),drafts:v.number()}),
 handler:async(ctx,args)=>{
  await household(ctx,args.householdId);let threads=0,messages=0,drafts=0;
  const rows=await ctx.db.query('mailThreads').withIndex('by_householdId',q=>q.eq('householdId',args.householdId)).take(101);
  if(rows.length>100)fail('FIXTURE_LIMIT','Use a smaller synthetic household.');
  for(const row of rows){if(row.inboxId!==inboxId||!row.providerThreadId.startsWith(`ui-fixture:${args.householdId}:`))continue;
   const ms=await ctx.db.query('mailMessages').withIndex('by_threadId_and_occurredAt',q=>q.eq('threadId',row._id)).take(101),ds=await ctx.db.query('mailDrafts').withIndex('by_threadId',q=>q.eq('threadId',row._id)).take(101);
   if(ms.length>100||ds.length>100)fail('FIXTURE_LIMIT','Fixture grew beyond its supported cleanup size.');
   if(ms.some(m=>m.inboxId!==inboxId||m.sourceId)||ds.some(d=>d.providerDraftId||d.state!=='failed'))fail('FIXTURE_CHANGED','Fixture has changed; inspect before cleanup.');
   for(const m of ms){await ctx.db.delete(m._id);messages++;}for(const d of ds){await ctx.db.delete(d._id);drafts++;}await ctx.db.delete(row._id);threads++;
  }
  return {threads,messages,drafts};
 }
});

// A departed fictional member has no credentials or active membership.
export const formerWork=internalMutation({args:{householdId:v.id('households')},returns:v.id('memberships'),handler:async(ctx,args)=>{
 const h=await household(ctx,args.householdId),operation='uiFixtures.formerWork';
 const prior=await ctx.db.query('requests').withIndex('by_userId_and_operation_and_requestId',q=>q.eq('userId',h.ownerId).eq('operation',operation).eq('requestId',h._id)).unique();
 if(prior){const record=JSON.parse(prior.resultId);return record.memberId;}
 const userId=await ctx.db.insert('users',{name:'Synthetic former member — UI fixture'}),memberId=await ctx.db.insert('memberships',{householdId:h._id,userId,role:'member',status:'left',joinedAt:Date.now()-86400000,endedAt:Date.now(),emailNotifications:false,lastReadSequence:0}),taskIds=[];
 for(const status of ['open','done','cancelled'] as const)taskIds.push(await ctx.db.insert('tasks',{householdId:h._id,title:`Synthetic former-member ${status} responsibility — UI fixture`,category:'logistics',dueAt:null,ownerId:userId,requestedOwnerId:null,status,note:'Disposable interface fixture. No real responsibility or provider operation.',sourceRefs:[],version:1,createdBy:h.ownerId,updatedAt:Date.now()}));
 await ctx.db.insert('requests',{userId:h.ownerId,operation,requestId:h._id,fingerprint:'synthetic-ui-fixture',resultId:JSON.stringify({memberId,userId,taskIds}),expiresAt:Date.now()+86400000});return memberId;
}});
export const cleanupFormerWork=internalMutation({args:{householdId:v.id('households')},returns:v.number(),handler:async(ctx,args)=>{
 const h=await household(ctx,args.householdId);
 const request=await ctx.db.query('requests').withIndex('by_userId_and_operation_and_requestId',q=>q.eq('userId',h.ownerId).eq('operation','uiFixtures.formerWork').eq('requestId',h._id)).unique();if(!request)return 0;
 const data=JSON.parse(request.resultId) as {memberId:Id<'memberships'>;userId:Id<'users'>;taskIds:Id<'tasks'>[]},m=await ctx.db.get(data.memberId),u=await ctx.db.get(data.userId);
 if(!m||m.householdId!==h._id||m.status!=='left'||m.userId!==data.userId||u?.name!=='Synthetic former member — UI fixture'||u.email||data.taskIds.length!==3)fail('FIXTURE_CHANGED','Inspect changed former-member fixture before cleanup.');
 for(const id of data.taskIds){const task=await ctx.db.get(id);if(!task||task.householdId!==h._id||task.ownerId!==u._id||!task.title.startsWith('Synthetic former-member ')||task.sourceRefs.length||task.version!==1)fail('FIXTURE_CHANGED','Inspect changed former-member fixture before cleanup.');}
 for(const id of data.taskIds)await ctx.db.delete(id);await ctx.db.delete(m._id);await ctx.db.delete(u._id);await ctx.db.delete(request._id);return data.taskIds.length;
}});

// Shorten a completed synthetic export so its real UI expiry can be observed.
// No export contents, processor success, or file download is fabricated.
export const expireExportSoon=internalMutation({args:{privacyJobId:v.id('privacyJobs')},returns:v.number(),handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.privacyJobId);if(!job||job.kind!=='export'||job.state!=='succeeded')fail('EXPORT_REQUIRED','A completed synthetic export is required.');
 await household(ctx,job.householdId);
 const expiresAt=Math.min(job.expiresAt,Date.now()+30000);await ctx.db.patch(job._id,{expiresAt});return expiresAt;
}});

// Restore only the existing anonymous second role after a removal UI test.
// This is test cleanup, never evidence that the real invitation flow passed.
export const restoreDemoSecondRole=internalMutation({
 args:{householdId:v.id('households')},returns:v.id('memberships'),
 handler:async(ctx,args)=>{
  const h=await household(ctx,args.householdId);
  const demo=await ctx.db.query('demoSessions').withIndex('by_householdId',q=>q.eq('householdId',h._id)).unique();
  if(!demo?.secondRoleId||demo.creatorId!==h.ownerId||demo.expiresAt<=Date.now())return fail('FIXTURE_CHANGED','Restore the sample creator as owner before cleanup.');
  const user=await ctx.db.get(demo.secondRoleId);
  const m=await ctx.db.query('memberships').withIndex('by_householdId_and_userId',q=>q.eq('householdId',h._id).eq('userId',demo.secondRoleId!)).unique();
  if(!user?.isAnonymous||user.email||!m||m.role!=='member')return fail('FIXTURE_CHANGED','Only the existing anonymous second role can be restored.');
  if(m.status!=='active')await ctx.db.patch(m._id,{status:'active',endedAt:undefined,joinedAt:Date.now()});
  return m._id;
 }
});

// Manual, explicitly synthetic evidence for browser recovery tests. No crawl,
// model output, provider message or successful review is represented by this seed.
export const sourceRecovery=internalMutation({
 args:{householdId:v.id('households'),step:v.union(v.literal('seed'),v.literal('removeSource'),v.literal('cleanup'))},
 returns:v.union(v.null(),v.object({sourceId:v.id('sources'),proposalId:v.id('proposals'),taskIds:v.array(v.id('tasks'))})),
 handler:async(ctx,args)=>{
  const h=await household(ctx,args.householdId),operation='uiFixtures.sourceRecovery';
  const prior=await ctx.db.query('requests').withIndex('by_userId_and_operation_and_requestId',q=>q.eq('userId',h.ownerId).eq('operation',operation).eq('requestId',h._id)).unique();
  if(!prior){
   if(args.step!=='seed')return null;
   const now=Date.now(),plaintext='Synthetic manual UI fixture. Carry the blue folder. No provider or model produced this text.',taskIds:Id<'tasks'>[]=[];
   for(const name of ['A','B'])taskIds.push(await ctx.db.insert('tasks',{householdId:h._id,title:`Synthetic review target ${name} — UI fixture`,category:'logistics',dueAt:null,ownerId:null,requestedOwnerId:null,status:'open',note:`Original fixture note ${name}.`,sourceRefs:[],version:1,createdBy:h.ownerId,updatedAt:now}));
   const sourceId=await ctx.db.insert('sources',{householdId:h._id,kind:'manual',contentHash:operation,plaintext,capturedAt:now,publishedAt:null,retentionUntil:now+86400000,extractionState:'unsupported',warnings:['Synthetic interface fixture; not model output or a provider capture.'],truncated:false,unresolvedReferences:1,version:1});
   const quote='Carry the blue folder.',quoteStart=plaintext.indexOf(quote);
   const proposalId=await ctx.db.insert('proposals',{householdId:h._id,sourceId,target:null,targetVersion:null,field:'note',proposedValue:quote,previousValue:null,quote,quoteStart,quoteEnd:quoteStart+quote.length,status:'pending',version:1});
   const data={sourceId,proposalId,taskIds};await ctx.db.insert('requests',{userId:h.ownerId,operation,requestId:h._id,fingerprint:'synthetic-ui-fixture',resultId:JSON.stringify(data),expiresAt:now+86400000});return data;
  }
  const data=JSON.parse(prior.resultId) as {sourceId:Id<'sources'>;proposalId:Id<'proposals'>;taskIds:Id<'tasks'>[]};
  const s=await ctx.db.get(data.sourceId),p=await ctx.db.get(data.proposalId);
  if((s&&(s.householdId!==h._id||s.kind!=='manual'||s.contentHash!==operation||s.threadId||s.watchId))||!p||p.householdId!==h._id||p.sourceId!==data.sourceId||p.status!=='pending'||p.target||data.taskIds.length!==2)fail('FIXTURE_CHANGED','Inspect the changed source fixture before cleanup.');
  for(const id of data.taskIds){const t=await ctx.db.get(id);if(!t||t.householdId!==h._id||!t.title.startsWith('Synthetic review target ')||t.version!==1||t.sourceRefs.length)fail('FIXTURE_CHANGED','Inspect the changed task fixture before cleanup.');}
  if(args.step==='seed')return data;
  if(s)await ctx.db.delete(s._id);
  if(args.step==='cleanup'){await ctx.db.delete(p._id);for(const id of data.taskIds)await ctx.db.delete(id);await ctx.db.delete(prior._id);return null;}
  return data;
 }
});

export const watchPagination=internalMutation({
 args:{visitId:v.id('visits'),cleanup:v.boolean()},returns:v.array(v.id('watches')),
 handler:async(ctx,args)=>{
  const visit=await ctx.db.get(args.visitId);if(!visit)fail('NOT_FOUND','Visit unavailable.');const h=await household(ctx,visit.householdId);
  const rows=await ctx.db.query('watches').withIndex('by_visitId',q=>q.eq('visitId',visit._id)).take(101);
  if(rows.length>100)fail('FIXTURE_LIMIT','Use a smaller synthetic visit.');
  const prefix=`ui-fixture-watch:${visit._id}:`,ids:Id<'watches'>[]=[];
  if(args.cleanup){
   for(const w of rows){if(!w.tag.startsWith(prefix))continue;if(w.householdId!==h._id||w.active||w.currentJobId||w.lastSuccessfulSourceId||w.version!==1||w.settingsHash!=='ui-fixture-no-provider')fail('FIXTURE_CHANGED','Inspect changed watches before cleanup.');await ctx.db.delete(w._id);ids.push(w._id);}return ids;
  }
  for(let i=0;i<26;i++){const tag=prefix+i,existing=rows.find(w=>w.tag===tag);if(existing){ids.push(existing._id);continue;}ids.push(await ctx.db.insert('watches',{householdId:h._id,visitId:visit._id,url:`https://example.invalid/synthetic-ui-fixture/${i+1}`,tag,schemaVersion:1,settingsHash:'ui-fixture-no-provider',lastSuccessfulSourceId:null,nextCheckAt:Date.now()+86400000,active:false,state:'paused',createdBy:h.ownerId,version:1}));}return ids;
 }
});
