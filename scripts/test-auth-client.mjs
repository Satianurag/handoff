import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const source = (await readFile(new URL('../web/auth-client.js', import.meta.url), 'utf8')).replace(/export /g, '') + '\nthis.adapter={readTokens,hasSession,fetchToken,signIn,signInSample,signOut,getClient:()=>client};';
function harness({path="/sign-in",sharedLocal=new Map()}={}) {
  const data = sharedLocal, sessionData=new Map(), events = [], listeners = new Map(), clients = [];
  const state = { action: async () => ({ tokens: { token: 'test-token', refreshToken: 'test-refresh' } }) };
  class Client { constructor(){clients.push(this)} setAuth(fn){this.auth=fn} async close(){this.closed=true} }
  class Http { setAuth(){} clearAuth(){} action(...args){return state.action(...args)} }
  const storage = { getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k) };
  const window = { convex: { ConvexClient: Client, ConvexHttpClient: Http }, HANDOFF_CONFIG: { convexUrl:'https://test.convex.cloud' }, addEventListener:(name,fn)=>listeners.set(name,fn), dispatchEvent:e=>{events.push(e);listeners.get(e.type)?.(e);} };
  const sessionStore={getItem:k=>sessionData.get(k)??null,setItem:(k,v)=>sessionData.set(k,v),removeItem:k=>sessionData.delete(k)};
  const context = vm.createContext({window,localStorage:storage,sessionStorage:sessionStore,location:{pathname:path,search:""},navigator:{},URL,URLSearchParams,Event,CustomEvent});
  vm.runInContext(source, context);
  return { ...context.adapter, state, data, sessionData, events, clients, listeners };
}
test('failed remote sign-out still removes tokens and closes private cache',async()=>{
 const h=harness();await h.signIn('synthetic@example.test','test-code');const previous=h.getClient();
 h.state.action=async()=>{throw Error('offline')};
 await assert.rejects(h.signOut());assert.equal(h.hasSession(),false);assert.equal(previous.closed,true);
 assert.equal(h.events.at(-1).detail.remoteRevoked,false);
});
test('permanently invalid refresh clears session, transient transport failure preserves it',async()=>{
 const h=harness();await h.signIn('synthetic@example.test','test-code');
 h.state.action=async()=>{throw Error('offline')};await assert.rejects(h.fetchToken({forceRefreshToken:true}));assert.equal(h.hasSession(),true);
 h.state.action=async()=>({tokens:null});assert.equal(await h.fetchToken({forceRefreshToken:true}),null);assert.equal(h.hasSession(),false);
});
test('cross-tab sign-out closes previous cache and in-flight refresh cannot restore session',async()=>{
 const h=harness();await h.signIn('synthetic@example.test','test-code');let finish;
 h.state.action=()=>new Promise(resolve=>{finish=resolve});const refresh=h.fetchToken({forceRefreshToken:true});
 const previous=h.getClient(), key=[...h.data.keys()][0];h.data.clear();h.listeners.get('storage')({key});
 finish({tokens:{token:'stale-new-token',refreshToken:'stale-new-refresh'}});
 assert.equal(await refresh,null);assert.equal(h.hasSession(),false);assert.equal(previous.closed,true);
});
test('stale invalid refresh cannot clear a newer account sign-in',async()=>{
 const h=harness();await h.signIn('synthetic@example.test','test-code');let finish;
 h.state.action=()=>new Promise(resolve=>{finish=resolve});const refresh=h.fetchToken({forceRefreshToken:true});
 h.state.action=async()=>({tokens:{token:'second-user-token',refreshToken:'second-user-refresh'}});await h.signIn('another@example.test','test-code');finish({tokens:null});
 assert.equal(await refresh,'second-user-token');assert.equal(h.readTokens().token,'second-user-token');
});

test('real account and two sample roles keep separate tokens and sign-out boundaries',async()=>{
 const sharedLocal=new Map(),real=harness({sharedLocal}),maya=harness({path:'/demo',sharedLocal}),leo=harness({path:'/demo/join',sharedLocal});
 real.state.action=async()=>({tokens:{token:'real-token',refreshToken:'real-refresh'}});await real.signIn('synthetic@example.test','test-code');
 maya.state.action=async()=>({tokens:{token:'maya-token',refreshToken:'maya-refresh'}});await maya.signInSample();
 leo.state.action=async()=>({tokens:{token:'leo-token',refreshToken:'leo-refresh'}});await leo.signInSample('one-use-test-token');
 assert.equal(real.readTokens().token,'real-token');assert.equal(maya.readTokens().token,'maya-token');assert.equal(leo.readTokens().token,'leo-token');
 assert.equal(sharedLocal.size,1);assert.equal(maya.sessionData.size,1);assert.equal(leo.sessionData.size,1);
 const key=[...sharedLocal.keys()][0];leo.listeners.get('storage')({key});assert.equal(leo.readTokens().token,'leo-token');
 await leo.signOut();assert.equal(leo.hasSession(),false);assert.equal(maya.readTokens().token,'maya-token');assert.equal(real.readTokens().token,'real-token');
 await real.signOut();assert.equal(maya.readTokens().token,'maya-token');
});
