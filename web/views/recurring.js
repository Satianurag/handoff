import { $,esc,link,button,badge,empty,skeleton,field,area,select,modal,localParts,replaceContent,notice,keyedRows } from '../ui/core.js';
import { header,paginated,toast,scope } from '../ui/session.js';
import { taskList } from './work.js';
import { watchHouseholdClock } from '../time.js';

const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const allDays=[1,2,3,4,5,6,7];
const policy='When clocks move forward, a skipped time moves to the first valid instant. A repeated time uses its first occurrence.';
const preservation='Completed and individually edited responsibilities stay unchanged.';
function ruleDays(series){return series.weekdays.length===7?'Every day':series.weekdays.map(day=>days[day-1]).join(', ');}
function stateLabel(series,today){return series.nextSeriesId?'Earlier rule':series.status==='cancelled'?'Ended or cancelled':series.activeUntil&&series.activeUntil<today?'Ended':series.activeFrom>today?'Starts '+series.activeFrom:'Active';}
function plusDays(date,count){const value=new Date(date+'T12:00:00Z');value.setUTCDate(value.getUTCDate()+count);return value.toISOString().slice(0,10);}
function formFields(ctx,series){
 const today=localParts(Date.now(),series?.timezone??ctx.household.timezone).date,daily=!series||series.weekdays.length===7;
 const start=series&&series.activeFrom>today?series.activeFrom:today,max=series&&series.activeFrom>plusDays(today,30)?series.activeFrom:plusDays(today,series?30:366);
 return field('title','Responsibility',series?.title??'','text','required maxlength="160"')+select('category','Kind',[['meal','Meal'],['checkin','Check-in'],['errand','Errand'],['ride','Ride'],['logistics','Logistics']],series?.category??'logistics')+
 '<div class="ui-field-pair">'+field('localTime','Local time',series?.localTime??'09:00','time','required')+field('timezone','Time zone',series?.timezone??ctx.household.timezone,'text','required')+'</div>'+
 select('frequency','Repeat',[['daily','Every day'],['weekdays','Selected weekdays']],daily?'daily':'weekdays')+
 `<fieldset class="ui-weekdays" data-weekdays ${daily?'hidden':''}><legend>Repeat on</legend><p class="ui-hint" data-weekday-error hidden>Choose at least one weekday.</p><div>${days.map((day,i)=>`<label class="ui-check"><input type="checkbox" name="weekdays" value="${i+1}" ${series?.weekdays.includes(i+1)?'checked':''}><span>${day}</span></label>`).join('')}</div></fieldset>`+
 '<div class="ui-field-pair">'+field(series?'fromDate':'activeFrom',series?'Change occurrences starting':'Start date',start,'date',`required min="${today}" max="${max}"`)+field('activeUntil','End date (optional)',series?.activeUntil??'','date',`min="${today}"`)+'</div>'+
 select('proposedOwnerId','Request each occurrence from',[['','Leave unassigned'],...ctx.members.map(m=>[m.membership.userId,m.displayName])],series?.proposedOwnerId??'')+
 '<p class="ui-hint">Each request needs acceptance. Choosing a person does not make them responsible automatically.</p>'+area('note','Note',series?.note??'','maxlength="4000"')+`<p class="ui-hint">${policy} ${preservation}</p>`;
}
function edit(ctx,series){
 const requestId=crypto.randomUUID();
 const dialog=modal({ctx,title:series?'Change future occurrences':'Add recurring responsibility',content:formFields(ctx,series),submit:series?'Change future occurrences':'Create recurring responsibility',onSubmit:async data=>{
  const weekdays=data.get('frequency')==='daily'?allDays:data.getAll('weekdays').map(Number);
  if(!weekdays.length){dialog.querySelector('[data-weekday-error]').hidden=false;throw {data:{message:'Choose at least one weekday.',field:'weekdays'}};}
  const fields={title:data.get('title'),category:data.get('category'),localTime:data.get('localTime'),timezone:data.get('timezone'),weekdays,activeUntil:data.get('activeUntil')||null,proposedOwnerId:data.get('proposedOwnerId')||null,note:data.get('note')};
  const id=series?await ctx.mutate('recurrence:editFuture',{seriesId:series._id,expectedVersion:series.version,fromDate:data.get('fromDate'),...fields}):await ctx.mutate('recurrence:create',{householdId:ctx.id,activeFrom:data.get('activeFrom'),requestId,...fields});
  toast('Recurring responsibilities saved.');ctx.go(ctx.path('/series/'+id));
 }});
 const clearWeekdayError=()=>{dialog.querySelector('[data-weekday-error]').hidden=true;dialog.querySelector('.ui-form-status').innerHTML='';};
 dialog.querySelector('[name="frequency"]').onchange=event=>{dialog.querySelector('[data-weekdays]').hidden=event.target.value==='daily';clearWeekdayError();};
 dialog.querySelector('[data-weekdays]').onchange=()=>{if(dialog.querySelector('[name="weekdays"]:checked'))clearWeekdayError();};
 if(!series)dialog.querySelector('[name="timezone"]').onchange=event=>{
  try{const today=localParts(Date.now(),event.target.value).date,start=dialog.querySelector('[name="activeFrom"]');start.min=today;start.max=plusDays(today,366);}catch{/* The server reports an invalid time zone without discarding the form. */}
 };
 return dialog;
}
export function recurring(ctx,id){
 header(ctx,'Recurring responsibilities','A predictable routine, with each occurrence owned explicitly.',button('Add recurring responsibility','new-series','primary'));
 $('[data-action="new-series"]').onclick=()=>edit(ctx);const root=$('#view-body');
 if(id==='all'){
  const status=new URLSearchParams(location.search).get('status')==='cancelled'?'cancelled':'active';
  root.innerHTML=`<nav class="ui-segments" aria-label="Recurring rule status">${[['active','Current rules'],['cancelled','Ended or cancelled']].map(([value,label])=>`<a data-route href="${ctx.path('/plan/recurring?status='+value)}" ${status===value?'aria-current="page"':''}>${label}</a>`).join('')}</nav><div id="series-list"></div>`;
  paginated(ctx,$('#series-list'),'recurrence:list',{householdId:ctx.id,status},(el,rows)=>{
   if(!rows.length){replaceContent(el,empty(status==='active'?'No recurring responsibilities.':'No ended or cancelled rules.','Create a routine for predictable everyday work.'));return;}
   if(!el.querySelector('[data-key]'))el.innerHTML='';delete el._stableMarkup;
   keyedRows(el,rows,s=>`<div class="ui-list-row"><div class="row-main">${link(ctx.path('/series/'+s._id),s.title,'row-title')}<div class="row-meta">${esc(ruleDays(s))} · ${esc(s.localTime)} · ${esc(s.timezone)}</div><div class="row-meta">${s.activeUntil&&s.activeUntil<s.activeFrom?'No further generation':esc(s.activeFrom)+(s.activeUntil?' through '+esc(s.activeUntil):' onwards')}</div></div>${badge(stateLabel(s,localParts(Date.now(),s.timezone).date))}</div>`);
  });return;
 }
 root.innerHTML=skeleton();let series,lists,ready=false,clock,occurrences,lastDate,reviewDialog;
 const all=new URLSearchParams(location.search).get('occurrences')==='all';
 function render(){
  if(!series||!ctx.alive)return;
  const today=localParts(Date.now(),series.timezone).date,ended=series.status==='cancelled'||series.activeUntil&&series.activeUntil<today;
  replaceContent($('#series-summary'),`<div class="ui-section-heading"><h2>${esc(series.title)}</h2>${badge(stateLabel(series,today))}</div><dl class="detail-facts"><dt>Repeats</dt><dd>${esc(ruleDays(series))}</dd><dt>Time</dt><dd>${esc(series.localTime)} · ${esc(series.timezone)}</dd><dt>Original start</dt><dd>${esc(series.activeFrom)}</dd><dt>New occurrences</dt><dd>${series.activeUntil&&series.activeUntil<series.activeFrom?'Stopped; preserved work remains below':series.activeUntil?'Through '+esc(series.activeUntil):'No end date'}</dd><dt>Requested of</dt><dd>${esc(ctx.name(series.proposedOwnerId))}</dd><dt>Schedule checked through</dt><dd>${esc(series.generatedThrough||'Not generated yet')}</dd></dl>${series.note?`<p class="detail-prose">${esc(series.note)}</p>`:''}<p class="ui-hint">Responsibilities are generated up to 30 days ahead. Each requested assignment needs acceptance. ${policy}</p>`);
  replaceContent($('#series-actions'),(!ended&&!series.nextSeriesId?button('Edit future occurrences','edit')+button('Cancel future occurrences','cancel'):'')+(series.previousSeriesId?link(ctx.path('/series/'+series.previousSeriesId+'?occurrences=all'),'Earlier rule & preserved work','ui-button secondary'):'')+(series.nextSeriesId?link(ctx.path('/series/'+series.nextSeriesId),'Revised rule','ui-button secondary'):'')+link(ctx.path('/plan/recurring'),'All recurring rules','ui-button secondary'));
  if(today!==lastDate){lastDate=today;occurrences?.setArgs({seriesId:id,fromDate:all?null:today});}
 }
 ctx.watch('recurrence:get',{seriesId:id},value=>{
  if(value.householdId!==ctx.id)return ctx.unavailable();
  if(reviewDialog?.isConnected&&series&&value.version!==series.version){
   reviewDialog.dataset.stale='true';const form=reviewDialog.querySelector('form');
   const disable=()=>{form.querySelector('[type="submit"]').disabled=true;};
   notice(form.querySelector('.ui-form-status'),'This rule changed. Close this dialog and review the current rule before trying again.');disable();form.addEventListener('handoff:form-idle',disable,{once:true});
  }
  series=value;
  if(!ready){
   ready=true;root.innerHTML=`<article><div class="detail-reading" id="series-summary"></div><div class="ui-actions" id="series-actions"></div><section class="ui-section"><h2>Occurrences</h2><p class="ui-hint">Open a responsibility to edit just that occurrence. Individually edited work and completed work are preserved when the rule changes. Date filters use the original scheduled date; individually edited times may differ. Times below use ${esc(ctx.household.timezone)}.</p><nav class="ui-segments" aria-label="Occurrence dates">${[[false,'Today onwards'],[true,'All dates']].map(([value,label])=>`<a data-route href="${ctx.path('/series/'+id+(value?'?occurrences=all':''))}" ${all===value?'aria-current="page"':''}>${label}</a>`).join('')}</nav><div id="series-occurrences"></div></section></article>`;
   lists=scope(ctx.auth.client);const child=Object.assign(Object.create(ctx),{watch:lists.watch,add:lists.add});lastDate=localParts(Date.now(),series.timezone).date;
   occurrences=paginated(child,$('#series-occurrences'),'recurrence:occurrences',{seriesId:id,fromDate:all?null:lastDate},(el,rows)=>{
    if(rows.length)taskList(ctx,el,rows);
    else replaceContent(el,empty(all?'No retained occurrences for this rule.':'No generated occurrences from today onwards.',series.status==='cancelled'?'This rule no longer generates work. Earlier and preserved responsibilities remain available under All dates.':'Occurrences appear automatically as scheduled dates enter the next 30 days. You can inspect the complete retained list under All dates.'));
   });
   $('#series-actions').onclick=event=>{
    const b=event.target.closest('[data-action]');if(!b||!series)return;
    if(b.dataset.action==='edit'){reviewDialog=edit(ctx,series);return;}
    if(b.dataset.action!=='cancel')return;
    const reviewed=series,today=localParts(Date.now(),series.timezone).date;
    reviewDialog=modal({ctx,title:'Cancel future occurrences?',destructive:true,content:field('fromDate','Cancel starting',today,'date',`required min="${today}" max="${plusDays(today,30)}"`)+`<p>${preservation}</p>`,submit:'Cancel future occurrences',onSubmit:async data=>{
     await ctx.mutate('recurrence:cancelFuture',{seriesId:id,expectedVersion:reviewed.version,fromDate:data.get('fromDate')});toast('Future occurrences cancelled.');
    }});
   };
   clock=watchHouseholdClock(()=>series.timezone,render);
  }
  render();
 },error=>{lists?.dispose();clock?.();reviewDialog?.close();series=null;ready=false;root.innerHTML=empty('This recurring rule is unavailable.','Return to the rules list to review your routines.',link(ctx.path('/plan/recurring'),'All recurring rules','ui-button secondary'));ctx.error(error);});
 ctx.add(()=>{lists?.dispose();clock?.();});
}
