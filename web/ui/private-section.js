import {$,empty,link,skeleton} from './core.js';
import {header} from './session.js';
// Scope every child subscription so a revoked grant cannot repopulate a page
// after its private contents have been cleared.
export function privateMailSection(parent,title,render){
 let active=false,childAlive=false,navigate;const disposers=new Set();
 const add=fn=>{let live=true;const stop=()=>{if(!live)return;live=false;disposers.delete(stop);fn();};disposers.add(stop);return stop;};
 const child=Object.create(parent);Object.defineProperties(child,{alive:{get:()=>childAlive&&parent.alive},connected:{get:()=>parent.connected},add:{value:add,writable:true,configurable:true},watch:{writable:true,configurable:true,value:(name,args,receive,onError)=>add(parent.watch(name,args,value=>{if(childAlive)receive(value);},error=>{if(childAlive)onError?.(error);}))}});
 const clear=()=>{childAlive=false;for(const stop of [...disposers])stop();};
 header(parent,title,'Private correspondence for the people trusted with care information.');
 const body=()=>parent.viewRoot?.querySelector('[data-view-body]')||$('#view-body');body().innerHTML=skeleton();
 const unsubscribe=parent.watch('inbox:access',{householdId:parent.id},access=>{
  if(access.allowed){if(active)return;active=true;childAlive=true;navigate=render(child);return;}
  const wasActive=active;clear();active=false;if(wasActive)document.querySelectorAll('.ui-dialog').forEach(d=>d.close());
  header(parent,title,'Email may contain medical information.');body().innerHTML=empty('This inbox is shared with the care circle.','Ask the care profile creator for access. Before a care profile is set up, only the household owner can open email.',link(parent.path('/care'),'Care sharing','ui-button secondary'));
 },error=>{clear();active=false;document.querySelectorAll('.ui-dialog').forEach(d=>d.close());header(parent,title);body().innerHTML=empty('Private correspondence is unavailable.','Your access or connection may have changed.');parent.error(error);});
 const stop=()=>{unsubscribe?.();clear();};parent.add(stop);return href=>childAlive&&typeof navigate==='function'?navigate(href):false;
}
