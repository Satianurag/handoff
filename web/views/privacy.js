import { $,esc,link,button,badge,empty,skeleton,formatDate,notice,message,keyedRows } from '../ui/core.js';
import { scope,paginated } from '../ui/session.js';
import { preserveReadingPosition } from '../ui/reading-position.js';
import { privacyKinds,privacyState } from '../ui/privacy-state.js';
import { watchDeadline } from '../time.js';
import { privateFetch } from './records.js';
import { privateDownload } from '../ui/private-download.js';
export function mountPrivacy({auth,viewer,go,isCurrent}){
 const life=scope(auth.client),ctx={...life,get alive(){return life.alive&&isCurrent();},error:e=>{if(ctx.alive)notice($('#privacy-status'),message(e));}};
 const suffix=auth.sampleSession?'?sample=1':'',zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
 let current=null,partsStop,jobStop,deadlineStop,deadline,epoch=0,busy=false,connected=false;
 const downloads=new Set();
 const file=privateDownload({fetchPart:async part=>(await privateFetch({auth},{exportPartId:part._id})).arrayBuffer(),authorize:part=>auth.client.action('privacyExport:confirmDownload',{partId:part._id}),canUse:()=>ctx.alive&&connected&&!!current&&privacyState(current).ready});
 function clearFile(){file.clear();const ready=$('#prepared-export'),focused=ready?.contains(document.activeElement);if(ready)ready.innerHTML='';if(focused&&ctx.alive)$('h1',root).focus({preventScroll:true});}
 document.title='My data requests — Handoff';
 $('#app').innerHTML=`<main id="main" class="privacy-workspace"><header class="product-heading"><div><a class="wordmark" href="/">Handoff</a><h1 tabindex="-1">My data requests</h1><p>Private receipts for ${esc(viewer.displayName||'your account')}.</p></div>${link('/households'+suffix,'My households','ui-button secondary')}</header><div id="privacy-connection" role="status"></div><div id="privacy-status"></div><div id="privacy-content">${skeleton()}</div></main>`;
 const root=$('#app'),content=$('#privacy-content');$('h1',root).focus({preventScroll:true});
 const nav=e=>{const a=e.target.closest('[data-route]');if(a&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&e.button===0){e.preventDefault();go(a.getAttribute('href'));}};
 root.addEventListener('click',nav);ctx.add(()=>root.removeEventListener('click',nav));
 function controls(){
  if(!ctx.alive)return;
  root.querySelectorAll('[data-download]').forEach(b=>{b.disabled=!connected||!current||!privacyState(current).ready||downloads.size>0;});
  root.querySelectorAll('[data-action="retry"],[data-action="replacement"]').forEach(b=>{b.disabled=!connected||busy;});
 }
 const connection=()=>{if(!ctx.alive)return;connected=navigator.onLine&&auth.client.connectionState().isWebSocketConnected;if(!connected){clearFile();epoch++;downloads.clear();$('#privacy-status').innerHTML='';}$('#privacy-connection').innerHTML=connected?'':'<p class="ui-notice attention">Connection interrupted. Reconnect to download or retry a request.</p>';controls();};
 ctx.add(auth.client.subscribeToConnectionState(connection));window.addEventListener('online',connection);window.addEventListener('offline',connection);ctx.add(()=>{window.removeEventListener('online',connection);window.removeEventListener('offline',connection);});connection();
 function stopParts(){partsStop?.();partsStop=null;downloads.clear();clearFile();epoch++;if(ctx.alive)$('#privacy-status').innerHTML='';}
 function unavailable(error){
  const recoverFocus=content.contains(document.activeElement)||document.activeElement===document.body;
  current=null;stopParts();deadlineStop?.();deadlineStop=null;deadline=undefined;
  if(!ctx.alive)return;
  content.innerHTML=`${link('/privacy-requests'+suffix,'← All requests')}${empty('Request unavailable.','It may have expired, been removed, or no longer be accessible to this account.')}${button('Retry loading request','reload-request')}`;
  ctx.error(error);$('[data-action="reload-request"]',content).onclick=connect;
  if(recoverFocus)$('h1',root).focus({preventScroll:true});
 }
 async function download(part){
  if(!connected||!current||!privacyState(current).ready||downloads.size)return;
  const ticket=epoch;downloads.add(part._id);clearFile();controls();$('#privacy-status').innerHTML='<p role="status">Preparing your file…</p>';
  try{
   const prepared=await file.prepare(part);
   if(!prepared||!ctx.alive||ticket!==epoch)return;
   const ready=$('#prepared-export');
   ready.innerHTML=`<div class="ui-notice success"><strong>${esc(prepared.filename)}</strong><p role="status">File verified and ready. If it does not appear in your browser’s downloads, use Save file below.</p><div class="ui-actions"><a class="ui-button primary" href="${esc(prepared.url)}" download="${esc(prepared.filename)}">Save file</a>${button('Dismiss file','dismiss-file')}</div></div>`;
   const save=$('a',ready);
   save.onclick=event=>{if(!connected||!current||!privacyState(current).ready||!ctx.alive){event.preventDefault();clearFile();}};
   $('[data-action="dismiss-file"]',ready).onclick=()=>{clearFile();$('h1',root).focus({preventScroll:true});};
   $('#privacy-status').innerHTML='';
   // Keep the real attached link available instead of revoking it on a timer.
   // Browsers that block an asynchronous click can use the explicit Save link.
   save.click();
  }catch(error){if(ctx.alive&&ticket===epoch){if(error?.data?.code==='NOT_FOUND')unavailable(error);else ctx.error(error);}}
  finally{if(ticket===epoch){downloads.delete(part._id);controls();}}
 }
 function renderJob(){
  if(!current||!ctx.alive)return;
  const job=current,state=privacyState(job);let card=$('[data-receipt]',content);
  if(!card){content.innerHTML=`${link('/privacy-requests'+suffix,'← All requests')}<section class="detail-card" data-receipt></section><div id="prepared-export"></div><div id="export-parts"></div>`;card=$('[data-receipt]',content);}
  card.innerHTML=`<div class="ui-section-heading"><h2>${privacyKinds[job.kind]}</h2>${badge(state.label,state.tone)}</div><p role="status">${esc(state.detail)}</p><p class="ui-hint">Requested ${esc(formatDate(job.requestedAt,zone))}.${job.kind==='export'?' Expires '+esc(formatDate(job.expiresAt,zone))+'.':''}</p>${job.safeError?`<div class="ui-notice error">${esc(job.safeError)}</div>`:''}${job.processors.map(p=>`<div class="ui-list-row"><span class="row-main">${esc({agentmail:'Household email',convex:'Household records',workflow:'Background processing',storage:'Stored files'}[p.name]||'Data processor')}</span>${badge({queued:'Queued',running:'In progress',succeeded:'Completed',failed:'Needs attention'}[p.state]||p.state,p.state==='succeeded'?'success':p.state==='failed'?'error':'neutral')}</div>`).join('')}${state.retry?button('Retry request','retry','primary'):''}${auth.sampleSession&&job.kind==='delete'&&job.state==='succeeded'?'<div class="ui-notice success"><p>Sample cleanup completed. A replacement can now be created.</p>'+button('Create replacement sample','replacement','primary')+'</div>':''}`;
  for(const action of ['retry','replacement'])$(`[data-action="${action}"]`,card)?.addEventListener('click',async()=>{
   if(!connected||busy)return;busy=true;controls();const ticket=epoch;
   try{if(action==='retry')await auth.client.mutation('privacyJobs:retry',{privacyJobId:job._id});else{const householdId=await auth.client.action('demoTokens:completeReset',{cleanupJobId:job._id});if(ctx.alive&&ticket===epoch)go('/h/'+householdId+'/today?sample=1');}}catch(error){if(ctx.alive&&ticket===epoch)ctx.error(error);}finally{busy=false;controls();}
  });
  if(state.ready&&!partsStop){
   const partsCtx={...ctx,watch(name,args,receive,onError){return ctx.watch(name,args,receive,error=>{if(error?.data?.code==='NOT_FOUND')unavailable(error);else onError(error);});}};
   partsStop=paginated(partsCtx,$('#export-parts'),'privacyExportStore:parts',{privacyJobId:job._id},(el,rows)=>{
    preserveReadingPosition(el,()=>{if(!rows.length){el.innerHTML=empty('No export files are available.','If this completed request has expired or been removed, create a new export from household settings.');return;}if(!el.querySelector('[data-key]'))el.innerHTML='';keyedRows(el,rows,p=>`<div class="ui-list-row"><div class="row-main"><strong>${esc(p.filename)}</strong><div class="row-meta">${p.rows} ${p.rows===1?'record':'records'} · ${Math.ceil(p.bytes/1024)} KB</div></div><button class="ui-button secondary" type="button" data-download="${esc(p._id)}" aria-label="Download ${esc(p.filename)}">Download</button></div>`);});
    el.onclick=e=>{const b=e.target.closest('[data-download]'),part=b&&rows.find(p=>p._id===b.dataset.download);if(part)download(part);};controls();
   });
  }else if(!state.ready){const active=document.activeElement,parts=$('#export-parts');const moveFocus=parts?.contains(active);stopParts();if(parts)parts.innerHTML='';if(moveFocus)$('h1',root).focus({preventScroll:true});}
  controls();
 }
 const id=location.pathname.split('/')[2];
 function connect(){
  jobStop?.();stopParts();deadlineStop?.();deadlineStop=null;deadline=undefined;current=null;$('#privacy-status').innerHTML='';content.innerHTML=skeleton();
  jobStop=ctx.watch('privacyJobs:get',{privacyJobId:id},job=>{
   if(!ctx.alive)return;const recovering=!current;current=job;if(recovering)$('#privacy-status').innerHTML='';renderJob();
   if(job.kind==='export'&&deadline!==job.expiresAt){deadlineStop?.();deadline=job.expiresAt;deadlineStop=watchDeadline(deadline,expired=>{if(expired&&current)renderJob();});}
  },unavailable);
 }
 if(id)connect();
 else{
  let rows=[],listDeadline;
  function renderList(el){
   preserveReadingPosition(el,()=>{if(!rows.length){el.innerHTML=empty('No requests to show.','Exports and deletion receipts you requested appear here.');return;}if(!el.querySelector('[data-key]'))el.innerHTML='';keyedRows(el,rows,j=>{const state=privacyState(j);return `<div class="ui-list-row"><div class="row-main">${link('/privacy-requests/'+j._id+suffix,privacyKinds[j.kind],'row-title')}<div class="row-meta">Requested ${esc(formatDate(j.requestedAt,zone))}</div></div>${badge(state.label,state.tone)}</div>`;});});
   listDeadline?.();const next=Math.min(...rows.filter(j=>j.kind==='export'&&j.expiresAt>Date.now()).map(j=>j.expiresAt));if(Number.isFinite(next))listDeadline=watchDeadline(next,expired=>{if(expired&&ctx.alive)renderList(el);});
  }
  const listCtx={...ctx,watch(name,args,receive,onError){return ctx.watch(name,args,receive,error=>{if(ctx.alive){rows=[];const list=content.querySelector('.ui-list-rows');if(list)list.innerHTML='';}onError(error);});}};
  paginated(listCtx,content,'privacyJobs:listMine',{},(el,values)=>{rows=values;renderList(el);});ctx.add(()=>listDeadline?.());
 }
 return()=>{stopParts();deadlineStop?.();life.dispose();};
}
