import {$,link,field,skeleton,notice,message,wireForm,mayLeave} from '../ui/core.js';
import {scope} from '../ui/session.js';

export function mountAccount({auth,go,isCurrent}) {
 const life=scope(auth.client),suffix=auth.sampleSession?'?sample=1':'';
 const ctx={...life,get alive(){return life.alive&&isCurrent();},error:e=>{if(ctx.alive)notice($('#account-status'),message(e));}};
 document.title='Your account — Handoff';
 $('#app').innerHTML=`<main id="main" class="privacy-workspace"><header class="product-heading"><div><a class="wordmark" href="/">Handoff</a><h1 tabindex="-1">Your account</h1><p>Your name and sign-in details.</p></div>${link('/households?choose=1'+(auth.sampleSession?'&sample=1':''),'My households','ui-button secondary')}</header><div id="account-status"></div><div class="settings-layout"><nav aria-label="Account sections"><a href="/account${suffix}" data-route aria-current="page">Your profile</a>${link('/privacy-requests'+suffix,'Data requests')}${link('/help','Help & guidance')}</nav><section id="account-content">${skeleton()}</section></div></main>`;
 $('h1').focus({preventScroll:true});
 const root=$('#app');const navigate=e=>{const a=e.target.closest('a[data-route]');if(a&&e.button===0&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey){e.preventDefault();go(a.getAttribute('href'));}};
 root.addEventListener('click',navigate);ctx.add(()=>root.removeEventListener('click',navigate));
 let connected=false;
 const connection=state=>{connected=navigator.onLine&&state.isWebSocketConnected;const submit=$('#account-form [type="submit"]');if(submit&&!$('#account-form').hasAttribute('aria-busy'))submit.disabled=!connected;const status=$('#account-connection');if(status)status.textContent=connected?'':'Reconnect before saving. Your entries stay here.';};
 ctx.add(auth.client.subscribeToConnectionState(connection));connection(auth.client.connectionState());
 const online=()=>connection(auth.client.connectionState());window.addEventListener('online',online);window.addEventListener('offline',online);ctx.add(()=>{window.removeEventListener('online',online);window.removeEventListener('offline',online);});
 let mounted=false;
 ctx.watch('onboarding:viewer',{},viewer=>{
  if(!viewer){go('/sign-in');return;}
  if(mounted){const form=$('#account-form');if(!form.dataset.dirty&&!form.hasAttribute('aria-busy'))form.elements.displayName.value=viewer.displayName;return;}
  mounted=true;
  $('#account-content').innerHTML=`<h2>Your profile</h2><form id="account-form">${field('displayName','Display name',viewer.displayName,'text','required maxlength="80" autocomplete="name"')}<p class="ui-hint">This name appears to the people in your households.</p>${viewer.anonymous?'<div class="ui-notice">You’re using a fictional sample account. It has no verified sign-in email.</div>':field('email','Sign-in email',viewer.email||'','email','readonly')+`<p class="ui-hint">${viewer.verified?'Verified email.':'Email verification is incomplete.'} Your sign-in email is read-only here.</p>`}<p id="account-connection" class="ui-hint" role="status"></p><div class="ui-form-status" aria-live="polite"></div><button type="submit" class="ui-button primary">Save name</button></form><section class="detail-card"><h2>Your data</h2><p class="ui-hint">Exports and deletion requests belong to the household you choose. Deleting a household does not remove your sign-in account.</p>${link('/privacy-requests'+suffix,'View my data requests','ui-button secondary')}</section><section class="detail-card"><h2>This session</h2><p class="ui-hint">${viewer.anonymous?'Sign out of this sample role in this tab.':'Sign out of Handoff on this browser.'}</p><button class="ui-button secondary" id="account-signout">Sign out</button></section>`;
  connection(auth.client.connectionState());
  wireForm(ctx,$('#account-form'),async (data,form)=>{
   if(!connected)throw {data:{message:'Reconnect before saving. Your entries are still here.'}};
   await auth.client.mutation('team:setDisplayName',{displayName:data.get('displayName')});
   if(!ctx.alive)return;
   form.elements.displayName.value=String(data.get('displayName')).trim();
   form.querySelector('.ui-form-status').innerHTML='<p class="ui-notice success" role="status">Your name is saved.</p>';
  });
  $('#account-form').addEventListener('handoff:form-idle',()=>connection(auth.client.connectionState()));
  $('#account-signout').onclick=async()=>{if(!await mayLeave())return;try{await auth.signOut();}catch{/* The auth adapter clears private local state even if remote sign-out fails. */}};
 },error=>{if(!mounted)$('#account-content').innerHTML='<p class="ui-hint">Your profile could not be loaded.</p><button class="ui-button secondary" id="account-retry">Try again</button>';ctx.error(error);$('#account-retry')?.addEventListener('click',()=>go('/account'+suffix));});
 return()=>life.dispose();
}
