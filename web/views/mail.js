import {emailImport} from './records.js';
import {followUpEvidence} from './care.js';
import {privateMailSection} from '../ui/private-section.js';
import {draftControls,canCorrectSend,draftSaveStatus,mailboxSaveState} from '../ui/mail-state.js';
import {mountInboxSplit} from '../ui/inbox-layout.js';
import {preserveReadingPosition,messageUpdateState} from '../ui/reading-position.js';
import { $,esc,link,button,badge,empty,skeleton,field,area,select,modal,formatDate,wireForm,allPages,notice,keyedRows,mayLeave,preserveFocus } from '../ui/core.js';
import { header,paginated,toast } from '../ui/session.js';
import { mailStatus,contactForm } from './settings.js';
const threadLabel=state=>({new:'New',waiting:'Waiting for reply',replyReceived:'Reply received',resolved:'Resolved'}[state]||state);
function inboxContent(ctx,threadId=null){header(ctx,'Inbox','One shared conversation, with every send reviewed.',link(ctx.path('/questions/new'),'New question','ui-button primary'));const requestedFilter=new URLSearchParams(location.search).get('view'),filter=threadId&&requestedFilter==='drafts'?'all':['new','waiting','drafts','all','archived','quarantine'].includes(requestedFilter)?requestedFilter:'new';$('#view-body').innerHTML=`<div id="inbox-connection"></div><nav class="ui-segments" aria-label="Inbox views">${[['new','New'],['waiting','Waiting'],['drafts','Drafts'],['all','All'],['archived','Archived'],['quarantine','Needs review']].map(([id,title])=>`<a data-route href="${ctx.path('/inbox?view='+id)}" ${filter===id?'aria-current="page"':''}>${title}</a>`).join('')}</nav><div id="inbox-list"></div>`;mailStatus(ctx,$('#inbox-connection'));
 if(filter==='drafts'){const root=$('#inbox-list');root.innerHTML=['generating','editable','failed','approved','sending','sent'].map(state=>`<section class="ui-section"><h2>${{generating:'Generating',editable:'Editing',failed:'Needs attention',approved:'Approved',sending:'Sending or awaiting confirmation',sent:'Sent'}[state]}</h2><div id="drafts-${state}"></div></section>`).join('');for(const state of ['generating','editable','failed','approved','sending','sent'])paginated(ctx,$('#drafts-'+state),'drafts:list',{householdId:ctx.id,state},(el,rows)=>{el.innerHTML=rows.length?rows.map(d=>`<div class="ui-list-row"><div class="row-main">${link(ctx.path('/drafts/'+d._id),d.subject,'row-title')}<div class="row-meta">To ${esc(d.recipient)} · ${esc(formatDate(d.updatedAt,ctx.household.timezone))}</div></div>${badge(d.state,d.state==='failed'?'error':'neutral')}</div>`).join(''):'<p class="ui-hint">No drafts in this state.</p>';});return;}
 return mountInboxSplit(ctx,$('#inbox-list'),{filter,threadId,renderThread:threadDetail,threadLabel,formatDate});
}
async function questionNewContent(ctx){header(ctx,'New question','Write a message yourself, or save your instruction and ask for a draft.',link(ctx.path('/inbox'),'← Inbox','ui-button secondary'));const root=$('#view-body');root.innerHTML=skeleton();const params=new URLSearchParams(location.search);try{
 const contacts=(await allPages(ctx,'contacts:list',{householdId:ctx.id,state:'approved'},201));const threadId=params.get('thread');const thread=threadId?await ctx.query('threads:get',{threadId}):null;const reply=threadId&&params.get('mode')==='reply'?await ctx.query('threads:replyContext',{threadId}):null;
 if(!ctx.alive)return;if(threadId&&params.get('mode')==='reply'&&!reply){root.innerHTML=empty('There is no retained sender to reply to.','Choose an approved contact explicitly to start a new question.',link(ctx.path('/questions/new'),'Write a new question','ui-button primary'));return;}const eligible=contacts.filter(c=>reply?c.allowReply&&c.email.toLowerCase()===reply.from.toLowerCase():c.allowSend);
 if(!eligible.length){root.innerHTML=empty('Confirm the recipient first.','Approve a contact and the correct send or reply permission before composing.',link(ctx.path('/settings?section=email'),'Open contacts','ui-button primary'));return;}
 let related=thread?.related??null;if(params.get('visit'))related={kind:'visit',id:params.get('visit')};if(params.get('task'))related={kind:'task',id:params.get('task')};
 const requestId=crypto.randomUUID();root.innerHTML=`<form id="question-form" class="detail-reading">${reply?`<div class="ui-notice attention">Replying to the actual sender: ${esc(reply.from)}. A forwarded office address is not substituted automatically.</div>`:''}${select('recipient','To',eligible.map(c=>[c.email,`${c.label} · ${c.email}`]),eligible[0].email)}${field('subject','Subject',thread?'Re: '+thread.subject:'','text','required maxlength="200"')}${area('body','Message or drafting instruction','','required maxlength="20000"')}<p class="ui-hint">Saving creates an unsent draft. You’ll review the exact final message and approve sending separately.</p><div class="ui-form-status"></div><button class="ui-button primary" type="submit">Save draft</button></form>`;
 wireForm(ctx,$('#question-form'),async d=>{const id=await ctx.mutate('drafts:create',{householdId:ctx.id,...(thread?{threadId:thread._id}:{}),related,recipient:d.get('recipient'),subject:d.get('subject'),body:d.get('body'),...(reply?{inReplyTo:reply.providerMessageId}:{}),sourceRefs:[],requestId});ctx.go(ctx.path('/drafts/'+id));});
 }catch(error){ctx.error(error);root.innerHTML='';}}
function draftDetailContent(ctx,id){
 header(ctx,'Message draft','Nothing is sent until you review and approve the exact message.',link(ctx.path('/inbox?view=drafts'),'← Drafts','ui-button secondary'));
 const outer=$('#view-body');outer.innerHTML='<div id="draft-mail-status"></div><div id="draft-sync-status"></div><div id="draft-body"></div>';mailStatus(ctx,$('#draft-mail-status'));
 const root=$('#draft-body');root.innerHTML=skeleton();let latest,stopSends,jobStop,version;
 const syncRoot=$('#draft-sync-status');let syncStatus,syncPending=false;
 function renderSync(){
  if(!syncStatus||!ctx.alive)return;
  const state=mailboxSaveState(syncStatus),pending=syncPending||state.pending;
  preserveFocus(syncRoot,()=>{syncRoot.innerHTML=state.detail?`<div class="ui-notice ${state.tone}"><p role="status">${esc(state.detail)}</p>${syncStatus.blocker?link(ctx.path(syncStatus.blocker==='senderNeedsReview'&&syncStatus.threadId?'/inbox/'+syncStatus.threadId:'/settings?section='+(syncStatus.blocker==='emailPaused'?'sharing':'email')),'Open '+(syncStatus.blocker==='senderNeedsReview'?'conversation':'email settings'),'ui-button secondary'):state.retry||pending?`<button class="ui-button secondary" type="button" data-action="retry-draft-sync" aria-disabled="${pending}" aria-busy="${pending}">${pending?'Saving to mailbox…':'Retry mailbox save'}</button>`:''}</div>`:'';});
 }
 syncRoot.onclick=async event=>{
  const b=event.target.closest('[data-action="retry-draft-sync"]');if(!b||!syncStatus||syncPending||!mailboxSaveState(syncStatus).retry)return;
  syncPending=true;renderSync();
  try{await ctx.action('mail:syncDraft',{draftId:id});}catch(error){ctx.error(error);}finally{syncPending=false;if(ctx.alive)renderSync();}
 };
 ctx.watch('drafts:mailboxStatus',{draftId:id},value=>{syncStatus=value;renderSync();},()=>{syncStatus=null;preserveFocus(syncRoot,()=>{syncRoot.innerHTML='';});});

 const render=result=>{
  latest=result;
  const previous=$('#draft-form',root),busy=previous?.getAttribute('aria-busy')==='true';
  if(previous&&(previous.dataset.dirty==='true'||busy)){
   if(result.kind==='replaced'||result.draft.version!==version||result.draft.correctionDraftId){
    const status=$('#draft-conflict',root);status.innerHTML='<div class="ui-notice attention" role="status">This draft changed elsewhere. Your unsaved text is preserved. '+button('Review saved version','reload-draft')+'</div>';
   }
   $('[data-action="review-send"]',root)?.setAttribute('disabled','');return;
  }
  stopSends?.();stopSends=null;
  if(result.kind==='replaced'){root.innerHTML=empty('This draft was replaced.','The replacement contains the saved message and its new recipient.',link(ctx.path('/drafts/'+result.replacementId),'Open replacement draft','ui-button primary'));return;}
  const d=result.draft;if(d.householdId!==ctx.id)return ctx.unavailable();version=d.version;
  const {editable,ready,replace,generate}=draftControls(d,result.latestSend);
  root.innerHTML=`<article class="detail-reading"><div class="ui-section-heading"><h2>To ${esc(d.recipient)}</h2>${badge(d.state,d.state==='failed'?'error':'neutral')}</div><p class="ui-hint">${esc(draftSaveStatus(d,ready))}</p>${d.correctionDraftId?link(ctx.path('/drafts/'+d.correctionDraftId),'Open corrected draft','ui-button primary'):''}${d.correctsSendIntentId?`<p>${link(ctx.path('/sends/'+d.correctsSendIntentId),'View original send receipt')}</p>`:''}${d.replacementCleanupJobId&&d.recoveryRequestedBy===ctx.viewer.id?`<p class="ui-hint">The previous unsent draft was retired. ${link('/privacy-requests/'+d.replacementCleanupJobId+(ctx.auth.sampleSession?'?sample=1':''),'Check provider cleanup')}</p>`:''}<div id="draft-conflict"></div><div id="draft-job"></div><form id="draft-form">${field('subject','Subject',d.subject,'text',`required maxlength="200" ${editable?'':'readonly'}`)}${area('body','Message',d.body,`required maxlength="20000" ${editable?'':'readonly'}`)}<div class="ui-form-status"></div><div class="ui-actions">${editable?'<button class="ui-button secondary" type="submit">Save changes</button>'+(replace?button('Change recipient','replace'):result.latestSend?link(ctx.path('/sends/'+result.latestSend._id),'Correct from send receipt','ui-button secondary'):'')+(generate?button('Generate draft','generate'):'')+`<button class="ui-button primary" type="button" data-action="review-send" ${!ready?'disabled':''}>Review before sending</button>`:''}${editable?button('Discard draft','discard'):''}</div></form><section class="detail-card"><h2>Sources</h2>${d.sourceRefs.length?d.sourceRefs.map(r=>`<blockquote class="source-quote">${esc(r.quote)}</blockquote>${link(ctx.path('/sources/'+r.sourceId),'Inspect source')}`).join(''):'<p>No external quotes attached. Review all factual claims before sending.</p>'}</section><section class="detail-card"><h2>Send history</h2><div id="draft-sends"></div></section></article>`;
  const form=$('#draft-form',root);
  form.addEventListener('input',()=>{$('[data-action="review-send"]',root)?.setAttribute('disabled','');});
  form.addEventListener('handoff:form-idle',()=>{if(ctx.alive&&form.isConnected&&form.dataset.dirty!=='true'&&latest)render(latest);});
  wireForm(ctx,form,async data=>{if(!editable)return;await ctx.mutate('drafts:edit',{draftId:id,expectedVersion:d.version,subject:data.get('subject'),body:data.get('body'),sourceRefs:d.sourceRefs});form.dataset.dirty='';toast('Draft saved.');ctx.go(ctx.path('/drafts/'+id));});
  stopSends=paginated(ctx,$('#draft-sends',root),'sendIntents:forDraft',{draftId:id},(el,rows)=>{el.innerHTML=rows.length?rows.map(s=>`<div class="ui-list-row"><div class="row-main">${link(ctx.path('/sends/'+s._id),s.state==='unknown'?'Send outcome needs confirmation':'Send '+s.state,'row-title')}<div class="row-meta">${esc(formatDate(s.createdAt,ctx.household.timezone))} · Delivery ${esc(s.delivery)}</div></div></div>`).join(''):'<p>No approved send yet.</p>';});
  root.onclick=async event=>{
   const b=event.target.closest('[data-action]');if(!b)return;const op=b.dataset.action;
   if(op==='reload-draft'){if(await mayLeave()){form.dataset.dirty='';render(latest);}return;}
   if(form.dataset.dirty==='true'&&['review-send','generate'].includes(op)){notice($('.ui-form-status',form),'Save your edits before continuing.');return;}
   if(op==='replace'){b.disabled=true;try{const data=new FormData(form);await recreateDraft(ctx,d,{subject:data.get('subject'),body:data.get('body'),form,trigger:b});}finally{if(b.isConnected)b.disabled=false;}return;}
   if(op==='review-send'){await sendReview(ctx,d);return;}
   if(op==='discard'){modal({ctx,title:'Discard unsent draft?',content:'<p>This removes the unsent draft, including any unsaved changes, from Handoff and its supported email provider. You can follow the deletion receipt.</p>',submit:'Discard draft',destructive:true,onSubmit:async()=>{const jobId=await ctx.mutate('drafts:discard',{draftId:id,expectedVersion:d.version});form.dataset.dirty='';ctx.go('/privacy-requests/'+jobId+(ctx.auth.sampleSession?'?sample=1':''));}});return;}
   if(op==='generate'){modal({ctx,title:'Draft a clearer question',content:area('instruction','What should the message ask?',d.body,'required maxlength="2000"')+'<p>Your saved text is used as context. Review the generated result before sending.</p>',submit:'Generate draft',onSubmit:async data=>{const jobId=await ctx.action('generate:draftQuestion',{draftId:id,expectedVersion:d.version,instruction:data.get('instruction')});jobStop?.();jobStop=ctx.watch('jobs:get',{jobId},job=>{const status=$('#draft-job');if(status)notice(status,job.state==='succeeded'?'Draft generated. Review every detail before sending.':job.state==='failed'?(job.safeError||'Generation failed; your saved draft is preserved.'):'Draft generation is '+job.state,job.state==='failed'?'error':'attention');});}});return;}
  };
 };
 ctx.watch('drafts:view',{draftId:id},render,error=>{
  ctx.error(error);stopSends?.();stopSends=null;
  const form=$('#draft-form',root);
  if(form&&(form.dataset.dirty==='true'||form.getAttribute('aria-busy')==='true')){
   notice($('#draft-conflict',root),'This draft is unavailable. Your unsaved text is still here; return to Drafts after copying anything you need.');
   form.querySelectorAll('button').forEach(b=>b.disabled=true);return;
  }
  preserveFocus(root,()=>{root.innerHTML=empty('Draft unavailable.','It may have been removed or your access may have changed.',link(ctx.path('/inbox?view=drafts'),'Back to drafts','ui-button secondary'));});
 });
 ctx.add(()=>{stopSends?.();jobStop?.();});
}
async function recreateDraft(ctx,draft,{sendIntent=null,subject=draft.subject,body=draft.body,form=null,trigger=null}={}){
 try{
  const contacts=(await allPages(ctx,'contacts:list',{householdId:ctx.id,state:'approved'},201)).filter(c=>c.allowSend&&(sendIntent||c.email!==draft.recipient));
  if(!ctx.alive)return;
  if(!contacts.length){modal({ctx,returnFocus:trigger,title:'Approve a recipient first',content:'<p>A new message needs an approved contact with permission to send.</p>'+link(ctx.path('/settings?section=email'),'Review approved contacts'),submit:null});return;}
  let lastPayload='',requestId='';
  modal({ctx,returnFocus:trigger,title:sendIntent?'Correct failed delivery':'Change recipient',content:`<p>${sendIntent?'The original send receipt stays in your history.':'Your current subject and text will be saved in a replacement draft. The previous unsent draft will be retired and queued for provider cleanup.'} This starts a new email and requires a separate send approval.</p><p class="ui-hint">Previous recipient: ${esc(draft.recipient)}</p>${select('recipient','New recipient',contacts.map(c=>[c.email,`${c.label} · ${c.email}`]),contacts[0].email)}${field('subject','Subject',subject,'text','required maxlength="200"')}${area('body','Message',body,'required maxlength="20000"')}${!sendIntent?'<label class="ui-check"><input type="checkbox" required><span>Replace the old unsent draft with this message.</span></label>':''}`,submit:sendIntent?'Create corrected draft':'Replace draft',onSubmit:async data=>{
   const input={draftId:draft._id,expectedVersion:draft.version,...(sendIntent?{sendIntentId:sendIntent._id}:{}),recipient:data.get('recipient'),subject:data.get('subject'),body:data.get('body')},payload=JSON.stringify(input);
   if(payload!==lastPayload){requestId=crypto.randomUUID();lastPayload=payload;}
   const id=await ctx.mutate('drafts:recreate',{...input,requestId});if(form)form.dataset.dirty='';ctx.go(ctx.path('/drafts/'+id));
  }});
 }catch(error){ctx.error(error);}
}
async function sendReview(ctx,draft){try{const connection=await ctx.query('inbox:connection',{householdId:ctx.id});if(!ctx.alive)return;const logicalSendId=`ui-${draft._id}-${draft.version}-${ctx.viewer.id}`;modal({ctx,title:'Review & approve this email',content:`<dl class="detail-facts"><dt>From</dt><dd>${esc(connection?.address||'Household mailbox unavailable')}</dd><dt>To</dt><dd>${esc(draft.recipient)}</dd><dt>Subject</dt><dd>${esc(draft.subject)}</dd></dl><div class="detail-card"><p class="detail-prose">${esc(draft.body)}</p></div><label class="ui-check"><input type="checkbox" required><span>I reviewed this exact recipient and message and approve sending it.</span></label><p class="ui-hint">Once sending starts, this email cannot be recalled. Delivery is tracked separately.</p>`,submit:'Approve & send',onSubmit:async()=>{const sendIntentId=await ctx.mutate('drafts:approveSend',{draftId:draft._id,expectedVersion:draft.version,expectedHash:draft.contentHash,logicalSendId});ctx.go(ctx.path('/sends/'+sendIntentId));}});}catch(e){ctx.error(e);}}
function sendDetailContent(ctx,id){
 header(ctx,'Send receipt','Approval, sending and delivery are distinct steps.',link(ctx.path('/inbox?view=drafts'),'← Drafts','ui-button secondary'));
 const root=$('#view-body');root.innerHTML=skeleton();
 ctx.watch('sendIntents:get',{sendIntentId:id},s=>{
  if(s.householdId!==ctx.id)return ctx.unavailable();
  root.innerHTML=`<article class="detail-reading"><div class="ui-actions">${badge(s.state,s.state==='unknown'?'attention':s.state==='sent'?'success':'neutral')}${badge('Delivery: '+s.delivery,s.delivery==='bounced'||s.delivery==='rejected'?'error':'neutral')}</div>${s.state==='unknown'?'<div class="ui-notice attention">The provider may have accepted this email. Check its status; do not create another send to retry it.</div>':''}${s.lastError?`<div class="ui-notice error">${esc(s.lastError)}</div>`:''}<dl class="detail-facts"><dt>To</dt><dd>${esc(s.recipient)}</dd><dt>Subject</dt><dd>${esc(s.subject)}</dd><dt>Approved by</dt><dd>${esc(ctx.name(s.approvedBy))}</dd><dt>Approved at</dt><dd>${esc(formatDate(s.createdAt,ctx.household.timezone))}</dd></dl><p class="detail-prose">${esc(s.body||'The retained message body has been removed.')}</p><div class="ui-actions">${['unknown','sending'].includes(s.state)?button('Check provider status','reconcile','primary'):''}${s.state==='approved'&&s.attempts===0&&(s.approvedBy===ctx.viewer.id||ctx.household.ownerId===ctx.viewer.id)?button('Cancel approval','cancel'):''}${s.correctionDraftId?link(ctx.path('/drafts/'+s.correctionDraftId),'Open corrected draft','ui-button primary'):canCorrectSend(s)?button('Create corrected draft','correct','primary'):''}${link(ctx.path('/drafts/'+s.draftId),'Open draft','ui-button secondary')}</div><p class="ui-hint">Sent does not mean delivered. Delivered does not mean read.</p></article>`;
  root.onclick=async event=>{const b=event.target.closest('[data-action]');if(!b)return;b.disabled=true;try{
   if(b.dataset.action==='reconcile'){await ctx.action('mail:reconcile',{sendIntentId:id});toast('Provider status checked. The receipt shows the latest known result.');}
   else if(b.dataset.action==='correct'){const draft=await ctx.query('drafts:get',{draftId:s.draftId});if(ctx.alive)await recreateDraft(ctx,draft,{sendIntent:s,subject:s.subject,body:s.body,trigger:b});}
   else if(b.dataset.action==='cancel')await ctx.mutate('sendIntents:cancel',{sendIntentId:id});
  }catch(e){ctx.error(e);}finally{if(b.isConnected)b.disabled=false;}};
 },error=>{ctx.error(error);root.innerHTML=empty('Send receipt unavailable.','It may have expired or your access may have changed.',link(ctx.path('/inbox?view=drafts'),'Back to drafts','ui-button secondary'));});
}
function threadDetailContent(ctx,id){
 const $=(selector,root=ctx.viewRoot??document)=>root.querySelector(ctx.viewRoot&&selector==='#view-body'?'[data-view-body]':selector);
 header(ctx,'Conversation','Only approved details update your household plan.',link(ctx.inboxListUrl||ctx.path('/inbox'),'← Conversations','ui-button secondary'));
 const root=$('#view-body');root.innerHTML=skeleton();let latest,initialized=false,messageState=null,messages=[],replyIds=new Set();
 function renderMessage(m){return `<section class="message-card"><div class="ui-section-heading"><strong>${esc(m.direction==='inbound'?'From '+m.from:'To '+m.to.join(', '))}</strong>${badge(m.direction==='inbound'?'Received':m.delivery)}</div><p class="ui-hint">${esc(formatDate(m.occurredAt,ctx.household.timezone))}</p>${m.attachmentOnly?'<div class="ui-notice attention">This email contains attachments without supported text. Import the original attachment and review it before updating the plan.</div>':''}${m.truncated?'<p class="ui-hint">Text was truncated; some content is not shown.</p>':''}<div class="detail-prose">${esc(m.plaintext||'Original message text is no longer available.')}</div><div class="ui-actions">${m.sourceId?link(ctx.path('/sources/'+m.sourceId),'Source & suggestions','ui-button secondary'):''}${latest.quarantined&&m.direction==='inbound'?button('Review sender permissions','contact:'+m._id):''}</div></section>`;}
 function renderMessages(el,rows){
  messages=[...rows].sort((a,b)=>a.occurredAt-b.occurredAt||a._creationTime-b._creationTime||a._id.localeCompare(b._id));
  const next=messageUpdateState(messageState,rows);next.newReplies.forEach(id=>replyIds.add(id));messageState=next;
  const jump=$('[data-action="new-reply"]',root);jump.hidden=!replyIds.size;jump.textContent=replyIds.size===1?'New reply — View':`${replyIds.size} new replies — View`;
  preserveReadingPosition(root,()=>{if(!rows.length){el.innerHTML=empty('No retained messages.','The conversation may be waiting for mail or its originals may have expired.');return;}if(!el.querySelector('[data-key]'))el.innerHTML='';keyedRows(el,messages,renderMessage);});
 }
 ctx.watch('threads:get',{threadId:id},thread=>{
  if(thread.householdId!==ctx.id)return ctx.unavailable();latest=thread;
  if(!initialized){
   initialized=true;
   root.innerHTML=`<article class="conversation-article"><div data-thread-summary></div><div class="new-reply-bar" aria-live="polite"><button class="ui-button secondary" type="button" data-action="new-reply" hidden>New reply — View</button></div><section class="detail-card"><h2>Messages</h2><p class="ui-hint">Newest messages are loaded first, shown in time order. Load earlier messages for more context.</p><div data-thread-messages></div></section><section class="detail-card"><h2>Drafts</h2><div data-thread-drafts></div></section></article>`;
   paginated(ctx,$('[data-thread-messages]',root),'threads:recentMessages',{threadId:id},renderMessages,{moreLabel:'Load earlier messages'});
   paginated(ctx,$('[data-thread-drafts]',root),'drafts:forThreadPage',{threadId:id},(el,rows)=>preserveReadingPosition(root,()=>{if(!rows.length){el.innerHTML='<p>No saved drafts for this conversation.</p>';return;}if(!el.querySelector('[data-key]'))el.innerHTML='';keyedRows(el,rows,d=>`<div class="ui-list-row"><div class="row-main">${link(ctx.path('/drafts/'+d._id),d.subject,'row-title')}<div class="row-meta">${esc(formatDate(d.updatedAt,ctx.household.timezone))}</div></div>${badge(d.state)}</div>`);}));
  }
  preserveReadingPosition(root,()=>{
   $('[data-thread-summary]',root).innerHTML=`<div class="ui-section-heading"><h2>${esc(thread.subject||'Untitled conversation')}</h2>${badge(thread.quarantined?'Sender needs review':threadLabel(thread.state),thread.quarantined?'attention':'neutral')}</div>${thread.quarantined?'<div class="ui-notice attention">This sender is not approved. Review the actual sender and their permissions before releasing the conversation. Release does not approve extracted facts.</div>':''}${thread.related?`<p class="ui-hint">${link(ctx.path('/'+(thread.related.kind==='task'?'tasks':'visits')+'/'+thread.related.id),'Open linked '+(thread.related.kind==='task'?'responsibility':'visit')+' →')}</p>`:'<p class="ui-hint">Not matched to a responsibility or visit.</p>'}<div class="ui-actions">${!thread.quarantined?link(ctx.path('/questions/new?thread='+id+'&mode=reply'),'Reply to actual sender','ui-button primary'):button('Release for review','release')}${link(ctx.path('/questions/new'),'New question','ui-button secondary')}${button(thread.state==='resolved'?'Reopen':'Resolve',thread.state==='resolved'?'reopen':'resolve')}${button(thread.archived?'Unarchive':'Archive',thread.archived?'unarchive':'archive')}${button('Match responsibility or visit','match')}${!thread.quarantined?button(thread.followUpId?'Open waiting item':'Link waiting item',thread.followUpId?'waiting-open':'waiting-link')+button('Import attachments','attachments'):''}${thread.related?button('Detach match','detach'):''}${button('Delete conversation','delete')}</div>`;
   const el=$('[data-thread-messages] .ui-list-rows',root);if(messages.length)keyedRows(el,messages,renderMessage);
  });
 },ctx.error);
 root.onclick=event=>{
  const b=event.target.closest('[data-action]');if(!b||!latest)return;const op=b.dataset.action,thread=latest;
  if(op==='new-reply'){const last=messages.filter(m=>replyIds.has(m._id)).at(-1);if(last){const el=root.querySelector(`[data-key="${CSS.escape(last._id)}"]`);el?.scrollIntoView({block:'start',behavior:'instant'});if(el){el.tabIndex=-1;el.focus({preventScroll:true});}}replyIds.clear();b.hidden=true;return;}
  if(op.startsWith('contact:')){const m=messages.find(m=>m._id===op.split(':')[1]);if(m)contactForm(ctx,null,{email:m.from,label:m.from});return;}
  if(op==='waiting-open'){followUpEvidence(ctx,thread.followUpId);return;}
  if(op==='waiting-link'){matchWaiting(ctx,thread);return;}
  if(op==='attachments'){emailImport(ctx,{threadId:id,...(thread.followUpId?{followUpId:thread.followUpId}:{})});return;}
  if(op==='match'){matchThread(ctx,thread);return;}
  if(op==='delete'){const requestId=crypto.randomUUID();modal({ctx,title:'Delete conversation and original evidence?',content:'<p>Confirmed responsibilities remain. Original messages and their source evidence are removed from supported processors. External copies cannot be recalled.</p><label class="ui-check"><input type="checkbox" required><span>I understand this deletion is permanent.</span></label>',submit:'Delete conversation',destructive:true,onSubmit:async()=>{const jobId=await ctx.mutate('privacyJobs:deleteThread',{threadId:id,expectedVersion:thread.version,confirmed:true,requestId});ctx.go('/privacy-requests/'+jobId+(ctx.auth.sampleSession?'?sample=1':''));}});return;}
  if(!['release','detach','resolve','reopen','archive','unarchive'].includes(op))return;
  modal({ctx,title:{release:'Release this conversation for review?',detach:'Detach this conversation?',resolve:'Resolve this conversation?',reopen:'Reopen this conversation?',archive:'Archive this conversation?',unarchive:'Unarchive this conversation?'}[op],content:'<p>Confirmed responsibilities are unchanged. A new conversation match requires a fresh review of its suggestions.</p>',submit:'Confirm',onSubmit:async()=>{await ctx.mutate(op==='release'?'threads:releaseQuarantine':op==='detach'?'threads:attach':'threads:update',{threadId:id,expectedVersion:thread.version,...(op==='detach'?{related:null}:op==='release'?{}:{operation:op})});toast('Conversation updated.');}});
 };
}

async function matchThread(ctx,thread){try{const now=Date.now();const [tasks,visits]=await Promise.all([allPages(ctx,'tasks:list',{householdId:ctx.id,status:'open'},501),allPages(ctx,'visits:list',{householdId:ctx.id,status:'upcoming',from:Math.max(0,now-180*86400000),to:now+180*86400000},501)]);const choices=[...tasks.map(t=>['task:'+t._id,t.title]),...visits.map(v=>['visit:'+v._id,v.title])];modal({ctx,title:'Match conversation',content:select('target','Responsibility or visit',[['','Choose a match'],...choices],'')+'<p>Existing unreviewed suggestions are invalidated when the match changes. Review the new extraction before applying details.</p>',submit:'Save match',onSubmit:async d=>{const [kind,id]=d.get('target').split(':');if(!id)throw {data:{message:'Choose a responsibility or visit.'}};await ctx.mutate('threads:attach',{threadId:thread._id,expectedVersion:thread.version,related:{kind,id}});toast('Conversation matched.');}});}catch(e){ctx.error(e);}}

export function inbox(ctx,threadId=null){return privateMailSection(ctx,"Inbox",child=>inboxContent(child,threadId));}
export function questionNew(ctx){return privateMailSection(ctx,"New question",child=>questionNewContent(child));}
export function draftDetail(ctx,id){return privateMailSection(ctx,"Message draft",child=>draftDetailContent(child,id));}
export function sendDetail(ctx,id){return privateMailSection(ctx,"Send receipt",child=>sendDetailContent(child,id));}
export function threadDetail(ctx,id){return privateMailSection(ctx,"Conversation",child=>threadDetailContent(child,id));}

async function matchWaiting(ctx,thread){try{const lists=await Promise.all(['waiting','received'].map(status=>allPages(ctx,'care:listFollowUps',{householdId:ctx.id,status},501)));const rows=lists.flat();if(!ctx.alive)return;modal({ctx,title:'Link a waiting item',content:rows.length?select('followUpId','Waiting for',[['','Choose a waiting item'],...rows.map(f=>[f._id,f.title])],'')+'<p>Replies become new information. A person still reviews and closes the item. The responsibility or visit match is preserved.</p>':empty('No waiting items yet.','Add a waiting item under Care essentials, then link this conversation.'),submit:rows.length?'Link waiting item':null,onSubmit:async d=>{if(!d.get('followUpId'))throw {data:{message:'Choose a waiting item.'}};await ctx.mutate('followUpMail:linkThread',{threadId:thread._id,expectedVersion:thread.version,followUpId:d.get('followUpId')});toast('Conversation linked to waiting item.');}});}catch(error){ctx.error(error);}}
