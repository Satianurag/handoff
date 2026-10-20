import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const { mailClientSpy } = vi.hoisted(() => ({ mailClientSpy: vi.fn() }));
vi.mock("./model/agentmail", async importOriginal => ({
  ...(await importOriginal<typeof import("./model/agentmail")>()),
  mailClient: mailClientSpy,
}));

async function demo(t: ReturnType<typeof convexTest>, email: string) {
  const ids = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { email, emailVerificationTime: 1 });
    const now = Date.now();
    const householdId = await ctx.db.insert("households", {
      ownerId: userId, nickname: "Sample Pat", timezone: "UTC", mode: "demo", status: "active",
      materialRevision: 0, eventSequence: 0, consentVersion: 1, currentCoverageId: null,
      lastReceiptId: null, provisioning: "pending", emailImport: true, aiProcessing: true,
      createdAt: now, updatedAt: now, expiresAt: now + 86400000,
    });
    await ctx.db.insert("memberships", { householdId, userId, role: "owner", status: "active", joinedAt: now, emailNotifications: true, lastReadSequence: 0 });
    await ctx.db.insert("mailAccounts", { householdId, status: "pending", contactSyncState: "pending", version: 1 });
    await ctx.db.insert("demoSessions", { householdId, creatorId: userId, capabilityHash: "test", fixtureVersion: 1, expiresAt: now + 86400000 });
    return { householdId, userId };
  });
  return { ...ids, user: t.withIdentity({ subject: ids.userId }) };
}

async function sendDemoDraft(t: ReturnType<typeof convexTest>, householdId: string, user: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>) {
  const draftId = await user.mutation(api.drafts.create, {
    householdId: householdId as never, related: null, recipient: "office@demo.handoff.invalid",
    subject: "Sample question", body: "Which entrance should we use?", sourceRefs: [], requestId: `draft-${householdId}`,
  });
  const draft = await user.query(api.drafts.get, { draftId });
  const sync = await t.mutation(internal.mailStore.beginDraftSync, { draftId, token: `sync-${householdId}` });
  await t.mutation(internal.mailStore.finishDraftSync, { draftId, token: `sync-${householdId}`, version: sync.draft.version, success: true });
  const sendIntentId = await user.mutation(api.drafts.approveSend, {
    draftId, expectedVersion: draft.version, expectedHash: draft.contentHash, logicalSendId: `send-${householdId}`,
  });
  await t.action(internal.mail.sendInternal, { sendIntentId });
  return { draftId, sendIntentId };
}

test("demo provisioning is ready without provider resource ids", async () => {
  mailClientSpy.mockClear();
  const t = convexTest(schema, modules);
  const { householdId } = await demo(t, "demo@example.test");
  await t.action(internal.mail.provisionInternal, { householdId });
  const account = await t.run(ctx => ctx.db.query("mailAccounts").withIndex("by_householdId", q => q.eq("householdId", householdId)).unique());
  const session = await t.run(ctx => ctx.db.query("demoSessions").withIndex("by_householdId", q => q.eq("householdId", householdId)).unique());
  expect(account).toMatchObject({ status: "ready", contactSyncState: "ready" });
  expect(account).not.toHaveProperty("podId");
  expect(account).not.toHaveProperty("inboxId");
  expect(account?.address).toMatch(/^family-[a-z0-9]+@demo\.handoff\.invalid$/);
  expect(session).toMatchObject({ officeAddress: "office@demo.handoff.invalid" });
  expect(session).not.toHaveProperty("officeInboxId");
  expect(mailClientSpy).not.toHaveBeenCalled();
});

test("direct demo ingestion is isolated by household", async () => {
  mailClientSpy.mockClear();
  const t = convexTest(schema, modules);
  const first = await demo(t, "first@example.test");
  const second = await demo(t, "second@example.test");
  await t.action(internal.mail.provisionInternal, { householdId: first.householdId });
  await t.action(internal.mail.provisionInternal, { householdId: second.householdId });
  const accounts = await t.run(async ctx => Promise.all([first, second].map(async ({ householdId }) => ctx.db.query("mailAccounts").withIndex("by_householdId", q => q.eq("householdId", householdId)).unique())));
  for (const [i, household] of [first, second].entries()) {
    const account = accounts[i]!;
    await t.mutation(internal.mailStore.ingest, {
      householdId: household.householdId, inboxId: account.address!, messageId: `m-${i}`,
      threadId: `t-${i}`, from: "office@demo.handoff.invalid", to: [account.address!],
      subject: "Synthetic", plaintext: "SYNTHETIC DEMO — test", occurredAt: Date.now(),
      attachmentOnly: false, isReply: false, routingAmbiguous: false,
    });
  }
  const messages = await t.run(ctx => ctx.db.query("mailMessages").collect());
  expect(messages).toHaveLength(2);
  expect(new Set(messages.map(message => message.householdId))).toEqual(new Set([first.householdId, second.householdId]));
});

test("approved demo draft is sent and projected locally without constructing AgentMail", async () => {
  mailClientSpy.mockClear();
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  await t.run(ctx => ctx.db.insert("operatorSettings", { key: "pauseAutomaticOperations", enabled: true, updatedAt: Date.now() }));
  const sample = await demo(t, "send@example.test");
  await t.action(internal.mail.provisionInternal, { householdId: sample.householdId });
  const { draftId, sendIntentId } = await sendDemoDraft(t, sample.householdId, sample.user);
  const [intent, draft, messages, threads] = await t.run(async ctx => Promise.all([
    ctx.db.get(sendIntentId), ctx.db.get(draftId),
    ctx.db.query("mailMessages").withIndex("by_householdId", q => q.eq("householdId", sample.householdId)).collect(),
    ctx.db.query("mailThreads").withIndex("by_householdId", q => q.eq("householdId", sample.householdId)).collect(),
  ]));
  expect(intent?.state).toBe("sent");
  expect(draft?.state).toBe("sent");
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({ direction: "outbound", householdId: sample.householdId });
  expect(threads).toHaveLength(1);
  expect(threads[0]._id).toBe(messages[0].threadId);
  expect(mailClientSpy).not.toHaveBeenCalled();
});

test("scripted demo reply attaches to that household's last outbound thread only", async () => {
  mailClientSpy.mockClear();
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  await t.run(ctx => ctx.db.insert("operatorSettings", { key: "pauseAutomaticOperations", enabled: true, updatedAt: Date.now() }));
  const first = await demo(t, "reply@example.test");
  const second = await demo(t, "other@example.test");
  await t.action(internal.mail.provisionInternal, { householdId: first.householdId });
  await t.action(internal.mail.provisionInternal, { householdId: second.householdId });
  await first.user.action(api.mail.demoOfficeMessage, { householdId: first.householdId, scenario: "initial" });
  await second.user.action(api.mail.demoOfficeMessage, { householdId: second.householdId, scenario: "initial" });
  await sendDemoDraft(t, first.householdId, first.user);
  await first.user.action(api.mail.demoOfficeMessage, { householdId: first.householdId, scenario: "reply" });
  const [firstMessages, secondMessages] = await t.run(async ctx => Promise.all([first, second].map(({ householdId }) =>
    ctx.db.query("mailMessages").withIndex("by_householdId", q => q.eq("householdId", householdId)).collect()
  )));
  const outbound = firstMessages.find(message => message.direction === "outbound");
  const reply = firstMessages.find(message => message.direction === "inbound" && message.plaintext.includes("Scripted office reply"));
  expect(outbound).toBeDefined();
  expect(reply?.threadId).toBe(outbound?.threadId);
  expect(secondMessages).toHaveLength(1);
  expect(secondMessages[0].direction).toBe("inbound");
  expect(mailClientSpy).not.toHaveBeenCalled();
});
