import { $,esc,link,button,badge,empty,skeleton,field,select,modal,formatDate,notice,replaceContent,bindActions } from '../ui/core.js';
import { header,paginated,toast,scope } from '../ui/session.js';
import { watchDeadline } from '../time.js';
import { taskList } from './work.js';

function editName(ctx){
 modal({ctx,title:'Your display name',content:field('name','Name',ctx.viewer.displayName,'text','required maxlength="80"'),onSubmit:async data=>{
  const name=data.get('name').trim();await ctx.mutate('team:setDisplayName',{displayName:name});ctx.viewer.displayName=name;toast('Name updated.');
 }});
}
export function invite(ctx){let invitation;const dialog=modal({ctx,title:'Invite someone you trust',content:field('email','Their email address','','email','required maxlength="254"')+select('accessPreset','Access to this household',[['care_circle','Care circle'],['limited_helper','Limited helper']],'care_circle')+'<p class="ui-hint"><strong>Care circle:</strong> shared plans, visits and household updates. Medical records and email require separate access.<br><strong>Limited helper:</strong> only their requested or accepted responsibilities, the travel details needed for them, and their own availability. You’ll receive a private link to share yourself.</p>',submit:'Create invitation',onSubmit:async data=>{invitation=await ctx.action('invites:create',{householdId:ctx.id,email:data.get('email'),accessPreset:data.get('accessPreset')});}});dialog.addEventListener('close',()=>{if(!invitation)return;const url=new URL('/join/'+invitation.token,location.origin).href;const result=modal({ctx,title:'Your invitation is ready',content:field('link','Private invitation link',url,'text','readonly')+`<p class="ui-hint">Expires ${esc(formatDate(invitation.expiresAt,ctx.household.timezone))}. Copy this link now; it cannot be shown again.</p>`+button('Copy invitation','copy'),submit:null,onSubmit:async()=>{}});$('[data-action="copy"]',result).onclick=async()=>{try{await navigator.clipboard.writeText(url);toast('Invitation link copied.');}catch{notice($('.ui-form-status',result),'Select the link and copy it manually.');}};});}

export function people(ctx,id){
 header(ctx,id?'Household member':'People','Share responsibility with people you trust.');
 const actions=$('.product-heading .ui-actions'),root=$('#view-body');
 let data,stopExpiry,formerLife,formerOwner=false;
 function updateActions(owner){
  replaceContent(actions,owner&&ctx.household.mode==='real'?button('Invite someone','invite','primary'):'');
 }
 bindActions(actions,{invite:()=>invite(ctx)});
 if(id){person(ctx,id,updateActions);return;}
 root.innerHTML=`<section class="ui-section"><h2>In this household</h2><div id="current-members">${skeleton()}</div></section><section class="ui-section" id="invitation-section" hidden><h2>Invitations</h2><div id="member-invitations"></div></section><section class="ui-section" id="former-section" hidden><h2>Former members</h2><p class="ui-hint">Leaving does not silently reassign unfinished work. Review anything still attributed to a former member.</p><h3>Removed</h3><div id="former-removed"></div><h3>Left the household</h3><div id="former-left"></div></section>`;
 function renderInvites(){
  stopExpiry?.();stopExpiry=null;
  const owner=data?.members.find(m=>m.membership.userId===ctx.viewer.id)?.membership.role==='owner';
  $('#invitation-section').hidden=!owner;
  const target=$('#member-invitations');
  if(!owner){replaceContent(target,'');return;}
  if(ctx.household.mode==='demo'){replaceContent(target,'<p class="ui-hint">This fictional household uses the recipient link in Sample controls. Email invitations are available in your own household.</p>');return;}
  const now=Date.now();replaceContent(target,data.invites.length?data.invites.map(i=>`<div class="ui-list-row"><div class="row-main"><strong>${esc(i.email)}</strong><div class="row-meta">${i.accessPreset==='limited_helper'?'Limited helper':'Care circle'} · ${i.expiresAt<=now?'Expired':'Expires '+esc(formatDate(i.expiresAt,ctx.household.timezone))}</div></div>${button(i.expiresAt<=now?'Remove expired invitation':'Revoke','revoke:'+i._id)}</div>`).join(''):empty('No pending invitations.','Invite someone when you’re ready to share the work.'));
  const next=Math.min(...data.invites.filter(i=>i.expiresAt>now).map(i=>i.expiresAt));
  if(Number.isFinite(next))stopExpiry=watchDeadline(next,expired=>{if(expired&&ctx.alive)renderInvites();});
 }
 $('#member-invitations').onclick=event=>{
  const b=event.target.closest('[data-action]');if(!b?.dataset.action.startsWith('revoke:'))return;
  const id=b.dataset.action.slice(7);modal({ctx,title:'Revoke invitation?',content:'<p>This private link will stop working. You can create a new invitation later.</p>',submit:'Revoke invitation',onSubmit:async()=>{await ctx.mutate('inviteStore:revoke',{inviteId:id});toast('Invitation revoked.');}});
 };
 bindActions($('#current-members'),{name:()=>editName(ctx)});
 ctx.watch('team:list',{householdId:ctx.id},value=>{
  data=value;ctx.members=value.members;const owner=value.members.find(m=>m.membership.userId===ctx.viewer.id)?.membership.role==='owner';ctx.isOwner=owner;updateActions(owner);
  replaceContent($('#current-members'),value.members.map(m=>`<div class="ui-list-row"><span class="ui-avatar small">${esc(m.displayName.slice(0,1))}</span><div class="row-main">${link(ctx.path('/people/'+m.membership._id),m.displayName+(m.membership.userId===ctx.viewer.id?' (you)':''),'row-title')}<div class="row-meta">${m.membership.role==='owner'?'Household owner':m.membership.accessPreset==='limited_helper'?'Limited helper':'Care circle'}</div></div>${m.membership.userId===ctx.viewer.id?button('Edit name','name'):''}</div>`).join(''));
  renderInvites();$('#former-section').hidden=!owner;
  if(formerOwner===owner)return;formerOwner=owner;formerLife?.dispose();formerLife=null;
  for(const status of ['removed','left'])$('#former-'+status).innerHTML='';
  if(owner){formerLife=scope(ctx.auth.client);const child=Object.assign(Object.create(ctx),{add:formerLife.add,watch:formerLife.watch});
   for(const status of ['removed','left'])paginated(child,$('#former-'+status),'formerWork:list',{householdId:ctx.id,status},(el,rows)=>replaceContent(el,rows.length?rows.map(m=>`<div class="ui-list-row"><div class="row-main">${link(ctx.path('/people/'+m._id),m.displayName,'row-title')}<div class="row-meta">${status==='left'?'Left':'Removed'} ${m.endedAt?esc(formatDate(m.endedAt,ctx.household.timezone)):'date unavailable'}</div></div>${link(ctx.path('/people/'+m._id),'Review responsibilities →')}</div>`).join(''):empty('No '+(status==='left'?'departed':'removed')+' members.','Former household members will appear here.')));
  }
 },error=>{replaceContent($('#current-members'),empty('People could not be loaded.','Return to Today and reopen People to try again.'));ctx.error(error);});
 ctx.add(()=>{stopExpiry?.();formerLife?.dispose();});
}

function person(ctx,id,updateActions){
 const root=$('#view-body');root.innerHTML=skeleton();let person,lists,ready=false,reviewDialog;
 const signature=value=>JSON.stringify([value.membership.status,value.membership.role,value.membership.accessPreset,value.membership.joinedAt,value.viewerIsOwner,value.viewerIsSelf]);
 function beginLists(){
  lists=scope(ctx.auth.client);const child=Object.assign(Object.create(ctx),{add:lists.add,watch:lists.watch});
  for(const [queryName,target,emptyTitle] of [['team:responsibilities','person-tasks','No open responsibilities.'],['team:requestedResponsibilities','person-requests','No assignment requests.']])paginated(child,$('#'+target),queryName,{householdId:ctx.id,memberId:id},(el,rows)=>taskList(ctx,el,rows,emptyTitle));
  for(const state of ['committed','active'])paginated(child,$('#person-'+state),'team:coverage',{householdId:ctx.id,memberId:id,state},(el,rows)=>replaceContent(el,rows.length?rows.map(c=>`<div class="ui-list-row"><div class="row-main">${link(ctx.path('/coverage/'+c._id),state==='active'?'Active coverage':'Committed coverage','row-title')}<div class="row-meta">${esc(formatDate(c.startsAt,ctx.household.timezone))} – ${esc(formatDate(c.endsAt,ctx.household.timezone))}</div></div></div>`).join(''):empty(state==='active'?'No active coverage.':'No coverage commitments.','Coverage only starts or ends through an explicit action.')));
 }
 ctx.watch('team:get',{householdId:ctx.id,memberId:id},value=>{
  if(reviewDialog?.isConnected&&person&&signature(value)!==signature(person)){
   const form=reviewDialog.querySelector('form'),disable=()=>{form.querySelector('[type="submit"]').disabled=true;};
   notice(form.querySelector('.ui-form-status'),'Membership or ownership changed. Close this dialog and review the current member details.');disable();form.addEventListener('handoff:form-idle',disable,{once:true});reviewDialog.dataset.stale='true';
  }
  person=value;updateActions(value.viewerIsOwner);
  if(!ready){ready=true;root.innerHTML='<article><div id="person-summary"></div><div class="ui-actions" id="person-actions"></div><section class="ui-section"><h2>Open responsibilities</h2><div id="person-tasks"></div></section><section class="ui-section"><h2>Assignment requests</h2><div id="person-requests"></div></section><section class="ui-section"><h2>Coverage commitments</h2><div id="person-committed"></div><div id="person-active"></div></section></article>';beginLists();}
  const active=value.membership.status==='active',owner=value.membership.role==='owner',name=value.displayName;
  replaceContent($('#person-summary'),`<div class="ui-section-heading"><h2>${esc(name)}</h2>${badge(active?(owner?'Household owner':value.membership.accessPreset==='limited_helper'?'Limited helper':'Care circle'):(value.membership.status==='left'?'Left the household':'Removed'))}</div>${!active?`<p class="ui-notice attention">${esc(name)} no longer has access${value.membership.endedAt?' · '+esc(formatDate(value.membership.endedAt,ctx.household.timezone)):''}. Responsibilities and coverage below remain attributed to them until explicitly corrected.</p>`:''}${value.viewerIsSelf&&owner?'<p class="ui-hint">Transfer ownership to another active member before leaving this household.</p>':''}`);
  replaceContent($('#person-actions'),(value.viewerIsSelf?button('Edit name','name'):'')+(active&&value.viewerIsOwner&&!value.viewerIsSelf?button('Change access','access')+(value.membership.accessPreset==='limited_helper'?'':button('Transfer ownership','transfer'))+button('Remove member','remove'):active&&value.viewerIsSelf&&!owner?button('Leave household','leave'):'')+(!active?link(ctx.path('/plan?view=work&ownership=former&member='+id),'All retained work','ui-button secondary'):'')+link(ctx.path('/people'),'← People','ui-button secondary'));
  // Only the member-action region handles membership changes. Task actions
  // have their own delegated handler and must never fall through to removal.
  $('#person-actions').onclick=event=>{
   const b=event.target.closest('[data-action]');if(!b)return;const op=b.dataset.action;
   if(op==='name'){editName(ctx);return;}
   if(op==='access'){
    const reviewed=person;
    reviewDialog=modal({ctx,title:'Change household access',content:select('accessPreset','Access preset',[['care_circle','Care circle'],['limited_helper','Limited helper']],reviewed.membership.accessPreset||'care_circle')+'<p class="ui-hint">Care circle members can use the shared household plan. Medical information and email remain separately restricted. Limited helpers see only their own requested and accepted responsibilities, the practical visit details for those tasks, and their own availability. Access changes take effect immediately.</p>',submit:'Save access',onSubmit:async data=>{
     if(reviewDialog.dataset.stale==='true'||signature(person)!==signature(reviewed))throw {data:{message:'Membership changed. Close this dialog and review the current details.'}};
     await ctx.mutate('team:setAccessPreset',{householdId:ctx.id,userId:reviewed.membership.userId,accessPreset:data.get('accessPreset')});toast('Household access updated.');
    }});return;
   }
   if(!['transfer','leave','remove'].includes(op))return;
   const reviewed=person;
   reviewDialog=modal({ctx,title:op==='transfer'?'Transfer household ownership?':op==='leave'?'Leave this household?':'Remove household member?',content:`<p>${op==='transfer'?esc(reviewed.displayName)+' will control household processing choices, invitations and deletion.':op==='leave'?'You will lose access immediately. Your unfinished responsibilities remain attributed to you until someone explicitly reassigns them.':esc(reviewed.displayName)+' loses access immediately. Their tasks and coverage remain visible for an explicit correction; nothing transfers automatically.'}</p>`,submit:op==='transfer'?'Transfer ownership':op==='leave'?'Leave household':'Remove member',destructive:op!=='transfer',onSubmit:async()=>{
    if(reviewDialog.dataset.stale==='true'||signature(person)!==signature(reviewed))throw {data:{message:'Membership changed. Close this dialog and review the current details.'}};
    await ctx.mutate(op==='transfer'?'team:transferOwnership':'team:remove',op==='transfer'?{householdId:ctx.id,newOwnerId:reviewed.membership.userId}:{householdId:ctx.id,memberId:id});
    if(op==='leave')ctx.go('/households'+(ctx.auth.sampleSession?'?sample=1':''));else toast(op==='transfer'?'Household ownership transferred.':'Member removed. Review their retained work below.');
   }});
  };
 },error=>{lists?.dispose();reviewDialog?.close();person=null;ready=false;root.innerHTML=empty('This member is unavailable.','They may no longer belong to this household.',link(ctx.path('/people'),'Back to People','ui-button secondary'));ctx.error(error);});
 ctx.add(()=>lists?.dispose());
}
