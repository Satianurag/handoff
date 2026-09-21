"use node";
import { randomUUID } from "node:crypto";
import { v, ConvexError } from "convex/values";
import { action, internalAction, type ActionCtx, env } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { fail, email } from "./model/access";
import { contentHash } from "./model/mail";
import { digest } from "./model/sourceText";
import { mailClient, mailbox, providerDraftHash, statusCode, syncLists, providerRetryDelay } from "./model/agentmail";

export function operationRetryDelay(error:unknown):number|null{
 if(error instanceof ConvexError){const data=error.data;if(data&&typeof data==="object"&&!Array.isArray(data)){
  if("retryAfterMs" in data&&typeof data.retryAfterMs==="number")return data.retryAfterMs;
  if("code" in data&&typeof data.code==="string"&&["BUSY","CONTACTS_CHANGED","DRAFT_CHANGED","MAILBOX_NOT_READY"].includes(data.code))return data.code==="BUSY"?120000:30000;
 }return null;}
 const status=statusCode(error);return status===null||[408,429,500,502,503,504].includes(status)?providerRetryDelay(error):null;
}
function operationFailure(error:unknown,code:string,message:string):never{throw new ConvexError({code,message,retryAfterMs:operationRetryDelay(error)});}

export async function provisionMailbox(ctx: ActionCtx, householdId: Id<"households">): Promise<void> {
  const state = await ctx.runMutation(internal.mailStore.provisionContext, { householdId });
  const client = mailClient();
  let creatingInbox = false;
  try {
    const resourceKey = `handoff-${env.CONVEX_SITE_URL.split("//")[1].split(".")[0]}-${householdId}`;
    const pod = state.account.podId ? await client.pods.get(state.account.podId) : await client.pods.create({ clientId: resourceKey, name: "Handoff household" });
    await ctx.runMutation(internal.mailStore.resourceCheckpoint, { householdId, podId: pod.podId });
    creatingInbox = !state.account.inboxId;
    const inbox = state.account.inboxId ? await client.inboxes.get(state.account.inboxId) : await client.pods.inboxes.create(pod.podId, { clientId: `${resourceKey}-family`, displayName: state.household.mode === "demo" ? "Handoff synthetic household" : "Handoff" });
    creatingInbox = false;
    await ctx.runMutation(internal.mailStore.resourceCheckpoint, { householdId, podId: pod.podId, inboxId: inbox.inboxId, address: inbox.email });
    // Close all three directions before exposing a newly provisioned address.
    if (!state.account.inboxId) await syncLists(client, inbox.inboxId, { send: [], receive: [], reply: [] });
    creatingInbox = !!state.demo && !state.demo.officeInboxId;
    const office = state.demo ? state.demo.officeInboxId ? await client.inboxes.get(state.demo.officeInboxId) : await client.pods.inboxes.create(pod.podId, { clientId: `${resourceKey}-office`, displayName: "Sample office — synthetic demo" }) : null;
    creatingInbox = false;
    if (office) await syncLists(client, office.inboxId, { send: [inbox.email], receive: [inbox.email], reply: [inbox.email] });
    const active = await ctx.runMutation(internal.mailStore.provisioned, { householdId, podId: pod.podId, inboxId: inbox.inboxId, address: inbox.email, ...(office ? { officeInboxId: office.inboxId, officeAddress: office.email } : {}) });
    if (active) await syncContacts(ctx, householdId);
  } catch (error) {
    let capacityReached = false;
    // Confirm account capacity only after an inbox creation was denied. A 403
    // from another operation is not evidence that the inbox limit was reached.
    if (creatingInbox && statusCode(error) === 403) {
      try {
        const organization = await client.organizations.get();
        capacityReached = typeof organization.inboxLimit === "number" && Number.isFinite(organization.inboxLimit) && organization.inboxCount >= organization.inboxLimit;
      } catch { /* Preserve the original failure when usage cannot be checked. */ }
    }
    await ctx.runMutation(internal.mailStore.accountFailed, { householdId, operation: "provision", capacityReached, ...(statusCode(error) ? { providerStatus: statusCode(error)! } : {}) });
    if (capacityReached) throw new ConvexError({ code: "MAIL_CAPACITY_REACHED", message: "Handoff’s email service has reached its mailbox limit. The operator must free or add capacity before setup can finish. Records, visits and responsibilities remain available.", retryAfterMs: null });
    operationFailure(error,"MAIL_PROVISION_FAILED", "Mailbox provisioning did not finish. Its stable resource identity makes retry safe.");
  }
}

export async function syncContacts(ctx: ActionCtx, householdId: Id<"households">): Promise<void> {
  const token = randomUUID();
  const state = await ctx.runMutation(internal.mailStore.beginContactSync, { householdId, token });
  try {
    await syncLists(mailClient(), state.inboxId, state);
    const ready = await ctx.runMutation(internal.mailStore.finishContactSync, { householdId, token, version: state.version });
    if (!ready) fail("CONTACTS_CHANGED", "Contacts changed during synchronization. Sync the current permissions again.");
  } catch (error) {
    await ctx.runMutation(internal.mailStore.accountFailed, { householdId, operation: "contacts", token });
    operationFailure(error,"CONTACT_SYNC_FAILED", "Email contact policies could not be synchronized. Sending is paused until retry succeeds.");
  }
}

export async function syncProviderDraft(ctx: ActionCtx, draftId: Id<"mailDrafts">): Promise<void> {
  const token = randomUUID();
  const state = await ctx.runMutation(internal.mailStore.beginDraftSync, { draftId, token });
  const client = mailClient();
  let providerDraftId = state.draft.providerDraftId;
  try {
    const d = state.draft;
    if (!providerDraftId) {
      const created = await client.inboxes.drafts.create(state.inboxId, { clientId: `handoff-draft-${draftId}`, to: [d.recipient], subject: d.subject, text: d.body, ...(d.inReplyTo ? { inReplyTo: d.inReplyTo } : {}) });
      providerDraftId = created.draftId;
    }
    const current = await client.inboxes.drafts.get(state.inboxId, providerDraftId);
    if (current.inReplyTo !== d.inReplyTo || current.forwardOf || current.sendStatus) fail("PROVIDER_DRAFT_MISMATCH", "Provider draft threading changed unexpectedly.");
    await client.inboxes.drafts.update(state.inboxId, providerDraftId, { to: [d.recipient], cc: [], bcc: [], replyTo: [], subject: d.subject, text: d.body, html: null, sendAt: null, removeAttachments: (current.attachments ?? []).map(a => a.attachmentId) });
    const saved = await client.inboxes.drafts.get(state.inboxId, providerDraftId);
    if (providerDraftHash(saved) !== d.contentHash) fail("PROVIDER_DRAFT_MISMATCH", "Provider draft does not match the reviewed content.");
    const fresh = await ctx.runMutation(internal.mailStore.finishDraftSync, { draftId, token, version: d.version, providerDraftId, success: true });
    if (!fresh) fail("DRAFT_CHANGED", "A newer draft version needs synchronization.");
  } catch (error) {
    await ctx.runMutation(internal.mailStore.finishDraftSync, { draftId, token, version: state.draft.version, ...(providerDraftId ? { providerDraftId } : {}), success: false });
    operationFailure(error,"DRAFT_SYNC_FAILED", "Draft was not saved to the email service. Retry before approving.");
  }
}

export async function sendApproved(ctx: ActionCtx, sendIntentId: Id<"sendIntents">): Promise<void> {
  const state = await ctx.runQuery(internal.mailStore.sendContext, { sendIntentId });
  if (state.intent.state === "sent" || state.intent.state === "cancelled") return;
  if (["sending", "unknown"].includes(state.intent.state)) { await reconcileSend(ctx, sendIntentId); return; }
  if (state.intent.state !== "approved") return;
  const client = mailClient();
  let claimed = false;
  try {
    const remote = await client.inboxes.drafts.get(state.inboxId, state.intent.providerDraftId);
    claimed = await ctx.runMutation(internal.mailStore.claimSend, { sendIntentId, providerHash: providerDraftHash(remote) });
    if (!claimed) return;
    // No SDK retry: uncertain transport outcomes enter reconciliation. A future
    // explicit safe retry must reuse this same immutable intent/key within 24h.
    const sent = await client.inboxes.drafts.send(state.inboxId, state.intent.providerDraftId, { addLabels: [`handoff-send-${sendIntentId}`] }, { idempotencyKey: state.intent.idempotencyKey, maxRetries: 0 });
    await ctx.runMutation(internal.mailStore.sent, { sendIntentId, messageId: sent.messageId, threadId: sent.threadId });
  } catch (error) {
    const code = statusCode(error);
    const definitelyRejected = code !== null && [400, 401, 403, 422].includes(code);
    await ctx.runMutation(internal.mailStore.sendFailed, { sendIntentId, uncertain: claimed && !definitelyRejected, onlyIfUnstarted: !claimed });
  }
}

export async function reconcileSend(ctx: ActionCtx, sendIntentId: Id<"sendIntents">): Promise<void> {
  const { intent, draft, inboxId } = await ctx.runQuery(internal.mailStore.sendContext, { sendIntentId });
  if (intent.state === "sent" || !["sending", "unknown"].includes(intent.state)) return;
  await ctx.runMutation(internal.mailStore.reconciliationChecked,{sendIntentId});
  const client = mailClient();
  try {
    const result = await client.inboxes.messages.list(inboxId, { labels: [`handoff-send-${sendIntentId}`], limit: 2 });
    if (result.messages.length === 1 && !result.nextPageToken) {
      const message = await client.inboxes.messages.get(inboxId, result.messages[0].messageId);
      if (message.to.length === 1 && !message.cc?.length && !message.bcc?.length && mailbox(message.to[0]) === intent.recipient && message.subject === intent.subject && (message.extractedText ?? message.text ?? "").trim() === intent.body.trim() && message.inReplyTo === draft.inReplyTo) {
        await ctx.runMutation(internal.mailStore.sent, { sendIntentId, messageId: message.messageId, threadId: message.threadId }); return;
      }
    }
  } catch { /* Retain uncertain status. A provider outage is not evidence of no send. */ }
  await ctx.runMutation(internal.mailStore.sendFailed, { sendIntentId, uncertain: true });
}

export const provision = action({ args: { householdId: v.id("households") }, returns: v.null(), handler: async (ctx, args): Promise<null> => { await ctx.runMutation(internal.operationStore.request,{...args,kind:"provisionMail"}); return null; } });
export const syncContactPolicies = action({ args: { householdId: v.id("households") }, returns: v.null(), handler: async (ctx, args): Promise<null> => { await ctx.runMutation(internal.operationStore.request,{...args,kind:"syncContacts"}); return null; } });
export const syncDraft = action({ args: { draftId: v.id("mailDrafts") }, returns: v.null(), handler: async (ctx, args): Promise<null> => { const draft=await ctx.runQuery(api.drafts.get,args);await ctx.runMutation(internal.operationStore.request,{...args,householdId:draft.householdId,kind:"syncDraft"}); return null; } });
export const send = action({ args: { sendIntentId: v.id("sendIntents") }, returns: v.null(), handler: async (ctx, args): Promise<null> => { const intent=await ctx.runQuery(api.sendIntents.get,args);await ctx.runMutation(internal.operationStore.request,{...args,householdId:intent.householdId,kind:"sendApprovedDraft"}); return null; } });
export const reconcile = action({ args: { sendIntentId: v.id("sendIntents") }, returns: v.null(), handler: async (ctx, args): Promise<null> => { await ctx.runQuery(api.sendIntents.get, args); await reconcileSend(ctx, args.sendIntentId); return null; } });
export const provisionInternal = internalAction({ args: { householdId: v.id("households") }, returns: v.null(), handler: async (ctx, args): Promise<null> => { await provisionMailbox(ctx, args.householdId); return null; } });
export const syncContactsInternal = internalAction({ args: { householdId: v.id("households") }, returns: v.null(), handler: async (ctx, args): Promise<null> => { await syncContacts(ctx, args.householdId); return null; } });
export const syncDraftInternal = internalAction({ args: { draftId: v.id("mailDrafts") }, returns: v.null(), handler: async (ctx, args): Promise<null> => { await syncProviderDraft(ctx, args.draftId); return null; } });
export const sendInternal = internalAction({ args: { sendIntentId: v.id("sendIntents") }, returns: v.null(), handler: async (ctx, args): Promise<null> => { await sendApproved(ctx, args.sendIntentId); return null; } });

export const sendOtp = internalAction({
  args: { address: v.string(), token: v.string() }, returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const address = email(args.address);
    if (!/^\d{8}$/.test(args.token)) fail("INVALID_CODE", "Invalid verification request.");
    await ctx.runMutation(internal.mailStore.otpQuota, { addressHash: digest(address) });
    const client = mailClient();
    try {
      const key = `handoff-auth-${env.CONVEX_SITE_URL.split("//")[1].split(".")[0]}`;
      const pod = await client.pods.create({ clientId: key, name: "Handoff authentication" });
      const inbox = await client.pods.inboxes.create(pod.podId, { clientId: `${key}-sender`, displayName: "Handoff sign-in" });
      await client.inboxes.messages.send(inbox.inboxId, { to: [address], subject: "Your Handoff sign-in code", text: `Your Handoff sign-in code is ${args.token}. It expires in 15 minutes. If you did not request it, ignore this email.` }, { idempotencyKey: `otp-${digest(`${address}:${args.token}`)}` });
    } catch { fail("EMAIL_UNAVAILABLE", "The sign-in code could not be sent. Try again shortly."); }
    return null;
  },
});

async function ingestProvider(ctx:ActionCtx,args:{inboxId:string;messageId:string;forceQuarantine?:boolean}):Promise<Id<"mailMessages">|null>{
 const state=await ctx.runQuery(internal.mailStore.inboundContext,{inboxId:args.inboxId});
 if(!state||(state.household.expiresAt&&state.household.expiresAt<=Date.now()))return null;
 const message=await mailClient().inboxes.messages.get(args.inboxId,args.messageId);
 if(message.inboxId!==args.inboxId||message.labels.includes("sent"))return null;
 const text=message.extractedText??message.text??"",to=message.to.map(mailbox);
 const routingAmbiguous=!!args.forceQuarantine||!state.account.address||!to.includes(state.account.address.toLowerCase())||(message.cc?.length??0)>0||message.labels.some(label=>["spam","blocked","unauthenticated"].includes(label));
 return ctx.runMutation(internal.mailStore.ingest,{inboxId:args.inboxId,messageId:message.messageId,threadId:message.threadId,from:mailbox(message.from),to,subject:message.subject??"(No subject)",plaintext:text.slice(0,150000),occurredAt:message.timestamp.getTime(),attachmentOnly:!text.trim(),isReply:!!message.inReplyTo,routingAmbiguous});
}
export const ingestMessage=internalAction({args:{inboxId:v.string(),messageId:v.string()},returns:v.union(v.id("mailMessages"),v.null()),handler:ingestProvider});
export const ingestForWorkflow=internalAction({
 args:{inboxId:v.string(),messageId:v.string(),quarantine:v.boolean()},returns:v.object({messageId:v.union(v.id("mailMessages"),v.null()),failed:v.boolean(),retryAfterMs:v.union(v.number(),v.null())}),
 handler:async(ctx,args)=>{
  try{return {messageId:await ingestProvider(ctx,{...args,forceQuarantine:args.quarantine}),failed:false,retryAfterMs:null};}
  catch(error){const status=statusCode(error);return {messageId:null,failed:true,retryAfterMs:!(error instanceof ConvexError)&&(status===null||[408,429,500,502,503,504].includes(status))?providerRetryDelay(error):null};}
 }
});

export const demoOfficeMessage = action({
  args: { householdId: v.id("households"), scenario: v.union(v.literal("initial"), v.literal("reply")) }, returns: v.object({ messageId: v.string(), threadId: v.string() }),
  handler: async (ctx, args): Promise<{ messageId: string; threadId: string }> => {
    const { account, demo } = await ctx.runQuery(internal.mailStore.demoContext, { householdId: args.householdId });
    if (demo.expiresAt <= Date.now()) fail("EXPIRED", "Demo expired.");
    const client = mailClient();
    const key = `handoff-demo-${args.householdId}-${args.scenario}`;
    if (args.scenario === "initial") {await ctx.runMutation(internal.mailStore.demoSendAllowance,{householdId:args.householdId});return client.inboxes.messages.send(demo.officeInboxId!, { to: [account.address!], subject: "Synthetic visit logistics", text: "SYNTHETIC DEMO — Sample office. Please use the east entrance for the sample visit. Parking is in Lot A. This message is scripted and contains no real patient information." }, { idempotencyKey: key });}
    const received = await client.inboxes.messages.list(demo.officeInboxId!, { labels: ["received"], limit: 1 });
    if (!received.messages[0]) return fail("NO_QUESTION", "Send the reviewed sample question first.");
    await ctx.runMutation(internal.mailStore.demoSendAllowance,{householdId:args.householdId});
    return client.inboxes.messages.reply(demo.officeInboxId!, received.messages[0].messageId, { to: [account.address!], text: "SYNTHETIC DEMO — Scripted office reply: please use the west entrance. Parking remains in Lot A. Please review this update." }, { idempotencyKey: key });
  },
});

async function removeProviderData(ctx:ActionCtx,args:{privacyJobId:Id<"privacyJobs">}):Promise<null>{
    const state = await ctx.runMutation(internal.mailStore.cleanupContext, args);
    const client = mailClient();
    const remove = async (operation: () => Promise<unknown>) => { try { await operation(); } catch (error) { if (statusCode(error) !== 404) throw error; } };
    try {
      if (state.job.kind === "deleteDraft" && state.draft?.providerDraftId && state.account?.inboxId) await remove(() => client.inboxes.drafts.delete(state.account!.inboxId!, state.draft!.providerDraftId!));
      if (state.job.kind === "deleteThread" && state.thread){
        let cursor:string|null=null;
        for(;;){const page:{draftIds:string[];cursor:string;done:boolean}=await ctx.runQuery(internal.mailStore.cleanupDraftsPage,{...args,cursor});
          for(const draftId of page.draftIds)await remove(()=>client.inboxes.drafts.delete(state.thread!.inboxId,draftId));
          if(page.done)break;cursor=page.cursor;
        }
        await remove(() => client.inboxes.threads.delete(state.thread!.inboxId, state.thread!.providerThreadId));
      }
      if(state.job.kind==="delete"){
        let cursor:string|null=null;
        for(;;){const page:{messages:{inboxId:string;threadId?:string;notificationId:Id<"notifications">;state:string}[];cursor:string;done:boolean}=await ctx.runQuery(internal.mailStore.cleanupNotificationPage,{...args,cursor});
          for(const message of page.messages){
            if(message.threadId)await remove(()=>client.inboxes.threads.delete(message.inboxId,message.threadId!));
            else if(["sending","unknown"].includes(message.state)){
              const matches=await client.inboxes.messages.list(message.inboxId,{labels:[`handoff-notification-${message.notificationId}`],limit:20});
              if(matches.nextPageToken)fail("CLEANUP_LIMIT","Notification cleanup needs operator review.");
              for(const sent of matches.messages)await remove(()=>client.inboxes.threads.delete(message.inboxId,sent.threadId));
            }
          }
          if(page.done)break;cursor=page.cursor;
        }
      }
      if (state.job.kind === "delete" && state.account?.podId) {
        // A pod belongs exclusively to this household, including its demo office.
        // List from page one after each deletion batch; never skip shifted rows.
        for (let batch = 0; batch < 10; batch++) {
          let inboxes;
          try { inboxes = await client.pods.inboxes.list(state.account.podId, { limit: 20 }); }
          catch (error) { if (statusCode(error) === 404) break; throw error; }
          for (const inbox of inboxes.inboxes) await remove(() => client.inboxes.delete(inbox.inboxId));
          if (!inboxes.nextPageToken) break;
          if (batch === 9) fail("CLEANUP_LIMIT", "Provider cleanup needs another batch.");
        }
        await remove(() => client.pods.delete(state.account!.podId!));
      }
      await ctx.runMutation(internal.mailStore.providerCleaned, { ...args, success: true });
    } catch(error) {
      await ctx.runMutation(internal.mailStore.providerCleaned, { ...args, success: false });
      operationFailure(error,"PROVIDER_CLEANUP_FAILED", "Email provider deletion is incomplete. Its receipt remains pending for retry.");
    }
    return null;
}
export const cleanupProvider=internalAction({args:{privacyJobId:v.id("privacyJobs")},returns:v.null(),handler:removeProviderData});
export const cleanupForWorkflow=internalAction({args:{privacyJobId:v.id("privacyJobs")},returns:v.object({ok:v.boolean(),retryAfterMs:v.union(v.number(),v.null())}),handler:async(ctx,args)=>{
 try{await removeProviderData(ctx,args);return {ok:true,retryAfterMs:null};}catch(error){return {ok:false,retryAfterMs:operationRetryDelay(error)};}
}});
