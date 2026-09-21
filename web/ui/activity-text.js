import { formatDate } from './core.js';
const labels={title:'Title',note:'Note',dueAt:'Due',time:'Visit time',confirmedStartsAt:'Visit time',address:'Address',confirmedAddress:'Address',phone:'Phone',timezone:'Time zone',startsAt:'Start',endsAt:'End',status:'Status',ownerId:'Responsible',requestedOwnerId:'Requested of'};
const dateFields=new Set(['dueAt','time','confirmedStartsAt','startsAt','endsAt']);
const idPattern=/\b[a-z0-9]{32}\b/g;
const subjects={task:'Responsibility',coverage:'Coverage',visit:'Visit',handover:'Handover',thread:'Conversation',household:'Household',team:'Household membership',proposal:'Suggested change',contact:'Contact',demo:'Sample',recurrence:'Recurring responsibility',source:'Source',mail:'Email',consent:'Permission',watch:'Public-page watch'};
const verbs={created:'added',edited:'updated',claim:'taken',release:'released',complete:'completed',reopen:'reopened',cancel:'cancelled',restore:'restored',acceptAssignment:'assignment accepted',declineAssignment:'assignment declined',assignmentRequested:'assignment requested',assignmentOverridden:'assigned by the household owner',handoverAccepted:'accepted in handover',published:'sent for acceptance',accepted:'accepted',decline:'declined',resolve:'resolved',reopened:'reopened',volunteer:'committed',withdraw:'commitment withdrawn',start:'started',end:'ended',planned:'planned',ownerTransferred:'ownership transferred',confirmed:'confirmed',approved:'approved',approve:'approved',dismiss:'dismissed',archive:'archived',unarchive:'restored to inbox',attached:'related item updated',quarantineReleased:'sender review completed',renamed:'renamed',removed:'removed',left:'ended',changed:'updated',checked:'checked',proposalsReady:'suggestions ready',sent:'sent',received:'received',rideLinked:'ride link updated',editedFuture:'future schedule updated',cancelledFuture:'future occurrences cancelled',generated:'occurrences created'};
export function activityTitle(event){const [kind,verb]=String(event.type).split('.');return `${subjects[kind]||'Household'} ${verbs[verb]||'updated'}`;}
export function activityText(ctx,type,value){
 const raw=String(value??'').trim();if(!raw)return '';
 if(raw.startsWith('{')||raw.startsWith('[')){
  try{
   const parsed=JSON.parse(raw);if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')return 'Details updated.';
   return Object.entries(parsed).filter(([key])=>labels[key]).map(([key,val])=>{
    let display;
    if(dateFields.has(key))display=val==null?'Not set':typeof val==='number'&&Number.isFinite(val)?formatDate(val,ctx.household.timezone):'Updated';
    else if(key.endsWith('OwnerId')||key==='ownerId')display=ctx.name(val);
    else display=val==null||val===''?'Not set':typeof val==='string'?val:'Updated';
    return `${labels[key]}: ${display}`;
   }).join(' · ')||'Details updated.';
  }catch{return 'Details updated.';}
 }
 if(type==='handover.accepted')return raw.replace(/\b1 responsibilities\b/,'1 responsibility');
 if(type==='coverage.edited'&&/^\d+\/\d+$/.test(raw))return raw.split('/').map(t=>formatDate(Number(t),ctx.household.timezone)).join(' – ');
 if(type==='visit.rideLinked')return raw==='none'?'Ride unlinked.':'Ride responsibility linked. Open the visit to see the current ride.';
 if(type==='proposal.approve'){
  const match=/^(startsAt|dueAt|address|phone|note|title): ([\s\S]*)$/.exec(raw);
  if(match)return `${labels[match[1]]}: ${dateFields.has(match[1])?(match[2]===''?'Not set':Number.isFinite(Number(match[2]))?formatDate(Number(match[2]),ctx.household.timezone):'Updated'):match[2]||'Not set'}`;
 }
 if(type==='consent.changed')return raw.replace(/^(coordination|emailImport|aiProcessing):/,(_,scope)=>({coordination:'Household coordination',emailImport:'Email importing',aiProcessing:'AI processing'}[scope]+':'));
 if(type==='contact.confirmed')return raw.replace(/send=(true|false), receive=(true|false), reply=(true|false)$/,(_,send,receive,reply)=>`Sending ${send==='true'?'allowed':'blocked'} · Receiving ${receive==='true'?'allowed':'blocked'} · Replies ${reply==='true'?'allowed':'blocked'}`);
 if(type==='recurrence.created')return raw.replace(/weekdays ([1-7](?:,[1-7])*)$/,(_,days)=>days.split(',').map(day=>['','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][Number(day)]).join(', '));
 if(type==='thread.attached')return raw==='Detached'?'No related responsibility or visit.':`Linked to ${raw.startsWith('task:')?'a responsibility':raw.startsWith('visit:')?'a visit':'a household item'}.`;
 if(/^thread\.(archive|unarchive|resolve|reopen)$/.test(type))return {archive:'Conversation moved to the archive.',unarchive:'Conversation returned to the inbox.',resolve:'Question marked resolved.',reopen:'Question reopened.'}[type.split('.')[1]];
 if(/^visit\.(complete|cancel|restore)$/.test(type))return raw.replace(/^(completed|cancelled|upcoming); ride status unchanged$/,(_,status)=>`${{completed:'Visit completed',cancelled:'Visit cancelled',upcoming:'Visit restored to upcoming'}[status]}. The ride responsibility is unchanged.`);
 if(/^coverage\.(volunteer|withdraw|start|end|cancel)$/.test(type))return raw.replace(/^(volunteer|withdraw|start|end|cancel);\s*/,(_,op)=>({volunteer:'Committed; coverage has not started.',withdraw:'Commitment withdrawn.',start:'Coverage started.',end:'Coverage ended.',cancel:'Coverage cancelled.'}[op]+' ')).trim();
 const ownerEvent=/^task\.(?:claim|release|complete|reopen|cancel|restore|acceptAssignment|declineAssignment|assignmentRequested|assignmentOverridden|handoverAccepted)$/.test(type);
 let result=raw.replace(idPattern,id=>ownerEvent||type.startsWith('team.')?ctx.name(id):'linked record');
 result=result.replace(/owner=/g,'Responsible: ').replace(/\bunassigned\b/g,'Unassigned').replace(/^open;/,'Open;').replace(/^done;/,'Completed;').replace(/^cancelled;/,'Cancelled;').replace(/;\s*$/,'');
 return result;
}
export function handoverChangeText(ctx,change){
 if(change.kind==='proposal')return 'Unreviewed suggestion: '+change.summary.replace(/^Unreviewed /,'');
 const match=/^([\w.]+):\s*([\s\S]*)$/.exec(change.summary);
 const details=activityText(ctx,match?.[1]||'',match?.[2]??change.summary);
 if(!match)return details;
 const title=activityTitle({type:match[1]});
 return details.toLowerCase().startsWith(title.toLowerCase()+'.')?details:`${title}${details?': '+details:''}`;
}
