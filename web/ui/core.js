export const $ = (s, root=document) => root.querySelector(s);
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {
 records:'M5 3h9l5 5v13H5z M14 3v6h5 M8 13h8 M8 17h5', care:'M12 21s-9-5-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 7-9 12-9 12z', place:'M12 22s8-8 8-14a8 8 0 0 0-16 0c0 6 8 14 8 14z M9 8a3 3 0 1 0 6 0 3 3 0 1 0-6 0', search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
 today:'M3 10l9-7 9 7v10H3z M9 20v-7h6v7', plan:'M5 4h14v17H5z M9 2v4 M15 2v4 M8 10h8 M8 14h8 M8 18h5',
 inbox:'M3 5h18v14H3z M3 6l9 7 9-7', history:'M4 7a9 9 0 1 1-1 9 M3 3v5h5 M12 7v5l3 2',
 people:'M15 21v-3a6 6 0 0 0-12 0v3 M16 4a3 3 0 0 1 0 6 M18 14a5 5 0 0 1 3 4v3',
 settings:'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2 2 M16.4 16.4l2 2 M5.6 18.4l2-2 M16.4 7.6l2-2',
 help:'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3 M12 17h.01', arrow:'M5 12h14 M14 7l5 5-5 5', plus:'M12 5v14 M5 12h14', close:'M6 6l12 12 M6 18L18 6', bell:'M5 16V9a7 7 0 0 1 14 0v7l2 2H3z M9 21h6', chevron:'M9 5l7 7-7 7', check:'M5 12l4 4L19 6', calendar:'M3 5h18v16H3z M7 2v6 M17 2v6 M3 10h18', clock:'M12 6v6l4 2', link:'M10 13l4-4 M8 16l-2 2a4 4 0 0 1-6-6l5-5 M16 8l2-2a4 4 0 0 1 6 6l-5 5', logout:'M9 3H3v18h6 M9 12h12 M17 8l4 4-4 4', more:'M5 12h.01 M12 12h.01 M19 12h.01', menu:'M4 6h16 M4 12h16 M4 18h16'
};
export function icon(name) {return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${['clock','help','settings'].includes(name)?'<circle cx="12" cy="12" r="9"/>':''}${name==='people'?'<circle cx="9" cy="7" r="3"/>':''}<path d="${paths[name]||paths.arrow}"/></svg>`;}
export const link = (url,label,cls='')=>`<a class="${cls}" href="${esc(url)}" data-route>${esc(label)}</a>`;
export const button = (label,id,kind='secondary')=>`<button class="ui-button ${kind}" type="button" ${id?`data-action="${esc(id)}"`:''}>${esc(label)}</button>`;
export function badge(label,tone='neutral'){return `<span class="ui-badge ${tone}">${esc(label)}</span>`;}
export function empty(title,body,action=''){return `<div class="ui-empty"><strong>${esc(title)}</strong><p>${esc(body)}</p>${action}</div>`;}
export function skeleton(){return '<div class="ui-skeleton" aria-busy="true" role="status"><span class="sr-only">Loading…</span><i></i><i></i><i></i></div>';}
export const field=(name,label,value='',type='text',extra='')=>`<label class="ui-field"><span>${esc(label)}</span><input name="${esc(name)}" type="${type}" value="${esc(value)}" ${extra}></label>`;
export const area=(name,label,value='',extra='')=>`<label class="ui-field"><span>${esc(label)}</span><textarea name="${esc(name)}" rows="4" ${extra}>${esc(value)}</textarea></label>`;
export const select=(name,label,options,value)=>`<label class="ui-field"><span>${esc(label)}</span><select name="${esc(name)}">${options.map(([id,title])=>`<option value="${esc(id)}" ${String(id)===String(value)?'selected':''}>${esc(title)}</option>`).join('')}</select></label>`;
export function formatDate(value,zone,options={dateStyle:'medium',timeStyle:'short'}) {return value==null?'No due time':new Intl.DateTimeFormat(undefined,{timeZone:zone,...options}).format(value);}
export function localParts(value,zone){if(value==null)return {date:'',time:''};const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(value).map(p=>[p.type,p.value]));return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`};}
export function message(error){return typeof error?.data?.message==='string'?error.data.message:(!navigator.onLine?'You’re offline. Reconnect and try again.':'We couldn’t complete that action. Your entries are still here. Try again.');}
export function notice(root,text,tone='error'){root.innerHTML=`<div class="ui-notice ${tone}" role="${tone==='error'?'alert':'status'}">${esc(text)}</div>`;}
// Restore the same control after a live render, scoped to its keyed record.
// Never move focus out of an editor or dialog elsewhere on the page.
export function focusBookmark(root,active=document.activeElement){
 const owned=root?.contains(active);
 const record=owned?active.closest('[data-key]'):null;
 const key=record&&root.contains(record)?record.dataset.key:null;
 const attribute=owned?['data-action','data-check','href','id','name','aria-label'].find(name=>active.hasAttribute(name)):null;
 const value=attribute?active.getAttribute(attribute):null,tag=active?.tagName;
 return()=>{
 if(!owned||!root.isConnected)return;
 if(active.isConnected){active.focus({preventScroll:true});return;}
 const region=key&&root.dataset.key!==key?root.querySelector(`[data-key="${CSS.escape(key)}"]`):root;
 const replacement=attribute?region?.querySelector(`${tag}[${attribute}="${CSS.escape(value)}"]`):null;
 if(replacement&&!replacement.disabled){replacement.focus({preventScroll:true});return;}
 const section=root.closest('section'),view=root.closest('[data-detail-view],#view');
 const heading=section?.querySelector('h2,h3')||view?.querySelector('h1');
 if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
 };
}
export function preserveFocus(root,render){
 const active=document.activeElement,restore=focusBookmark(root,active);
 render();
 if(!active.isConnected&&(document.activeElement===document.body||document.activeElement===active))restore();
}
// Use for read-only live regions, never an actively edited form.
export function replaceContent(root,html){
 if(root._stableMarkup===html)return;
 preserveFocus(root,()=>{root.innerHTML=html;root._stableMarkup=html;});
}
export function keyedRows(root,rows,render){
 preserveFocus(root,()=>{
 const current=new Map([...root.children].map(el=>[el.dataset.key,el]));
 let position=0;
 for(const row of rows){const key=String(row._id),html=render(row);let el=current.get(key);current.delete(key);
  if(!el){el=document.createElement('div');el.dataset.key=key;root.append(el);}
  if(root.children[position]!==el){const focused=el.contains(document.activeElement)?document.activeElement:null;root.insertBefore(el,root.children[position]??null);focused?.focus({preventScroll:true});}position++;
  if(el._markup!==html){el.innerHTML=html;el._markup=html;}
 }
 for(const el of current.values())el.remove();
 });
}
export function bindActions(root,actions){root.addEventListener('click',event=>{const el=event.target.closest('[data-action]');if(el&&root.contains(el)&&actions[el.dataset.action])actions[el.dataset.action](el,event);});}
let discardPrompt;
export function confirmDiscard() {
 if(discardPrompt)return discardPrompt;
 discardPrompt=new Promise(resolve=>{
  const previous=document.activeElement,dialog=document.createElement('dialog');dialog.className='ui-dialog ui-discard-dialog';
  dialog.setAttribute('aria-labelledby','discard-heading');
  dialog.innerHTML=`<header><h2 id="discard-heading">Leave your changes?</h2></header><div class="ui-dialog-body"><p>Your unsaved changes will be lost. Stay here to finish or save them first.</p></div><footer><button class="ui-button secondary" data-stay autofocus>Keep editing</button><button class="ui-button danger" data-leave>Discard changes</button></footer>`;
  let approved=false;
  dialog.querySelector('[data-stay]').onclick=()=>dialog.close();dialog.querySelector('[data-leave]').onclick=()=>{approved=true;dialog.close();};
  dialog.addEventListener('close',()=>{dialog.remove();discardPrompt=null;if(previous?.isConnected)previous.focus({preventScroll:true});resolve(approved);},{once:true});
  document.body.append(dialog);dialog.showModal();
 });
 return discardPrompt;
}
export function hasUnsavedChanges(root=document){return !!root.querySelector('form[data-dirty="true"]');}
export async function mayLeave(){
 if(document.querySelector('form[aria-busy="true"]'))return false;
 return !hasUnsavedChanges() || await confirmDiscard();
}
function watchDateChoices(root){
 root.addEventListener('input',event=>{
  const input=event.target;
  const groups=input.name==='timezone'?[...root.querySelectorAll('[data-date-fields]')]:['date','time'].includes(input.type)?[input.closest('[data-date-fields]')]:[];
  for(const group of groups){if(!group)continue;const choices=group.querySelector('[data-time-choice]');if(choices){choices.hidden=true;choices.querySelector('select').value='';}if(input.name==='timezone')group.querySelector('.ui-hint').textContent='Times use '+input.value.replaceAll('_',' ')+'.';}
 });
}
// Connection state is applied independently of validation/permission disabling.
// The shell updates mounted forms without adding a subscription per live render.
export function updateFormConnection(root,connected){
 const forms=root.matches?.('form[data-requires-connection]')?[root]:root.querySelectorAll('form[data-requires-connection]');
 for(const form of forms){
  form.dataset.connected=String(connected);
  form.querySelectorAll('[type="submit"]').forEach(button=>button.setAttribute('aria-disabled',String(!connected)));
  const hint=form.querySelector('[data-form-connection]');if(hint){
   hint.hidden=connected;
   hint.textContent=form.getAttribute('aria-busy')==='true'
    ?'Connection interrupted. Your save may already be processing. Reconnect to confirm the result; do not submit it again.'
    :'Reconnect before saving. Your entries stay here.';
  }
 }
}
function prepareConnectionForm(ctx,form){
 if(typeof ctx?.connected!=='boolean'||!form.querySelector('[type="submit"]'))return;
 form.dataset.requiresConnection='true';
 const hint=document.createElement('p');hint.className='ui-hint';hint.dataset.formConnection='';hint.setAttribute('role','status');hint.textContent='Reconnect before saving. Your entries stay here.';
 const status=form.querySelector('.ui-form-status');if(status)status.before(hint);else form.append(hint);
 updateFormConnection(form,ctx.connected);
}
function formCanSave(form){
 if(!form.hasAttribute('data-requires-connection')||form.dataset.connected==='true')return true;
 const status=form.querySelector('.ui-form-status');if(status)notice(status,'Reconnect before saving. Your entries are still here.');return false;
}
function formError(form,error){
 const status=form.querySelector('.ui-form-status');
 if(!status)return null;
 notice(status,message(error));status.tabIndex=-1;
 return [...form.elements].find(el=>el.name===error?.data?.field)||status;
}
export function modal({ctx,title,content,submit='Save',pendingLabel='Saving…',onSubmit,destructive=false,returnFocus=null}){
 const previous=returnFocus||document.activeElement,dialog=document.createElement('dialog');dialog.className='ui-dialog';const id=crypto.randomUUID();dialog.setAttribute('aria-labelledby',id);
 const restoreFocus=focusBookmark(previous?.closest('[data-detail-view],#view')||document.body,previous);
 dialog.innerHTML=`<form><header><h2 id="${id}">${esc(title)}</h2><button type="button" class="icon-button" aria-label="Close">${icon('close')}</button></header><div class="ui-dialog-body">${content}<div class="ui-form-status"></div></div><footer>${button('Cancel','cancel')}${submit?`<button class="ui-button ${destructive?'danger':'primary'}" type="submit">${esc(submit)}</button>`:''}</footer></form>`;
 document.body.append(dialog);watchDateChoices(dialog);prepareConnectionForm(ctx,dialog.querySelector('form'));let dirty=false,busy=false;
 const close=async()=>{if(busy)return;if(dirty&&!await confirmDiscard())return;dialog.close();};
 dialog.querySelector('header button').onclick=close;dialog.querySelector('[data-action="cancel"]').onclick=close;
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('input',()=>{dirty=true;dialog.querySelector('form').dataset.dirty='true';});
 dialog.addEventListener('close',()=>{dialog.remove();restoreFocus();});
 dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();if(busy)return;const form=event.currentTarget;if(!formCanSave(form)||!form.reportValidity())return;
  const data=new FormData(form),controls=[...form.querySelectorAll('input,select,textarea,button')].map(el=>[el,el.disabled]);
  busy=true;form.setAttribute('aria-busy','true');let errorFocus;const b=form.querySelector('[type="submit"]');for(const [el] of controls)el.disabled=true;if(b)b.textContent=pendingLabel;
  try {await onSubmit(data,form);dirty=false;dialog.close();}catch(error){errorFocus=formError(form,error);}finally{busy=false;form.removeAttribute('aria-busy');for(const [el,disabled] of controls)el.disabled=disabled;if(b)b.textContent=submit;updateFormConnection(form,form.dataset.connected==='true');form.dispatchEvent(new Event('handoff:form-idle',{bubbles:true}));if(ctx?.alive!==false&&errorFocus?.isConnected&&!errorFocus.disabled)errorFocus.focus();}
 };
 dialog.showModal();return dialog;
}
export async function resolveDate(ctx,date,time,zone,choice){
 if(!date&&!time)return null;if(!date||!time)throw {data:{message:'Choose both a date and a time, or leave both empty.'}};
 const result=await ctx.query('dates:resolveLocal',{householdId:ctx.id,timezone:zone,date,time,...(choice?{choice}:{})});
 if(result.kind==='gap')throw {data:{message:'That local time does not exist because clocks move forward. Choose a different time.'}};
 if(result.kind==='ambiguous'&&!choice){document.querySelectorAll('[data-time-choice]').forEach(el=>{el.hidden=false;});throw {data:{message:'Clocks repeat this time. Choose first or second occurrence below.'}};}
 return result.choices[0].epochMilliseconds;
}
export const dateFields=(value,zone,prefix='due')=>{const p=localParts(value,zone);return `<div data-date-fields><div class="ui-field-pair">${field(prefix+'Date','Date',p.date,'date')}${field(prefix+'Time','Time',p.time,'time')}</div><div data-time-choice hidden>${select(prefix+'Choice','If clocks repeat this time',[['','Ask me when ambiguous'],['earlier','First occurrence'],['later','Second occurrence']],'')}</div><p class="ui-hint">Times use ${esc(zone.replaceAll('_',' '))}.</p></div>`;};
export function wireForm(ctx,form,handler){
 prepareConnectionForm(ctx,form);watchDateChoices(form);let busy=false;form.addEventListener('input',()=>{form.dataset.dirty='true';});
 form.onsubmit=async event=>{event.preventDefault();if(busy||!formCanSave(form)||!form.reportValidity())return;const data=new FormData(form),controls=[...form.querySelectorAll('input,select,textarea,button')].map(el=>[el,el.disabled]);busy=true;const b=form.querySelector('[type="submit"]'),label=b?.textContent,focused=form.contains(document.activeElement)?document.activeElement:null;form.setAttribute('aria-busy','true');for(const [el] of controls)el.disabled=true;if(b)b.textContent='Saving…';
  let errorFocus;
  try{await handler(data,form);form.dataset.dirty='';}catch(error){errorFocus=formError(form,error);if(!errorFocus)ctx.error(error);}finally{busy=false;form.removeAttribute('aria-busy');for(const [el,disabled] of controls)el.disabled=disabled;if(b)b.textContent=label;updateFormConnection(form,form.dataset.connected==='true');form.dispatchEvent(new Event('handoff:form-idle',{bubbles:true}));if(ctx.alive&&errorFocus?.isConnected&&!errorFocus.disabled)errorFocus.focus();else if(ctx.alive&&focused?.isConnected&&!focused.disabled&&document.activeElement===document.body)focused.focus({preventScroll:true});}
 };
}
export async function allPages(ctx,name,args,limit=251){const rows=[];let cursor=null;do{const result=await ctx.query(name,{...args,paginationOpts:{numItems:Math.min(100,limit-rows.length),cursor}});rows.push(...result.page);if(result.isDone)return rows;if(rows.length>=limit)throw {data:{message:'This selection exceeds the review limit. Narrow the list or close older work before continuing.'}};cursor=result.continueCursor;}while(ctx.alive);return [];}
