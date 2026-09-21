/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { api, internal } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(ctx=>ctx.db.insert("operatorSettings",{key:"pauseAutomaticOperations",enabled:true,updatedAt:Date.now()})); rateLimiterTest.register(t);
  const userId = await t.run(ctx => ctx.db.insert("users", { email: "member@example.test", emailVerificationTime: 1 }));
  const user = t.withIdentity({ subject: userId });
  const householdId = await user.mutation(api.households.create, { nickname: "Synthetic", timezone: "UTC", firstTask: "Groceries", adultConfirmed: true, authorityStatement: "Synthetic test", noticeVersion: "test", emailImport: true, aiProcessing: true, requestId: "create" });
  await t.mutation(internal.mailStore.provisioned, { householdId, podId: "pod", inboxId: "family@example.test", address: "family@example.test" });
  const contact = { householdId, email: "office@example.test", label: "Office", relationship: "Test", allowSend: true, allowReceive: true, allowReply: true, state: "approved" as const };
  await user.mutation(api.contacts.set, contact);
  const sync = await t.mutation(internal.mailStore.beginContactSync, { householdId, token: "contacts" });
  await t.mutation(internal.mailStore.finishContactSync, { householdId, token: "contacts", version: sync.version });
  const draftId = await user.mutation(api.drafts.create, { householdId, related: null, recipient: contact.email, subject: "Entrance", body: "Which entrance?", sourceRefs: [], requestId: "draft" });
  const draft = await user.query(api.drafts.get, { draftId });
  return { t, user, userId, householdId, contact, draftId, draft };
}

async function approved() {
  const s = await setup();
  await s.t.mutation(internal.mailStore.beginDraftSync, { draftId: s.draftId, token: "save" });
  await s.t.mutation(internal.mailStore.finishDraftSync, { draftId: s.draftId, token: "save", version: 1, providerDraftId: "provider-draft", success: true });
  const sendIntentId = await s.user.mutation(api.drafts.approveSend, { draftId: s.draftId, expectedVersion: 1, expectedHash: s.draft.contentHash, logicalSendId: "send" });
  return { ...s, sendIntentId };
}

test("provider save racing an edit cannot make the newer draft approvable", async () => {
  const { t, user, draftId } = await setup();
  await t.mutation(internal.mailStore.beginDraftSync, { draftId, token: "save" });
  await user.mutation(api.drafts.edit, { draftId, expectedVersion: 1, subject: "New subject", body: "New body", sourceRefs: [] });
  expect(await t.mutation(internal.mailStore.finishDraftSync, { draftId, token: "save", version: 1, providerDraftId: "provider-draft", success: true })).toBe(false);
  const d = await user.query(api.drafts.get, { draftId });
  await expect(user.mutation(api.drafts.approveSend, { draftId, expectedVersion: 2, expectedHash: d.contentHash, logicalSendId: "new" })).rejects.toThrow("provider draft");
});

test("duplicate send workers claim once; an uncertain send remains locked and cannot be sent anew", async () => {
  const { t, user, draftId, draft, sendIntentId } = await approved();
  expect(await t.mutation(internal.mailStore.claimSend, { sendIntentId, providerHash: draft.contentHash })).toBe(true);
  expect(await t.mutation(internal.mailStore.claimSend, { sendIntentId, providerHash: draft.contentHash })).toBe(false);
  await t.mutation(internal.mailStore.sendFailed, { sendIntentId, uncertain: false, onlyIfUnstarted: true });
  expect((await user.query(api.sendIntents.get, { sendIntentId })).state).toBe("sending");
  await t.mutation(internal.mailStore.sendFailed, { sendIntentId, uncertain: true });
  expect(await t.mutation(internal.mailStore.claimSend, { sendIntentId, providerHash: draft.contentHash })).toBe(false);
  await expect(user.mutation(api.drafts.edit, { draftId, expectedVersion: 1, subject: "Retry", body: "Retry", sourceRefs: [] })).rejects.toThrow("locked");
  await expect(user.mutation(api.sendIntents.cancel, { sendIntentId })).rejects.toThrow("already started");
  await t.mutation(internal.mailStore.sent, { sendIntentId, messageId: "actual-message", threadId: "actual-thread" });
  await t.mutation(internal.mailStore.sent, { sendIntentId, messageId: "actual-message", threadId: "actual-thread" });
  expect((await user.query(api.sendIntents.get, { sendIntentId })).state).toBe("sent");
  expect(await t.run(ctx => ctx.db.query("mailMessages").take(10))).toHaveLength(1);
});

test("contact revocation, consent withdrawal and changed provider content each stop approved sends", async () => {
  for (const cause of ["contact", "consent", "content"] as const) {
    const { t, user, householdId, contact, draft, sendIntentId } = await approved();
    if (cause === "contact") await user.mutation(api.contacts.set, { ...contact, expectedVersion: 1, state: "blocked" });
    if (cause === "consent") await user.mutation(api.consents.set, { householdId, scope: "emailImport", granted: false, noticeVersion: "test", authorityStatement: "Synthetic withdrawal" });
    await expect(t.mutation(internal.mailStore.claimSend, { sendIntentId, providerHash: cause === "content" ? "unapproved" : draft.contentHash })).rejects.toThrow();
    expect((await user.query(api.sendIntents.get, { sendIntentId })).attempts).toBe(0);
  }
});

test("duplicate incoming mail is idempotent, unknown senders quarantine, and late mail preserves thread chronology", async () => {
  const { t, householdId } = await setup();
  const incoming = { inboxId: "family@example.test", messageId: "received", threadId: "thread", from: "office@example.test", to: ["family@example.test"], subject: "Logistics", plaintext: "Use the east entrance.", occurredAt: Date.now(), attachmentOnly: false, isReply: false, routingAmbiguous: false };
  const id = await t.mutation(internal.mailStore.ingest, incoming);
  expect(await t.mutation(internal.mailStore.ingest, incoming)).toBe(id);
  await t.mutation(internal.mailStore.ingest, { ...incoming, messageId: "older", occurredAt: incoming.occurredAt - 1000 });
  const threads = await t.run(ctx => ctx.db.query("mailThreads").withIndex("by_householdId_and_archived_and_lastMessageAt", q => q.eq("householdId", householdId)).take(10));
  expect(threads[0].lastMessageAt).toBe(incoming.occurredAt);
  await t.mutation(internal.mailStore.ingest, { ...incoming, messageId: "unknown", threadId: "foreign-thread", from: "unknown@example.test" });
  const unknown = await t.run(ctx => ctx.db.query("sources").withIndex("by_householdId_and_providerMessageId", q => q.eq("householdId", householdId).eq("providerMessageId", "unknown")).unique());
  expect(unknown?.extractionState).toBe("quarantined");
  const notices = await t.run(ctx => ctx.db.query("notifications").take(10));
  expect(notices).toHaveLength(2);
});
