import {$,esc,link,badge,empty,keyedRows,notice,message} from './core.js';
import {scope,paginated,toast} from './session.js';
import {notificationWatch} from './notification-navigation.js';
import {preserveReadingPosition} from './reading-position.js';

export function inboxSelection(href,householdId,filter){
 if(!href.startsWith('/')||href.startsWith('//'))return null;
 const url=new URL(href,'https://handoff.invalid'),parts=url.pathname.split('/');
 if(parts.length<4||parts.length>5||parts[1]!=='h'||parts[2]!==householdId||parts[3]!=='inbox'||(url.searchParams.get('view')||'new')!==filter)return null;
 return {id:parts[4]||null};
}
export function mountInboxSplit(ctx,root,{filter,threadId,renderThread,threadLabel,formatDate}){
 root.innerHTML=`<div class="inbox-split"><section class="inbox-conversations" aria-label="Conversations" data-reading-scroll><div data-conversation-list></div></section><section class="inbox-reading" aria-label="Selected conversation" data-reading-scroll><div data-conversation-status></div><div data-conversation-detail></div></section></div>`;
 const list=$('[data-conversation-list]',root),detail=$('[data-conversation-detail]',root),reading=$('.inbox-reading',root),split=$('.inbox-split',root),status=$('[data-conversation-status]',root);
 let selected=null,life=null;
 const listUrl=ctx.path('/inbox?view='+filter);
 const markSelected=()=>list.querySelectorAll('[data-thread]').forEach(a=>{if(a.dataset.thread===selected)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
 paginated(ctx,list,'inbox:list',{householdId:ctx.id,filter},(el,rows)=>preserveReadingPosition(list,()=>{
  if(!rows.length){el.innerHTML=empty('No conversations in this view.','Choose another view or write a reviewed question.');return;}
  if(!el.querySelector('[data-key]'))el.innerHTML='';
  keyedRows(el,rows,t=>`<a class="conversation-row" data-route data-thread="${t._id}" href="${esc(ctx.path('/inbox/'+t._id+'?view='+filter))}"><span class="row-title">${esc(t.subject||'Untitled conversation')}</span><span class="row-meta">${esc(formatDate(t.lastMessageAt,ctx.household.timezone))}</span><span class="row-meta">${badge(t.quarantined?'Sender needs review':threadLabel(t.state),t.quarantined?'attention':t.state==='replyReceived'?'review':'neutral')}${t.related?`<span>Linked ${esc(t.related.kind)}</span>`:''}</span></a>`);
  markSelected();
 }));
 function show(id){
  if(selected===id&&life?.alive)return;
  const previousId=selected;life?.dispose();life=null;selected=id;markSelected();status.innerHTML='';reading.scrollTop=0;split.classList.toggle('has-selection',!!id);
  if(!id){detail.innerHTML=empty('Choose a conversation.','Messages, reviewed changes and drafts stay together here.');document.title='Inbox — Handoff';if(previousId){const previous=list.querySelector(`[data-thread="${CSS.escape(previousId)}"]`);if(previous)previous.focus({preventScroll:true});else{list.parentElement.tabIndex=-1;list.parentElement.focus({preventScroll:true});}}return;}
  life=scope(ctx.auth.client);const active=life,child=Object.create(ctx),{alive,...bindings}=active;
  Object.assign(child,bindings,{viewRoot:detail,inboxListUrl:listUrl});Object.defineProperty(child,'alive',{get:()=>active.alive&&ctx.alive});
  child.watch=notificationWatch(child,active.watch,()=>toast('The conversation opened, but its notification could not be marked read. Try Mark read in Notifications.'));
  child.unavailable=()=>{if(!child.alive)return;active.dispose();detail.innerHTML=empty('This conversation is unavailable.','It may have been removed or your access may have changed.',link(listUrl,'Back to conversations','ui-button secondary'));};
  child.error=error=>{if(!child.alive)return;if(['NOT_FOUND','FORBIDDEN','UNAUTHENTICATED'].includes(error?.data?.code)){child.unavailable();return;}notice(status,message(error));if(detail.querySelector('.ui-skeleton')){detail.innerHTML=empty('Couldn’t open this conversation.','Your conversation list remains available.');const retry=document.createElement('button');retry.className='ui-button secondary';retry.textContent='Try again';retry.onclick=()=>{active.dispose();show(id);};detail.append(retry);}};
  try{renderThread(child,id);}catch(error){child.error(error);}
 }
 show(threadId||null);ctx.add(()=>life?.dispose());
 return href=>{const target=inboxSelection(href,ctx.id,filter);if(!target)return false;show(target.id);return true;};
}
