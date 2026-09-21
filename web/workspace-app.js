import {workspaceRequests} from './ui/workspace-requests.js';
import {activityTitle} from './ui/activity-text.js';
import {notificationWatch} from './ui/notification-navigation.js';
import {detailPanelRouter} from './ui/detail-panel.js';
import { sampleActions } from './views/sample.js';
import { $, esc, link, empty, notice, message } from './ui/core.js';
import { scope, navShell, header, toast } from './ui/session.js';
import { today, plan, taskDetail, taskForm, coverageForm, coverageDetail } from './views/work.js';
import { handoverList, newHandover, handoverDetail } from "./views/handovers.js";
import { visitNew, visitDetail, visitList } from "./views/visits.js";
import { recurring } from "./views/recurring.js";
import { historyView, notifications, notificationBell } from "./views/activity.js";
import { people } from "./views/people.js";
import { settings } from "./views/settings.js";
import { reviewQueue, sourceDetail } from "./views/sources.js";
import { inbox, questionNew, draftDetail, sendDetail, threadDetail } from "./views/mail.js";
import { recordsList,recordDetail } from './views/records.js';
import { carePage,visitPreparation } from './views/care.js';
import { helperPage } from './views/helper.js';
import { placesPage } from './views/places.js';
export async function mountWorkspace({auth,viewer,go,isCurrent}){
 const id=location.pathname.split('/')[2],life=scope(auth.client);let routePanel;
 const ctx={auth,viewer,id,...life,connected:false,members:[],detailLists:null,
  get alive(){return life.alive&&isCurrent();},
  path:suffix=>{const url=new URL(`/h/${id}${suffix}`,location.origin);if(auth.sampleSession)url.searchParams.set('sample','1');return url.pathname+url.search;},
  go,
  name:userId=>userId===viewer.id?(viewer.displayName||'You'):ctx.members.find(m=>m.membership.userId===userId)?.displayName||(userId?'Former member':'Unassigned'),
  eventTitle:activityTitle,
  error:error=>{if(!ctx.alive)return;if(error?.data?.code==='UNAUTHENTICATED'){ctx.unavailable();return;}notice($('#view-status'),message(error));},
  unavailable:()=>{life.dispose();document.querySelectorAll('.ui-dialog,.ui-detail-panel').forEach(el=>{el.close();el.remove();});$('#app').innerHTML=`<main id="main" class="boot"><h1 tabindex="-1">This space is unavailable.</h1><p>Your access may have changed, or the household was removed.</p><a href="/households${auth.sampleSession?'?sample=1':''}">My households</a></main>`;document.title='Space unavailable — Handoff';$('#app h1').focus({preventScroll:true});
   // A denied broad subscription can arrive before the access subscription.
   // Clear private content immediately, then recover into the new preset.
   if(ctx.accessPreset)auth.client.query('helpers:context',{householdId:id}).then(access=>{if(isCurrent()&&access.accessPreset!==ctx.accessPreset)location.replace(ctx.path(access.accessPreset==='limited_helper'?'/my-responsibilities':'/today'));}).catch(()=>{});
  },
 };
 Object.assign(ctx,workspaceRequests(ctx,auth.client));
 ctx.watch=notificationWatch(ctx,life.watch,()=>toast('The item opened, but its notification could not be marked read. Try Mark read in Notifications.'));
 try{
  const access=await ctx.query('helpers:context',{householdId:id});
  if(!ctx.alive){life.dispose();return()=>{};}
  ctx.accessPreset=access.accessPreset;
  ctx.watch('helpers:context',{householdId:id},value=>{
   if(value.accessPreset===ctx.accessPreset)return;
   life.dispose();document.querySelectorAll('.ui-dialog,.ui-detail-panel').forEach(el=>{el.close();el.remove();});
   $('#app').innerHTML='<main class="boot"><h1>Your access has changed.</h1><p>Opening the right workspace…</p></main>';
   location.replace(ctx.path(value.accessPreset==='limited_helper'?'/my-responsibilities':'/today'));
  },ctx.unavailable);
  if(access.accessPreset==='limited_helper'){
   ctx.household=access;ctx.isOwner=false;
   if(location.pathname!==`/h/${id}/my-responsibilities`)history.replaceState(null,'',ctx.path('/my-responsibilities'));
   navShell(ctx,'my-responsibilities');helperPage(ctx);
   return()=>{life.dispose();document.querySelectorAll('.ui-dialog').forEach(el=>{el.close();el.remove();});};
  }
  if(location.pathname===`/h/${id}/my-responsibilities`)history.replaceState(null,'',ctx.path('/today'));
  const [household,team]=await Promise.all([ctx.query('households:get',{householdId:id}),ctx.query('team:list',{householdId:id})]);if(!ctx.alive){life.dispose();return()=>{};}
  viewer.displayName ||= team.members.find(m=>m.membership.userId===viewer.id)?.displayName || '';
  ctx.household=household;ctx.members=team.members;ctx.isOwner=household.ownerId===viewer.id;
  const parts=location.pathname.split('/').slice(3),section=parts[0];
  navShell(ctx,['tasks','coverage','visits','handovers','recurring','series'].includes(section)?'plan':section);
  notificationBell(ctx);
  if(household.mode==='demo')sampleActions(ctx);
  ctx.watch('households:get',{householdId:id},value=>{ctx.household=value;ctx.isOwner=value.ownerId===viewer.id;},ctx.unavailable);
  ctx.watch('team:list',{householdId:id},value=>{ctx.members=value.members;},ctx.error);
  ctx.openHandovers=root=>handoverList(ctx,root);
  if(section==='today')today(ctx);
  else if(section==='plan'&&parts[1]==='recurring')recurring(ctx,'all');
  else if(section==='plan')plan(ctx);
  else if(section==='tasks'&&parts[1]==='new'){plan(ctx);taskForm(ctx);}
  else if(section==='tasks'&&parts[1])taskDetail(ctx,parts[1]);
  else if(section==='coverage'&&parts[1]==='new'){plan(ctx);coverageForm(ctx);}
  else if(section==='coverage'&&parts[1])coverageDetail(ctx,parts[1]);
  else if(section==='handovers'&&parts[1]==='new')await newHandover(ctx);
  else if(section==='handovers'&&parts[1])handoverDetail(ctx,parts[1]);
  else if(section==='visits'&&!parts[1])visitList(ctx);
  else if(section==='visits'&&parts[1]==='new')visitNew(ctx);
  else if(section==='visits'&&parts[1]&&parts[2]==='prepare')visitPreparation(ctx,parts[1]);
  else if(section==='visits'&&parts[1])visitDetail(ctx,parts[1]);
  else if(section==='records'&&parts[1])recordDetail(ctx,parts[1]);
  else if(section==='records')recordsList(ctx);
  else if(section==='care')carePage(ctx);
  else if(section==='places')placesPage(ctx);
  else if(['recurring','series'].includes(section)&&parts[1])recurring(ctx,parts[1]);
  else if(section==='history')historyView(ctx);
  else if(section==='notifications')notifications(ctx);
  else if(section==='people')people(ctx,parts[1]);
  else if(section==='settings')settings(ctx);
  else if(section==='review')reviewQueue(ctx);
  else if(section==='sources'&&parts[1])sourceDetail(ctx,parts[1]);
  else if(section==='inbox')routePanel=inbox(ctx,parts[1]);
  else if(section==='questions'&&parts[1]==='new')await questionNew(ctx);
  else if(section==='drafts'&&parts[1])draftDetail(ctx,parts[1]);
  else if(section==='sends'&&parts[1])sendDetail(ctx,parts[1]);
  else{header(ctx,'Page not found');$('#view-body').innerHTML=empty('This link is unavailable.','Open Today or Plan to continue.');}
  if(['today','plan','visits'].includes(section)&&!parts[1])routePanel=detailPanelRouter(ctx,{tasks:taskDetail,visits:visitDetail,coverage:coverageDetail});
 }catch(error){if(ctx.alive)ctx.unavailable();}
 const dispose=()=>{life.dispose();document.querySelectorAll('.ui-dialog').forEach(el=>{el.close();el.remove();});};dispose.routePanel=routePanel;return dispose;
}
