import { notice } from './core.js';
// Freeze the meaning of entered wall-clock values. A live household change
// must not cause an open form to reinterpret them in a different zone.
export function guardHouseholdTimezone(ctx,dialog,zone){
 let changed=false;
 const explanation='The household time zone changed. Your entries are still here. Close this dialog and reopen it to review dates in the new zone.';
 const disable=()=>{if(changed&&dialog.isConnected){dialog.querySelector('[type="submit"]').disabled=true;notice(dialog.querySelector('.ui-form-status'),explanation);}};
 const stop=ctx.watch('households:get',{householdId:ctx.id},household=>{if(household.timezone!==zone){changed=true;disable();}},()=>{changed=true;disable();});
 dialog.addEventListener('handoff:form-idle',disable);dialog.addEventListener('close',stop,{once:true});
 return()=>{if(changed||ctx.household.timezone!==zone)throw {data:{message:explanation}};};
}
