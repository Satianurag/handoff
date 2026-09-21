"use node";
import {v} from "convex/values";
import {internalAction} from "./_generated/server";
import {internal} from "./_generated/api";
import {mailClient,statusCode} from "./model/agentmail";
import {operationRetryDelay} from "./mail";
import type {ActionCtx} from "./_generated/server";
import type {Id} from "./_generated/dataModel";
export async function removeRaw(ctx:ActionCtx,jobId:Id<"jobs">){
 const resource=await ctx.runMutation(internal.retentionRawStore.prepare,{jobId});if(!resource)return;
 const client=mailClient();
 async function remove(action:()=>Promise<unknown>){try{await action();}catch(error){if(statusCode(error)!==404)throw error;}}
 for(const draftId of resource.draftIds)await remove(()=>client.inboxes.drafts.delete(resource.inboxId,draftId));
 if(resource.messageId)await remove(()=>client.inboxes.messages.delete(resource.inboxId,resource.messageId!));
 else if(resource.label){
  // An uncertain send is reconciled by its private, unique label; never resend.
  let page;try{page=await client.inboxes.messages.list(resource.inboxId,{labels:[resource.label],limit:25});}catch(error){if(statusCode(error)!==404)throw error;await ctx.runMutation(internal.retentionRawStore.finish,{jobId});return;}
  for(const message of page.messages)await remove(()=>client.inboxes.messages.delete(resource.inboxId,message.messageId));
  if(page.nextPageToken)throw new Error("More labelled messages require another cleanup pass.");
 }
 await ctx.runMutation(internal.retentionRawStore.finish,{jobId});
}
export const removeSource=internalAction({args:{jobId:v.id("jobs")},returns:v.object({ok:v.boolean(),retryAfterMs:v.union(v.number(),v.null())}),handler:async(ctx,args)=>{
 const resource=await ctx.runQuery(internal.retentionSourceStore.providerContext,args);if(!resource){await ctx.runMutation(internal.retentionSourceStore.providerRemoved,args);return {ok:true,retryAfterMs:null};}
 try{await mailClient().inboxes.messages.delete(resource.inboxId,resource.messageId);await ctx.runMutation(internal.retentionSourceStore.providerRemoved,args);return {ok:true,retryAfterMs:null};}catch(error){if(statusCode(error)===404){await ctx.runMutation(internal.retentionSourceStore.providerRemoved,args);return {ok:true,retryAfterMs:null};}return {ok:false,retryAfterMs:operationRetryDelay(error)};}
}});
