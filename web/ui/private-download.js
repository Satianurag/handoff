// Keep only one prepared file in memory. Invalidation also cancels pending
// preparation, so late responses cannot restore bytes after access is lost.
export function privateDownload({fetchPart,authorize,canUse,createURL=blob=>URL.createObjectURL(blob),revokeURL=url=>URL.revokeObjectURL(url)}){
 let generation=0,current=null;
 function clear(){generation++;if(current)revokeURL(current.url);current=null;}
 async function prepare(part){
  clear();const ticket=generation,valid=()=>ticket===generation&&canUse();
  if(!valid())return null;
  const bytes=await fetchPart(part);
  if(!valid())return null;
  if(!(bytes instanceof ArrayBuffer)||bytes.byteLength!==part.bytes)throw Error('The downloaded file is incomplete. Try preparing it again.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(!valid())return null;
  if(hash!==part.sha256)throw Error('The downloaded file could not be verified. Try preparing it again.');
  // The access check happens after fetching and verifying, before bytes become
  // available through a browser link. The reactive receipt can revoke it later.
  await authorize(part);
  if(!valid())return null;
  current={url:createURL(new Blob([bytes],{type:part.mimeType||(/\.pdf$/i.test(part.filename)?'application/pdf':/\.png$/i.test(part.filename)?'image/png':/\.jpe?g$/i.test(part.filename)?'image/jpeg':'application/x-ndjson')})),filename:part.filename};
  return current;
 }
 return {prepare,clear,get current(){return current;}};
}
