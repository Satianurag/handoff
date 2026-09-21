import { $,esc,link,empty,skeleton,formatDate,notice,message } from '../ui/core.js';
import { scope } from '../ui/session.js';
import { packMarkup } from './care.js';
import { watchDeadline } from '../time.js';

export function mountSharedPack({auth,viewer,go,isCurrent,shareId}){
 const life=scope(auth.client),ctx={...life,auth,externalPack:true,get alive(){return life.alive&&isCurrent();}};
 document.title='Shared visit pack — Handoff';
 $('#app').innerHTML=`<main id="main" class="privacy-workspace"><header class="product-heading"><div><a class="wordmark" href="/">Handoff</a><h1 tabindex="-1">Shared visit pack</h1><p>Private access for ${esc(viewer.email||'your verified account')}.</p></div>${link('/households','My households','ui-button secondary')}</header><div id="shared-status"></div><div id="shared-content">${skeleton()}</div></main>`;
 const root=$('#app'),content=$('#shared-content'),status=$('#shared-status');$('h1',root).focus({preventScroll:true});let stopDeadline,printCopy,current;
 const cleanupPrint=()=>{printCopy?.remove();printCopy=null;document.body.classList.remove('care-printing');};
 const clear=()=>{stopDeadline?.();stopDeadline=null;current=null;cleanupPrint();};
 const unavailable=()=>{clear();content.innerHTML=empty('This shared pack is unavailable.','It may have expired, been revoked, or be intended for another verified email account. Ask the sender for a new private share.');};
 const configure=data=>{ctx.household={timezone:data.timezone};ctx.name=()=>data.creatorDisplayName;};
 const print=async()=>{
  const button=content.querySelector('[data-print]');if(button)button.disabled=true;
  try{const data=await auth.client.query('careShares:shared',{shareId});if(!ctx.alive)return;if(!data)return unavailable();configure(data);cleanupPrint();printCopy=document.createElement('div');printCopy.className='care-print-active';printCopy.innerHTML=packMarkup(ctx,data.pack);document.body.append(printCopy);document.body.classList.add('care-printing');window.print();}
  catch(error){if(ctx.alive)notice(status,message(error));}
  finally{if(button?.isConnected)button.disabled=false;}
 };
 const nav=e=>{const a=e.target.closest('a[data-route]');if(a&&e.button===0&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey){e.preventDefault();go(a.getAttribute('href'));}};
 root.addEventListener('click',nav);ctx.add(()=>root.removeEventListener('click',nav));window.addEventListener('afterprint',cleanupPrint);ctx.add(()=>window.removeEventListener('afterprint',cleanupPrint));
 if(!shareId){unavailable();return()=>life.dispose();}
 ctx.watch('careShares:shared',{shareId},data=>{
  if(!ctx.alive)return;if(!data)return unavailable();if(current&&JSON.stringify(current)===JSON.stringify(data))return;clear();current=data;configure(data);status.innerHTML='';
  content.innerHTML=`<div class="care-pack-tools"><button class="ui-button primary" type="button" data-print>Print / save PDF</button><p class="ui-hint">Access expires ${esc(formatDate(data.expiresAt,data.timezone))}. This is one reviewed snapshot. Original record files are listed separately and require their own private share. Downloaded or printed copies cannot be revoked.</p></div>${packMarkup(ctx,data.pack)}`;
  content.querySelector('[data-print]').onclick=print;stopDeadline=watchDeadline(data.expiresAt,expired=>{if(expired&&ctx.alive)unavailable();});
 },error=>{unavailable();if(ctx.alive)notice(status,message(error));});
 return()=>{clear();life.dispose();};
}
