// Keep the first visible keyed row at its current offset while rows arrive or
// change above it. No smooth scrolling unless the reader asks to jump.
export function preserveReadingPosition(root,render){
 const host=root.closest('[data-reading-scroll]')||document.scrollingElement;
 const top=host===document.scrollingElement?0:host.getBoundingClientRect().top;
 const bottom=host===document.scrollingElement?innerHeight:host.getBoundingClientRect().bottom;
 const anchor=[...root.querySelectorAll('[data-key]')].find(el=>{const r=el.getBoundingClientRect();return r.bottom>top&&r.top<bottom;});
 const oldTop=anchor?.getBoundingClientRect().top,oldScroll=host.scrollTop;
 render();
 if(anchor?.isConnected)host.scrollTop=oldScroll+anchor.getBoundingClientRect().top-oldTop;
 else host.scrollTop=oldScroll;
}

export function messageUpdateState(previous,rows){
 const watermark=rows.reduce((max,row)=>Math.max(max,row._creationTime),previous?.watermark??-1);
 return {watermark,newReplies:previous?rows.filter(row=>row.direction==='inbound'&&row._creationTime>previous.watermark).map(row=>row._id):[]};
}
