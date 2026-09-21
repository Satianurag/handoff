import {$,esc,link,button,badge,icon,select,formatDate,keyedRows,replaceContent,skeleton,message,bindActions} from '../ui/core.js';
import {watchPages} from '../ui/pagination.js';
import {agendaDays} from '../ui/agenda-days.js';
import {coverageLabels} from '../ui/coverage-state.js';
import {householdDayStart,shiftHouseholdDays,watchHouseholdClock} from '../time.js';

export function mountAgenda(ctx,root,{taskRow,bindTaskRows,addCoverage}){
 const params=new URLSearchParams(location.search),raw=params.get('from'),fixed=raw&&Number.isFinite(Number(raw))&&Number(raw)>0&&Number(raw)<4090000000000?Number(raw):null;
 const filter=['tasks','coverage','visits'].includes(params.get('kind'))?params.get('kind'):'all';
 const labels={tasks:'Responsibilities',coverage:'Coverage',visits:'Visits'},kinds=filter==='all'?Object.keys(labels):[filter];
 let from=householdDayStart(fixed??Date.now(),ctx.household.timezone),zone=ctx.household.timezone;
 const states=Object.fromEntries(kinds.map(kind=>[kind,{rows:[],status:'loading'}])),pages={};
 root.innerHTML=`<div class="ui-toolbar"><strong id="agenda-range"></strong><div class="ui-actions" id="agenda-range-links"></div>${select('kind','Show',[['all','Everything'],['tasks','Responsibilities'],['coverage','Coverage'],['visits','Visits']],filter)}${button('Add coverage','add-coverage')}${link(ctx.path('/visits/new'),'Add visit','ui-button secondary')}${link(ctx.path('/visits'),'All visits','ui-button secondary')}</div><p class="ui-hint"><span id="agenda-timezone">Times use ${esc(zone.replaceAll('_',' '))}.</span> Recurring responsibilities appear as their occurrences are generated. ${link(ctx.path('/plan/recurring'),'View recurring rules')}</p><div id="agenda-status" class="agenda-status" aria-live="polite"></div><div id="agenda-days">${skeleton()}</div>`;
 bindActions(root,{'add-coverage':addCoverage});
 const href=start=>ctx.path('/plan?view=agenda'+(start===null?'':'&from='+start)+(filter==='all'?'':'&kind='+filter));
 $('[name="kind"]',root).onchange=event=>ctx.go(ctx.path('/plan?view=agenda'+(fixed===null?'':'&from='+from)+(event.target.value==='all'?'':'&kind='+event.target.value)));
 function rangeHeader(){
  const next=shiftHouseholdDays(from,zone,7);$('#agenda-timezone',root).textContent='Times use '+zone.replaceAll('_',' ')+'.';
  $('#agenda-range',root).textContent=formatDate(from,zone,{dateStyle:'medium'})+' – '+formatDate(next-1,zone,{dateStyle:'medium'});
  replaceContent($('#agenda-range-links',root),link(href(shiftHouseholdDays(from,zone,-7)),'Previous week','ui-button secondary')+link(href(next),'Next week','ui-button secondary')+link(href(null),'Today','ui-button secondary'));
 }
 function render(){
  if(!ctx.alive)return;
  replaceContent($('#agenda-status',root),kinds.map(kind=>{
   const state=states[kind];if(state.status==='done')return '';
   return `<div class="agenda-query-status"><span>${labels[kind]} · ${state.rows.length} loaded${state.status==='loading'?' · Updating…':''}</span>${state.status==='error'?`<span role="alert">${esc(message(state.error))}</span>${button('Retry '+labels[kind].toLowerCase(),'retry:'+kind)}`:state.status==='more'?button('Load more '+labels[kind].toLowerCase(),'more:'+kind):''}</div>`;
  }).join(''));
  const daysRoot=$('#agenda-days',root),complete=kinds.every(k=>states[k].status==='done');
  if(kinds.every(k=>states[k].status==='loading'&&!states[k].rows.length)){daysRoot.innerHTML=skeleton();return;}
  if(!daysRoot.querySelector('[data-key]'))daysRoot.innerHTML='';
  keyedRows(daysRoot,agendaDays(from,zone,Object.fromEntries(kinds.map(k=>[k,states[k].rows]))),day=>`<section class="agenda-day"><h2>${esc(formatDate(day.start,zone,{weekday:'long',month:'short',day:'numeric'}))}</h2><div>${day.items.length?day.items.map(item=>{
   const {row,kind}=item;if(kind==='tasks')return taskRow(ctx,row);
   const status=kind==='coverage'?coverageLabels[row.state]:{upcoming:'Upcoming',completed:'Completed',cancelled:'Cancelled'}[row.status];
   return `<div class="ui-list-row">${icon(kind==='visits'?'calendar':'clock')}<div class="row-main">${link(ctx.path('/'+kind+'/'+row._id),row.title||((row.activeOwnerId||row.plannedOwnerId)?'Coverage with '+ctx.name(row.activeOwnerId||row.plannedOwnerId):'Unassigned coverage'),'row-title')}<div class="row-meta">${item.continues?'Continues from ':''}${esc(formatDate(row.confirmedStartsAt??row.startsAt,zone))}${row.endsAt?' – '+esc(formatDate(row.endsAt,zone)):''}</div></div>${badge(status||row.status||row.state,row.state==='active'?'success':'neutral')}</div>`;
  }).join(''):`<p class="ui-hint">${complete?'No '+(filter==='all'?'plans':labels[filter].toLowerCase())+' on this day.':'No entries loaded for this day yet. Other results may still be loading or on another page.'}</p>`}</div></section>`);
  bindTaskRows(ctx,daysRoot,states.tasks?.rows??[]);
 }
 $('#agenda-status',root).onclick=event=>{const b=event.target.closest('[data-action]');if(!b)return;const [action,kind]=b.dataset.action.split(':');if(action==='retry')pages[kind]?.retry();else pages[kind]?.loadMore();};
 rangeHeader();
 for(const kind of kinds){pages[kind]=watchPages({watch:ctx.watch,name:'upcoming:list',args:{householdId:ctx.id,kind,from:Math.max(0,from),to:shiftHouseholdDays(from,zone,7)-1},receive:state=>{states[kind]=state;render();}});ctx.add(()=>pages[kind].dispose());}
 function updateClock(now){
  const nextZone=ctx.household.timezone,nextFrom=householdDayStart(fixed??now,nextZone);
  if(nextFrom!==from||zone!==nextZone){from=nextFrom;zone=nextZone;rangeHeader();for(const kind of kinds)pages[kind].setArgs({householdId:ctx.id,kind,from:Math.max(0,from),to:shiftHouseholdDays(from,zone,7)-1});}
  render();
 }
 ctx.add(watchHouseholdClock(()=>ctx.household.timezone,updateClock));
 ctx.watch('households:get',{householdId:ctx.id},household=>{ctx.household=household;if(household.timezone!==zone)updateClock(Date.now());},ctx.unavailable);
}
