import {esc,link,badge,empty,keyedRows,formatDate} from '../ui/core.js';
import {paginated,toast} from '../ui/session.js';
import {publicWatchState} from '../ui/source-state.js';

export function publicWatches(ctx,root,visitId){
 let rows=[],rowsRoot;const pending=new Set();
 function render(el,values){
  rows=values;rowsRoot=el;
  if(!rows.length){el.innerHTML=empty('No public page attached.','Add the official location page when it would help your household.');return;}
  if(!el.querySelector('[data-key]'))el.innerHTML='';
  keyedRows(el,rows,w=>{
   const state=publicWatchState(w),busy=pending.has(w._id);
   return `<div class="ui-list-row"><div class="row-main"><strong>${esc(new URL(w.url).hostname)}</strong><p class="ui-hint detail-prose">${esc(w.url)}</p><div class="row-meta">${badge(state.label,state.tone)}</div><p class="ui-hint">${esc(state.detail)}</p><p class="ui-hint">${w.lastAttemptAt?'Last check attempt '+esc(formatDate(w.lastAttemptAt,ctx.household.timezone)):'No check attempted yet.'}</p><p class="ui-hint">${w.lastSuccessfulCapturedAt!=null?'Last successful capture '+esc(formatDate(w.lastSuccessfulCapturedAt,ctx.household.timezone)):'No retained successful capture.'}</p>${w.sourceAvailable?link(ctx.path('/sources/'+w.lastSuccessfulSourceId),'View last successful source'):''}</div><div class="row-actions"><button class="ui-button secondary" type="button" data-action="check:${w._id}" aria-disabled="${busy||!state.canCheck}">${busy?'Updating…':w.state==='processing'?'Checking…':'Check now'}</button><button class="ui-button secondary" type="button" data-action="toggle:${w._id}" aria-disabled="${busy}">${w.active?'Pause':'Resume'}</button></div></div>`;
  });
 }
 const stop=paginated(ctx,root,'watches:forVisit',{visitId},render,{moreLabel:'Load more public pages'});
 root.onclick=async event=>{
  const b=event.target.closest('[data-action]');if(!b)return;event.stopPropagation();
  const [op,id]=b.dataset.action.split(':'),w=rows.find(row=>row._id===id);
  if(!w||pending.has(id)||b.getAttribute('aria-disabled')==='true'||!['check','toggle'].includes(op))return;
  pending.add(id);render(rowsRoot,rows);
  try{
   if(op==='check'){await ctx.action('web:checkNow',{watchId:id,requestId:crypto.randomUUID()});if(ctx.alive)toast('Public page check queued.');}
   else await ctx.mutate('watches:setActive',{watchId:id,expectedVersion:w.version,active:!w.active});
  }catch(error){if(ctx.alive)ctx.error(error);}finally{pending.delete(id);if(ctx.alive&&rowsRoot?.isConnected)render(rowsRoot,rows);}
 };
 return stop;
}
