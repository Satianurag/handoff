export function timezonePreviewDeadline(preview){return Math.min(preview.previewedAt+5*60000+1,...preview.changes.map(item=>item.oldDueAt+1));}
export function timezonePreviewState(preview,household,userId,now=Date.now()){
 if(household.ownerId!==userId)return {valid:false,reason:'Household ownership changed. Only its current owner can change the time zone.'};
 if(household.materialRevision!==preview.materialRevision)return {valid:false,reason:'The household changed. Refresh the preview and review it again.'};
 if(now>=timezonePreviewDeadline(preview))return {valid:false,reason:'This preview expired or an occurrence became due. Refresh it before confirming.'};
 if(preview.fromTimezone===preview.toTimezone)return {valid:false,reason:'This is already the household time zone. No change is needed.'};
 return {valid:true,reason:''};
}
