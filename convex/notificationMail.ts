"use node";
import type {ActionCtx} from "./_generated/server";
import {env} from "./_generated/server";
import type {Id} from "./_generated/dataModel";
import {internal} from "./_generated/api";
import {mailClient,mailbox,statusCode} from "./model/agentmail";
export async function sendNotification(ctx:ActionCtx,notificationId:Id<"notifications">){
 if(!await ctx.runMutation(internal.notificationStore.prepare,{notificationId}))return true;
 const client=mailClient(),key=`handoff-auth-${env.CONVEX_SITE_URL.split("//")[1].split(".")[0]}`;
 const pod=await client.pods.create({clientId:key,name:"Handoff authentication"});
 const inbox=await client.pods.inboxes.create(pod.podId,{clientId:`${key}-sender`,displayName:"Handoff sign-in"});
 const send=await ctx.runMutation(internal.notificationStore.claim,{notificationId,inboxId:inbox.inboxId});if(!send)return true;
 try{
  const result=await client.inboxes.messages.send(send.inboxId,{to:[send.recipient],subject:send.subject,text:send.body,labels:[`handoff-notification-${notificationId}`]},{idempotencyKey:send.idempotencyKey,maxRetries:0});
  await ctx.runMutation(internal.notificationStore.sent,{notificationId,messageId:result.messageId,threadId:result.threadId});return true;
 }catch(error){const status=statusCode(error);await ctx.runMutation(internal.notificationStore.failed,{notificationId,uncertain:status===null||![400,401,403,422].includes(status)});return false;}
}
export async function reconcileNotification(ctx:ActionCtx,notificationId:Id<"notifications">){
 const send=await ctx.runQuery(internal.notificationStore.read,{notificationId});if(!send||send.retiring||!["unknown","sending"].includes(send.state))return true;
 const client=mailClient();
 try{
  const page=await client.inboxes.messages.list(send.inboxId,{labels:[`handoff-notification-${notificationId}`],limit:2});
  if(page.messages.length===1&&!page.nextPageToken){const m=await client.inboxes.messages.get(send.inboxId,page.messages[0].messageId);
   if(m.to.length===1&&!m.cc?.length&&!m.bcc?.length&&mailbox(m.to[0])===send.recipient&&m.subject===send.subject&&(m.extractedText??m.text??"").trim()===send.body.trim()){
    await ctx.runMutation(internal.notificationStore.sent,{notificationId,messageId:m.messageId,threadId:m.threadId});return true;
   }
  }
 }catch{/* Read failure is not proof that no email was sent. */}
 await ctx.runMutation(internal.notificationStore.failed,{notificationId,uncertain:true});return false;
}
