import { $,esc,button,select,modal,formatDate,notice,message } from '../ui/core.js';
import { toast } from '../ui/session.js';
import { watchDeadline } from '../time.js';
import { timezonePreviewDeadline,timezonePreviewState } from '../ui/timezone-review.js';

export function zoneChange(ctx){
 let preview;
 const zones=[...new Set([ctx.household.timezone,'UTC',...(typeof Intl.supportedValuesOf==='function'?Intl.supportedValuesOf('timeZone'):[])])].sort();
 const choices=zones.map(zone=>[zone,zone.replaceAll('_',' ').replaceAll('/',' · ')]);
 const input=modal({ctx,title:'Preview time-zone change',content:select('zone','New time zone',choices,ctx.household.timezone)+'<p>Active recurring rules will use the new zone. Completed, past-due and individually edited work keeps its saved time. One-off responsibilities, coverage and visits keep their original instants.</p>',submit:'Preview changes',pendingLabel:'Preparing preview…',onSubmit:async data=>{
  try{preview=await ctx.action('householdTimezone:preview',{householdId:ctx.id,timezone:data.get('zone').trim()});}
  catch(error){if(error?.data?.code==='INVALID_TIMEZONE')throw {data:{message:'Choose a supported time zone from the list.',field:'zone'}};throw error;}
 }});
 input.addEventListener('close',()=>{if(preview&&ctx.alive)review(ctx,preview);},{once:true});
}
function review(ctx,initial){
 let preview=initial,household=ctx.household,stopDeadline,refreshing=false;
 const dialog=modal({ctx,title:'Confirm time-zone change',content:'<div data-zone-preview></div><div class="ui-form-status" data-zone-stale></div>'+button('Refresh preview','refresh-zone'),submit:'Confirm time zone',onSubmit:async data=>{
  const state=timezonePreviewState(preview,household,ctx.viewer.id);
  if(!state.valid)throw {data:{message:state.reason}};
  if(!data.get('reviewed'))throw {data:{message:'Review the displayed changes before confirming.'}};
  await ctx.mutate('householdTimezone:confirm',{householdId:ctx.id,timezone:preview.toTimezone,expectedMaterialRevision:preview.materialRevision,previewedAt:preview.previewedAt,confirmed:true});
  toast('Household time zone changed.');ctx.go(ctx.path('/settings'));
 }});
 const form=$('form',dialog),refresh=$('[data-action="refresh-zone"]',dialog),submit=$('[type="submit"]',dialog);
 function validity(){
  if(!dialog.isConnected)return;
  const state=timezonePreviewState(preview,household,ctx.viewer.id),status=$('[data-zone-stale]',dialog);
  submit.disabled=refreshing||!state.valid;
  refresh.disabled=refreshing||household.ownerId!==ctx.viewer.id;
  if(!state.valid){notice(status,state.reason);const check=$('[name="reviewed"]',dialog);if(check)check.checked=false;}else status.innerHTML='';
 }
 function render(){
  const due=preview.changes.filter(change=>change.newDueAt<Date.now()).length;
  $('[data-zone-preview]',dialog).innerHTML=`<p><strong>${esc(preview.fromTimezone)}</strong> → <strong>${esc(preview.toTimezone)}</strong></p><p>${preview.changes.length} generated ${preview.changes.length===1?'occurrence changes':'occurrences change'}. ${preview.unchangedHistoricalCount} other reviewed occurrences keep their saved time.</p><p class="ui-hint">Completed, past-due, cancelled and individually edited work stays unchanged. One-off responsibilities, coverage and visits keep their original instants. Their displayed local time may look different in the new household zone.</p>${due?`<p class="ui-notice attention">${due} ${due===1?'occurrence becomes':'occurrences become'} past due in the new zone. Review the times below.</p>`:''}${preview.changes.map(change=>`<div class="ui-list-row"><div class="row-main"><strong>${esc(change.title)}</strong><p class="ui-hint">Before: ${esc(formatDate(change.oldDueAt,change.fromTimezone))} · ${esc(change.fromTimezone)}<br>After: ${esc(formatDate(change.newDueAt,preview.toTimezone))} · ${esc(preview.toTimezone)}</p>${change.adjustment?`<p class="ui-hint">${esc(change.adjustment)}</p>`:''}</div></div>`).join('')}${preview.fromTimezone!==preview.toTimezone?'<label class="ui-check"><input type="checkbox" name="reviewed" required><span>I reviewed these times and the work that stays unchanged.</span></label>':''}`;
  stopDeadline?.();stopDeadline=watchDeadline(timezonePreviewDeadline(preview),()=>validity());validity();
 }
 refresh.onclick=async()=>{
  if(refreshing)return;refreshing=true;validity();refresh.textContent='Refreshing…';
  try{const next=await ctx.action('householdTimezone:preview',{householdId:ctx.id,timezone:preview.toTimezone});if(!dialog.isConnected||!ctx.alive)return;preview=next;render();}
  catch(error){if(dialog.isConnected)notice($('.ui-dialog-body > .ui-form-status:last-child',dialog),message(error));}
  finally{refreshing=false;if(dialog.isConnected){refresh.textContent='Refresh preview';validity();}}
 };
 const stop=ctx.watch('households:get',{householdId:ctx.id},value=>{household=value;validity();},()=>{submit.disabled=true;refresh.disabled=true;notice($('[data-zone-stale]',dialog),'This household is no longer available. Close this dialog.');});
 form.addEventListener('handoff:form-idle',validity);render();
 const cleanup=()=>{stop();stopDeadline?.();};dialog.addEventListener('close',cleanup,{once:true});ctx.add(cleanup);
}
