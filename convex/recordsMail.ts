"use node";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mailClient } from "./model/agentmail";
import { recordCategory } from "./recordsSchema";
import { validateRecordBytes,MAX_RECORD_BYTES } from "./recordsFiles";
const attachment=v.object({attachmentId:v.string(),filename:v.string(),size:v.number(),contentType:v.string()});
export const listAttachments=action({args:{messageId:v.id("mailMessages")},returns:v.array(attachment),handler:async(ctx,args)=>{
 const message=await ctx.runQuery(internal.records.authorizeMessage,args),remote=await mailClient().inboxes.messages.get(message.inboxId,message.providerMessageId);
 await ctx.runQuery(internal.records.authorizeMessage,args);return (remote.attachments??[]).slice(0,100).map(a=>({attachmentId:a.attachmentId,filename:a.filename??"Attachment",size:a.size,contentType:a.contentType??"application/octet-stream"}));
}});
export const importAttachment=action({args:{messageId:v.id("mailMessages"),attachmentId:v.string(),title:v.string(),category:recordCategory,followUpId:v.optional(v.id("followUps")),recordId:v.optional(v.id("records"))},returns:v.id("records"),handler:async(ctx,args):Promise<Id<"records">>=>{
 const message=await ctx.runQuery(internal.records.authorizeMessage,{messageId:args.messageId,recordId:args.recordId,followUpId:args.followUpId});
 if(!args.attachmentId||args.attachmentId.length>500)throw new Error("Choose an attachment.");
 const client=mailClient(),remote=await client.inboxes.messages.get(message.inboxId,message.providerMessageId),listed=remote.attachments?.find(a=>a.attachmentId===args.attachmentId);
 if(!listed||listed.size>MAX_RECORD_BYTES)throw new Error("Attachment unavailable or larger than 10 MiB.");
 const metadata=await client.inboxes.messages.getAttachment(message.inboxId,message.providerMessageId,args.attachmentId);
 const url=new URL(metadata.downloadUrl);if(url.protocol!=="https:"||url.username||url.password)throw new Error("The attachment provider returned an invalid download URL.");
 const mimeType=(metadata.contentType??listed.contentType??"").split(";")[0];if(!["application/pdf","image/jpeg","image/png"].includes(mimeType))throw new Error("Choose a PDF, JPEG or PNG attachment.");
 const response=await fetch(url,{signal:AbortSignal.timeout(30000),redirect:"error"});if(!response.ok||!response.body)throw new Error("The attachment could not be downloaded. Try again.");
 const chunks:Uint8Array[]=[];let size=0;const reader=response.body.getReader();for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>MAX_RECORD_BYTES){await reader.cancel();throw new Error("Attachment exceeds 10 MiB.");}chunks.push(next.value);}const bytes=Buffer.concat(chunks);
 const validated=await validateRecordBytes(bytes,mimeType);await ctx.runQuery(internal.records.authorizeMessage,{messageId:args.messageId,recordId:args.recordId,followUpId:args.followUpId});
 const storageId=await ctx.storage.store(new Blob([bytes],{type:mimeType}));let recordId:Id<"records">;try{recordId=await ctx.runMutation(internal.records.saveUpload,{householdId:message.householdId,recordId:args.recordId,storageId,title:args.title,category:args.category,filename:metadata.filename??listed.filename??"Attachment",mimeType,bytes:size,...validated,sourceMessageId:message._id,sourceAttachmentId:args.attachmentId});}catch(error){await ctx.storage.delete(storageId);throw error;}
 if(args.followUpId)await ctx.runMutation(api.followUpMail.linkRecord,{followUpId:args.followUpId,recordId,linked:true,messageId:args.messageId});return recordId;
}});
