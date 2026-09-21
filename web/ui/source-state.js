import {formatDate} from './core.js';
export const proposalStatuses=[['pending','Needs review'],['approved','Approved'],['dismissed','Dismissed'],['invalid','No longer valid']];
export const proposalFieldLabels={startsAt:'Visit time',dueAt:'Due time',address:'Address',phone:'Phone',note:'Note',title:'Title'};
export function proposalStatus(search){const value=new URLSearchParams(search).get('status');return proposalStatuses.some(([id])=>id===value)?value:'pending';}
export function proposalValueLabel(value,field,zone){return value==null?'Not set':typeof value==='number'&&['dueAt','startsAt'].includes(field)?formatDate(value,zone):String(value);}
export function extractionState(view,now=Date.now()){
 const {source,latestExtraction:job,extractionBlockedReason:blocked}=view;
 if(blocked)return {label:'Manual review available',detail:blocked,canExtract:false,tone:'attention'};
 if(job&&['queued','running'].includes(job.state))return {label:job.state==='queued'?'Extraction queued':'Reading source',detail:'Confirmed details stay unchanged while suggestions are prepared.',canExtract:false,tone:'review'};
 if(job?.state==='failed'&&job.retryAt>now)return {label:'Extraction waiting',detail:job.safeError||'Automatic processing is temporarily unavailable. Retry after the time below, or confirm details manually. The original is preserved.',canExtract:false,tone:'attention'};
 if(job?.state==='failed'||source.extractionState==='failed')return {label:'Extraction failed',detail:'The original is preserved. Retry extraction or confirm details manually.',canExtract:true,tone:'error'};
 if(job?.state==='cancelled')return {label:'Extraction stopped',detail:'No automatic confirmation was made. You can request extraction again.',canExtract:true,tone:'attention'};
 if(job?.state==='needsReview')return {label:'Extraction needs attention',detail:'Review the original manually. Confirmed details have not been changed automatically.',canExtract:false,tone:'attention'};
 if(source.extractionState==='processing'||source.extractionState==='pending')return {label:source.extractionState==='processing'?'Reading source':'Awaiting extraction',detail:'Suggestions still need a household member’s review before changing the plan.',canExtract:source.extractionState!=='processing',tone:'review'};
 return {label:source.extractionState==='ready'?'Extraction complete':'Ready for review',detail:'Review suggestions below. You can request extraction again after matching or changing the related item.',canExtract:true,tone:'neutral'};
}
export function proposalReviewState(original,current,sourceAvailable,selected,reviewedVersion,publicPage=false){
 if(!current||current.version!==original.version||current.status!=='pending')return {reviewable:false,approvable:false,reason:'This suggestion changed or was already reviewed. Close this review and open its latest state.'};
 if(!sourceAvailable)return {reviewable:false,approvable:false,reason:'Original evidence is unavailable. Confirm details manually instead.'};
 if(publicPage&&original.field==='startsAt')return {reviewable:true,approvable:false,reason:'A public page cannot confirm a private appointment time. Dismiss this suggestion and confirm the time manually.'};
 if(!selected)return {reviewable:true,approvable:false,reason:'Choose an available responsibility or visit to see its confirmed value.'};
 if(!['open','upcoming'].includes(selected.status))return {reviewable:true,approvable:false,reason:'This item is closed. Restore it before applying a suggestion.'};
 if(original.targetVersion!=null&&selected.version!==original.targetVersion)return {reviewable:true,approvable:false,reason:'This item changed since extraction. Re-extract the source or make a manual correction.'};
 if(selected.version!==reviewedVersion)return {reviewable:true,approvable:false,reason:'The selected item changed during your review. Read the current value and explicitly review this version.'};
 return {reviewable:true,approvable:true,reason:''};
}

export function publicWatchState(w){
 const comparison={baseline:'First capture saved; there is no earlier comparison.',changed:'Public logistics changed. Review the original before updating the plan.',unchanged:'No logistical change found in the last successful comparison.',unknown:'Last capture saved, but its comparison is unavailable.'}[w.lastSuccessfulComparison]||'No retained comparison is available.';
 if(!w.active)return {label:'Paused',tone:'neutral',detail:'Resume this page to check for updates. '+comparison,canCheck:false};
 if(w.state==='processing')return {label:'Checking page',tone:'review',detail:'The last successful evidence stays available during this check.',canCheck:false};
 if(w.state==='failed')return {label:'Check failed',tone:'error',detail:(w.lastResult||'The page could not be checked.')+' Previous successful evidence is unchanged.',canCheck:true};
 if(w.state==='pending')return {label:'Waiting to check',tone:'review',detail:comparison,canCheck:true};
 return {label:'Watching page',tone:w.lastSuccessfulComparison==='changed'?'attention':'neutral',detail:comparison,canCheck:true};
}
