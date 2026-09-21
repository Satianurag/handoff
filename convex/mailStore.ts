import {receivedForFollowUp} from "./followUpMailAccess";
import { canReadMail } from "./model/mailAccess";
import { projectDelivery } from "./model/delivery";
import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel";
import schema from "./schema";
import { email, fail, internalUserQuery, member } from "./model/access";
import { permittedRecipient } from "./model/mail";
import { limits, dailyAllowance } from "./model/limits";
import { notify, record } from "./model/events";
import { sourceText } from "./model/sourceText";

export async function activeMail(ctx: QueryCtx | MutationCtx, householdId: Id<"households">, now: number) {
  const household = await ctx.db.get(householdId);
  if (!household || household.status !== "active" || !household.emailImport || (household.expiresAt !== undefined && household.expiresAt <= now)) return fail("EMAIL_DISABLED", "Email processing is paused or this household expired.");
  const account = await ctx.db.query("mailAccounts").withIndex("by_householdId", q => q.eq("householdId", householdId)).unique();
  if (!account) return fail("NOT_FOUND", "Mailbox unavailable.");
  return { household, account };
}

export const authorize = internalUserQuery({
  args: { householdId: v.id("households"), ownerOnly: v.boolean() }, returns: v.null(),
  handler: async (ctx, args) => { await member(ctx, args.householdId, args.ownerOnly); return null; },
});

export const provisionContext = internalMutation({
  args: { householdId: v.id("households") },
  returns: v.object({ household: schema.doc("households"), account: schema.doc("mailAccounts"), demo: v.union(schema.doc("demoSessions"), v.null()) }),
  handler: async (ctx, args) => {
    const state = await activeMail(ctx, args.householdId, Date.now());
    const demo = state.household.mode === "demo" ? await ctx.db.query("demoSessions").withIndex("by_householdId", q => q.eq("householdId", args.householdId)).unique() : null;
    await ctx.db.patch(state.account._id, { status: "processing", lastError: undefined, capacityReached: undefined });
    return { ...state, demo };
  },
});

export const provisioned = internalMutation({
  args: { householdId: v.id("households"), podId: v.string(), inboxId: v.string(), address: v.string(), officeInboxId: v.optional(v.string()), officeAddress: v.optional(v.string()) }, returns: v.boolean(),
  handler: async (ctx, args) => {
    // Keep resource IDs even if deletion raced provisioning, so cleanup can find them.
    const household = await ctx.db.get(args.householdId);
    const account = await ctx.db.query("mailAccounts").withIndex("by_householdId", q => q.eq("householdId", args.householdId)).unique();
    if (!household || !account) return false;
    if (account.inboxId && account.inboxId !== args.inboxId) return fail("RESOURCE_CONFLICT", "Mailbox identity changed unexpectedly.");
    const active = household.status === "active" && household.emailImport && (!household.expiresAt || household.expiresAt > Date.now());
    await ctx.db.patch(account._id, { podId: args.podId, inboxId: args.inboxId, address: email(args.address), status: active ? "ready" : "paused", contactSyncState: "pending", version: account.version + 1, lastError: undefined, capacityReached: undefined });
    await ctx.db.patch(household._id, { provisioning: active ? "ready" : "paused" });
    if (household.mode === "demo" && args.officeInboxId && args.officeAddress) {
      const demo = await ctx.db.query("demoSessions").withIndex("by_householdId", q => q.eq("householdId", household._id)).unique();
      if (demo) await ctx.db.patch(demo._id, { officeInboxId: args.officeInboxId, officeAddress: email(args.officeAddress) });
      const contact = await ctx.db.query("contacts").withIndex("by_householdId_and_email", q => q.eq("householdId", household._id).eq("email", email(args.officeAddress!))).unique();
      if (!contact && active) await ctx.db.insert("contacts", { householdId: household._id, label: "Sample office — controlled demo", email: email(args.officeAddress), relationship: "Operator-owned synthetic scenario", confirmedBy: household.ownerId, allowSend: true, allowReceive: true, allowReply: true, state: "approved", version: 1, updatedAt: Date.now() });
    }
    return active;
  },
});

export const resourceCheckpoint = internalMutation({
  args: { householdId: v.id("households"), podId: v.string(), inboxId: v.optional(v.string()), address: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const account = await ctx.db.query("mailAccounts").withIndex("by_householdId", q => q.eq("householdId", args.householdId)).unique();
    if (!account) return null;
    await ctx.db.patch(account._id, { podId: args.podId, ...(args.inboxId ? { inboxId: args.inboxId } : {}), ...(args.address ? { address: args.address } : {}) });
    return null;
  },
});

export const accountFailed = internalMutation({
  args: { householdId: v.id("households"), operation: v.union(v.literal("provision"), v.literal("contacts")), token: v.optional(v.string()), providerStatus: v.optional(v.number()), capacityReached: v.optional(v.boolean()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const account = await ctx.db.query("mailAccounts").withIndex("by_householdId", q => q.eq("householdId", args.householdId)).unique();
    if (account && (args.operation === "provision" || account.syncToken === args.token)) await ctx.db.patch(account._id, { ...(args.operation === "provision" ? { status: "failed" as const, capacityReached: args.capacityReached ?? false } : { contactSyncState: "failed" as const, syncToken: undefined, syncUntil: undefined }), lastError: args.operation === "provision" && args.capacityReached ? "Handoff’s email service has reached its mailbox limit. The operator must free or add capacity before setup can finish. You can still upload records, prepare visits and share responsibilities." : `Email service could not complete this operation${args.providerStatus ? ` (HTTP ${args.providerStatus})` : ""}. Retry from its status.` });
    return null;
  },
});

export const beginContactSync = internalMutation({
  args: { householdId: v.id("households"), token: v.string() },
  returns: v.object({ inboxId: v.string(), version: v.number(), send: v.array(v.string()), receive: v.array(v.string()), reply: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const household=await ctx.db.get(args.householdId);
    const account=await ctx.db.query("mailAccounts").withIndex("by_householdId",q=>q.eq("householdId",args.householdId)).unique();
    if(!household||household.status!=="active"||!account||(household.expiresAt&&household.expiresAt<=Date.now()))return fail("NOT_FOUND","Mailbox unavailable.");
    if (!account.inboxId || !["ready","paused"].includes(account.status)) return fail("MAILBOX_NOT_READY", "Wait for mailbox provisioning.");
    if (account.syncToken && (account.syncUntil ?? 0) > Date.now()) return fail("BUSY", "Contact policies are already syncing.");
    const contacts = await ctx.db.query("contacts").withIndex("by_householdId_and_state", q => q.eq("householdId", household._id)).take(201);
    if (contacts.length > 200) return fail("CONTACT_LIMIT", "Use at most 200 contacts per household.");
    const approved = household.emailImport?contacts.filter(c => c.state === "approved"):[];
    const send = approved.filter(c => c.allowSend).map(c => c.email);
    const receive = approved.filter(c => c.allowReceive).map(c => c.email);
    const reply = approved.filter(c => c.allowReply).map(c => c.email);
    if (household.emailImport && household.mode === "real") {
      const members = await ctx.db.query("memberships").withIndex("by_householdId_and_status", q => q.eq("householdId", household._id).eq("status", "active")).take(21);
      if (members.length > 20) return fail("MEMBER_LIMIT", "Member policy limit exceeded.");
      for (const member of members) {
        const user = await ctx.db.get(member.userId);
        if (user?.email && user.emailVerificationTime && !contacts.some(c => c.email === email(user.email!) && c.state === "blocked")) { receive.push(email(user.email)); reply.push(email(user.email)); }
      }
    }
    await ctx.db.patch(account._id, { syncToken: args.token, syncUntil: Date.now() + 120000, contactSyncState: "processing" });
    return { inboxId: account.inboxId, version: account.version, send: [...new Set(send)], receive: [...new Set(receive)], reply: [...new Set(reply)] };
  },
});

export const finishContactSync = internalMutation({
  args: { householdId: v.id("households"), token: v.string(), version: v.number() }, returns: v.boolean(),
  handler: async (ctx, args) => {
    const account = await ctx.db.query("mailAccounts").withIndex("by_householdId", q => q.eq("householdId", args.householdId)).unique();
    if (!account || account.syncToken !== args.token) return false;
    const ready = account.version === args.version;
    await ctx.db.patch(account._id, { syncToken: undefined, syncUntil: undefined, contactSyncState: ready ? "ready" : "pending", lastError: undefined });
    return ready;
  },
});

export const beginDraftSync = internalMutation({
  args: { draftId: v.id("mailDrafts"), token: v.string() }, returns: v.object({ draft: schema.doc("mailDrafts"), inboxId: v.string() }),
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId); if (!draft) return fail("NOT_FOUND", "Draft unavailable.");
    const { account } = await activeMail(ctx, draft.householdId, Date.now());
    const membership = await ctx.db.query("memberships").withIndex("by_householdId_and_userId", q => q.eq("householdId", draft.householdId).eq("userId", draft.editorId)).unique();
    if (!membership || membership.status !== "active") return fail("FORBIDDEN", "Draft editor is no longer a member.");
    await permittedRecipient(ctx, draft.householdId, draft.recipient, !!draft.inReplyTo);
    if (!account.inboxId || account.status !== "ready") return fail("MAILBOX_NOT_READY", "Wait for mailbox provisioning.");
    if (draft.correctionDraftId || !["editable", "failed"].includes(draft.state)) return fail("DRAFT_LOCKED", "Only an editable draft can sync.");
    if (draft.syncToken && (draft.syncUntil ?? 0) > Date.now()) return fail("BUSY", "This draft is already syncing.");
    await ctx.db.patch(draft._id, { syncToken: args.token, syncUntil: Date.now() + 120000 });
    return { draft, inboxId: account.inboxId };
  },
});

export const finishDraftSync = internalMutation({
  args: { draftId: v.id("mailDrafts"), token: v.string(), version: v.number(), providerDraftId: v.optional(v.string()), success: v.boolean() }, returns: v.boolean(),
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId); if (!draft || draft.syncToken !== args.token) return false;
    const fresh = args.success && !draft.correctionDraftId && draft.version === args.version && ["editable", "failed"].includes(draft.state);
    await ctx.db.patch(draft._id, { syncToken: undefined, syncUntil: undefined, ...(args.providerDraftId ? { providerDraftId: args.providerDraftId } : {}), providerSyncedVersion: fresh ? args.version : undefined, ...(fresh ? { state: "editable" as const } : {}), lastError: args.success ? undefined : "Provider draft could not be saved. Retry before approving." });
    return fresh;
  },
});

export const sendContext = internalQuery({
  args: { sendIntentId: v.id("sendIntents") }, returns: v.object({ intent: schema.doc("sendIntents"), draft: schema.doc("mailDrafts"), inboxId: v.string() }),
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.sendIntentId); if (!intent) return fail("NOT_FOUND", "Send unavailable.");
    const draft = await ctx.db.get(intent.draftId);
    const account = await ctx.db.query("mailAccounts").withIndex("by_householdId", q => q.eq("householdId", intent.householdId)).unique();
    if (!draft || !account?.inboxId) return fail("NOT_FOUND", "Send unavailable.");
    return { intent, draft, inboxId: account.inboxId };
  },
});

export const claimSend = internalMutation({
  args: { sendIntentId: v.id("sendIntents"), providerHash: v.string() }, returns: v.boolean(),
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.sendIntentId); if (!intent || intent.state !== "approved") return false;
    const { household, account } = await activeMail(ctx, intent.householdId, Date.now());
    const membership = await ctx.db.query("memberships").withIndex("by_householdId_and_userId", q => q.eq("householdId", household._id).eq("userId", intent.approvedBy)).unique();
    const draft = await ctx.db.get(intent.draftId);
    if (!membership || membership.status !== "active" || !await canReadMail(ctx,household._id,intent.approvedBy) || !draft || draft.state !== "approved" || draft.version !== intent.draftVersion || draft.contentHash !== intent.contentHash || args.providerHash !== intent.contentHash || draft.providerDraftId !== intent.providerDraftId || draft.providerSyncedVersion !== draft.version || draft.syncToken || account.status !== "ready" || account.contactSyncState !== "ready" || household.consentVersion !== intent.consentVersion) return fail("STALE_APPROVAL", "Approval or email permissions changed. Review again before sending.");
    await permittedRecipient(ctx, household._id, intent.recipient, !!draft.inReplyTo);
    if (draft.threadId) {
      const thread = await ctx.db.get(draft.threadId);
      if (!thread || thread.quarantined || thread.deleting || thread.version !== intent.approvedThreadVersion) return fail("STALE_APPROVAL", "The conversation changed. Review again before sending.");
    }
    await dailyAllowance(ctx,"householdSends",household._id);
    await dailyAllowance(ctx,"globalSends");
    await ctx.db.patch(intent._id, { state: "sending", attempts: intent.attempts + 1, firstAttemptAt: Date.now(), lastAttemptAt: Date.now() });
    await ctx.db.patch(draft._id, { state: "sending", updatedAt: Date.now() });
    return true;
  },
});

export const sendFailed = internalMutation({
  args: { sendIntentId: v.id("sendIntents"), uncertain: v.boolean(), onlyIfUnstarted: v.optional(v.boolean()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.sendIntentId); if (!intent || intent.state === "sent" || intent.state === "cancelled") return null;
    if (args.onlyIfUnstarted && (intent.attempts > 0 || intent.state !== "approved")) return null;
    const unknown = args.uncertain || intent.state === "unknown";
    await ctx.db.patch(intent._id, { state: unknown ? "unknown" : "failed", delivery: unknown ? "unknown" : "rejected", reconciliation: unknown ? "required" : "none", lastError: unknown ? "Status needs checking. No automatic resend will occur." : "Email was not sent. Review the draft and current permissions." });
    const draft = await ctx.db.get(intent.draftId);
    if (draft && draft.state !== "deleted") await ctx.db.patch(draft._id, { state: unknown ? "sending" : "failed", lastError: unknown ? "Status needs checking." : "Send failed. Review and save again." });
    return null;
  },
});

export const sent = internalMutation({
  args: { sendIntentId: v.id("sendIntents"), messageId: v.string(), threadId: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.sendIntentId); if (!intent || intent.state === "sent") return null;
    if (!["sending", "unknown"].includes(intent.state)) return fail("INVALID_SEND_STATE", "No send attempt exists for this receipt.");
    const draft = await ctx.db.get(intent.draftId);
    const account = await ctx.db.query("mailAccounts").withIndex("by_householdId", q => q.eq("householdId", intent.householdId)).unique();
    if (!account?.inboxId || !account.address || !draft) return fail("NOT_FOUND", "Send projection unavailable.");
    await ctx.db.patch(intent._id, { state: "sent", delivery: intent.delivery === "unknown" || intent.delivery === "pending" ? "sent" : intent.delivery, providerMessageId: args.messageId, providerThreadId: args.threadId, reconciliation: "confirmed", lastError: undefined });
    let thread = await ctx.db.query("mailThreads").withIndex("by_inboxId_and_providerThreadId", q => q.eq("inboxId", account.inboxId!).eq("providerThreadId", args.threadId)).unique();
    if (!thread) {
      const id = await ctx.db.insert("mailThreads", { householdId: intent.householdId, inboxId: account.inboxId, providerThreadId: args.threadId, related: draft.related, subject: intent.subject, state: "waiting", archived: false, quarantined: false, deleting: false, lastMessageAt: intent.firstAttemptAt ?? Date.now(), version: 1 });
      thread = (await ctx.db.get(id))!;
    } else await ctx.db.patch(thread._id, { state: (thread.lastInboundAt ?? 0) >= (intent.firstAttemptAt ?? 0) ? "replyReceived" : "waiting", version: thread.version + 1, lastMessageAt: Math.max(thread.lastMessageAt, intent.firstAttemptAt ?? Date.now()), archived: false });
    const exists = await ctx.db.query("mailMessages").withIndex("by_inboxId_and_providerMessageId", q => q.eq("inboxId", account.inboxId!).eq("providerMessageId", args.messageId)).unique();
    if (!exists) await ctx.db.insert("mailMessages", { householdId: intent.householdId, threadId: thread._id, providerMessageId: args.messageId, inboxId: account.inboxId, direction: "outbound", from: account.address, to: [intent.recipient], plaintext: intent.body, subject: intent.subject, occurredAt: intent.firstAttemptAt ?? Date.now(), delivery: "sent", attachmentOnly: false, truncated: false, retentionUntil: Date.now() + 30 * 86400000, unresolvedReferences: 0 });
    await ctx.db.patch(draft._id, { state: "sent", threadId: thread._id, updatedAt: Date.now(), lastError: undefined });
    await record(ctx, { householdId: intent.householdId, actorId: intent.approvedBy, type: "mail.sent", entity: { kind: "thread", id: thread._id }, after: "Approved question sent; awaiting a reply." });
    await projectDelivery(ctx,intent.householdId,account.inboxId,args.messageId);
    return null;
  },
});

export const otpQuota = internalMutation({
  args: { addressHash: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    await limits.limit(ctx, "otpRecipient", { key: args.addressHash, throws: true });
    await limits.limit(ctx, "otpDailyRecipient", { key: args.addressHash, throws: true });
    await limits.limit(ctx, "otpGlobal", { throws: true });
    await dailyAllowance(ctx,"globalSends");
    return null;
  },
});

export const inboundContext = internalQuery({
  args: { inboxId: v.string() }, returns: v.union(v.object({ household: schema.doc("households"), account: schema.doc("mailAccounts") }), v.null()),
  handler: async (ctx, args) => {
    const account = await ctx.db.query("mailAccounts").withIndex("by_inboxId", q => q.eq("inboxId", args.inboxId)).unique();
    const household = account ? await ctx.db.get(account.householdId) : null;
    return account && household && household.status === "active" && household.emailImport ? { account, household } : null;
  },
});

export const ingest = internalMutation({
  args: { inboxId: v.string(), messageId: v.string(), threadId: v.string(), from: v.string(), to: v.array(v.string()), subject: v.string(), plaintext: v.string(), occurredAt: v.number(), attachmentOnly: v.boolean(), isReply: v.boolean(), routingAmbiguous: v.boolean() }, returns: v.union(v.id("mailMessages"), v.null()),
  handler: async (ctx, args) => {
    const account = await ctx.db.query("mailAccounts").withIndex("by_inboxId", q => q.eq("inboxId", args.inboxId)).unique();
    if (!account) return null;
    const household = await ctx.db.get(account.householdId);
    if (!household || household.status !== "active" || !household.emailImport || (household.expiresAt && household.expiresAt <= Date.now())) return null;
    const existing = await ctx.db.query("mailMessages").withIndex("by_inboxId_and_providerMessageId", q => q.eq("inboxId", args.inboxId).eq("providerMessageId", args.messageId)).unique();
    if (existing) return existing._id;
    if (!Number.isFinite(args.occurredAt) || args.occurredAt < 0 || args.occurredAt > Date.now() + 300000 || args.to.length > 50 || args.plaintext.length > 150000) return fail("INVALID_MESSAGE", "Provider message is outside supported bounds.");
    const sender = email(args.from);
    const contact = await ctx.db.query("contacts").withIndex("by_householdId_and_email", q => q.eq("householdId", household._id).eq("email", sender)).unique();
    let allowed = contact?.state === "approved" && (args.isReply ? contact.allowReply : contact.allowReceive);
    if (!allowed && contact?.state !== "blocked" && household.mode === "real") {
      const members = await ctx.db.query("memberships").withIndex("by_householdId_and_status", q => q.eq("householdId", household._id).eq("status", "active")).take(21);
      for (const m of members) { const user = await ctx.db.get(m.userId); if (user?.emailVerificationTime && user.email && email(user.email) === sender) allowed = true; }
    }
    if (household.mode === "demo") {
      const demo = await ctx.db.query("demoSessions").withIndex("by_householdId", q => q.eq("householdId", household._id)).unique();
      allowed = allowed && demo?.officeAddress === sender;
    }
    const normalized = sourceText(args.plaintext);
    let thread = await ctx.db.query("mailThreads").withIndex("by_inboxId_and_providerThreadId", q => q.eq("inboxId", args.inboxId).eq("providerThreadId", args.threadId)).unique();
    if (thread?.deleting) return null;
    const quarantine = !allowed || args.routingAmbiguous || !!thread?.quarantined;
    const subject = args.subject.slice(0, 200);
    if (!thread) {
      const id = await ctx.db.insert("mailThreads", { householdId: household._id, inboxId: args.inboxId, providerThreadId: args.threadId, related: null, subject, state: "new", archived: false, quarantined: quarantine, deleting: false, lastMessageAt: args.occurredAt, lastInboundAt: args.occurredAt, version: 1 });
      thread = (await ctx.db.get(id))!;
    } else await ctx.db.patch(thread._id, { state: args.occurredAt >= thread.lastMessageAt ? "replyReceived" : thread.state, quarantined: quarantine, lastMessageAt: Math.max(thread.lastMessageAt, args.occurredAt), lastInboundAt: Math.max(thread.lastInboundAt ?? 0, args.occurredAt), version: thread.version + 1, archived: false });
    const sourceId = await ctx.db.insert("sources", { householdId: household._id, kind: "email", providerMessageId: args.messageId, threadId: thread._id, contentHash: normalized.contentHash, plaintext: normalized.plaintext, capturedAt: Date.now(), publishedAt: args.occurredAt, retentionUntil: Date.now() + 30 * 86400000, extractionState: quarantine ? "quarantined" : args.attachmentOnly ? "unsupported" : household.aiProcessing ? "pending" : "paused", warnings: args.attachmentOnly ? ["Attachment-only email: review and import the original attachment from this conversation."] : [], truncated: normalized.truncated, unresolvedReferences: 0, version: 1 });
    const messageId = await ctx.db.insert("mailMessages", { householdId: household._id, threadId: thread._id, providerMessageId: args.messageId, inboxId: args.inboxId, direction: "inbound", from: sender, to: args.to.map(email), plaintext: normalized.plaintext, subject, sourceId, occurredAt: args.occurredAt, delivery: "delivered", attachmentOnly: args.attachmentOnly, truncated: normalized.truncated, retentionUntil: Date.now() + 30 * 86400000, unresolvedReferences: 0 });
    if (!quarantine) {
      await receivedForFollowUp(ctx,thread);
      const { eventId } = await record(ctx, { householdId: household._id, actorId: null, type: "mail.received", entity: { kind: "thread", id: thread._id }, after: "Email received. Review its contents; no confirmed details were changed." });
      const members = await ctx.db.query("memberships").withIndex("by_householdId_and_status", q => q.eq("householdId", household._id).eq("status", "active")).take(21);
      for (const m of members) await notify(ctx, { householdId: household._id, userId: m.userId, target: { kind: "thread", id: thread._id }, type: "mail.received", dedupeKey: `mail:${messageId}:${m.userId}`, eventId });
    }
    return messageId;
  },
});

export const demoContext = internalUserQuery({
  args: { householdId: v.id("households") }, returns: v.object({ account: schema.doc("mailAccounts"), demo: schema.doc("demoSessions") }),
  handler: async (ctx, args) => {
    const { household } = await member(ctx, args.householdId);
    if (household.mode !== "demo") return fail("DEMO_ONLY", "This action is for the synthetic scenario only.");
    const account = await ctx.db.query("mailAccounts").withIndex("by_householdId", q => q.eq("householdId", household._id)).unique();
    const demo = await ctx.db.query("demoSessions").withIndex("by_householdId", q => q.eq("householdId", household._id)).unique();
    if (account?.status === "failed") return fail(account.capacityReached ? "MAIL_CAPACITY_REACHED" : "MAIL_PROVISION_FAILED", account.lastError ?? "Sample email setup needs attention. Check the email status.");
    if (!account?.address || !demo?.officeInboxId) return fail("NOT_READY", "Wait for demo mail provisioning.");
    return { account, demo };
  },
});

export const cleanupContext = internalMutation({
  args: { privacyJobId: v.id("privacyJobs") }, returns: v.object({ job: schema.doc("privacyJobs"), account: v.union(schema.doc("mailAccounts"), v.null()), draft: v.union(schema.doc("mailDrafts"), v.null()), thread: v.union(schema.doc("mailThreads"), v.null()) }),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.privacyJobId); if (!job || job.kind === "export") return fail("NOT_FOUND", "Deletion request unavailable.");
    const account = await ctx.db.query("mailAccounts").withIndex("by_householdId", q => q.eq("householdId", job.householdId)).unique();
    const household = await ctx.db.get(job.householdId);
    const draft = job.draftId ? await ctx.db.get(job.draftId) : null;
    const thread = job.threadId ? await ctx.db.get(job.threadId) : null;
    if (job.kind === "delete" && household?.status === "active") return fail("DELETE_NOT_REQUESTED", "Household deletion has not been authorized.");
    if (job.kind === "deleteDraft" && draft && draft.state !== "deleted") return fail("DELETE_NOT_REQUESTED", "Draft deletion has not been authorized.");
    if (job.kind === "deleteThread" && thread && !thread.deleting) return fail("DELETE_NOT_REQUESTED", "Thread deletion has not been authorized.");
    await ctx.db.patch(job._id, { stage: "providerCleanup", processors: job.processors.map(p => p.name === "agentmail" && p.state !== "succeeded" ? { name: p.name, state: "running" as const } : p) });
    return { job, account, draft, thread };
  },
});

export const providerCleaned = internalMutation({
  args: { privacyJobId: v.id("privacyJobs"), success: v.boolean() }, returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.privacyJobId); if (!job) return null;
    await ctx.db.patch(job._id, { stage: args.success ? "providerCleaned" : "providerCleanupFailed", processors: job.processors.map(p => p.name === "agentmail" ? { name: p.name, state: args.success ? "succeeded" as const : "failed" as const, ...(args.success ? {} : { safeError: "Email provider cleanup must be retried." }) } : p) });
    return null;
  },
});

export const demoSendAllowance = internalMutation({
  args: { householdId: v.id("households") }, returns: v.null(),
  handler: async (ctx, args) => {
    const { household } = await activeMail(ctx, args.householdId, Date.now());
    if (household.mode !== "demo") return fail("DEMO_ONLY", "Synthetic scenario only.");
    await dailyAllowance(ctx,"householdSends",household._id);
    await dailyAllowance(ctx,"globalSends");
    return null;
  },
});

export const cleanupDraftsPage=internalQuery({args:{privacyJobId:v.id("privacyJobs"),cursor:v.union(v.string(),v.null())},returns:v.object({draftIds:v.array(v.string()),cursor:v.string(),done:v.boolean()}),handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.privacyJobId);if(!job||job.kind!=="deleteThread"||!job.threadId)return fail("INVALID_DELETE","Thread deletion required.");
 const thread=await ctx.db.get(job.threadId);if(thread&&!thread.deleting)return fail("INVALID_DELETE","Thread deletion not authorized.");
 const page=await ctx.db.query("mailDrafts").withIndex("by_threadId",q=>q.eq("threadId",job.threadId)).paginate({cursor:args.cursor,numItems:25});
 return {draftIds:page.page.flatMap(d=>d.providerDraftId?[d.providerDraftId]:[]),cursor:page.continueCursor,done:page.isDone};
}});

export const cleanupNotificationPage=internalQuery({args:{privacyJobId:v.id("privacyJobs"),cursor:v.union(v.string(),v.null())},returns:v.object({messages:v.array(v.object({inboxId:v.string(),threadId:v.optional(v.string()),notificationId:v.id("notifications"),state:v.string()})),cursor:v.string(),done:v.boolean()}),handler:async(ctx,args)=>{
 const job=await ctx.db.get(args.privacyJobId);if(!job||job.kind!=="delete")return fail("INVALID_DELETE","Household deletion required.");
 const page=await ctx.db.query("notificationSends").withIndex("by_householdId",q=>q.eq("householdId",job.householdId)).paginate({cursor:args.cursor,numItems:25});
 return {messages:page.page.map(s=>({inboxId:s.inboxId,threadId:s.providerThreadId,notificationId:s.notificationId,state:s.state})),cursor:page.continueCursor,done:page.isDone};
}});

export const reconciliationChecked=internalMutation({args:{sendIntentId:v.id("sendIntents")},returns:v.null(),handler:async(ctx,args)=>{
 const intent=await ctx.db.get(args.sendIntentId);if(intent)await ctx.db.patch(intent._id,{lastReconciledAt:Date.now()});return null;
}});
