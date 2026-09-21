"use node";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
export const MAX_RECORD_BYTES = 10 * 1024 * 1024;
export async function validateRecordBytes(bytes:Uint8Array,mimeType:string){
 if(!bytes.length||bytes.length>MAX_RECORD_BYTES)throw new Error("Files must contain data and be at most 10 MiB.");
 const valid=mimeType==="application/pdf"?Buffer.from(bytes.subarray(0,5)).toString()==="%PDF-":mimeType==="image/png"?bytes.length>=24&&[137,80,78,71,13,10,26,10].every((value,i)=>bytes[i]===value):mimeType==="image/jpeg"?bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255:false;
 if(!valid)throw new Error("Upload a valid PDF, JPEG or PNG.");
 let pages=1;
 if(mimeType==="application/pdf"){
  const pdf=await PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false,throwOnInvalidObject:true});pages=pdf.getPageCount();
  if(pages<1||pages>100)throw new Error("PDF files must contain between 1 and 100 pages.");
 }
 return {sha256:createHash("sha256").update(bytes).digest("hex"),pages};
}
export const validate=internalAction({args:{storageId:v.id("_storage"),mimeType:v.string()},returns:v.object({sha256:v.string(),pages:v.number()}),handler:async(ctx,args)=>{
 const blob=await ctx.storage.get(args.storageId);if(!blob)throw new Error("File unavailable.");return validateRecordBytes(new Uint8Array(await blob.arrayBuffer()),args.mimeType);
}});
