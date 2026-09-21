"use node";
import {Webhook} from "svix";
import {z} from "zod";
import {v} from "convex/values";
import {internalAction,env} from "./_generated/server";
import {internal} from "./_generated/api";
import {digest} from "./model/sourceText";
const base=z.object({inbox_id:z.string().min(1).max(320),message_id:z.string().min(1).max(1000),timestamp:z.string().max(100)});
const event=z.object({event_id:z.string().min(1).max(200),event_type:z.string().max(100),message:base.optional(),send:base.optional(),delivery:base.optional(),bounce:base.optional(),reject:base.optional(),complaint:base.optional()});
export const receive=internalAction({
 args:{raw:v.string(),id:v.string(),timestamp:v.string(),signature:v.string()},returns:v.number(),
 handler:async(ctx,args):Promise<number>=>{
  if(!env.AGENTMAIL_WEBHOOK_SECRET)return 503;
  let raw:unknown;
  // Svix 2.5 verifies bytes and returns undefined; parse only after verification.
  try{new Webhook(env.AGENTMAIL_WEBHOOK_SECRET).verify(args.raw,{"svix-id":args.id,"svix-timestamp":args.timestamp,"svix-signature":args.signature});raw=JSON.parse(args.raw);}catch{return 400;}
  const parsed=event.safeParse(raw);if(!parsed.success)return 400;
  const e=parsed.data;
  const body=e.event_type.startsWith("message.received")?e.message:e.event_type==="message.sent"?e.send:e.event_type==="message.delivered"?e.delivery:e.event_type==="message.bounced"?e.bounce:e.event_type==="message.rejected"?e.reject:e.event_type==="message.complained"?e.complaint:null;
  if(!body)return 204;
  const occurredAt=Date.parse(body.timestamp);if(!Number.isFinite(occurredAt)||occurredAt<0||occurredAt>Date.now()+300000)return 400;
  const stored=await ctx.runMutation(internal.webhookStore.receive,{providerEventId:e.event_id,eventType:e.event_type,inboxId:body.inbox_id,providerMessageId:body.message_id,occurredAt,payloadHash:digest(args.raw)});
  return stored?204:409;
 }
});
