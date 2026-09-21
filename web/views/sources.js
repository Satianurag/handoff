import {evidenceHtml} from '../ui/evidence.js';
import {watchDeadline} from '../time.js';
import {proposalStatuses,proposalStatus,proposalFieldLabels,proposalValueLabel,extractionState} from '../ui/source-state.js';
import {reviewProposal} from './proposal-review.js';
import {preserveReadingPosition} from '../ui/reading-position.js';
import {$,esc,link,button,badge,empty,skeleton,formatDate,notice,message,keyedRows,preserveFocus} from '../ui/core.js';
import {header,paginated} from '../ui/session.js';
const sourceName=kind=>({web:'Public page',email:'Email',manual:'Manual source'}[kind]||'Unavailable source');
const targetPath=(ctx,target)=>ctx.path('/'+(target.kind==='task'?'tasks':'visits')+'/'+target.id);
export function proposalRows(ctx,el,rows){
 preserveReadingPosition(el,()=>{
  if(!rows.length){el.innerHTML=empty('No suggestions in this view.','You can always add or edit confirmed logistics yourself.');return;}
  if(!el.querySelector('[data-key]'))el.innerHTML='';
  keyedRows(el,rows,p=>{
   const target=p.targetInfo,zone=target?.timezone||ctx.household.timezone;
   return `<article class="proposal-card"><div class="ui-section-heading"><h2>${esc(proposalFieldLabels[p.field]||'Suggested detail')}</h2>${badge(proposalStatuses.find(([id])=>id===p.status)?.[1]||'Unavailable',p.status==='pending'?'attention':p.status==='approved'?'success':'neutral')}</div><p>${target?link(targetPath(ctx,target),target.title):p.target?'Matched item unavailable or removed.':'Not matched to a responsibility or visit yet.'}</p><p class="ui-hint">${esc(sourceName(p.sourceKind))}${p.sourceCapturedAt!=null?' · Captured '+esc(formatDate(p.sourceCapturedAt,zone)):''}</p><div class="proposal-values"><div><small>${p.status==='pending'&&target?'Current confirmed value':'Previously recorded'}</small><p>${esc(proposalValueLabel(p.status==='pending'&&target?target.value:p.previousValue,p.field,zone))}</p></div><div><small>${p.status==='approved'?'Confirmed at review':'Suggested'}</small><p>${esc(proposalValueLabel(p.proposedValue,p.field,zone))}</p></div></div>${p.status==='pending'&&target&&p.targetVersion!=null&&target.version!==p.targetVersion?'<p class="ui-notice attention">The item changed after this suggestion was prepared. Review the current details before continuing.</p>':''}${p.sourceAvailable?`<blockquote class="source-quote">${esc(p.quote)}</blockquote>`:'<p class="ui-hint">Original evidence unavailable. Confirm details manually rather than relying on a removed quote.</p>'}${p.reviewedAt?`<p class="ui-hint">Reviewed by ${esc(ctx.name(p.reviewedBy))} · ${esc(formatDate(p.reviewedAt,zone))}</p>`:''}${p.reason?`<p class="detail-prose">${esc(p.reason)}</p>`:''}<div class="ui-actions">${p.sourceAvailable?link(ctx.path('/sources/'+p.sourceId+'?status='+p.status),'Inspect original','ui-button secondary'):''}${p.status==='pending'&&p.sourceAvailable?button('Review suggestion',p._id,'primary'):''}</div></article>`;
  });
 });
 el.onclick=event=>{const b=event.target.closest('[data-action]');if(b)reviewProposal(ctx,rows.find(p=>p._id===b.dataset.action),b);};
}
export function reviewQueue(ctx){
 header(ctx,'Needs review','Review documents, email and public-page changes against their original sources.',link(ctx.path('/records'),'Open records','ui-button secondary')+link(ctx.path('/inbox'),'Open inbox','ui-button secondary'));
 const status=proposalStatus(location.search);
 $('#view-body').innerHTML=`<nav class="ui-segments" aria-label="Suggestion status">${proposalStatuses.map(([key,title])=>`<a data-route href="${ctx.path('/review?status='+key)}" ${status===key?'aria-current="page"':''}>${title}</a>`).join('')}</nav><section class="ui-section"><h2>Medical documents</h2><p class="ui-hint">Only records shared with you appear here. Open the original to approve, edit or dismiss its suggestions.</p><div id="record-proposal-list"></div></section><section class="ui-section"><h2>Email & public pages</h2><div id="proposal-list"></div></section>`;
 if(status==='invalid')$('#record-proposal-list').innerHTML='<p class="ui-hint">Suggestions from older document versions stay in each record’s version history.</p>';
 else paginated(ctx,$('#record-proposal-list'),'recordReview:list',{householdId:ctx.id,status},(el,rows)=>{
  el.innerHTML=rows.length?rows.map(p=>`<article class="proposal-card"><div class="ui-section-heading"><h3>${esc(p.title)}</h3>${badge({pending:'Needs review',approved:'Approved',dismissed:'Dismissed'}[p.status],p.status==='pending'?'attention':p.status==='approved'?'success':'neutral')}</div><p>${link(ctx.path('/records/'+p.recordId),p.recordTitle,'row-title')}</p><p class="ui-hint">${esc(p.filename)} · Page ${p.page}</p><p class="detail-prose">${esc(p.text)}</p><blockquote class="source-quote">${esc(p.quote)}</blockquote>${p.reviewedAt?`<p class="ui-hint">Reviewed ${esc(formatDate(p.reviewedAt,ctx.household.timezone))}</p>`:''}<div class="ui-actions">${link(ctx.path('/records/'+p.recordId),p.canReview&&p.status==='pending'?'Review with original':'Open original','ui-button secondary')}${p.taskId?link(ctx.path('/tasks/'+p.taskId),'Open responsibility','ui-button secondary'):''}</div>${!p.canReview&&p.status==='pending'?'<p class="ui-hint">The uploader reviews changes to this record.</p>':''}</article>`).join(''):empty('No document suggestions in this view.','Upload a record or choose another review status.');
 });
 paginated(ctx,$('#proposal-list'),'proposals:list',{householdId:ctx.id,status},(el,rows)=>proposalRows(ctx,el,rows));
}
export function sourceDetail(ctx,id){
 header(ctx,'Original source','Read the original before confirming a suggested change.',link(ctx.path('/review'),'← Review changes','ui-button secondary'));
 const root=$('#view-body'),status=proposalStatus(location.search);let stopSource,stopProposals,stopPrevious,stopDeadline,deadline,initialized=false,view,rows=[],previousId,busy=false;
 function captured(){const pre=$('[data-captured-text]',root);if(!pre||!view)return;const html=evidenceHtml(view.source.plaintext,rows)||'Original text is unavailable.';if(pre.innerHTML!==html){const top=pre.scrollTop;pre.innerHTML=html;pre.scrollTop=top;}}
 function controls(){
  if(!ctx.alive||!view||!initialized)return;const state=extractionState(view),extract=$('[data-extract]',root);
  extract.disabled=busy||!state.canExtract;extract.textContent=busy?'Requesting extraction…':state.label==='Extraction waiting'?'Waiting to retry':state.label==='Extraction failed'?'Retry extraction':'Extract suggestions';
  $('[data-extraction-state]',root).innerHTML=`${badge(state.label,state.tone)}<p class="ui-hint">${esc(state.detail)}</p>${view.latestExtraction?`<p class="ui-hint">Last extraction update ${esc(formatDate(view.latestExtraction.updatedAt,ctx.household.timezone))}${view.latestExtraction.retryAt?' · Retry available after '+esc(formatDate(view.latestExtraction.retryAt,ctx.household.timezone)):''}.</p>`:''}`;
 }
 function render(){
  const source=view.source;
  if(!initialized){
   initialized=true;root.innerHTML=`<article><div data-source-meta></div><section class="source-processing" aria-label="Source processing"><div data-extraction-state role="status"></div><button class="ui-button secondary" type="button" data-extract>Extract suggestions</button><div data-extraction-error></div></section><div class="source-columns"><section><h2>Captured text</h2><p class="ui-hint" data-current-captured></p><pre class="source-text" data-captured-text></pre></section><section data-previous-section hidden><h2>Previous capture</h2><div data-previous-source></div></section></div><section class="ui-section"><h2>Suggestions from this source</h2><nav class="ui-segments" aria-label="Source suggestion status">${proposalStatuses.map(([key,label])=>`<a data-route href="${ctx.path('/sources/'+id+'?status='+key)}" ${status===key?'aria-current="page"':''}>${label}</a>`).join('')}</nav><p class="ui-hint">Highlighted passages belong to the suggestions loaded in this view.</p><div data-source-proposals></div></section></article>`;
   stopProposals=paginated(ctx,$('[data-source-proposals]',root),'proposals:forSource',{sourceId:id,status},(el,values)=>{rows=values;proposalRows(ctx,el,rows);captured();});
   $('[data-extract]',root).onclick=async()=>{
    if(busy||!extractionState(view).canExtract)return;busy=true;controls();$('[data-extraction-error]',root).innerHTML='';
    try{await ctx.action('generate:extractLogistics',{sourceId:id});}catch(error){if(ctx.alive&&initialized)notice($('[data-extraction-error]',root),message(error));}finally{busy=false;controls();}
   };
  }
  let url=null;try{const parsed=new URL(source.url);if(parsed.protocol==='https:')url=parsed.href;}catch{}
  const comparison={baseline:'First capture — no earlier comparison',changed:'Public page changed',unchanged:'No logistical change found',unknown:'Comparison unavailable'}[source.comparison];
  $('[data-source-meta]',root).innerHTML=`<div class="ui-actions">${badge(sourceName(source.kind))}${comparison?badge(comparison,source.comparison==='changed'?'attention':'neutral'):''}${url?`<a class="ui-button secondary" href="${esc(url)}" rel="noopener noreferrer" target="_blank" referrerpolicy="no-referrer">Open public original</a>`:''}${view.threadAvailable?link(ctx.path('/inbox/'+source.threadId),'Open conversation','ui-button secondary'):''}</div>${url?`<p class="ui-hint detail-prose">${esc(url)}</p>`:''}${source.kind==='email'?`<p class="ui-hint">${view.sender?'Actual sender: '+esc(view.sender)+(view.receivedAt!=null?' · Received '+esc(formatDate(view.receivedAt,ctx.household.timezone)):''):'Original email sender metadata is unavailable.'} Names quoted inside a forwarded message are not verified sender identities.</p>`:''}${source.publishedAt!=null?`<p class="ui-hint">Published ${esc(formatDate(source.publishedAt,ctx.household.timezone))}.</p>`:''}${source.kind==='web'?'<p class="ui-hint">Public information can confirm entrances and logistics, but cannot establish a private appointment time.</p>':''}${source.truncated?'<p class="ui-notice attention">This source was truncated. Review the original for omitted context.</p>':''}${source.warnings.map(w=>`<p class="ui-notice attention">${esc(w)}</p>`).join('')}`;
  $('[data-current-captured]',root).textContent='Captured '+formatDate(source.capturedAt,ctx.household.timezone);
  controls();captured();
  if(deadline!==view.latestExtraction?.retryAt){stopDeadline?.();deadline=view.latestExtraction?.retryAt;stopDeadline=deadline?watchDeadline(deadline,controls):undefined;}
  $('[data-previous-section]',root).hidden=!source.previousSourceId;
  if(previousId!==source.previousSourceId){
   previousId=source.previousSourceId;stopPrevious?.();
   if(previousId){const previousRoot=$('[data-previous-source]',root);previousRoot.innerHTML=skeleton();stopPrevious=ctx.watch('sources:get',{sourceId:previousId},previous=>{if(!initialized)return;previousRoot.innerHTML=`<p class="ui-hint">Captured ${esc(formatDate(previous.capturedAt,ctx.household.timezone))}</p>${previous.truncated?'<p class="ui-notice attention">The previous capture was truncated.</p>':''}<pre class="source-text">${esc(previous.plaintext||'Previous text unavailable.')}</pre>`;},()=>{if(initialized)previousRoot.innerHTML='<p class="ui-hint">The previous original is no longer available. No comparison has been invented.</p>';});}
  }
 }
 function connect(){
  stopSource?.();stopDeadline?.();deadline=undefined;root.innerHTML=skeleton();initialized=false;view=null;rows=[];previousId=undefined;
  stopSource=ctx.watch('sources:view',{sourceId:id},value=>{view=value;if(view.source.householdId!==ctx.id)return ctx.unavailable();render();},error=>{
   initialized=false;view=null;stopProposals?.();stopPrevious?.();stopDeadline?.();
   preserveFocus(root,()=>{root.innerHTML=error?.data?.code==='NOT_FOUND'?empty('Original source unavailable.','It may have been removed under the household’s retention or deletion choices. Confirm changes manually rather than relying on a missing quote.'):`<div data-source-error></div>${button('Retry loading source','retry-source')}`;});
   if($('[data-source-error]',root)){notice($('[data-source-error]',root),message(error));$('[data-action="retry-source"]',root).onclick=connect;}
  });
 }
 ctx.add(()=>{stopSource?.();stopProposals?.();stopPrevious?.();stopDeadline?.();});connect();
}
