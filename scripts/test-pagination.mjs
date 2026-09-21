import {test} from 'node:test';
import assert from 'node:assert/strict';
import {watchPages} from '../web/ui/pagination.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
 const queries=[],states=[];
 const controller=watchPages({name:'tasks:list',args:{status:'open'},receive:s=>states.push(s),watch:(_n,args,ok,fail)=>{
  const q={args,ok,fail,stopped:false};queries.push(q);return()=>{assert.equal(q.stopped,false,'unsubscribe exactly once');q.stopped=true;};
 }});
 return {controller,queries,states,last:()=>states.at(-1)};
}
const page=(ids,cursor,isDone=false,extra={})=>({page:ids.map(_id=>({_id})),continueCursor:cursor,isDone,...extra});
test('loads all pages once, prevents duplicate clicks, and ignores updates after disposal',async()=>{
 const h=harness();h.queries[0].ok(page(['a','b'],'two'));await tick();h.controller.loadMore();h.controller.loadMore();assert.equal(h.queries.length,2);
 h.queries[1].ok(page(['b','c'],'end',true));await tick();assert.deepEqual(h.last().rows.map(x=>x._id),['a','b','c']);assert.equal(h.last().status,'done');
 h.controller.dispose();h.controller.dispose();const count=h.states.length;h.queries[0].ok(page(['later'],'end',true));await tick();assert.equal(h.states.length,count);assert.ok(h.queries.every(q=>q.stopped));
});
test('recommended split retains parent until both bounded children arrive',async()=>{
 const h=harness();h.queries[0].ok(page(['a','b'],'end',false,{splitCursor:'middle',pageStatus:'SplitRecommended'}));await tick();
 assert.deepEqual(h.last().rows.map(x=>x._id),['a','b']);assert.equal(h.queries[1].args.paginationOpts.endCursor,'middle');assert.equal(h.queries[2].args.paginationOpts.cursor,'middle');assert.equal(h.queries[2].args.paginationOpts.endCursor,'end');
 h.queries[1].ok(page(['a','inserted'],'middle'));await tick();assert.deepEqual(h.last().rows.map(x=>x._id),['a','b']);
 h.queries[2].ok(page(['b'],'end',true));await tick();assert.deepEqual(h.last().rows.map(x=>x._id),['a','inserted','b']);assert.equal(h.queries[0].stopped,true);assert.equal(h.last().status,'done');h.controller.dispose();
});
test('required split never treats a partial page as a complete list',async()=>{
 const h=harness();h.queries[0].ok(page(['a'],'end',true,{splitCursor:'middle',pageStatus:'SplitRequired'}));await tick();assert.equal(h.last().status,'loading');assert.deepEqual(h.last().rows,[]);
 h.queries[1].ok(page(['a'],'middle'));h.queries[2].ok(page(['b'],'end',true));await tick();assert.equal(h.last().status,'done');assert.deepEqual(h.last().rows.map(x=>x._id),['a','b']);h.controller.dispose();
});
test('filters can cross empty pages without falsely claiming an empty finished result',async()=>{
 const h=harness();h.queries[0].ok(page([],'next'));await tick();assert.equal(h.queries.length,2);assert.equal(h.last().status,'loading');
 h.queries[1].ok(page(['match'],'end',true));await tick();assert.deepEqual(h.last().rows.map(x=>x._id),['match']);assert.equal(h.last().status,'done');h.controller.dispose();
});
test('invalid cursor restarts once, repeated failure is visible, explicit retry is recoverable',async()=>{
 const h=harness();h.queries[0].fail(Error('InvalidCursor'));await tick();assert.equal(h.queries[0].stopped,true);assert.equal(h.queries.length,2);
 h.queries[1].fail(Error('InvalidCursor'));await tick();assert.equal(h.last().status,'error');assert.equal(h.queries.length,2);
 h.controller.retry();h.queries[2].ok(page(['recovered'],'end',true));await tick();assert.equal(h.last().status,'done');assert.equal(h.last().rows[0]._id,'recovered');h.controller.dispose();
});
test('missing split boundary fails visibly instead of loading forever',async()=>{
 const h=harness();h.queries[0].ok(page(['partial'],'end',true,{pageStatus:'SplitRequired'}));await tick();
 assert.equal(h.last().status,'error');assert.deepEqual(h.last().rows,[]);h.controller.dispose();
});
test('split child failure preserves complete parent and retry releases every subscription',async()=>{
 const h=harness();h.queries[0].ok(page(['a','b'],'end',true,{splitCursor:'middle',pageStatus:'SplitRecommended'}));await tick();
 h.queries[1].ok(page(['a'],'middle'));h.queries[2].fail(Error('Connection unavailable'));await tick();
 assert.equal(h.last().status,'error');assert.deepEqual(h.last().rows.map(x=>x._id),['a','b']);
 h.controller.retry();assert.ok(h.queries.slice(0,3).every(q=>q.stopped));h.queries[3].ok(page(['a','b','c'],'end',true));await tick();assert.equal(h.last().status,'done');h.controller.dispose();
});
test('repeated page cursor fails without a request loop',async()=>{
 const h=harness();h.queries[0].ok(page(['a'],'two'));await tick();h.controller.loadMore();
 h.queries[1].ok(page(['b'],'two'));await tick();h.controller.loadMore();await tick();
 assert.equal(h.last().status,'error');assert.equal(h.queries.length,2);h.controller.dispose();
});
test('clock refresh rebuilds cursors and preserves the previously loaded extent until replacement is complete',async()=>{
 const h=harness();h.queries[0].ok(page(['a','b'],'two'));await tick();h.controller.loadMore();h.queries[1].ok(page(['c','d'],'end',true));await tick();
 h.controller.setArgs({status:'open',now:100});await tick();assert.equal(h.last().status,'loading');assert.deepEqual(h.last().rows.map(x=>x._id),['a','b','c','d']);assert.ok(h.queries.slice(0,2).every(q=>q.stopped));
 assert.equal(h.queries[2].args.now,100);assert.equal(h.queries[2].args.paginationOpts.cursor,null);
 h.queries[2].ok(page(['b','c'],'next-new'));await tick();assert.equal(h.queries.length,4);assert.deepEqual(h.last().rows.map(x=>x._id),['a','b','c','d']);
 h.queries[3].ok(page(['d','e'],'end',true));await tick();assert.equal(h.last().status,'done');assert.deepEqual(h.last().rows.map(x=>x._id),['b','c','d','e']);
 h.controller.setArgs({status:'open',now:200});h.queries[4].ok(page(['e'],'end',true));await tick();assert.deepEqual(h.last().rows.map(x=>x._id),['e']);h.controller.dispose();
});
