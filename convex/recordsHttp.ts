import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
const maxBytes=10*1024*1024;
function headers(request:Request){return {"Access-Control-Allow-Origin":request.headers.get("Origin")??"*","Access-Control-Allow-Headers":"Authorization, Content-Type, X-Filename","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Cache-Control":"private, no-store","Vary":"Origin","X-Content-Type-Options":"nosniff"};}
export const options=httpAction(async(_ctx,request)=>new Response(null,{status:204,headers:headers(request)}));
export const file=httpAction(async(ctx,request)=>{
 const h=headers(request);try{
  if(!await ctx.auth.getUserIdentity())return new Response("Sign in to access records.",{status:401,headers:h});const params=new URL(request.url).searchParams;
  if(request.method==="GET"){
   const exportPartId=params.get("exportPartId") as Id<"exportParts">|null;if(exportPartId){const storageId=await ctx.runQuery(internal.privacyExportStore.authorize,{partId:exportPartId,now:Date.now()}),blob=await ctx.storage.get(storageId);if(!blob)return new Response("Export unavailable.",{status:404,headers:h});const current=await ctx.runQuery(internal.privacyExportStore.authorize,{partId:exportPartId,now:Date.now()});if(current!==storageId)throw new Error("Export changed");return new Response(blob,{headers:{...h,"Content-Type":blob.type||"application/octet-stream"}});}

   const shareId=params.get("shareId") as Id<"recordShares">|null;const versionId=params.get("versionId") as Id<"recordVersions">;if(!versionId&&!shareId)return new Response("Version required.",{status:400,headers:h});
   const file=shareId?await ctx.runQuery(internal.records.authorizeSharedFile,{shareId}):await ctx.runQuery(internal.records.authorizeFile,{versionId});const blob=await ctx.storage.get(file.storageId);if(!blob)return new Response("File unavailable.",{status:404,headers:h});if(shareId)await ctx.runQuery(internal.records.authorizeSharedFile,{shareId});else await ctx.runQuery(internal.records.authorizeFile,{versionId});
   return new Response(blob,{headers:{...h,"Content-Type":file.mimeType,"Content-Disposition":`inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`}});
  }
  const householdId=params.get("householdId") as Id<"households">,recordId=(params.get("recordId")??undefined) as Id<"records">|undefined;await ctx.runQuery(internal.records.authorizeUpload,{householdId,recordId});
  const mimeType=(request.headers.get("Content-Type")??"").split(";")[0];if(!["application/pdf","image/jpeg","image/png"].includes(mimeType))return new Response("Upload a PDF, JPEG or PNG.",{status:415,headers:h});
  const reader=request.body?.getReader();if(!reader)return new Response("File required.",{status:400,headers:h});const chunks:Uint8Array[]=[];let size=0;
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>maxBytes){await reader.cancel();return new Response("Files must be at most 10 MiB.",{status:413,headers:h});}chunks.push(part.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const valid=mimeType==="application/pdf"?new TextDecoder().decode(bytes.slice(0,5))==="%PDF-":mimeType==="image/png"?bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71:bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(!valid)return new Response("The file does not match its format.",{status:400,headers:h});
  const storageId=await ctx.storage.store(new Blob([bytes],{type:mimeType}));try{
   const validated=await ctx.runAction(internal.recordsFiles.validate,{storageId,mimeType});
   const category=params.get("category")??"other";if(!["report","referral","prescription","discharge","insurance","authority","other"].includes(category))throw new Error("Invalid category");
   const id=await ctx.runMutation(internal.records.saveUpload,{householdId,recordId,storageId,title:params.get("title")??"Untitled record",category:category as "report"|"referral"|"prescription"|"discharge"|"insurance"|"authority"|"other",filename:decodeURIComponent(request.headers.get("X-Filename")??"record"),mimeType,bytes:size,...validated});
   return Response.json({recordId:id},{headers:h});
  }catch(error){await ctx.storage.delete(storageId);throw error;}
 }catch{return new Response("Record unavailable, access changed, or upload invalid. Refresh and try again.",{status:400,headers:h});}
});
