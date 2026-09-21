import { householdDayEnd, shiftHouseholdDays } from '../time.js';
export const historyKinds=[['all','All activity'],['task','Responsibilities'],['visit','Visits'],['coverage','Coverage'],['handover','Handovers'],['thread','Conversations'],['source','Sources'],['household','Household & people']];
export function historySelection(search){
 const params=new URLSearchParams(search);
 return {since:params.get('view')==='since-acceptance',days:[7,30,90].includes(Number(params.get('days')))?Number(params.get('days')):30,kind:historyKinds.some(([key])=>key===params.get('kind'))?params.get('kind'):'all'};
}
export function historyPath({since,days,kind}){
 const params=new URLSearchParams();if(since)params.set('view','since-acceptance');else params.set('days',String(days));if(kind!=='all')params.set('kind',kind);
 return '/history'+(params.size?'?'+params:'');
}
export function historyArgs(householdId,selection,now,zone){
 return {householdId,...(selection.kind!=='all'?{kind:selection.kind}:{}),...(!selection.since?{from:shiftHouseholdDays(now,zone,1-selection.days),to:householdDayEnd(now,zone)}:{})};
}
// Sequence is monotonic even when timestamps coincide. Loading old pages or
// refreshing links cannot create a new-activity announcement.
export function activityUpdateState(previous,rows){
 return {watermark:rows.reduce((max,row)=>Math.max(max,row.sequence),previous?.watermark??0),newIds:previous?rows.filter(row=>row.sequence>previous.watermark).map(row=>row._id):[]};
}
