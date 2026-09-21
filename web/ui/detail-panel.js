import {icon,empty,notice,message,mayLeave} from './core.js';
import {notificationWatch} from './notification-navigation.js';
import {scope,toast} from './session.js';

export function detailTarget(href,householdId){
 const path=href.split('?')[0],match=path.match(/^\/h\/([a-z0-9]+)\/(tasks|visits|coverage)\/([a-z0-9]+)\/?$/);
 return match&&match[1]===householdId&&match[3]!=='new'?{kind:match[2],id:match[3]}:null;
}

// Keep the list and its subscriptions mounted. The dialog owns an independent
// query scope; only non-sensitive routes and the normal history index persist.
export function detailPanelRouter(ctx,renderers){
 const baseUrl=location.pathname+location.search,baseTitle=document.title,baseIndex=history.state?.handoffIndex;
 let dialog=null,detailLife=null,previousFocus=null,currentHref=null;
 function remove(restore=true){
  if(dialog)document.querySelectorAll('.ui-dialog').forEach(el=>{el.close();el.remove();});
  detailLife?.dispose();detailLife=null;currentHref=null;
  if(dialog){dialog.close();dialog.remove();dialog=null;}
  if(restore){document.title=baseTitle;if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});else document.querySelector('#view h1')?.focus({preventScroll:true});}
 }
 async function close(){
  if(!await mayLeave())return;
  document.querySelectorAll('form[data-dirty]').forEach(form=>form.dataset.dirty='');
  const index=history.state?.handoffIndex;
  if(Number.isInteger(baseIndex)&&Number.isInteger(index)&&index>baseIndex)history.go(baseIndex-index);
  else ctx.go(baseUrl,true);
 }
 function show(href,target){
  const first=!dialog;
  if(first){
   previousFocus=document.activeElement;dialog=document.createElement('dialog');dialog.className='ui-detail-panel';dialog.setAttribute('aria-label','Item details');
   dialog.innerHTML=`<div class="detail-panel-bar"><span>Details</span><button class="icon-button" type="button" aria-label="Close details">${icon('close')}</button></div><div class="detail-panel-content"><div data-panel-status></div><div data-detail-view></div></div>`;
   document.querySelector('#app').append(dialog);dialog.querySelector('[aria-label="Close details"]').onclick=close;
   dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.showModal();
  }
  detailLife?.dispose();detailLife=scope(ctx.auth.client);currentHref=href;
  const life=detailLife,child=Object.create(ctx),{alive,...bindings}=life;Object.assign(child,bindings,{viewRoot:dialog.querySelector('[data-detail-view]'),detailLists:null});
  Object.defineProperty(child,'alive',{get:()=>life.alive&&ctx.alive});
  child.watch=notificationWatch(child,life.watch,()=>toast('The item opened, but its notification could not be marked read. Try Mark read in Notifications.'));
  const status=dialog.querySelector('[data-panel-status]');status.innerHTML='';
  child.unavailable=()=>{if(!child.alive)return;life.dispose();child.viewRoot.innerHTML=empty('This item is unavailable.','It may have been removed or your access may have changed. Close this panel to return to your list.');};
  child.error=error=>{
   if(!child.alive)return;
   if(['NOT_FOUND','FORBIDDEN','UNAUTHENTICATED'].includes(error?.data?.code)){child.unavailable();return;}
   notice(status,message(error));
   if(child.viewRoot.querySelector('.ui-skeleton')){child.viewRoot.innerHTML=empty('Details could not be loaded.','Your list remains available behind this panel.');const retry=document.createElement('button');retry.className='ui-button secondary';retry.textContent='Try again';retry.onclick=()=>show(href,target);child.viewRoot.append(retry);}
  };
  try{renderers[target.kind](child,target.id);}catch(error){child.error(error);}
 }
 const dispose=()=>remove(false);ctx.add(dispose);
 return href=>{
  if(!ctx.alive)return false;
  if(href===baseUrl){if(dialog){remove();return true;}return false;}
  const target=detailTarget(href,ctx.id);if(!target)return false;
  if(href!==currentHref)show(href,target);return true;
 };
}
