import { $,esc,icon,link,button,badge,empty,field,area,select,modal,notice,message,formatDate } from '../ui/core.js';
import { header,toast } from '../ui/session.js';

const kinds=[['clinic','Clinic'],['hospital','Hospital'],['pharmacy','Pharmacy'],['home','Home'],['other','Other place']];
let library;
async function mapLibrary(){
 if(!document.querySelector('[data-map-style]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/lib/maplibre/maplibre-gl.css';css.dataset.mapStyle='';document.head.append(css);}
 library??=import('/lib/maplibre/maplibre-gl.mjs');return library;
}
const directions=place=>`https://maps.apple.com/?q=${encodeURIComponent(place.address)}`;
export async function createPlaceMap(container,{places=[],onSelect,onPin,center}={}){
 const lib=await mapLibrary();if(!container.isConnected)return null;
 const first=places.find(p=>p.latitude!=null&&p.longitude!=null),start=center||first&&[first.longitude,first.latitude];
 const map=new lib.Map({container,style:'https://tiles.openfreemap.org/styles/positron',center:start||[0,25],zoom:start?12:1.3,attributionControl:{compact:false},cooperativeGestures:true});
 map.addControl(new lib.NavigationControl({showCompass:false}),'top-right');
 let markers=[];
 const setPlaces=(rows,fit=false)=>{
  markers.forEach(m=>m.remove());markers=[];const bounds=new lib.LngLatBounds();
  for(const p of rows){if(p.latitude==null||p.longitude==null)continue;
   const el=document.createElement('button');el.type='button';el.className='place-marker';el.setAttribute('aria-label',p.name);el.innerHTML=icon('place');el.onclick=()=>onSelect?.(p);
   markers.push(new lib.Marker({element:el,anchor:'bottom'}).setLngLat([p.longitude,p.latitude]).addTo(map));bounds.extend([p.longitude,p.latitude]);
  }
  if(fit&&markers.length)map.fitBounds(bounds,{padding:70,maxZoom:14,duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:350});
 };
 setPlaces(places,true);if(onPin)map.on('click',e=>onPin({longitude:e.lngLat.lng,latitude:e.lngLat.lat}));
 const size=new ResizeObserver(()=>map.resize());size.observe(container);
 return {setPlaces,focus:p=>map.flyTo({center:[p.longitude,p.latitude],zoom:15,essential:false}),destroy(){size.disconnect();map.remove();}};
}
export function placesPage(ctx){
 header(ctx,'Care locations','The places that matter, with practical details close by.',link(ctx.path('/visits'),'Visits','ui-button secondary')+button('Add place','add-place','primary'));
 $('#view-body').innerHTML=`<div class="places-workspace"><section class="places-directory" aria-label="Saved places"><label class="places-search">${icon('search')}<input type="search" aria-label="Filter saved places" placeholder="Find a saved place"></label><div data-places-list><div class="ui-skeleton" role="status">Loading places…</div></div></section><section class="places-map-panel" aria-label="Map"><div class="places-map" data-places-map></div><div class="places-map-status" role="status"></div><div class="places-map-caption">${icon('place')}<span>Select a place for directions and arrival details. Map data: OpenFreeMap / OpenStreetMap.</span></div></section></div><p class="ui-hint places-privacy">The map provider receives the area you view. Care profiles and medical documents are not included in map requests.</p>`;
 let rows=[],map,selected=null,cancelled=false;ctx.add(()=>{cancelled=true;map?.destroy();});
 const mapNode=$('[data-places-map]'),list=$('[data-places-list]'),search=$('.places-search input');
 const render=()=>{const term=search.value.trim().toLowerCase(),shown=rows.filter(p=>`${p.name} ${p.address}`.toLowerCase().includes(term));
  list.innerHTML=shown.length?shown.map(p=>`<article class="place-card ${selected===p._id?'selected':''}" data-key="${esc(p._id)}"><div class="place-card-heading"><span class="place-kind-icon">${icon(p.kind==='home'?'today':'place')}</span><div><button class="place-title" data-show="${esc(p._id)}">${esc(p.name)}</button><span class="row-meta">${esc(kinds.find(k=>k[0]===p.kind)?.[1]||p.kind)} · ${p.visibility==='selected'?'Selected people':'Care space'}</span></div></div><p>${esc(p.address)}</p>${p.entrance?`<p class="place-arrival"><strong>Entrance</strong> ${esc(p.entrance)}</p>`:''}${p.parking?`<p class="place-arrival"><strong>Parking</strong> ${esc(p.parking)}</p>`:''}${p.accessibility?`<p class="place-arrival"><strong>Access</strong> ${esc(p.accessibility)}</p>`:''}<p class="ui-hint">Address confirmed ${esc(formatDate(p.confirmedAt,ctx.household.timezone))}</p><div class="ui-actions"><a class="ui-text-button" href="${directions(p)}" target="_blank" rel="noopener noreferrer">Directions ↗</a><button class="ui-text-button" data-edit="${esc(p._id)}">Details</button>${p.latitude===null?badge('Pin not added','attention'):''}</div></article>`).join(''):empty(term?'No matching places.':'Keep familiar places close.',term?'Try another name or address.':'Add a clinic, pharmacy or another destination for your family’s care.',term?'':button('Add your first place','add-place'));
  map?.setPlaces(shown);
 };
 createPlaceMap(mapNode,{onSelect:p=>{selected=p._id;render();$(`[data-key="${CSS.escape(p._id)}"]`,list)?.scrollIntoView({block:'nearest',behavior:'smooth'});}}).then(value=>{if(cancelled){value?.destroy();return;}map=value;map?.setPlaces(rows,true);}).catch(()=>notice($('.places-map-status'),'The map could not load. Your saved places and directions are still available.'));
 ctx.watch('places:list',{householdId:ctx.id},value=>{rows=value;render();map?.setPlaces(rows,!selected);},error=>notice(list,message(error)));
 search.oninput=render;
 $('#view').addEventListener('click',event=>{const add=event.target.closest('[data-action="add-place"]');if(add)return placeForm(ctx);
  const edit=event.target.closest('[data-edit]');if(edit)return placeForm(ctx,rows.find(p=>p._id===edit.dataset.edit));
  const show=event.target.closest('[data-show]');if(show){const p=rows.find(p=>p._id===show.dataset.show);selected=p._id;render();if(p.latitude!==null)map?.focus(p);}
 });
}
export function placeForm(ctx,place=null,{visitId,taskId,taskVersion,taskAccepted=false,address=''}={}){
 const requestId=crypto.randomUUID();let savedId=place?._id,savedVersion=place?.version,miniMap,pin=place?.latitude!=null?{latitude:place.latitude,longitude:place.longitude}:null;
 const content=`<div class="place-find"><label class="ui-field"><span>Find a public clinic or pharmacy</span><input name="placeQuery" type="search" placeholder="Place name and city" maxlength="240"></label>${button('Search places','search-places')}<p class="ui-hint">Search sends this text to Photon. For a private home, enter the address below and place its pin manually.</p><div data-search-results></div></div><div class="place-pin-map" data-pin-map aria-label="Choose a map pin"></div><p class="ui-hint">Select a result or click the map to position the pin. Confirm the address before saving.</p>${field('name','Place name',place?.name||'','text','required maxlength="160"')}${select('kind','Type of place',kinds,place?.kind||'clinic')}${area('address','Confirmed address',place?.address||address,'required maxlength="1000"')}<details class="place-coordinates"><summary>Pin coordinates</summary><div class="ui-field-pair">${field('latitude','Latitude',pin?.latitude??'','number','step="any" min="-85.051129" max="85.051129"')}${field('longitude','Longitude',pin?.longitude??'','number','step="any" min="-180" max="180"')}</div></details>${field('phone','Phone',place?.phone||'','tel','maxlength="80"')}${field('entrance','Entrance',place?.entrance||'','text','maxlength="1000"')}${field('parking','Parking',place?.parking||'','text','maxlength="1000"')}${field('accessibility','Accessibility',place?.accessibility||'','text','maxlength="1000"')}${select('visibility','Who can see this place',[['household','Everyone in this care space'],['selected','Only me and selected people']],place?.visibility||'household')}<fieldset class="place-readers"><legend>Selected people</legend>${ctx.members.filter(m=>m.membership.userId!==ctx.viewer.id).map(m=>`<label class="ui-check"><input type="checkbox" name="reader" value="${esc(m.membership.userId)}" ${place?.readerIds?.includes(m.membership.userId)?'checked':''}><span>${esc(m.displayName)}</span></label>`).join('')||'<p class="ui-hint">Invite someone from People to share with them.</p>'}</fieldset>${place?`<label class="ui-check"><input type="checkbox" name="reconfirmTasks"><span>If this address or pin changes, ask people with accepted errands here to accept the new destination again.</span></label>`:""}${taskAccepted?`<label class="ui-check"><input type="checkbox" name="requestAcceptance" required><span>Ask the assigned person to accept this new errand destination.</span></label>`:""}${place?`<div class="place-remove">${button('Remove place','remove-place','danger')}</div>`:''}`;
 const dialog=modal({ctx,title:place?'Place details':'Add a care location',content,submit:place?'Save place':'Add place',onSubmit:async data=>{
  const latitude=data.get('latitude')===''?null:Number(data.get('latitude')),longitude=data.get('longitude')===''?null:Number(data.get('longitude'));
  const value={name:data.get('name'),kind:data.get('kind'),address:data.get('address'),phone:data.get('phone'),entrance:data.get('entrance'),parking:data.get('parking'),accessibility:data.get('accessibility'),visibility:data.get('visibility'),readerIds:data.getAll('reader'),latitude,longitude};
  if(savedId){await ctx.mutate('places:edit',{placeId:savedId,expectedVersion:savedVersion,reconfirmTasks:data.has('reconfirmTasks'),...value});savedVersion+=1;}else{savedId=await ctx.mutate('places:create',{householdId:ctx.id,requestId,...value});savedVersion=1;}
  if(visitId)await ctx.mutate('places:linkVisit',{visitId,placeId:savedId});if(taskId)await ctx.mutate('places:linkTask',{taskId,expectedVersion:taskVersion,placeId:savedId,requestAcceptance:data.has('requestAcceptance')});toast(place?'Place updated.':'Place saved.');
 }});dialog.classList.add('place-dialog');
 const stopClose=ctx.add(()=>{if(dialog.isConnected)dialog.close();});let stopAccess;if(place)stopAccess=ctx.watch('places:list',{householdId:ctx.id},rows=>{if(!rows.some(p=>p._id===place._id))dialog.close();},()=>dialog.close());dialog.addEventListener('close',()=>{stopAccess?.();stopClose?.();},{once:true});
 const setPin=p=>{pin=p;$('[name="latitude"]',dialog).value=p.latitude.toFixed(6);$('[name="longitude"]',dialog).value=p.longitude.toFixed(6);miniMap?.setPlaces([{...p,name:'Selected pin'}]);dialog.querySelector('form').dataset.dirty='true';};
 createPlaceMap($('[data-pin-map]',dialog),{places:pin?[{...pin,name:place?.name||'Selected pin'}]:[],onPin:setPin}).then(value=>{if(!dialog.isConnected){value?.destroy();return;}miniMap=value;}).catch(()=>{$('[data-pin-map]',dialog).innerHTML='<p class="ui-hint">Map unavailable. You can enter coordinates or save the address without a pin.</p>';});
 dialog.addEventListener('close',()=>miniMap?.destroy(),{once:true});
 const updateReaders=()=>{$('.place-readers',dialog).hidden=$('[name="visibility"]',dialog).value!=='selected';};updateReaders();$('[name="visibility"]',dialog).onchange=updateReaders;
 $('[name="kind"]',dialog).onchange=e=>{if(e.target.value==='home'){$('[name="visibility"]',dialog).value='selected';updateReaders();}};
 $('[data-action="search-places"]',dialog).onclick=async event=>{const b=event.currentTarget,root=$('[data-search-results]',dialog);b.disabled=true;root.innerHTML='<p role="status">Finding places…</p>';
  try{const results=await ctx.action('placeSearch:search',{householdId:ctx.id,query:$('[name="placeQuery"]',dialog).value});if(!dialog.isConnected)return;
   root.innerHTML=results.length?results.map((p,i)=>`<button class="place-search-result" type="button" data-result="${i}"><strong>${esc(p.name)}</strong><span>${esc(p.address)}</span></button>`).join(''):'<p>No matching places. Try the city and street, or enter the address manually.</p>';
   root.onclick=e=>{const el=e.target.closest('[data-result]');if(!el)return;const p=results[Number(el.dataset.result)];$('[name="name"]',dialog).value=p.name;$('[name="address"]',dialog).value=p.address;setPin(p);miniMap?.focus(p);root.innerHTML='<p class="ui-hint">Location selected. Review the address and pin below.</p>';};
  }catch(error){notice(root,message(error));}finally{b.disabled=false;}
 };
 const remove=$('[data-action="remove-place"]',dialog);if(remove)remove.onclick=()=>modal({ctx,title:'Remove this saved place?',content:'<p>Linked visits must be unlinked before a place can be removed. No visits or responsibilities will be deleted.</p>',submit:'Remove place',destructive:true,onSubmit:async()=>{await ctx.mutate('places:remove',{placeId:place._id,expectedVersion:place.version});dialog.close();toast('Place removed.');}});
 return dialog;
}
export function visitPlaceSection(ctx,root,visit,onPlace){
 return ctx.watch('places:forVisit',{visitId:visit._id},place=>{
  onPlace?.(place);
  root.innerHTML=`<div class="ui-section-heading"><h2>Care location</h2>${button(place?'Change place':'Link a place','link-place')}</div>${place?`<p><strong>${esc(place.name)}</strong></p><p>${esc(place.address)}</p>${place.entrance?`<p>Entrance: ${esc(place.entrance)}</p>`:''}${place.parking?`<p>Parking: ${esc(place.parking)}</p>`:''}${place.phone?`<p>Phone: ${esc(place.phone)}</p>`:''}${visit.confirmedAddress&&visit.confirmedAddress.trim()!==place.address.trim()?'<p class="ui-notice attention">The saved place and confirmed visit address differ. Review the visit details before travelling.</p>':''}${place.accessibility?`<p>Access: ${esc(place.accessibility)}</p>`:''}<div class="ui-actions">${link(ctx.path('/places'), 'View map','ui-button secondary')}<a class="ui-button secondary" href="${directions(place)}" target="_blank" rel="noopener noreferrer">Directions ↗</a>${place.phone&&/^[+\d\s().-]+$/.test(place.phone)?`<a class="ui-button secondary" href="tel:${esc(place.phone.replace(/[^+\d]/g,''))}">Call location</a>`:''}${button('Unlink','unlink-place')}</div>`:'<p>Keep entrance, parking and accessibility details with a saved place.</p>'}`;
  root.onclick=async event=>{const op=event.target.closest('[data-action]')?.dataset.action;
   if(op==='unlink-place'){try{await ctx.mutate('places:linkVisit',{visitId:visit._id,placeId:null});toast('Place unlinked.');}catch(error){ctx.error(error);}return;}
   if(op!=='link-place')return;
   try{const places=await ctx.query('places:list',{householdId:ctx.id});if(!places.length)return placeForm(ctx,null,{visitId:visit._id,address:visit.confirmedAddress});
    const d=modal({ctx,title:'Choose a care location',content:select('placeId','Saved place',places.map(p=>[p._id,p.name+' — '+p.address]),place?._id)+button('Add a new place','new-place'),submit:'Link place',onSubmit:async data=>{await ctx.mutate('places:linkVisit',{visitId:visit._id,placeId:data.get('placeId')});toast('Place linked.');}});
    $('[data-action="new-place"]',d).onclick=()=>{d.close();placeForm(ctx,null,{visitId:visit._id,address:visit.confirmedAddress});};
   }catch(error){ctx.error(error);}
  };
 },error=>{onPlace?.(undefined);notice(root,message(error));});
}

export function taskPlaceSection(ctx,root,task){
 if(task.visitId){root.innerHTML=`<h2>Location</h2><p>${link(ctx.path('/visits/'+task.visitId),'Open the linked visit’s travel and location details →')}</p>`;return ()=>{};}
 return ctx.watch('places:forTask',{taskId:task._id},place=>{
  root.innerHTML=`<div class="ui-section-heading"><h2>Errand location</h2>${button(place?'Change place':'Link a place','link-task-place')}</div>${place?`<p><strong>${esc(place.name)}</strong></p><p>${esc(place.address)}</p>${place.entrance?`<p>Entrance: ${esc(place.entrance)}</p>`:''}${place.parking?`<p>Parking: ${esc(place.parking)}</p>`:''}${place.accessibility?`<p>Access: ${esc(place.accessibility)}</p>`:''}${place.phone?`<p>Phone: ${esc(place.phone)}</p>`:''}<div class="ui-actions">${link(ctx.path('/places'),'View map','ui-button secondary')}<a class="ui-button secondary" href="${directions(place)}" target="_blank" rel="noopener noreferrer">Directions ↗</a>${button('Copy address','copy-task-address')}${button('Unlink','unlink-task-place')}</div>`:task.placeId?'<p>This location is not available to you. Ask the person who manages it to share the practical details.</p>':'<p>Attach a pharmacy, shop or another saved destination. Helpers see its practical details only when the location is shared with them.</p>'}`;
  root.onclick=async event=>{const op=event.target.closest('[data-action]')?.dataset.action;if(!op)return;event.stopPropagation();
   try{if(op==='copy-task-address'){await navigator.clipboard.writeText(place.address);toast('Address copied.');return;}
    if(op==='unlink-task-place'){modal({ctx,title:'Unlink this errand location?',content:'<p>The saved place remains available. If someone has accepted this responsibility, ask them to accept again after its destination is removed.</p>',submit:'Unlink & update request',onSubmit:async()=>{await ctx.mutate('places:linkTask',{taskId:task._id,expectedVersion:task.version,placeId:null,requestAcceptance:true});toast('Location unlinked. Review the updated assignment.');}});return;}
    if(op!=='link-task-place')return;const places=await ctx.query('places:list',{householdId:ctx.id});if(!places.length)return placeForm(ctx,null,{taskId:task._id,taskVersion:task.version,taskAccepted:!!task.ownerId});
    const dialog=modal({ctx,title:'Choose the errand location',content:select('placeId','Saved place',places.map(p=>[p._id,p.name+' — '+p.address]),place?._id)+(task.ownerId?'<label class="ui-check"><input type="checkbox" name="requestAcceptance" required><span>Ask the assigned person to accept the changed errand destination again.</span></label>':'')+'<p class="ui-hint">A private location must be explicitly shared with the assigned helper. Linking does not change its readers.</p>'+button('Add a new place','new-task-place'),submit:'Link place',onSubmit:async data=>{await ctx.mutate('places:linkTask',{taskId:task._id,expectedVersion:task.version,placeId:data.get('placeId'),requestAcceptance:data.has('requestAcceptance')});toast('Errand location linked.');}});
    dialog.querySelector('[data-action="new-task-place"]').onclick=()=>{dialog.close();placeForm(ctx,null,{taskId:task._id,taskVersion:task.version,taskAccepted:!!task.ownerId});};
   }catch(error){ctx.error(error);}
  };
 },error=>notice(root,message(error)));
}
