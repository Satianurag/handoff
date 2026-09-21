// Find the next calendar-day boundary in the household's zone. A day may be
// 23 or 25 hours: adding 24 hours would include the wrong responsibilities.
export function householdDayEnd(now, timeZone) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = date.format(now);
  let low = now,
    high = now + 48 * 60 * 60 * 1000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (date.format(middle) === today) low = middle;
    else high = middle;
  }
  return high - 1;
}

export function householdDayStart(now,timeZone){
  const format=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
  const today=format.format(now);let low=now-48*3600000,high=now;
  while(high-low>1){const middle=Math.floor((low+high)/2);if(format.format(middle)===today)high=middle;else low=middle;}
  return high;
}
export function shiftHouseholdDays(now,timeZone,days){
  if(!Number.isInteger(days)||Math.abs(days)>366)throw Error('Choose at most 366 calendar days.');
  let result=householdDayStart(now,timeZone);
  for(let i=0;i<Math.abs(days);i++)result=days>0?householdDayEnd(result,timeZone)+1:householdDayStart(result-1,timeZone);
  return result;
}

// Time does not invalidate a Convex query by itself. Refresh at midnight as
// well as each minute, and immediately when a sleeping tab becomes visible.
export function watchHouseholdClock(zone,receive){
 let timer,stopped=false;
 const update=()=>{if(stopped)return;clearTimeout(timer);const now=Date.now();receive(now);timer=setTimeout(update,Math.min(60000,householdDayEnd(now,zone())-now+1));};
 const visible=()=>{if(document.visibilityState==='visible')update();};
 document.addEventListener('visibilitychange',visible);update();
 return()=>{stopped=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visible);};
}

// Query subscriptions do not update just because time passed. Recheck on wake
// and at the actual deadline, with a bounded timer for distant deadlines.
export function watchDeadline(deadline,receive){
 let timer,stopped=false,last;
 const update=()=>{
  if(stopped)return;clearTimeout(timer);const now=Date.now(),expired=now>=deadline;
  if(last!==expired){last=expired;receive(expired);}
  if(!expired)timer=setTimeout(update,Math.min(2147483647,deadline-now));
 };
 const wake=()=>{if(document.visibilityState==='visible')update();};
 document.addEventListener('visibilitychange',wake);update();
 return()=>{stopped=true;clearTimeout(timer);document.removeEventListener('visibilitychange',wake);};
}
