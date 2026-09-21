import {proposalCurrentValue,proposalSupportsTarget} from '../ui/evidence.js';
import {proposalFieldLabels,proposalValueLabel,proposalReviewState} from '../ui/source-state.js';
import {$,esc,link,button,empty,skeleton,area,select,modal,formatDate,dateFields,resolveDate,notice,keyedRows} from '../ui/core.js';
import {paginated,toast,scope} from '../ui/session.js';
export async function reviewProposal(ctx,original,returnFocus){
 if(!original)return;
 try{
  const initial=await ctx.query('sources:view',{sourceId:original.sourceId});if(!ctx.alive)return;
  const life=scope(ctx.auth.client),child={...ctx,...life};
  let source=initial.source,current=original,sourceAvailable=true,selected=null,target=original.target,reviewedVersion=null,stopTarget,stopCandidates,candidateKind,queuedRows;
  let zone=ctx.household.timezone,zoneChanged=false,valueEdited=false;
  const dated=['dueAt','startsAt'].includes(original.field);
  const controls=()=>dated?dateFields(typeof original.proposedValue==='number'?original.proposedValue:null,zone)+(original.field==='dueAt'?`<label class="ui-check"><input type="checkbox" name="noDate" ${original.proposedValue===null?'checked':''}><span>Clear the due date</span></label>`:''):area('value','Confirmed value',original.proposedValue??'','maxlength="4000"');
  const kinds=[['task','Responsibilities'],['visit','Visits']].filter(([kind])=>proposalSupportsTarget(original.field,kind));candidateKind=kinds[0]?.[0];
  const dialog=modal({ctx,title:'Review proposed '+(proposalFieldLabels[original.field]||'detail').toLowerCase(),returnFocus,content:`<blockquote class="source-quote" data-review-quote>${esc(original.quote)}</blockquote><p class="ui-hint" data-source-note>Original captured ${esc(formatDate(source.capturedAt,zone))}.</p><div data-review-state role="status"></div>${!original.target?`<details open data-target-picker><summary>Choose a matching item</summary>${select('targetKind','Match to',kinds,candidateKind)}<div data-target-options></div><p class="ui-hint">Can’t find the right item? ${link(ctx.path('/plan?view=work'),'Open all work')} or ${link(ctx.path('/visits/new'),'add a visit')}, then return to this suggestion.</p></details>`:''}<div class="context-block" data-current-value>${skeleton()}</div><div data-value-fields>${controls()}</div>${area('reason','Review note (required to dismiss)','','maxlength="1000"')}${source.kind==='email'?'<label class="ui-check"><input type="checkbox" name="acknowledgeHouseholdSharing"><span>I reviewed the new value and removed unnecessary medical details. This confirmed task or visit detail may be seen by everyone in the household; the original email remains private.</span></label>':''}${select('decision','Your decision',[['approve','Approve this confirmed detail'],['dismiss','Dismiss suggestion']],'approve')}`,submit:'Save review',onSubmit:async data=>{
   const policy=proposalReviewState(original,current,sourceAvailable,selected,reviewedVersion,source.kind==='web'),decision=data.get('decision');
   if(!policy.reviewable||decision==='approve'&&(!policy.approvable||zoneChanged))throw {data:{message:zoneChanged?'The item’s time zone changed. Close and reopen this review to use its new time zone.':policy.reason}};
   const value=decision==='approve'?(dated?(data.get('noDate')?null:await resolveDate(ctx,data.get('dueDate'),data.get('dueTime'),zone,data.get('dueChoice'))):data.get('value')):undefined;
   await ctx.mutate('proposals:review',{proposalId:original._id,expectedVersion:original.version,decision,...(target?{target}:{}),...(selected?{expectedTargetVersion:reviewedVersion}:{}),...(decision==='approve'?{editedValue:value}:{}),reason:data.get('reason'),...(source.kind==='email'?{acknowledgeHouseholdSharing:data.has('acknowledgeHouseholdSharing')}:{})});
   toast(decision==='approve'?'Confirmed detail updated.':'Suggestion dismissed.');
  }});
  const busy=()=>$('form',dialog).hasAttribute('aria-busy');
  $('[data-value-fields]',dialog).addEventListener('input',()=>{valueEdited=true;});
  function refresh(){
   if(!dialog.isConnected)return;
   const policy=proposalReviewState(original,current,sourceAvailable,selected,reviewedVersion,source.kind==='web');
   const reason=zoneChanged?'The item’s time zone changed. Your entries are preserved; close and reopen this review to use the new time zone.':policy.reason;
   $('[data-review-state]',dialog).innerHTML=reason?`<p class="ui-notice attention">${esc(reason)}</p>`:'';
   const dismiss=$('[name="decision"]',dialog).value==='dismiss';
   $('[type="submit"]',dialog).disabled=busy()||!policy.reviewable||!dismiss&&(!policy.approvable||zoneChanged);
   $('[name="reason"]',dialog).required=dismiss;const sharing=$('[name="acknowledgeHouseholdSharing"]',dialog);if(sharing)sharing.required=!dismiss;
   dialog.querySelectorAll('[data-value-fields] input,[data-value-fields] textarea,[data-value-fields] select').forEach(el=>el.disabled=busy()||dismiss||!policy.reviewable||zoneChanged);
   dialog.querySelectorAll('[data-target-picker] input,[data-target-picker] select,[data-target-picker] button,[data-action="review-current"]').forEach(el=>el.disabled=busy()||!policy.reviewable);
   $('[name="decision"]',dialog).disabled=busy()||!policy.reviewable;
  }
  function showCurrent(){
   const el=$('[data-current-value]',dialog);if(!selected){el.innerHTML='<p class="ui-hint">No available item selected.</p>';return;}
   const url=ctx.path('/'+(target.kind==='task'?'tasks':'visits')+'/'+selected._id);
   el.innerHTML=`<div class="proposal-values"><div><small>Current confirmed value · ${esc(selected.title)}</small><p>${esc(proposalValueLabel(proposalCurrentValue(selected,original.field),original.field,selected.timezone||ctx.household.timezone))}</p></div><div><small>Suggested</small><p>${esc(proposalValueLabel(original.proposedValue,original.field,zone))}</p></div></div><p class="ui-actions">${link(url,'Open current '+(target.kind==='task'?'responsibility':'visit'))}</p>${original.targetVersion==null&&selected.version!==reviewedVersion?button('I reviewed this current value','review-current'):''}`;
   $('[data-action="review-current"]',el)?.addEventListener('click',()=>{reviewedVersion=selected.version;showCurrent();refresh();});
  }
  function watchTarget(next){
   stopTarget?.();target=next;selected=null;reviewedVersion=null;zoneChanged=false;refresh();
   if(!target){showCurrent();return;}
   $('[data-current-value]',dialog).innerHTML=skeleton();
   stopTarget=child.watch(target.kind==='task'?'tasks:get':'visits:get',target.kind==='task'?{taskId:target.id}:{visitId:target.id},value=>{
    const row=target.kind==='task'?value:value.visit;const nextZone=row.timezone||ctx.household.timezone;
    if(!selected){reviewedVersion=row.version;if(nextZone!==zone){if(dated&&valueEdited)zoneChanged=true;else{zone=nextZone;$('[data-value-fields]',dialog).innerHTML=controls();}}}
    else if(dated&&nextZone!==zone)zoneChanged=true;
    selected=row;showCurrent();refresh();
   },()=>{selected=null;showCurrent();refresh();});
  }
  function renderCandidates(el,rows){
   if(busy()){queuedRows={el,rows};return;}
   queuedRows=null;
   if(!rows.length){el.innerHTML=empty('No matching items here.','Use another kind or add an item and return.');return;}
   if(!el.querySelector('[data-key]'))el.innerHTML='';
   keyedRows(el,rows,row=>`<label class="ui-check"><input type="radio" name="target" value="${esc(row._id)}" ${target?.id===row._id?'checked':''}><span><strong>${esc(row.title)}</strong><small class="row-meta">${esc(formatDate(row.when,ctx.household.timezone))}</small></span></label>`);refresh();
  }
  function candidates(){stopCandidates?.();watchTarget(null);stopCandidates=paginated(child,$('[data-target-options]',dialog),'proposals:matchCandidates',{proposalId:original._id,kind:candidateKind},renderCandidates);}
  $('[name="targetKind"]',dialog)?.addEventListener('change',event=>{candidateKind=event.target.value;candidates();});
  $('[data-target-options]',dialog)?.addEventListener('change',event=>{if(event.target.name==='target')watchTarget({kind:candidateKind,id:event.target.value});});
  $('[name="decision"]',dialog).addEventListener('change',refresh);
  dialog.addEventListener('handoff:form-idle',()=>{if(queuedRows)renderCandidates(queuedRows.el,queuedRows.rows);refresh();});
  dialog.addEventListener('close',()=>{life.dispose();if(!returnFocus?.isConnected){const next=document.querySelector(`[data-action="${CSS.escape(original._id)}"]`)||document.querySelector('#main h1');next?.focus({preventScroll:true});}},{once:true});ctx.add(()=>{life.dispose();if(dialog.isConnected)dialog.close();});
  child.watch('proposals:get',{proposalId:original._id},value=>{current=value;refresh();},()=>{current=null;refresh();});
  child.watch('sources:view',{sourceId:original.sourceId},view=>{source=view.source;sourceAvailable=source.plaintext.slice(original.quoteStart,original.quoteEnd)===original.quote;$('[data-review-quote]',dialog).textContent=sourceAvailable?original.quote:'The saved quote no longer matches the available original.';$('[data-source-note]',dialog).textContent=`Original captured ${formatDate(source.capturedAt,ctx.household.timezone)}. ${source.kind==='web'?'A public page cannot confirm a private appointment time.':''}`;refresh();},error=>{if(error?.data?.code==='CARE_ACCESS_REQUIRED'){dialog.close();return;}sourceAvailable=false;$('[data-review-quote]',dialog).textContent='Original evidence unavailable.';refresh();});
  if(original.target)watchTarget(original.target);else candidates();
 }catch(error){ctx.error(error);}
}
