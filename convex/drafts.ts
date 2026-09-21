import { requireMailAccess, canReadMail } from "./model/mailAccess";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import {linkEvidence} from "./model/sourceUses";
import {startPrivacy} from "./model/privacy";
import { queueOperation } from "./model/operations";
import { v } from "convex/values";
import schema from "./schema";
import { entity, sourceRef, jobState } from "./validators";
import { checkVersion, email, fail, member, text, userMutation, userQuery } from "./model/access";
import { authorizeEntity } from "./model/entities";
import { contentHash, permittedRecipient, validateEvidence } from "./model/mail";
import { priorRequest, saveRequest } from "./model/requests";
import { digest } from "./model/sourceText";

export const get = userQuery({
  args: { draftId: v.id("mailDrafts") }, returns: schema.doc("mailDrafts"),
  handler: async (ctx, args) => { const draft = await ctx.db.get(args.draftId); if (!draft || draft.state === "deleted") return fail("NOT_FOUND", "Draft unavailable."); await requireMailAccess(ctx, draft.householdId); return draft; },
});

// Read the operation for this exact saved version, rather than a recent page
// of household jobs which could omit it or describe an older draft version.
export const mailboxStatus = userQuery({
  args: { draftId: v.id("mailDrafts") },
  returns: v.object({ state: v.union(jobState,v.null()), editable: v.boolean(), ready: v.boolean(), lastError: v.optional(v.string()), blocker: v.union(v.literal("emailPaused"),v.literal("mailboxUnavailable"),v.literal("senderNeedsReview"),v.null()), threadId:v.optional(v.id("mailThreads")) }),
  handler: async (ctx,args) => {
    const draft=await ctx.db.get(args.draftId);
    if(!draft||draft.state==="deleted")return fail("NOT_FOUND","Draft unavailable.");
    const {household}=await requireMailAccess(ctx, draft.householdId);
    const job=await ctx.db.query("jobs").withIndex("by_householdId_and_operationKey",q=>q.eq("householdId",draft.householdId).eq("operationKey",`draft:${draft._id}:${draft.version}`)).unique();
    const account=await ctx.db.query("mailAccounts").withIndex("by_householdId",q=>q.eq("householdId",draft.householdId)).unique();
    const thread=draft.threadId?await ctx.db.get(draft.threadId):null;
    const blocker=!household.emailImport?"emailPaused" as const:!account?.inboxId||account.status!=="ready"?"mailboxUnavailable" as const:draft.threadId&&(!thread||thread.deleting||thread.quarantined)?"senderNeedsReview" as const:null;
    const editable=!draft.correctionDraftId&&["editable","failed"].includes(draft.state);
    return {state:job?.state??null,editable,ready:editable&&draft.state==="editable"&&!!draft.providerDraftId&&draft.providerSyncedVersion===draft.version&&!draft.syncToken,lastError:draft.lastError,blocker,threadId:draft.threadId};
  },
});

export const view = userQuery({
  args: { draftId: v.id("mailDrafts") },
  returns: v.union(v.object({ kind: v.literal("draft"), draft: schema.doc("mailDrafts"), latestSend: v.union(schema.doc("sendIntents"),v.null()) }), v.object({ kind: v.literal("replaced"), replacementId: v.id("mailDrafts") })),
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (draft && draft.state !== "deleted") {
      await requireMailAccess(ctx, draft.householdId);
      const latestSend=await ctx.db.query("sendIntents").withIndex("by_draftId_and_createdAt",q=>q.eq("draftId",draft._id)).order("desc").first();
      return { kind: "draft" as const, draft, latestSend };
    }
    const replacement = await ctx.db.query("mailDrafts").withIndex("by_replacesDraftId", q => q.eq("replacesDraftId", args.draftId)).unique();
    if (!replacement || replacement.state === "deleted") return fail("NOT_FOUND", "Draft unavailable.");
    await requireMailAccess(ctx, replacement.householdId); return { kind: "replaced" as const, replacementId: replacement._id };
  },
});

export const recreate = userMutation({
  args: { draftId: v.id("mailDrafts"), expectedVersion: v.number(), sendIntentId: v.optional(v.id("sendIntents")), recipient: v.string(), subject: v.string(), body: v.string(), requestId: v.string() },
  returns: v.id("mailDrafts"),
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    const existingReplacement = await ctx.db.query("mailDrafts").withIndex("by_replacesDraftId", q => q.eq("replacesDraftId", args.draftId)).unique();
    const basis = draft ?? existingReplacement; if (!basis) return fail("NOT_FOUND", "Draft unavailable.");
    await requireMailAccess(ctx, basis.householdId);
    const fingerprint = JSON.stringify(args), prior = await priorRequest(ctx, "drafts.recreate", args.requestId, fingerprint);
    if (prior) { const id=ctx.db.normalizeId("mailDrafts",prior.resultId),saved=id?await ctx.db.get(id):null; if(!saved||saved.state==="deleted")return fail("NOT_FOUND","Replacement draft unavailable. Open your saved drafts."); return saved._id; }
    if (!draft || existingReplacement || draft.state === "deleted") return fail("DRAFT_REPLACED", "This draft was already replaced. Open its replacement from the saved draft page.");
    checkVersion(draft,args.expectedVersion);
    if(draft.correctionDraftId)return fail("CORRECTION_EXISTS","A correction already exists. Open it from this draft or send receipt.");
    const intent = args.sendIntentId ? await ctx.db.get(args.sendIntentId) : null;
    if (args.sendIntentId) {
      if (!intent || intent.draftId !== draft._id || intent.householdId !== draft.householdId) return fail("NOT_FOUND","Send receipt unavailable.");
      if (intent.correctionDraftId) return fail("CORRECTION_EXISTS","A correction already exists. Open it from this send receipt.");
      const latest=await ctx.db.query("sendIntents").withIndex("by_draftId_and_createdAt",q=>q.eq("draftId",draft._id)).order("desc").first();
      if(latest?._id!==intent._id||!["sent","failed"].includes(intent.state)||!["bounced","rejected"].includes(intent.delivery)||!["sent","failed","editable"].includes(draft.state))return fail("SEND_UNRESOLVED","Only a confirmed failed delivery can create a correction. Check the latest send receipt first.");
    } else {
      if (!["editable","failed"].includes(draft.state)) return fail("DRAFT_LOCKED","Cancel an unstarted approval first. Sending or uncertain mail cannot be replaced.");
      const lastSend=await ctx.db.query("sendIntents").withIndex("by_draftId_and_createdAt",q=>q.eq("draftId",draft._id)).order("desc").first();
      if(lastSend&&lastSend.state!=="cancelled")return fail("SEND_RECEIPT_REQUIRED","Open the latest send receipt to correct this message without losing its history.");
      if (email(args.recipient)===draft.recipient) return fail("SAME_RECIPIENT","Choose a different recipient, or edit this draft.");
    }
    const recipient=await permittedRecipient(ctx,draft.householdId,args.recipient,false);
    const subject=text(args.subject,"Subject",200),body=text(args.body,"Message",20000);
    if(/[\r\n]/.test(subject))return fail("INVALID_SUBJECT","Use one line for the email subject.");
    await authorizeEntity(ctx,draft.householdId,draft.related); await validateEvidence(ctx,draft.householdId,draft.sourceRefs);
    // A changed address starts a new message, never a reply to another sender.
    const id=await ctx.db.insert("mailDrafts",{householdId:draft.householdId,related:draft.related,recipient,subject,body,sourceRefs:draft.sourceRefs,version:1,contentHash:contentHash(recipient,subject,body),editorId:ctx.user._id,recoveryRequestedBy:ctx.user._id,state:"editable",updatedAt:Date.now(),...(intent?{correctsSendIntentId:intent._id}:{replacesDraftId:draft._id})});
    await linkEvidence(ctx,draft.householdId,{kind:"draft",id},draft.sourceRefs);
    if(intent){
      await ctx.db.patch(intent._id,{correctionDraftId:id});
      await ctx.db.patch(draft._id,{correctionDraftId:id,version:draft.version+1,updatedAt:Date.now()});
    }
    else {
      await ctx.db.patch(draft._id,{state:"deleted",version:draft.version+1,updatedAt:Date.now()});
      const cleanupId=await ctx.db.insert("privacyJobs",{householdId:draft.householdId,requestedBy:ctx.user._id,kind:"deleteDraft",draftId:draft._id,state:"queued",stage:"requested",processors:[{name:"agentmail",state:"queued"},{name:"convex",state:"queued"}],requestedAt:Date.now(),expiresAt:Date.now()+30*86400000});
      await ctx.db.patch(id,{replacementCleanupJobId:cleanupId});await startPrivacy(ctx,cleanupId);
    }
    await saveRequest(ctx,"drafts.recreate",args.requestId,fingerprint,id);
    await queueOperation(ctx,{householdId:draft.householdId,kind:"syncDraft",key:`draft:${id}:1`,draftId:id,actorId:ctx.user._id,target:draft.related,automatic:true});
    return id;
  },
});

export const forThread = userQuery({
  args: { threadId: v.id("mailThreads") }, returns: v.array(schema.doc("mailDrafts")),
  handler: async (ctx, args) => { const thread = await ctx.db.get(args.threadId); if (!thread || thread.deleting) return fail("NOT_FOUND", "Thread unavailable."); await requireMailAccess(ctx, thread.householdId); return ctx.db.query("mailDrafts").withIndex("by_threadId", q => q.eq("threadId", thread._id)).order("desc").take(20); },
});

export const forThreadPage = userQuery({
  args: { threadId: v.id("mailThreads"), paginationOpts: paginationOptsValidator }, returns: paginationResultValidator(schema.doc("mailDrafts")),
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId); if (!thread || thread.deleting) return fail("NOT_FOUND", "Thread unavailable.");
    await requireMailAccess(ctx, thread.householdId);
    return ctx.db.query("mailDrafts").withIndex("by_threadId", q => q.eq("threadId", thread._id)).filter(q => q.neq(q.field("state"), "deleted")).order("desc").paginate(args.paginationOpts);
  },
});

export const create = userMutation({
  args: { householdId: v.id("households"), threadId: v.optional(v.id("mailThreads")), related: v.union(entity, v.null()), recipient: v.string(), subject: v.string(), body: v.string(), inReplyTo: v.optional(v.string()), sourceRefs: v.array(sourceRef), requestId: v.string() }, returns: v.id("mailDrafts"),
  handler: async (ctx, args) => {
    await requireMailAccess(ctx,args.householdId);await authorizeEntity(ctx, args.householdId, args.related);
    const recipient = await permittedRecipient(ctx, args.householdId, args.recipient, !!args.inReplyTo);
    const subject = text(args.subject, "Subject", 200), body = text(args.body, "Message", 20000);
    if (/[\r\n]/.test(subject)) fail("INVALID_SUBJECT", "Use one line for the email subject.");
    let approvedThreadVersion: number | undefined;
    if (args.threadId) {
      const thread = await ctx.db.get(args.threadId);
      if (!thread || thread.householdId !== args.householdId || thread.deleting || thread.quarantined) fail("NOT_FOUND", "Thread unavailable.");
      approvedThreadVersion = thread.version;
      if (args.inReplyTo) {
        const message = await ctx.db.query("mailMessages").withIndex("by_inboxId_and_providerMessageId", q => q.eq("inboxId", thread.inboxId).eq("providerMessageId", args.inReplyTo!)).unique();
        if (!message || message.threadId !== thread._id || message.direction !== "inbound" || email(message.from) !== recipient) fail("INVALID_REPLY", "Reply only to the actual approved sender. For a family forward, create a new question to the confirmed office contact.");
      }
    } else if (args.inReplyTo) fail("INVALID_REPLY", "A reply requires its actual source thread.");
    await validateEvidence(ctx, args.householdId, args.sourceRefs);
    const fingerprint = JSON.stringify(args), prior = await priorRequest(ctx, "drafts.create", args.requestId, fingerprint);
    if (prior) { const id = ctx.db.normalizeId("mailDrafts", prior.resultId); if (!id) return fail("NOT_FOUND", "Draft unavailable."); return id; }
    const id = await ctx.db.insert("mailDrafts", { householdId: args.householdId, ...(args.threadId ? { threadId: args.threadId } : {}), related: args.related, recipient, subject, body, ...(args.inReplyTo ? { inReplyTo: args.inReplyTo } : {}), sourceRefs: args.sourceRefs, version: 1, contentHash: contentHash(recipient, subject, body, args.inReplyTo), editorId: ctx.user._id, ...(approvedThreadVersion === undefined ? {} : { approvedThreadVersion }), state: "editable", updatedAt: Date.now() });
    await linkEvidence(ctx,args.householdId,{kind:"draft",id},args.sourceRefs);
    await saveRequest(ctx, "drafts.create", args.requestId, fingerprint, id);
    await queueOperation(ctx,{householdId:args.householdId,kind:"syncDraft",key:`draft:${id}:1`,draftId:id,actorId:ctx.user._id,target:args.threadId?{kind:"thread",id:args.threadId}:args.related,automatic:true});return id;
  },
});

export const edit = userMutation({
  args: { draftId: v.id("mailDrafts"), expectedVersion: v.number(), subject: v.string(), body: v.string(), sourceRefs: v.array(sourceRef) }, returns: v.null(),
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId); if (!draft) return fail("NOT_FOUND", "Draft unavailable.");
    await requireMailAccess(ctx, draft.householdId); checkVersion(draft, args.expectedVersion);
    if (draft.correctionDraftId || !["editable", "failed"].includes(draft.state)) fail("DRAFT_LOCKED", "This draft is locked or already sent. Cancel its unsent approval before editing.");
    const subject = text(args.subject, "Subject", 200), body = text(args.body, "Message", 20000);
    if (/[\r\n]/.test(subject)) fail("INVALID_SUBJECT", "Use one line for the email subject.");
    await validateEvidence(ctx, draft.householdId, args.sourceRefs);
    const thread = draft.threadId ? await ctx.db.get(draft.threadId) : null;
    if (draft.threadId && (!thread || thread.deleting || thread.quarantined)) fail("NOT_FOUND", "Thread unavailable.");
    await ctx.db.patch(draft._id, { subject, body, sourceRefs: args.sourceRefs, contentHash: contentHash(draft.recipient, subject, body, draft.inReplyTo), version: draft.version + 1, editorId: ctx.user._id, state: "editable", approvedThreadVersion: thread?.version, updatedAt: Date.now(), lastError: undefined });
    await linkEvidence(ctx,draft.householdId,{kind:"draft",id:draft._id},args.sourceRefs);
    await queueOperation(ctx,{householdId:draft.householdId,kind:"syncDraft",key:`draft:${draft._id}:${draft.version+1}`,draftId:draft._id,actorId:ctx.user._id,target:draft.threadId?{kind:"thread",id:draft.threadId}:draft.related,automatic:true});
    return null;
  },
});

export const approveSend = userMutation({
  args: { draftId: v.id("mailDrafts"), expectedVersion: v.number(), expectedHash: v.string(), logicalSendId: v.string() }, returns: v.id("sendIntents"),
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId); if (!draft) return fail("NOT_FOUND", "Draft unavailable.");
    const { household } = await requireMailAccess(ctx, draft.householdId);
    const prior = await ctx.db.query("sendIntents").withIndex("by_householdId_and_logicalSendId", q => q.eq("householdId", household._id).eq("logicalSendId", args.logicalSendId)).unique();
    if (prior) {
      if (prior.draftId !== draft._id || prior.draftVersion !== args.expectedVersion || prior.contentHash !== args.expectedHash || prior.approvedBy !== ctx.user._id) fail("IDEMPOTENCY_CONFLICT", "This send ID already belongs to another approval.");
      return prior._id;
    }
    text(args.logicalSendId, "Send ID", 128); checkVersion(draft, args.expectedVersion);
    if (draft.correctionDraftId || draft.state !== "editable" || !draft.providerDraftId || draft.providerSyncedVersion !== draft.version || draft.syncToken) fail("DRAFT_NOT_READY", "Wait for the provider draft to be saved before sending.");
    if (draft.contentHash !== args.expectedHash || draft.contentHash !== contentHash(draft.recipient, draft.subject, draft.body, draft.inReplyTo)) fail("STALE_APPROVAL", "The draft changed. Review its exact content before sending.");
    await permittedRecipient(ctx, household._id, draft.recipient, !!draft.inReplyTo);
    if (draft.threadId) {
      const thread = await ctx.db.get(draft.threadId);
      if (!thread || thread.deleting || thread.quarantined || thread.version !== draft.approvedThreadVersion) fail("STALE_APPROVAL", "The conversation changed. Review and save the draft again.");
    }
    const id = await ctx.db.insert("sendIntents", { householdId: household._id, draftId: draft._id, draftVersion: draft.version, contentHash: draft.contentHash, logicalSendId: args.logicalSendId, idempotencyKey: `handoff-${digest(`${household._id}:${args.logicalSendId}`)}`, approvedBy: ctx.user._id, recipient: draft.recipient, subject: draft.subject, body: draft.body, providerDraftId: draft.providerDraftId, approvedThreadVersion: draft.approvedThreadVersion, consentVersion: household.consentVersion, state: "approved", delivery: "pending", attempts: 0, createdAt: Date.now(), reconciliation: "none" });
    await ctx.db.patch(draft._id, { state: "approved", updatedAt: Date.now() });
    await queueOperation(ctx,{householdId:draft.householdId,kind:"sendApprovedDraft",key:`send:${id}`,sendIntentId:id,draftId:draft._id,actorId:ctx.user._id,target:draft.threadId?{kind:"thread",id:draft.threadId}:draft.related,automatic:true});return id;
  },
});

export const discard = userMutation({
  args: { draftId: v.id("mailDrafts"), expectedVersion: v.number() }, returns: v.id("privacyJobs"),
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId); if (!draft) return fail("NOT_FOUND", "Draft unavailable.");
    await requireMailAccess(ctx, draft.householdId); checkVersion(draft, args.expectedVersion);
    if (draft.correctionDraftId || !["editable", "failed"].includes(draft.state)) fail("DRAFT_LOCKED", "Cancel an unsent approval before discarding. Sending or sent mail cannot be recalled.");
    await ctx.db.patch(draft._id, { state: "deleted", version: draft.version + 1, updatedAt: Date.now() });
    const id=await ctx.db.insert("privacyJobs", { householdId: draft.householdId, requestedBy: ctx.user._id, kind: "deleteDraft", draftId: draft._id, state: "queued", stage: "requested", processors: [{ name: "agentmail", state: "queued" }, { name: "convex", state: "queued" }], requestedAt: Date.now(), expiresAt: Date.now() + 30 * 86400000 });
    await startPrivacy(ctx,id);return id;
  },
});

export const list = userQuery({
  args: { householdId: v.id("households"), state: v.union(v.literal("generating"), v.literal("editable"), v.literal("failed"), v.literal("approved"), v.literal("sending"), v.literal("sent")), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("mailDrafts").omit("syncToken", "syncUntil", "providerDraftId").extend({ syncing: v.boolean() })),
  handler: async (ctx, args) => {
    await requireMailAccess(ctx, args.householdId);
    const result = await ctx.db.query("mailDrafts").withIndex("by_householdId_and_state_and_updatedAt", q => q.eq("householdId", args.householdId).eq("state", args.state)).order("desc").paginate(args.paginationOpts);
    return { ...result, page: result.page.map(({ syncToken, syncUntil: _until, providerDraftId: _provider, ...row }) => ({ ...row, syncing: !!syncToken })) };
  },
});
