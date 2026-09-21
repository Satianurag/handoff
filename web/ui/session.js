import { watchPages } from './pagination.js';
import { $, esc, icon, link, skeleton, message, notice, bindActions, mayLeave, updateFormConnection } from './core.js';
export function scope(client) {
 let alive=true;const disposers=new Set();
 const add=fn=>{let active=true;const once=()=>{if(!active)return;active=false;disposers.delete(once);try{fn();}catch{console.error('A view resource could not be released. Remaining resources will still be closed.');}};disposers.add(once);return once;};
 return {get alive(){return alive;},add,dispose(){if(!alive)return;alive=false;for(const fn of [...disposers])fn();},
  watch(name,args,receive,error){return add(client.onUpdate(name,args,value=>{if(alive)receive(value);},err=>{if(alive)error?.(err);}));},
 };
}
export function paginated(ctx,root,name,args,render,{emptyText='Nothing here yet.',itemActions={},moreLabel='Load more'}={}){
 root.innerHTML=`<div class="ui-list-status"></div><div class="ui-list-rows">${skeleton()}</div><div class="ui-pager"><button class="ui-button secondary" type="button" hidden></button></div>`;
 const rowsRoot=$('.ui-list-rows',root),pager=$('.ui-pager',root),status=$('.ui-list-status',root);
 let disposed=false,first=true,lastRows=[],moreFocus=null;
 const action=$('button',pager);
 const pages=watchPages({watch:ctx.watch,name,args,receive:state=>{
  if(disposed)return;
  if(state.rows.length||state.status==='done'||state.status==='more'){render(rowsRoot,state.rows,emptyText);first=false;}
  if(state.status==='error'){if(first)rowsRoot.innerHTML='';notice(status,message(state.error));}
  else if(first&&state.status==='loading'){rowsRoot.innerHTML=skeleton();status.innerHTML='';}
  else status.innerHTML=state.status==='loading'&&!first?'<p class="ui-hint" role="status">Updating this list…</p>':'';
  const loading=state.status==='loading',available=state.status==='more'||state.status==='error'||loading&&!first;
  const keepsFocus=document.activeElement===action;
  action.hidden=!available;
  action.setAttribute('aria-disabled',String(loading));
  action.textContent=state.status==='error'?'Reload list':loading?'Loading…':moreLabel;
  action.onclick=()=>{
   if(loading)return;
   moreFocus={ids:new Set(lastRows.map(row=>row._id))};
   if(state.status==='error')pages.retry();else pages.loadMore();
  };
  if(moreFocus&&!loading){
   if(keepsFocus&&state.status!=='error'){
    const index=state.rows.findIndex(row=>!moreFocus.ids.has(row._id));
    const row=index<0?null:rowsRoot.querySelector(`[data-key="${CSS.escape(state.rows[index]._id)}"]`)||rowsRoot.children[index];
    const target=row?.querySelector('a[href]:not([aria-disabled="true"]),button:not(:disabled):not([aria-disabled="true"]),[tabindex]:not([aria-disabled="true"])')||row;
    if(target){if(!target.matches('a[href],button,[tabindex]'))target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'nearest'});}
    else if(!available){action.hidden=false;action.textContent='All items loaded';action.setAttribute('aria-disabled','true');action.onclick=null;}
   }
   moreFocus=null;
  }
  lastRows=state.rows;
 }});
 bindActions(rowsRoot,itemActions);
 const dispose=()=>{if(disposed)return;disposed=true;pages.dispose();};const registered=ctx.add(dispose),stop=typeof registered==='function'?registered:dispose;stop.setArgs=args=>pages.setArgs(args);return stop;
}

export function navShell(ctx,active){
 const limited=ctx.accessPreset==='limited_helper';
 const nav=limited?[['my-responsibilities','My responsibilities']]:[['today','Today'],['plan','Care plan'],['records','Records'],['people','People'],['inbox','Inbox']];
 const utilities=limited?[]:[['care','Care essentials'],['places','Care locations'],['history','History'],['settings','Settings']];
 $('#app').innerHTML=`<div class="product-shell"><aside class="product-sidebar"><a href="/" class="wordmark">Handoff</a><a class="household-switch" href="/households?choose=1${ctx.auth.sampleSession?'&sample=1':''}" data-route><span class="ui-avatar">${esc(ctx.household.nickname.slice(0,1).toUpperCase())}</span><span>${esc(ctx.household.nickname)}<small>${limited?'Limited helper access':'Family care space'}</small></span>${icon('chevron')}</a><nav aria-label="Household">${nav.map(([id,label])=>`<a href="${ctx.path('/'+id)}" data-route ${active===id?'aria-current="page"':''}>${icon(id==='my-responsibilities'?'plan':id==='places'?'place':id)}<span>${label}</span></a>`).join('')}</nav><nav class="product-utilities" aria-label="Household settings">${utilities.map(([id,label])=>`<a href="${ctx.path('/'+id)}" data-route ${active===id?'aria-current="page"':''}>${icon(id==='my-responsibilities'?'plan':id==='places'?'place':id)}<span>${label}</span></a>`).join('')}<a href="/help" data-route>${icon('help')}<span>Help & guidance</span></a></nav><div class="product-account"><span class="ui-avatar small">${esc((ctx.viewer.displayName||'You').slice(0,1).toUpperCase())}</span><div><a class="row-title" aria-label="Your account" href="/account${ctx.auth.sampleSession?'?sample=1':''}" data-route><strong>${esc(ctx.viewer.displayName||'Your account')}</strong></a><button class="ui-text-button" data-action="signout">Sign out</button></div></div></aside><div class="product-body"><header class="product-topbar"><button class="icon-button nav-toggle" aria-label="Toggle navigation" data-action="menu">${icon('menu')}</button><span>${esc(ctx.household.nickname)}’s household</span><div><span class="connection" id="app-connection">Connecting…</span>${limited?'':`<a class="icon-button notification-bell" aria-label="Notifications" href="${ctx.path('/notifications')}" data-route>${icon('bell')}<span class="notification-count" hidden></span></a>`}</div></header><div id="app-connection-notice"></div>${ctx.household.mode==='demo'?'<div class="sample-banner">Fictional sample household · Real backend operations · Sample mail uses controlled inboxes.</div>':''}<main id="main" class="product-main"><div id="view-status"></div><div id="view">${skeleton()}</div></main></div></div><div class="ui-toast" role="status" aria-live="polite" hidden></div>`;
 const app=$('#app');const click=event=>{const a=event.target.closest('a[data-route]');if(a&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&event.button===0){event.preventDefault();ctx.go(a.getAttribute('href'));}};
 app.addEventListener('click',click);ctx.add(()=>app.removeEventListener('click',click));
 bindActions(app,{menu:()=>$('.product-sidebar').classList.toggle('expanded'),signout:async()=>{if(!await mayLeave())return;try{await ctx.auth.signOut();}catch{/* Auth adapter always clears local state and reports uncertainty. */}}});
 const connection=state=>{if(!ctx.alive)return;ctx.connected=navigator.onLine&&state.isWebSocketConnected;updateFormConnection(document,ctx.connected);$('#app-connection').textContent=ctx.connected?'Live updates':'Reconnecting…';$('#app-connection').classList.toggle('offline',!ctx.connected);$('#app-connection-notice').innerHTML=ctx.connected?'':'<div class="ui-notice attention" role="status">Connection interrupted. You can read this view; reconnect before saving changes.</div>';};
 ctx.add(ctx.auth.client.subscribeToConnectionState(connection));connection(ctx.auth.client.connectionState());
 const offline=()=>connection(ctx.auth.client.connectionState());window.addEventListener('offline',offline);window.addEventListener('online',offline);ctx.add(()=>{window.removeEventListener('offline',offline);window.removeEventListener('online',offline);});
}
export function header(ctx,title,subtitle='',actions=''){const view=ctx.viewRoot||$('#view');view.innerHTML=`<header class="product-heading"><div><h1>${esc(title)}</h1>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div><div class="ui-actions">${actions}</div></header><div ${ctx.viewRoot?'data-view-body':'id="view-body"'}></div>`;document.title=`${title} — Handoff`;const heading=$('h1',view);heading.tabIndex=-1;heading.focus({preventScroll:true});}
export function toast(text){const el=$('.ui-toast');if(!el)return;el.textContent=text;el.hidden=false;clearTimeout(el._timer);el._timer=setTimeout(()=>{el.hidden=true;},6000);}
