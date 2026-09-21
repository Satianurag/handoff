import {historyKinds,historySelection,historyPath,historyArgs,activityUpdateState} from '../ui/history-state.js';
import {preserveReadingPosition} from '../ui/reading-position.js';
import {watchHouseholdClock} from '../time.js';
import {selectNotification} from '../ui/notification-navigation.js';
import { activityText } from '../ui/activity-text.js';
import { $,esc,link,button,badge,empty,select,field,formatDate,icon,notice,message,mayLeave,keyedRows,skeleton } from '../ui/core.js';
import { header,paginated,toast,scope } from '../ui/session.js';
export const entityPath=(ctx,target)=>target?ctx.path('/'+({task:'tasks',visit:'visits',coverage:'coverage',handover:'handovers',thread:'inbox',source:'sources'}[target.kind]||'today')+(target.kind==='household'?'':'/'+target.id)):ctx.path('/today');
export function historyView(ctx){
 header(ctx,'History','A shared record of changes, with clear attribution.');
 const root=$('#view-body'),selection=historySelection(location.search);
 root.innerHTML=`<nav class="ui-segments" aria-label="History views">${[[false,'Recent history'],[true,'Since my last handover']].map(([since,label])=>`<a data-route href="${esc(ctx.path(historyPath({...selection,since})))}" ${since===selection.since?'aria-current="page"':''}>${label}</a>`).join('')}</nav><form class="ui-toolbar" aria-label="History filters">${!selection.since?select('days','Date range',[['7','Last 7 days'],['30','Last 30 days'],['90','Last 90 days']],String(selection.days)):''}${select('kind','Related to',historyKinds,selection.kind)}</form><p class="ui-hint" data-baseline>${selection.since?'Finding your last accepted handover…':`Calendar days include today in ${esc(ctx.household.timezone)}.`}</p><p class="ui-hint">Completed operational history is retained for 90 days; active work can keep relevant context longer. Older removed entries are no longer available.</p><div class="history-update-bar"><button class="ui-button secondary" type="button" data-new-activity hidden></button><span class="sr-only" role="status" data-activity-announcement></span></div><div id="history-list"></div>`;
 const form=$('form',root),jump=$('[data-new-activity]',root),announcement=$('[data-activity-announcement]',root);
 form.onsubmit=event=>event.preventDefault();
 form.onchange=()=>ctx.go(ctx.path(historyPath({...selection,days:Number(form.elements.days?.value||selection.days),kind:form.elements.kind.value})));
 let state=null,pending=new Set(),baseline,firstNew=null,stop;
 const updateButton=()=>{jump.hidden=!pending.size;jump.textContent=pending.size===1?'Show new activity':`Show ${pending.size} new updates`;const text=pending.size?`${pending.size} new ${pending.size===1?'update is':'updates are'} available.`:'';if(announcement.textContent!==text)announcement.textContent=text;};
 const child=selection.since?{...ctx,watch:(name,args,receive,error)=>ctx.watch(name,args,value=>receive(value.result),error)}:ctx;
 const render=(el,rows)=>{
  const next=activityUpdateState(state,rows);state=next;next.newIds.forEach(id=>pending.add(id));
  const visible=new Set(rows.map(row=>row._id));pending=new Set([...pending].filter(id=>visible.has(id)));firstNew=rows.find(row=>pending.has(row._id))?._id;updateButton();
  preserveReadingPosition(el,()=>{
   if(!rows.length){el.innerHTML=empty('No activity in this view.','Try another category or date range. New changes will appear here automatically.');return;}
   if(!el.querySelector('[data-key]'))el.innerHTML='';
   keyedRows(el,rows,event=>{
    const title=ctx.eventTitle(event),detail=activityText(ctx,event.type,event.after),handoverId=event.handoverId||(event.entity.kind==='handover'?event.entity.id:null);
    const links=(event.sourceLinks||[]).map((source,index)=>source.available?link(ctx.path('/sources/'+source.sourceId),`Source${event.sourceLinks.length>1?' '+(index+1):''}`):'<span>Original source unavailable</span>');
    if(event.receiptAvailable&&handoverId)links.push(link(ctx.path('/handovers/'+handoverId),'Accepted receipt'));
    return `<article class="ui-list-row" tabindex="-1"><span class="ui-avatar small" aria-hidden="true">${esc(event.actorId?ctx.name(event.actorId).slice(0,1):'H')}</span><div class="row-main">${event.targetAvailable?link(entityPath(ctx,event.entity),title,'row-title'):`<span class="row-title">${esc(title)}</span>`}${detail?`<p class="activity-detail">${esc(detail)}</p>`:''}<div class="row-meta">${esc(event.actorId?ctx.name(event.actorId):'Handoff')} · ${esc(formatDate(event.timestamp,ctx.household.timezone))}</div>${!event.targetAvailable?'<p class="ui-hint">Related item unavailable or removed. This retained entry records the earlier change.</p>':''}${links.length?`<div class="row-meta">${links.join(' · ')}</div>`:''}</div></article>`;
   });
  });
 };
 let args=historyArgs(ctx.id,selection,Date.now(),ctx.household.timezone);
 const list=$('#history-list',root);
 const load=()=>{stop?.();state=null;pending.clear();updateButton();stop=paginated(child,list,selection.since?'history:sinceAcceptance':'history:list',args,render);};
 if(selection.since){
  let stopBaseline;
  const connect=()=>{
   stopBaseline?.();list.innerHTML=skeleton();
   stopBaseline=ctx.watch('history:acceptanceBaseline',{householdId:ctx.id},value=>{
    $('[data-baseline]',root).textContent=value.at===null?'You haven’t accepted a handover yet. Showing retained activity in this view.':`Changes after the handover you accepted ${formatDate(value.at,ctx.household.timezone)}.`;
    if(baseline!==value.sequence||!stop){baseline=value.sequence;args={...args,afterSequence:value.sequence};load();}
   },error=>{stop?.();stop=null;pending.clear();updateButton();$('[data-baseline]',root).textContent='Your handover baseline could not be loaded.';notice(list,message(error));list.insertAdjacentHTML('beforeend',button('Retry history','retry-history'));$('[data-action="retry-history"]',list).onclick=connect;});
  };connect();
 }else load();
 jump.onclick=()=>{const target=[...root.querySelectorAll('[data-key]')].find(el=>el.dataset.key===firstNew);if(!target)return;target.scrollIntoView({block:'start',behavior:'instant'});target.querySelector('article')?.focus({preventScroll:true});pending.clear();updateButton();};
 if(!selection.since)ctx.add(watchHouseholdClock(()=>ctx.household.timezone,now=>{const next=historyArgs(ctx.id,selection,now,ctx.household.timezone);if(next.from!==args.from||next.to!==args.to){args=next;stop.setArgs(args);}}));
}
const notificationTitle=n=>({
 'handover.incoming':'A handover is ready for your review',
 'assignment.requested':'You have a responsibility request',
 'handover.accepted':'Your handover was accepted',
 'task.due':'A responsibility is due',
 'mail.received':'A message has arrived',
 'mail.waiting':'A question is still waiting for a reply',
 'mail.deliveryFailure':'An email could not be delivered',
 'source.review':'Source changes are ready for your review',
 'task.unassigned':'A responsibility needs someone to take it',
 'assignment.overridden':'The household owner assigned you a responsibility',
 'handover.cancel':'A handover was cancelled',
 'handover.decline':'Your handover was declined',
}[n.type]||'Your household has an update');

function notificationList(ctx,root,{unreadOnly=false,close=()=>{},changeFilter}={}){
 root.innerHTML=`<div class="notification-tools"><nav class="ui-segments" aria-label="Notification views">${[['all','All'],['unread','Unread']].map(([id,label])=>`<button type="button" data-filter="${id}" aria-pressed="${(id==='unread')===unreadOnly}">${label}</button>`).join('')}</nav>${button('Mark all read','read-all')}</div><div data-notification-status></div><div data-notification-list></div>`;
 const status=$('[data-notification-status]',root),all=$('[data-action="read-all"]',root),busy=new Set();let stop,rows=[],readingAll=false;
 const render=(el,values)=>{
  const active=document.activeElement,focusedId=root.contains(active)?active.closest('[data-read]')?.dataset.read:null;
  const index=rows.findIndex(row=>row._id===focusedId);
  const nearby=focusedId?[focusedId,...rows.slice(index+1).map(row=>row._id),...rows.slice(0,index).reverse().map(row=>row._id)]:[];
  rows=values;
  preserveReadingPosition(el,()=>{
   if(!values.length){el.innerHTML=empty(unreadOnly?'You’re caught up.':'No notifications yet.',unreadOnly?'There are no unread updates for you.':'Requests, handovers and replies will appear here.');return;}
   if(!el.querySelector('[data-key]'))el.innerHTML='';
   keyedRows(el,values,n=>`<div class="ui-list-row notification-row ${n.readAt===null?'unread':''}"><div class="row-main"><a class="row-title" href="${esc(entityPath(ctx,n.target))}" data-notification="${n._id}">${esc(notificationTitle(n))}</a><div class="row-meta">${n.readAt===null?badge('Unread','review'):badge('Read')}<span>${esc(formatDate(n.createdAt,ctx.household.timezone))}</span></div></div>${n.readAt===null?`<button class="ui-button secondary" data-read="${n._id}" aria-disabled="${readingAll||busy.has(n._id)}">${busy.has(n._id)?'Saving…':'Mark read'}</button>`:''}</div>`);
  });
  // A pending acknowledgment stays focusable. When its control disappears,
  // continue at the same notification, the nearest remaining row, or the filter.
  if(focusedId&&!active.isConnected){
   const same=$(`[data-read="${CSS.escape(focusedId)}"]`,root);
   const nearbyLink=nearby.map(id=>$(`[data-notification="${CSS.escape(id)}"]`,root)).find(Boolean);
   (same||nearbyLink||$(`[data-filter="${unreadOnly?'unread':'all'}"]`,root))?.focus({preventScroll:true});
  }
 };
 function load(){stop?.();stop=paginated(ctx,$('[data-notification-list]',root),'notifications:list',{householdId:ctx.id,unreadOnly},render);}
 root.onclick=async event=>{
  const filter=event.target.closest('[data-filter]');
  if(filter){unreadOnly=filter.dataset.filter==='unread';root.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.filter==='unread')===unreadOnly)));changeFilter?.(unreadOnly);load();return;}
  const a=event.target.closest('[data-notification]');
  if(a){if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0)return;event.preventDefault();event.stopPropagation();const item=rows.find(n=>n._id===a.dataset.notification);if(!item||!await mayLeave()||!ctx.alive)return;const href=a.getAttribute('href');selectNotification(ctx,item,href);close();ctx.go(href);return;}
  const b=event.target.closest('[data-read]');if(!b||readingAll||busy.has(b.dataset.read))return;
  const id=b.dataset.read;busy.add(id);b.setAttribute('aria-disabled','true');b.textContent='Saving…';status.innerHTML='';
  try{await ctx.mutate('notifications:read',{notificationId:id});}catch(error){if(ctx.alive)notice(status,message(error));}finally{busy.delete(id);if(ctx.alive)render($('.ui-list-rows',root),rows);}
 };
 all.onclick=async()=>{
  if(readingAll)return;readingAll=true;all.setAttribute('aria-disabled','true');all.textContent='Marking read…';status.innerHTML='';root.querySelectorAll('[data-read]').forEach(b=>b.setAttribute('aria-disabled','true'));
  try{let result;do{result=await ctx.mutate('notifications:readAll',{householdId:ctx.id});}while(result.hasMore&&ctx.alive);if(ctx.alive)toast('Notifications marked read.');}
  catch(error){if(ctx.alive)notice(status,message(error));}
  finally{readingAll=false;if(ctx.alive){all.setAttribute('aria-disabled','false');all.textContent='Mark all read';render($('.ui-list-rows',root),rows);}}
 };
 load();
}
export function notifications(ctx){
 header(ctx,'Notifications','Updates meant for you.');
 notificationList(ctx,$('#view-body'),{unreadOnly:new URLSearchParams(location.search).get('view')==='unread',changeFilter:unread=>history.replaceState(history.state,'',ctx.path('/notifications'+(unread?'?view=unread':'')))});
}
export function notificationBell(ctx){
 const bell=$('.notification-bell'),count=$('.notification-count',bell);
 ctx.watch('notifications:unreadCount',{householdId:ctx.id},value=>{const label=value.capped?'99+':String(value.count);count.hidden=!value.count;count.textContent=label;bell.setAttribute('aria-label',value.count?`Notifications, ${label} unread`:'Notifications');bell.removeAttribute('title');},()=>{count.hidden=true;bell.setAttribute('aria-label','Notifications, unread count unavailable');bell.title='Open notifications to retry.';});
 let dialog,disposeSheet;
 bell.onclick=event=>{
  if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0)return;
  event.preventDefault();event.stopPropagation();if(dialog)return;
  const life=scope(ctx.auth.client),previous=document.activeElement;
  dialog=document.createElement('dialog');dialog.className='ui-detail-panel notification-sheet';dialog.dataset.readingScroll='';dialog.setAttribute('aria-label','Notifications');
  dialog.innerHTML=`<div class="detail-panel-bar"><span>Notifications</span><button class="icon-button" type="button" aria-label="Close notifications">${icon('close')}</button></div><div class="detail-panel-content"><h2>Updates for you</h2><p class="ui-hint">Opening this list leaves your unread updates untouched.</p><div data-notifications></div><p>${link(ctx.path('/notifications'),'Open notification history →')}</p></div>`;
  $('#app').append(dialog);
  const child=Object.create(ctx),{alive,...bindings}=life;Object.assign(child,bindings);Object.defineProperty(child,'alive',{get:()=>life.alive&&ctx.alive});
  const close=()=>disposeSheet?.();
  disposeSheet=ctx.add(()=>{life.dispose();dialog?.close();dialog?.remove();dialog=null;disposeSheet=null;if(previous?.isConnected)previous.focus({preventScroll:true});});
  $('[aria-label="Close notifications"]',dialog).onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  notificationList(child,$('[data-notifications]',dialog),{close});dialog.showModal();
 };
}
