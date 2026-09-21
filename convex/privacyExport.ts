import {v} from "convex/values";
import {action,internalAction} from "./_generated/server";
import {internal} from "./_generated/api";
import {digest} from "./model/sourceText";
export const buildPage=internalAction({args:{privacyJobId:v.id("privacyJobs"),table:v.string(),cursor:v.union(v.string(),v.null()),pageNumber:v.number()},returns:v.object({cursor:v.string(),done:v.boolean()}),handler:async(ctx,args):Promise<{cursor:string;done:boolean}>=>{
 const page=await ctx.runQuery(internal.privacyExportStore.page,{privacyJobId:args.privacyJobId,table:args.table,cursor:args.cursor});
 if(page.rows){
  const blob=new Blob([page.text],{type:"application/x-ndjson"}),storageId=await ctx.storage.store(blob),partKey=`${args.table}:${String(args.pageNumber).padStart(8,"0")}`;
  try{await ctx.runMutation(internal.privacyExportStore.saved,{privacyJobId:args.privacyJobId,partKey,filename:`${args.table}-${String(args.pageNumber).padStart(6,"0")}.ndjson`,storageId,bytes:blob.size,sha256:digest(page.text),rows:page.rows,accessRecordIds:page.accessRecordIds,requiresCareAccess:page.requiresCareAccess,requiresMailAccess:page.requiresMailAccess,visitPackIds:page.visitPackIds,accessPlaceIds:page.accessPlaceIds});}catch(e){await ctx.storage.delete(storageId);throw e;}
 }
 return {cursor:page.cursor,done:page.done};
}});
export const download=action({args:{partId:v.id("exportParts")},returns:v.bytes(),handler:async(ctx,args):Promise<ArrayBuffer>=>{
 const storageId=await ctx.runQuery(internal.privacyExportStore.authorize,{...args,now:Date.now()});
 const blob=await ctx.storage.get(storageId);if(!blob)throw new Error("Export unavailable or expired.");
 const bytes=await blob.arrayBuffer();
 const authorizedId=await ctx.runQuery(internal.privacyExportStore.authorize,{...args,now:Date.now()});
 if(authorizedId!==storageId)throw new Error("Export changed. Try downloading the current file again.");
 return bytes;
}});
// Called after the browser receives/verifies the bytes. An action forces a new
// server read instead of reusing the receipt query cached by ConvexClient.
export const confirmDownload=action({args:{partId:v.id("exportParts")},returns:v.null(),handler:async(ctx,args):Promise<null>=>{
 await ctx.runQuery(internal.privacyExportStore.authorize,{...args,now:Date.now()});
 return null;
}});

export const buildFilePage=internalAction({args:{privacyJobId:v.id("privacyJobs"),cursor:v.union(v.string(),v.null())},returns:v.object({cursor:v.string(),done:v.boolean()}),handler:async(ctx,args):Promise<{cursor:string;done:boolean}>=>{
 const page=await ctx.runQuery(internal.privacyExportStore.filePage,args);
 for(const file of page.files){const blob=await ctx.storage.get(file.storageId);if(!blob)throw new Error("A saved record original is unavailable. Export did not complete.");const bytes=await blob.arrayBuffer(),hash=await crypto.subtle.digest("SHA-256",bytes),storageId=await ctx.storage.store(new Blob([bytes],{type:blob.type}));try{await ctx.runMutation(internal.privacyExportStore.saved,{privacyJobId:args.privacyJobId,partKey:`record-file:${file._id}`,filename:`${file._id}-${file.filename}`,storageId,bytes:blob.size,sha256:Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join(""),rows:1,accessRecordIds:[file.recordId]});}catch(error){await ctx.storage.delete(storageId);throw error;}}
 return {cursor:page.cursor,done:page.done};
}});
