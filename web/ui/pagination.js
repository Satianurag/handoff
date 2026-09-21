// Native Convex cursor pages, including the split protocol used by its official
// pagination client. Keep the original page until both replacement pages exist.
let nextPaginationId = 0;
export function watchPages({watch, name, args, receive, size=25}) {
  let roots=[], dead=false, queued=false, pagingId=++nextPaginationId;
  let error=null, fatalError=null, invalidResetUsed=false, automaticEmptyPages=0;
  let heldRows=null,restoreCount=0;
  const schedule=()=>{if(!dead&&!queued){queued=true;queueMicrotask(flush);}};
  function stopQuery(node){
    if(!node.listening)return;node.listening=false;node.stop?.();
  }
  function disposeNode(node){stopQuery(node);node.children?.forEach(disposeNode);}
  function subscribe(opts){
    const node={opts:{numItems:size,...opts,id:pagingId},result:null,children:null,listening:true,stop:null,error:null};
    const stop=watch(name,{...args,paginationOpts:node.opts},value=>{
      if(dead||!node.listening)return;
      node.result=value;node.error=null;
      if(value.pageStatus==='SplitRequired'&&!value.splitCursor)node.error={data:{message:'This list could not finish updating. Reload the list to try again.'}};
      if(value.splitCursor&&!node.children&&(value.pageStatus==='SplitRequired'||value.pageStatus==='SplitRecommended'||value.page.length>size*2)){
        if(value.splitCursor===node.opts.cursor||value.splitCursor===value.continueCursor){
          node.error={data:{message:'This list could not finish updating. Reload the list to try again.'}};
        }else node.children=[subscribe({...node.opts,endCursor:value.splitCursor}),subscribe({...node.opts,cursor:value.splitCursor,endCursor:value.continueCursor})];
      }
      schedule();
    },failure=>{
      if(dead||!node.listening)return;
      const invalid=failure?.data?.paginationError==='InvalidCursor'||String(failure?.message||'').includes('InvalidCursor');
      if(invalid&&!invalidResetUsed){invalidResetUsed=true;queueMicrotask(()=>{if(!dead&&node.listening)restart();});return;}
      node.error=failure;schedule();
    });
    node.stop=stop;if(!node.listening)stop();return node;
  }
  function ready(node){
    if(node.children)return node.children.every(ready);
    return !!node.result&&!node.error&&node.result.pageStatus!=='SplitRequired';
  }
  function nestedError(node){return node.error||node.children?.map(nestedError).find(Boolean)||null;}
  function collect(node,values){
    if(node.children){
      if(node.children.every(ready)){stopQuery(node);for(const child of node.children)if(!collect(child,values))return false;return true;}
      // Continue showing the complete parent while a recommended split loads.
      error ||= nestedError(node);
      if(node.listening&&node.result?.pageStatus!=='SplitRequired'){values.push(node.result);return true;}
      return false;
    }
    if(node.error){error=node.error;return false;}
    if(!node.result||node.result.pageStatus==='SplitRequired')return false;
    values.push(node.result);return true;
  }
  function snapshot(){
    const pages=[];error=fatalError;let complete=true;
    for(const node of roots)if(!collect(node,pages)){complete=false;break;}
    const rows=[...new Map(pages.flatMap(page=>page.page).map(row=>[row._id,row])).values()];
    const last=pages.at(-1);
    return {rows,status:error?'error':!complete?'loading':last?.isDone?'done':'more',error,last};
  }
  function flush(){
    queued=false;if(dead)return;
    const state=snapshot();
    // A clock refresh starts with fresh cursors, but retains the reader's loaded
    // extent until the replacement catches up or reaches the end.
    if(heldRows&&(state.status==='done'||state.rows.length>=restoreCount||(state.status==='more'&&automaticEmptyPages>=10))){heldRows=null;restoreCount=0;}
    receive({rows:heldRows??state.rows,status:heldRows&&state.status!=='error'?'loading':state.status,error:state.error});
    if(state.status==='more'&&state.last?.page.length===0&&automaticEmptyPages<10){automaticEmptyPages++;append(state.last.continueCursor);}
    else if(state.last?.page.length){automaticEmptyPages=0;if(heldRows&&state.status==='more')append(state.last.continueCursor);}
  }
  function append(cursor){
    if(roots.some(node=>node.opts.cursor===cursor)){
      fatalError={data:{message:'The list returned a repeated page. Reload the list to continue.'}};schedule();return;
    }
    roots.push(subscribe({cursor}));schedule();
  }
  function restart(){
    roots.forEach(disposeNode);roots=[];error=null;fatalError=null;automaticEmptyPages=0;pagingId=++nextPaginationId;
    roots.push(subscribe({cursor:null}));schedule();
  }
  restart();
  return {
    setArgs(nextArgs){if(dead||JSON.stringify(args)===JSON.stringify(nextArgs))return;heldRows=heldRows??snapshot().rows;restoreCount=heldRows.length;args=nextArgs;invalidResetUsed=false;restart();},
    loadMore(){if(dead)return;const state=snapshot();if(state.status==='more')append(state.last.continueCursor);},
    retry(){if(!dead){invalidResetUsed=false;restart();}},
    dispose(){if(dead)return;dead=true;roots.forEach(disposeNode);roots=[];},
  };
}
