import {shiftHouseholdDays} from '../time.js';

export function agendaDays(from,timeZone,rowsByKind,count=7){
 return Array.from({length:count},(_,index)=>{
  const start=shiftHouseholdDays(from,timeZone,index),end=shiftHouseholdDays(from,timeZone,index+1);
  const items=[];
  for(const [kind,rows] of Object.entries(rowsByKind))for(const row of rows){
   const time=kind==='tasks'?row.dueAt:kind==='visits'?row.confirmedStartsAt:row.startsAt;
   const visible=kind==='coverage'?time<end&&row.endsAt>start:time!=null&&time>=start&&time<end;
   if(visible)items.push({kind,row,time:Math.max(time,start),continues:time<start});
  }
  items.sort((a,b)=>a.time-b.time||a.kind.localeCompare(b.kind)||String(a.row._id).localeCompare(String(b.row._id)));
  return {_id:String(start),start,end,items};
 });
}
