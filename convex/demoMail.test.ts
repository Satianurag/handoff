import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function demo(t: ReturnType<typeof convexTest>, email: string) {
  return t.run(async ctx => {
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
}

test("demo provisioning is ready without provider resource ids", async () => {
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
});

test("direct demo ingestion is isolated by household", async () => {
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
