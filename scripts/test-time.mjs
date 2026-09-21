import {test} from 'node:test';
import assert from 'node:assert/strict';
import {householdDayStart, householdDayEnd, shiftHouseholdDays, watchHouseholdClock} from '../web/time.js';
const ms=Date.parse;
test('agenda includes exactly the household day across spring and fall clock changes',()=>{
 for(const [instant,start,end,hours] of [
  ['2026-03-08T16:00Z','2026-03-08T05:00Z','2026-03-09T04:00Z',23],
  ['2026-11-01T17:00Z','2026-11-01T04:00Z','2026-11-02T05:00Z',25],
 ]){
  assert.equal(householdDayStart(ms(instant),'America/New_York'),ms(start));
  assert.equal(householdDayEnd(ms(instant),'America/New_York'),ms(end)-1);
  assert.equal((ms(end)-ms(start))/3600000,hours);
 }
});
test('next and previous agenda weeks remain local midnight instead of drifting an hour',()=>{
 const from=ms('2026-03-05T05:00Z'),next=shiftHouseholdDays(from,'America/New_York',7);
 assert.equal(next,ms('2026-03-12T04:00Z'));
 assert.equal(shiftHouseholdDays(next,'America/New_York',-7),from);
 const fall=ms('2026-10-29T04:00Z');
 assert.equal(shiftHouseholdDays(fall,'America/New_York',7),ms('2026-11-05T05:00Z'));
});
test('calendar boundaries respect fractional offsets and a skipped local date',()=>{
 assert.equal(householdDayStart(ms('2026-01-01T00:00Z'),'Asia/Kathmandu'),ms('2025-12-31T18:15Z'));
 assert.equal(householdDayEnd(ms('2026-01-01T00:00Z'),'Asia/Kathmandu'),ms('2026-01-01T18:15Z')-1);
 const samoa=ms('2011-12-29T10:00Z');
 assert.equal(shiftHouseholdDays(samoa,'Pacific/Apia',1),ms('2011-12-30T10:00Z'));
 assert.equal(shiftHouseholdDays(ms('2011-12-30T10:00Z'),'Pacific/Apia',-1),samoa);
});
test('clock refreshes at midnight, after tab wake, and stops cleanly',()=>{
 const original={now:Date.now,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,document:globalThis.document};
 let now=ms('2026-03-09T03:59:50Z'),scheduled,delay,listener,cleared=0;const received=[];
 try{
  Date.now=()=>now;globalThis.setTimeout=(fn,wait)=>{scheduled=fn;delay=wait;return 1;};globalThis.clearTimeout=()=>cleared++;
  globalThis.document={visibilityState:'visible',addEventListener:(_n,fn)=>listener=fn,removeEventListener:(_n,fn)=>{assert.equal(fn,listener);listener=null;}};
  const stop=watchHouseholdClock(()=>'America/New_York',value=>received.push(value));assert.equal(delay,10000);
  now+=10000;scheduled();assert.equal(received.length,2);assert.equal(delay,60000);
  now+=120000;listener();assert.equal(received.at(-1),now);
  const count=received.length;stop();scheduled();assert.equal(received.length,count);assert.equal(listener,null);assert.ok(cleared>=3);
 }finally{Date.now=original.now;globalThis.setTimeout=original.setTimeout;globalThis.clearTimeout=original.clearTimeout;if(original.document===undefined)delete globalThis.document;else globalThis.document=original.document;}
});
test('mixed agenda groups by local day, repeats overlapping coverage, and excludes midnight outside the range',async()=>{
 const {agendaDays}=await import('../web/ui/agenda-days.js');
 const from=ms('2026-03-08T05:00Z'),next=ms('2026-03-09T04:00Z');
 const days=agendaDays(from,'America/New_York',{
  tasks:[{_id:'early',dueAt:from},{_id:'last',dueAt:next-1},{_id:'tomorrow',dueAt:next},{_id:'undated',dueAt:null}],
  visits:[{_id:'visit',confirmedStartsAt:from+3600000}],
  coverage:[{_id:'overlap',startsAt:from-3600000,endsAt:next+3600000},{_id:'ended',startsAt:from-7200000,endsAt:from}],
 },2);
 assert.equal(days[0].end-days[0].start,23*3600000);
 assert.deepEqual(days[0].items.map(i=>i.row._id),['overlap','early','visit','last']);
 assert.deepEqual(days[1].items.map(i=>i.row._id),['overlap','tomorrow']);
 assert.equal(days[0].items[0].continues,true);assert.equal(days[1].items[0].continues,true);
});


test('private export expiry fires at the deadline, rechecks tab wake, and stops after disposal',async()=>{
 const {watchDeadline}=await import('../web/time.js');
 const original={now:Date.now,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,document:globalThis.document};
 let now=1000,scheduled,delay,wake;const states=[];
 try{
  Date.now=()=>now;globalThis.setTimeout=(fn,wait)=>{scheduled=fn;delay=wait;return 1;};globalThis.clearTimeout=()=>{};
  globalThis.document={visibilityState:'visible',addEventListener:(_n,fn)=>wake=fn,removeEventListener:(_n,fn)=>{assert.equal(fn,wake);wake=null;}};
  const stop=watchDeadline(1500,expired=>states.push(expired));assert.deepEqual(states,[false]);assert.equal(delay,500);
  now=1499;scheduled();assert.deepEqual(states,[false]);assert.equal(delay,1);
  now=1500;scheduled();assert.deepEqual(states,[false,true]);stop();scheduled();assert.deepEqual(states,[false,true]);assert.equal(wake,null);
  now=1000;const woke=[];const stopWake=watchDeadline(2000,expired=>woke.push(expired));now=3000;wake();assert.deepEqual(woke,[false,true]);stopWake();
 }finally{Date.now=original.now;globalThis.setTimeout=original.setTimeout;globalThis.clearTimeout=original.clearTimeout;if(original.document===undefined)delete globalThis.document;else globalThis.document=original.document;}
});
