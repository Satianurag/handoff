import { $,esc,link,empty,skeleton,formatDate,notice,message } from '../ui/core.js';
import { scope } from '../ui/session.js';
import { previewVersion } from './records.js';
import { watchDeadline } from '../time.js';
export function mountSharedRecord({auth,viewer,go,isCurrent,shareId}){
 const life=scope(auth.client),ctx={...life,auth,get alive(){return life.alive&&isCurrent();}};
 document.title='Shared care record — Handoff';
 $('#app').innerHTML=`<main id="main" class="privacy-workspace"><header class="product-heading"><div><a class="wordmark" href="/">Handoff</a><h1 tabindex="-1">Shared care record</h1><p>Private access for ${esc(viewer.email||'your verified account')}.</p></div>${link('/households','My households','ui-button secondary')}</header><div id="shared-status"></div><div id="shared-content">${skeleton()}</div></main>`;
 const root=$('#app'),content=$('#shared-content');$('h1',root).focus({preventScroll:true});let stopPreview,stopDeadline,shown;
 const clear=()=>{stopPreview?.();stopPreview=null;stopDeadline?.();stopDeadline=null;shown=null;};
 const unavailable=()=>{clear();content.innerHTML=empty('This shared file is unavailable.','It may have expired, been revoked, or be intended for another verified email account. Ask the sender for a new private share.');};
 const nav=e=>{const a=e.target.closest('a[data-route]');if(a&&e.button===0&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey){e.preventDefault();go(a.getAttribute('href'));}};root.addEventListener('click',nav);ctx.add(()=>root.removeEventListener('click',nav));
 if(!shareId){unavailable();return()=>life.dispose();}
 ctx.watch('records:shared',{shareId},data=>{if(!ctx.alive)return;if(!data)return unavailable();if(shown===data.versionId)return;clear();shown=data.versionId;content.innerHTML=`<article><h2>${esc(data.title)}</h2><p class="ui-hint">Access expires ${esc(formatDate(data.expiresAt,Intl.DateTimeFormat().resolvedOptions().timeZone))}. This grants access to one original file, not the household.</p><div data-preview></div></article>`;stopPreview=previewVersion(ctx,content.querySelector('[data-preview]'),{_id:data.versionId,filename:data.filename},{shareId});stopDeadline=watchDeadline(data.expiresAt,expired=>{if(expired&&ctx.alive)unavailable();});},error=>{unavailable();if(ctx.alive)notice($('#shared-status'),message(error));});
 return()=>{clear();life.dispose();};
}
