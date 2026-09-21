import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scope } from '../web/ui/session.js';
import { isAppRoute } from '../web/routes.js';
import { esc, localParts } from '../web/ui/core.js';
test('subscription disposal is idempotent across minute refresh and route cleanup',()=>{
 let unsubscribed=0,receive;const client={onUpdate(_name,_args,fn){receive=fn;let disposed=false;return()=>{assert.equal(disposed,false);disposed=true;unsubscribed++;};}};
 const s=scope(client);let deliveries=0;const stop=s.watch('today:get',{},()=>deliveries++);receive({});stop();s.add(()=>stop());s.dispose();s.dispose();receive({});assert.equal(unsubscribed,1);assert.equal(deliveries,1);
});
test('deep-link routes recognize consumer screens and reject arbitrary assets or paths',()=>{
 for(const path of ['/account','/h/abc/visits','/h/abc/plan/recurring','/h/abc/series/def','/h/abc/tasks/new','/h/abc/plan','/h/abc/handovers/def','/privacy-requests/def','/demo/join','/join/token'])assert.equal(isAppRoute(path),true,path);
 for(const path of ['/missing.js','/not-a-route','//external.test','/h/abc/unknown'])assert.equal(isAppRoute(path),false,path);
});
test('only task, visit and coverage details in the current household qualify for a list panel',async()=>{
 const {detailTarget}=await import('../web/ui/detail-panel.js');
 assert.deepEqual(detailTarget('/h/abc/tasks/def?sample=1','abc'),{kind:'tasks',id:'def'});
 for(const url of ['/h/abc/tasks/new','/h/other/tasks/def','/h/abc/handovers/def','/h/abc/visits','/h/abc/plan/recurring','/h/abc/series/def','https://example.test/h/abc/tasks/def'])assert.equal(detailTarget(url,'abc'),null);
});
test('untrusted source strings remain text and local date formatting respects household timezone',()=>{
 assert.equal(esc('<img src=x onerror="run()">'), '&lt;img src=x onerror=&quot;run()&quot;&gt;');
 assert.deepEqual(localParts(Date.UTC(2026,0,1,0,0),'Asia/Kathmandu'),{date:'2026-01-01',time:'05:45'});
});

test('handover review choices reset on changed snapshot and transition to a receipt after acceptance',async()=>{
 const {handoverUpdatePolicy}=await import('../web/ui/handover-state.js');
 const pending={handover:{status:'pending',version:2},stale:false};
 assert.equal(handoverUpdatePolicy(pending,{...pending},{dirty:true}),'preserve-acceptance');
 assert.equal(handoverUpdatePolicy(pending,{...pending,stale:true},{dirty:true}),'reset-acceptance');
 assert.equal(handoverUpdatePolicy(pending,{handover:{status:'pending',version:3},stale:false},{dirty:true}),'reset-acceptance');
 assert.equal(handoverUpdatePolicy(pending,{handover:{status:'accepted',version:3},stale:false},{dirty:true}),'render');
 assert.equal(handoverUpdatePolicy(pending,{handover:{status:'declined',version:3},stale:false},{dirty:true}),'render');
 const draft={handover:{status:'draft',version:1},stale:false};
 assert.equal(handoverUpdatePolicy(draft,{...draft,stale:true},{dirty:true}),'preserve-draft');
 assert.equal(handoverUpdatePolicy(draft,{handover:{status:'draft',version:2},stale:false},{dirty:true,submitting:true}),'render');
});

test('activity explains saved values without JSON, raw ownership ids, or epoch dates',async()=>{
 const {activityText,handoverChangeText}=await import('../web/ui/activity-text.js');
 const person='abcdefgh12345678abcdefgh12345678';const ctx={household:{timezone:'UTC'},name:id=>id===person?'Leo':'Unassigned'};
 const edit=activityText(ctx,'task.edited',JSON.stringify({title:'Bring keys',note:'At the desk',dueAt:Date.UTC(2026,0,1,12)}));
 assert.match(edit,/Title: Bring keys/);assert.match(edit,/Due: Jan 1, 2026/);assert.doesNotMatch(edit,/[{}]|1767268800000/);
 assert.equal(activityText(ctx,'task.handoverAccepted',person),'Leo');
 assert.equal(activityText(ctx,'task.complete','done; owner='+person+'; '),'Completed; Responsible: Leo');
 assert.equal(handoverChangeText(ctx,{kind:'event',summary:'task.edited: {"title":"Bring keys"}'}),'Responsibility updated: Title: Bring keys');
 assert.equal(handoverChangeText(ctx,{kind:'event',summary:'team.ownerTransferred: '+person}),'Household membership ownership transferred: Leo');
 assert.equal(handoverChangeText(ctx,{kind:'event',summary:'task.handoverAccepted: '+person}),'Responsibility accepted in handover: Leo');
 assert.equal(handoverChangeText(ctx,{kind:'event',summary:'coverage.end: end; Finished the sample check.'}),'Coverage ended. Finished the sample check.');
 assert.equal(handoverChangeText(ctx,{kind:'proposal',summary:'Unreviewed address: West entrance'}),'Unreviewed suggestion: address: West entrance');
 assert.equal(activityText(ctx,'task.edited','{"privateId":"'+person+'"}'),'Details updated.');
});

test('evidence highlighting requires exact quote spans and escapes source HTML',async()=>{
 const {evidenceHtml,proposalCurrentValue,proposalSupportsTarget}=await import('../web/ui/evidence.js');
 const source='Call <office> at noon.';
 assert.equal(evidenceHtml(source,[{quote:'<office>',quoteStart:5,quoteEnd:13}]),'Call <mark>&lt;office&gt;</mark> at noon.');
 assert.equal(evidenceHtml(source,[{quote:'wrong',quoteStart:5,quoteEnd:13},{quote:source,quoteStart:-1,quoteEnd:source.length}]),'Call &lt;office&gt; at noon.');
 assert.equal(evidenceHtml('abcdef',[{quote:'bcd',quoteStart:1,quoteEnd:4},{quote:'de',quoteStart:3,quoteEnd:5}]),'a<mark>bcde</mark>f');
 assert.equal(proposalCurrentValue({confirmedAddress:'Front entrance'},'address'),'Front entrance');
 assert.equal(proposalCurrentValue({confirmedStartsAt:42},'startsAt'),42);
 assert.equal(proposalSupportsTarget('address','task'),false);assert.equal(proposalSupportsTarget('startsAt','visit'),true);
});

test('a selected notification is read once only after its target renders for the same account and route',async()=>{
 const {selectNotification,acknowledgeNotification,notificationWatch}=await import('../web/ui/notification-navigation.js');
 const calls=[],client={},ctx={auth:{client},viewer:{id:'viewer'},id:'home',alive:true,mutate:async(...args)=>calls.push(args)};
 const href='/h/home/tasks/task',n={_id:'notice',readAt:null,target:{kind:'task',id:'task'}};
 selectNotification(ctx,n,href);
 for(const [context,name,args,path] of [
  [ctx,'notifications:list',{},href], [ctx,'tasks:get',{taskId:'other'},href],
  [ctx,'tasks:get',{taskId:'task'},'/h/home/today'], [{...ctx,alive:false},'tasks:get',{taskId:'task'},href],
  [{...ctx,auth:{client:{}}},'tasks:get',{taskId:'task'},href], [{...ctx,viewer:{id:'other'}},'tasks:get',{taskId:'task'},href],
 ])acknowledgeNotification(context,name,args,path,()=>{});
 await Promise.resolve();assert.equal(calls.length,0);
 acknowledgeNotification(ctx,'tasks:get',{taskId:'task'},href,()=>{});
 acknowledgeNotification(ctx,'tasks:get',{taskId:'task'},href,()=>{});
 await Promise.resolve();assert.deepEqual(calls,[['notifications:read',{notificationId:'notice'}]]);
 selectNotification(ctx,n,href);let receive;
 const wrapped=notificationWatch(ctx,(_name,_args,fn)=>{receive=fn;},()=>{});
 wrapped('tasks:get',{taskId:'task'},()=>{throw Error('Render failed');});
 assert.throws(()=>receive({}),/Render failed/);await Promise.resolve();assert.equal(calls.length,1);
 selectNotification(ctx,{...n,readAt:1},href);
 acknowledgeNotification(ctx,'tasks:get',{taskId:'task'},href,()=>{});await Promise.resolve();assert.equal(calls.length,1);
});

test('inbox selection preserves its filter and rejects another household or unrelated route',async()=>{
 const {inboxSelection}=await import('../web/ui/inbox-layout.js');
 assert.deepEqual(inboxSelection('/h/home/inbox/thread?view=waiting&sample=1','home','waiting'),{id:'thread'});
 assert.deepEqual(inboxSelection('/h/home/inbox?view=waiting','home','waiting'),{id:null});
 for(const href of ['//external.test/h/home/inbox/thread?view=waiting','/h/other/inbox/thread?view=waiting','/h/home/inbox/thread?view=all','/h/home/tasks/thread?view=waiting','/h/home/inbox/thread/extra?view=waiting','https://external.test/h/home/inbox/thread?view=waiting'])assert.equal(inboxSelection(href,'home','waiting'),null);
});
test('new reply detection ignores initial history, older pages, outbound mail and delivery-only updates',async()=>{
 const {messageUpdateState}=await import('../web/ui/reading-position.js');
 const row=(id,time,direction='inbound')=>({_id:id,_creationTime:time,direction});
 let state=messageUpdateState(null,[row('current',30)]);assert.deepEqual(state.newReplies,[]);
 state=messageUpdateState(state,[row('old',10),row('current',30)]);assert.deepEqual(state.newReplies,[]);
 state=messageUpdateState(state,[row('old',10),row('current',30),row('sent',31,'outbound')]);assert.deepEqual(state.newReplies,[]);
 const rows=[row('current',30),row('sent',31,'outbound'),row('reply',32)];
 state=messageUpdateState(state,rows);assert.deepEqual(state.newReplies,['reply']);
 state=messageUpdateState(state,rows);assert.deepEqual(state.newReplies,[]);
});

test('mail controls require exact saved provider version and hide unsafe recovery on uncertain sends',async()=>{
 const {draftControls,canCorrectSend,draftSaveStatus}=await import('../web/ui/mail-state.js');
 const draft={state:'editable',version:2,providerDraftId:'provider',providerSyncedVersion:2};
 assert.deepEqual(draftControls(draft),{editable:true,ready:true,replace:true,generate:true});
 for(const change of [{providerDraftId:undefined},{providerSyncedVersion:1},{syncToken:'pending'},{state:'failed'},{correctionDraftId:'replacement'}])assert.equal(draftControls({...draft,...change}).ready,false);
 for(const state of ['approved','sending','sent','generating','deleted'])assert.equal(draftControls({...draft,state}).editable,false);
 for(const state of ['approved','sending','unknown','sent','failed'])assert.equal(draftControls(draft,{state}).replace,false);
 assert.equal(draftControls(draft,{state:'cancelled'}).replace,true);
 for(const state of ['approved','sending','unknown','cancelled'])assert.equal(canCorrectSend({state,delivery:'bounced',body:'Message'}),false);
 for(const state of ['sent','failed'])for(const delivery of ['bounced','rejected'])assert.equal(canCorrectSend({state,delivery,body:'Message'}),true);
 assert.equal(canCorrectSend({state:'sent',delivery:'bounced',body:''}),false);
 assert.equal(canCorrectSend({state:'sent',delivery:'bounced',body:'Message',correctionDraftId:'exists'}),false);
 assert.match(draftSaveStatus({...draft,state:'sending'},false),/confirmation/);
 assert.match(draftSaveStatus({...draft,correctionDraftId:'exists'},false),/original message is retained/);
});

test('history keeps since-acceptance categories in URLs and includes live events through household midnight',async()=>{
 const {historySelection,historyPath,historyArgs,activityUpdateState}=await import('../web/ui/history-state.js');
 const selection=historySelection('?view=since-acceptance&kind=coverage&days=7');
 assert.equal(historyPath(selection),'/history?view=since-acceptance&kind=coverage');
 assert.deepEqual(historyArgs('home',selection,0,'UTC'),{householdId:'home',kind:'coverage'});
 assert.deepEqual(historySelection('?days=900&kind=secret'),{since:false,days:30,kind:'all'});
 const now=Date.parse('2026-03-08T16:00Z');
 const args=historyArgs('home',{since:false,days:7,kind:'task'},now,'America/New_York');
 assert.equal(args.from,Date.parse('2026-03-02T05:00Z'));assert.equal(args.to,Date.parse('2026-03-09T04:00Z')-1);assert.ok(args.to>now);
 assert.deepEqual(historyArgs('home',{since:false,days:7,kind:'task'},now+60000,'America/New_York'),args);
 const initial=activityUpdateState(null,[{_id:'a',sequence:10}]);assert.deepEqual(initial.newIds,[]);
 const older=activityUpdateState(initial,[{_id:'a',sequence:10},{_id:'b',sequence:1}]);assert.deepEqual(older.newIds,[]);
 const fresh=activityUpdateState(older,[{_id:'new',sequence:11},{_id:'a',sequence:10}]);assert.deepEqual(fresh.newIds,['new']);
 assert.deepEqual(activityUpdateState(fresh,[{_id:'new',sequence:11,targetAvailable:false}]).newIds,[]);
});
test('history gives mail, source, consent, visit and proposal events readable descriptions',async()=>{
 const {activityTitle,activityText}=await import('../web/ui/activity-text.js');const ctx={household:{timezone:'UTC'},name:()=> 'Former member'};
 assert.equal(activityTitle({type:'mail.received'}),'Email received');assert.equal(activityTitle({type:'source.proposalsReady'}),'Source suggestions ready');
 assert.equal(activityText(ctx,'consent.changed','aiProcessing: withdrawn'),'AI processing: withdrawn');
 assert.match(activityText(ctx,'proposal.approve','startsAt: 1767268800000'),/^Start: Jan 1, 2026/);
 assert.equal(activityText(ctx,'visit.complete','completed; ride status unchanged'),'Visit completed. The ride responsibility is unchanged.');
 assert.equal(activityText(ctx,'thread.archive','archive'),'Conversation moved to the archive.');
 assert.equal(activityText(ctx,'recurrence.created','Task; local 09:00; UTC; weekdays 1,5'),'Task; local 09:00; UTC; Monday, Friday');
 assert.match(activityText(ctx,'contact.confirmed','Office: approved; send=true, receive=false, reply=true'),/Sending allowed · Receiving blocked · Replies allowed$/);
});

test('source extraction controls distinguish persisted progress, manual-only states and safe retries',async()=>{
 const {extractionState,proposalStatus}=await import('../web/ui/source-state.js');
 const base={source:{extractionState:'ready'},latestExtraction:null,extractionBlockedReason:null};
 assert.equal(extractionState({...base,latestExtraction:{state:'running'}}).canExtract,false);
 assert.equal(extractionState({...base,latestExtraction:{state:'failed',safeError:'MODEL_HTTP_429'}}).label,'Extraction failed');
 assert.doesNotMatch(extractionState({...base,latestExtraction:{state:'failed',safeError:'MODEL_HTTP_429'}}).detail,/MODEL_HTTP/);
 const waiting={...base,latestExtraction:{state:'failed',retryAt:2000}};
 assert.equal(extractionState(waiting,1000).label,'Extraction waiting');
 assert.equal(extractionState(waiting,1999).canExtract,false);
 assert.equal(extractionState(waiting,2000).canExtract,true);
 assert.equal(extractionState({...waiting,extractionBlockedReason:'AI processing is off.'},2000).canExtract,false);
 assert.equal(extractionState({...base,extractionBlockedReason:'AI processing is off.'}).canExtract,false);
 assert.equal(extractionState({...base,source:{extractionState:'processing'}}).canExtract,false);
 assert.equal(proposalStatus('?status=approved'),'approved');assert.equal(proposalStatus('?status=other'),'pending');
});
test('source review stops concurrent approvals without discarding edited values',async()=>{
 const {proposalReviewState}=await import('../web/ui/source-state.js');const original={version:1,status:'pending',field:'note',targetVersion:3},target={version:3,status:'open'};
 assert.equal(proposalReviewState(original,original,true,target,3).approvable,true);
 assert.equal(proposalReviewState(original,{...original,status:'approved',version:2},true,target,3).reviewable,false);
 assert.equal(proposalReviewState(original,original,false,target,3).reviewable,false);
 assert.equal(proposalReviewState(original,original,true,{...target,version:4},3).approvable,false);
 assert.equal(proposalReviewState(original,original,true,{...target,status:'done'},3).approvable,false);
 const unmatched={...original,targetVersion:null};
 assert.equal(proposalReviewState(unmatched,unmatched,true,{...target,version:4},3).approvable,false);
 assert.equal(proposalReviewState(unmatched,unmatched,true,{...target,version:4},4).approvable,true);
 const visit={...original,field:'startsAt'};assert.equal(proposalReviewState(visit,visit,true,{version:3,status:'upcoming'},3,true).approvable,false);
 assert.equal(proposalReviewState(visit,visit,true,{version:3,status:'upcoming'},3,true).reviewable,true);
});


test('export receipts expire independently of backend success and do not advertise cleanup for export failures',async()=>{
 const {privacyState}=await import('../web/ui/privacy-state.js');
 const job={kind:'export',state:'succeeded',expiresAt:1000};
 assert.equal(privacyState(job,999).ready,true);
 assert.deepEqual([privacyState(job,1000).ready,privacyState(job,1000).label,privacyState(job,1000).tone],[false,'Expired','neutral']);
 assert.equal(privacyState({...job,state:'failed'},1000).retry,false);
 assert.match(privacyState({...job,state:'failed'},999).detail,/export could not finish/);
 assert.equal(privacyState({...job,kind:'delete'},1000).label,'Completed');
 assert.match(privacyState({...job,kind:'delete'},1000).detail,/External copies cannot be recalled/);
});

test('coverage controls never imply a timed takeover and distinguish active owner corrections',async()=>{
 const {coverageControls}=await import('../web/ui/coverage-state.js');
 const block={_id:'block',state:'committed',plannedOwnerId:'maya',activeOwnerId:null,endsAt:2000};
 const maya={userId:'maya',isOwner:true,currentCoverageId:null},leo={userId:'leo',isOwner:false,currentCoverageId:null};
 assert.equal(coverageControls(block,maya,1000).start,true);
 assert.equal(coverageControls(block,leo,1000).start,false);
 const expired=coverageControls(block,maya,2000);assert.equal(expired.start,false);assert.match(expired.notice,/Edit the end time/);
 const conflict=coverageControls(block,{...maya,currentCoverageId:'other'},1000);assert.equal(conflict.start,false);assert.match(conflict.notice,/Another coverage block/);
 const active={...block,state:'active',activeOwnerId:'leo'};
 assert.equal(coverageControls(active,leo,3000).end,true);assert.equal(coverageControls(active,maya,3000).end,true);assert.equal(coverageControls(active,{...maya,isOwner:false},3000).end,false);
 assert.match(coverageControls(active,leo,3000).notice,/remains active/);
 for(const state of ['ended','cancelled']){const controls=coverageControls({...active,state},maya,3000);assert.equal(controls.closed,true);assert.equal(controls.start,false);assert.equal(controls.end,false);}
});

test('private downloads verify authentic bytes, retain one retry link, and revoke it on invalidation',async()=>{
 const {privateDownload}=await import('../web/ui/private-download.js');
 const bytes=new TextEncoder().encode('{"table":"visits","record":{"title":"Synthetic"}}\n').buffer;
 const sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
 const part={filename:'visits-000000.ndjson',bytes:bytes.byteLength,sha256};let allowed=true,checks=0,created=0;const revoked=[];
 const file=privateDownload({fetchPart:async()=>bytes,authorize:async checkedPart=>{assert.equal(checkedPart,part);checks++;},canUse:()=>allowed,createURL:blob=>{assert.equal(blob.size,bytes.byteLength);return 'blob:synthetic-'+(++created);},revokeURL:url=>revoked.push(url)});
 assert.deepEqual(await file.prepare(part),{url:'blob:synthetic-1',filename:part.filename});assert.equal(checks,1);
 await file.prepare(part);assert.deepEqual(revoked,['blob:synthetic-1']);
 file.clear();file.clear();assert.deepEqual(revoked,['blob:synthetic-1','blob:synthetic-2']);assert.equal(file.current,null);
 allowed=false;assert.equal(await file.prepare(part),null);assert.equal(created,2);
});

test('late export bytes and late authorization cannot restore an expired, disconnected or departed view',async()=>{
 const {privateDownload}=await import('../web/ui/private-download.js');
 const bytes=new TextEncoder().encode('{}\n').buffer,part={filename:'sample.ndjson',bytes:bytes.byteLength,sha256:Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex')};
 for(const stage of ['fetch','authorize']){
  let release,entered;const enteredStage=new Promise(resolve=>entered=resolve),pending=new Promise(resolve=>release=resolve);let created=0;
  const file=privateDownload({fetchPart:async()=>{if(stage==='fetch'){entered();await pending;}return bytes;},authorize:async()=>{if(stage==='authorize'){entered();await pending;}},canUse:()=>true,createURL:()=>{created++;return 'blob:test';},revokeURL:()=>{}});
  const preparing=file.prepare(part);await enteredStage;file.clear();release();assert.equal(await preparing,null);assert.equal(created,0);assert.equal(file.current,null);
 }
 let allowed=true,release;const blocked=new Promise(resolve=>release=resolve);
 const file=privateDownload({fetchPart:async()=>{await blocked;return bytes;},authorize:async()=>{throw Error('must not authorize stale bytes');},canUse:()=>allowed});
 const preparing=file.prepare(part);allowed=false;release();assert.equal(await preparing,null);
});

test('corrupt export data and revoked server access never produce a file link',async()=>{
 const {privateDownload}=await import('../web/ui/private-download.js');
 const bytes=new TextEncoder().encode('{}\n').buffer,part={filename:'sample.ndjson',bytes:bytes.byteLength,sha256:Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex')};
 const createURL=()=>{throw Error('unverified data exposed');};
 for(const input of [{...part,bytes:99},{...part,sha256:'0'.repeat(64)}]){
  const file=privateDownload({fetchPart:async()=>bytes,authorize:async()=>{},canUse:()=>true,createURL});
  await assert.rejects(file.prepare(input),/incomplete|verified/);assert.equal(file.current,null);
 }
 const file=privateDownload({fetchPart:async()=>bytes,authorize:async()=>{throw Error('Access revoked');},canUse:()=>true,createURL});
 await assert.rejects(file.prepare(part),/Access revoked/);assert.equal(file.current,null);
});

test('timezone review invalidates on ownership, household changes, due time and five-minute expiry',async()=>{
 const {timezonePreviewDeadline,timezonePreviewState}=await import('../web/ui/timezone-review.js');
 const preview={fromTimezone:'America/New_York',toTimezone:'America/Los_Angeles',materialRevision:3,previewedAt:1000,changes:[{oldDueAt:9000}]},household={ownerId:'owner',materialRevision:3};
 assert.equal(timezonePreviewDeadline(preview),9001);
 assert.equal(timezonePreviewState(preview,household,'owner',9000).valid,true);
 assert.match(timezonePreviewState(preview,household,'owner',9001).reason,/expired|became due/);
 assert.match(timezonePreviewState(preview,{...household,materialRevision:4},'owner',1000).reason,/Refresh/);
 assert.match(timezonePreviewState(preview,{...household,ownerId:'other'},'owner',1000).reason,/ownership/);
 assert.match(timezonePreviewState({...preview,toTimezone:preview.fromTimezone},household,'owner',1000).reason,/already/);
 assert.equal(timezonePreviewDeadline({...preview,changes:[]}),301001);
});


test('an offline form cannot queue its preparation query and save automatically on reconnect',async()=>{
 const {workspaceRequests}=await import('../web/ui/workspace-requests.js');
 const calls=[],ctx={alive:true,connected:false,household:{}};
 const requests=workspaceRequests(ctx,{query:async()=>{calls.push('date');return 123;},mutation:async()=>calls.push('save')});
 const save=async()=>{const dueAt=await requests.query('dates:resolveLocal',{});return requests.mutate('tasks:edit',{dueAt});};
 await assert.rejects(save(),e=>e.data.message.includes('Reconnect'));
 ctx.connected=true;await Promise.resolve();assert.deepEqual(calls,[]);
 await save();assert.deepEqual(calls,['date','save']);
});
test('bootstrap reads remain available before connection setup, but writes and inactive views do not',async()=>{
 const {workspaceRequests}=await import('../web/ui/workspace-requests.js');
 const calls=[],ctx={alive:true,connected:false};
 const client={query:async()=>{calls.push('read');return {};},mutation:async()=>calls.push('write'),action:async()=>calls.push('action')};
 const requests=workspaceRequests(ctx,client);
 await requests.query('households:get',{});assert.deepEqual(calls,['read']);
 await assert.rejects(requests.mutate('tasks:edit',{}));await assert.rejects(requests.action('model:generate',{}));
 ctx.household={};await assert.rejects(requests.query('dates:resolveLocal',{}));
 ctx.connected=true;ctx.alive=false;
 for(const method of ['query','mutate','action'])await assert.rejects(requests[method]('anything',{}),e=>e.data.message.includes('no longer active'));
 assert.deepEqual(calls,['read']);
});

test('mailbox save progress and cancellation never imply provider success',async()=>{
 const {mailboxSaveState}=await import('../web/ui/mail-state.js');
 const base={editable:true,ready:false,blocker:null,state:null};
 for(const state of ['queued','running']){const result=mailboxSaveState({...base,state});assert.equal(result.pending,true);assert.equal(result.retry,false);}
 for(const state of ['failed','cancelled','needsReview']){const result=mailboxSaveState({...base,state});assert.equal(result.retry,true);assert.equal(result.tone,'error');assert.match(result.detail,/saved in Handoff/);}
 for(const blocker of ['emailPaused','mailboxUnavailable','senderNeedsReview'])assert.equal(mailboxSaveState({...base,blocker,state:'cancelled'}).retry,false);
 assert.equal(mailboxSaveState({...base,ready:true,state:'succeeded'}).tone,'success');
 assert.equal(mailboxSaveState({...base,editable:false}).detail,'');
});

test('public watch controls preserve capture meaning across paused, failed and unknown comparisons',async()=>{
 const {publicWatchState}=await import('../web/ui/source-state.js');
 assert.equal(publicWatchState({active:false,state:'ready',lastSuccessfulComparison:'changed'}).canCheck,false);
 assert.equal(publicWatchState({active:true,state:'processing'}).canCheck,false);
 const failed=publicWatchState({active:true,state:'failed',lastResult:'Request failed.'});assert.equal(failed.canCheck,true);assert.match(failed.detail,/Previous successful evidence is unchanged/);
 assert.match(publicWatchState({active:true,state:'ready',lastSuccessfulComparison:'unknown'}).detail,/comparison is unavailable/);
 assert.match(publicWatchState({active:true,state:'ready',lastSuccessfulComparison:'unchanged'}).detail,/No logistical change/);
});
