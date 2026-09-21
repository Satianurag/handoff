import { $,esc,button,modal,notice,message } from '../ui/core.js';
import { toast } from '../ui/session.js';
export function sampleActions(ctx){
 const banner=$('.sample-banner');if(!banner)return;
 banner.innerHTML=`<div class="sample-banner-heading"><span>Fictional sample household · Real backend operations · Mail goes only to controlled sample inboxes.</span>${button('Sample controls','sample-controls')}</div><div id="sample-controls" hidden><p>Try the same workflow from both people’s perspectives. Provider failures stay visible in the product.</p><div class="ui-actions">${button('Receive office message','sample-initial')}${button('Change public notice','sample-notice')}${button('Receive office reply','sample-reply')}${button('Open recipient role','sample-role')}${ctx.isOwner?button('Reset sample','sample-reset'):''}</div><div id="sample-status" role="status"></div><div id="sample-role-link"></div><div id="sample-public-link"></div></div>`;
 banner.onclick=async event=>{
  const b=event.target.closest('[data-action]');if(!b||b.getAttribute('aria-disabled')==='true')return;const op=b.dataset.action;
  if(op==='sample-controls'){
   const panel=$('#sample-controls');panel.hidden=!panel.hidden;b.setAttribute('aria-expanded',String(!panel.hidden));
   if(!panel.hidden&&!$('#sample-public-link').children.length){try{const url=await ctx.query('demoFixtures:url',{householdId:ctx.id});if(ctx.alive)$('#sample-public-link').innerHTML=`<p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open current public sample notice</a></p><p class="ui-hint">Use this URL as the sample visit’s public page. Capture it before changing the notice to compare the two versions.</p>`;}catch(error){if(ctx.alive)notice($('#sample-public-link'),message(error));}}
   return;
  }
  if(op==='sample-reset'){
   modal({ctx,title:'Reset this fictional household?',content:'<p>The current sample and its supported provider resources will be deleted. You can create the replacement only after cleanup succeeds. Your real account is unaffected.</p>',submit:'Reset sample',destructive:true,onSubmit:async()=>{const {cleanupJobId}=await ctx.action('demoTokens:reset',{householdId:ctx.id});ctx.go('/privacy-requests/'+cleanupJobId+'?sample=1&reset=1');}});return;
  }
  b.setAttribute('aria-disabled','true');b.setAttribute('aria-busy','true');
  try{
   if(op==='sample-role'){
    const token=await ctx.action('demoTokens:secondRoleLink',{householdId:ctx.id});if(!ctx.alive)return;
    $('#sample-role-link').innerHTML=`<p><a class="ui-button primary" href="/demo/join#${esc(token)}" target="_blank" rel="noopener noreferrer">Continue as Leo in a separate tab →</a></p><p class="ui-hint">This one-use link expires. Maya stays signed in here. Opening another role link replaces any unused link.</p>`;
    if(document.activeElement===b)$('#sample-role-link a').focus({preventScroll:true});
   }else if(op==='sample-notice'){
    await ctx.mutate('demoFixtures:change',{householdId:ctx.id,version:2});const url=await ctx.query('demoFixtures:url',{householdId:ctx.id});if(!ctx.alive)return;
    notice($('#sample-status'),'The synthetic public notice now says to use the west entrance. Check this public page from the sample visit to review the change. Add a public-page watch there first if none exists.','success');
    const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Open the public sample notice';$('#sample-status').append(a);
   }else{
    await ctx.action('mail:demoOfficeMessage',{householdId:ctx.id,scenario:op==='sample-initial'?'initial':'reply'});if(!ctx.alive)return;
    notice($('#sample-status'),'The controlled sample office submitted the message. Open Inbox to follow its actual arrival and review.','success');toast('Sample office message submitted.');
   }
  }catch(error){if(ctx.alive)notice($('#sample-status'),message(error));}finally{if(b.isConnected){b.removeAttribute('aria-disabled');b.removeAttribute('aria-busy');}}
 };
}
