/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { occurrence } from "./model/recurrence";
import rateLimiterTest from "@convex-dev/rate-limiter/test";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.useRealTimers());

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(ctx=>ctx.db.insert("operatorSettings",{key:"pauseAutomaticOperations",enabled:true,updatedAt:Date.now()}));
  rateLimiterTest.register(t);
  const users = await t.run(async ctx => {
    const alice = await ctx.db.insert("users", { email: "alice@example.test", emailVerificationTime: 1 });
    const bob = await ctx.db.insert("users", { email: "bob@example.test", emailVerificationTime: 1 });
    const outsider = await ctx.db.insert("users", { email: "outsider@example.test", emailVerificationTime: 1 });
    const anon = await ctx.db.insert("users", { isAnonymous: true });
    return { alice, bob, outsider, anon };
  });
  const alice = t.withIdentity({ subject: users.alice });
  const bob = t.withIdentity({ subject: users.bob });
  const input = { nickname: "Dad", timezone: "America/New_York", firstTask: "Pick up groceries", adultConfirmed: true, authorityStatement: "Authorized by recipient", noticeVersion: "2026-09", emailImport: false, aiProcessing: false, requestId: "create-household" };
  const householdId = await alice.mutation(api.households.create, input);
  await t.run(ctx => ctx.db.insert("memberships", { householdId, userId: users.bob, role: "member", status: "active", joinedAt: 1, emailNotifications: false, lastReadSequence: 0 }));
  const tasks = await alice.query(api.tasks.list, { householdId, status: "open", paginationOpts: { numItems: 10, cursor: null } });
  return { t, users, alice, bob, householdId, taskId: tasks.page[0]._id, input };
}

test("household creation is idempotent, verifies adults/email, and blocks anonymous real use", async () => {
  const { t, alice, users, input, householdId } = await setup();
  expect(await alice.mutation(api.households.create, input)).toBe(householdId);
  await expect(alice.mutation(api.households.create, { ...input, nickname: "Changed" })).rejects.toThrow("already used");
  await expect(t.withIdentity({ subject: users.anon }).mutation(api.households.create, input)).rejects.toThrow("Verify your email");
  await expect(alice.mutation(api.households.create, { ...input, requestId: "another", adultConfirmed: false })).rejects.toThrow("adults");
  const events = await t.run(ctx => ctx.db.query("events").withIndex("by_householdId_and_sequence", q => q.eq("householdId", householdId)).take(10));
  expect(events.map(e => e.sequence)).toEqual([1, 2]);
});

test("foreign IDs, removed members, and unauthenticated reads fail closed", async () => {
  const { t, users, bob, householdId, taskId } = await setup();
  await expect(t.query(api.tasks.get, { taskId })).rejects.toThrow("Sign in");
  await expect(t.withIdentity({ subject: users.outsider }).query(api.tasks.get, { taskId })).rejects.toThrow("unavailable");
  await t.run(async ctx => { const m = await ctx.db.query("memberships").withIndex("by_householdId_and_userId", q => q.eq("householdId", householdId).eq("userId", users.bob)).unique(); await ctx.db.patch(m!._id, { status: "removed" }); });
  await expect(bob.mutation(api.tasks.transition, { taskId, expectedVersion: 1, operation: "claim" })).rejects.toThrow("unavailable");
});

test("two simultaneous claims have one winner and stale edits cannot overwrite", async () => {
  const { alice, bob, taskId } = await setup();
  const results = await Promise.allSettled([alice.mutation(api.tasks.transition, { taskId, expectedVersion: 1, operation: "claim" }), bob.mutation(api.tasks.transition, { taskId, expectedVersion: 1, operation: "claim" })]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  const task = await alice.query(api.tasks.get, { taskId });
  expect(task.version).toBe(2); expect(task.ownerId).not.toBeNull();
  await expect(alice.mutation(api.tasks.edit, { taskId, expectedVersion: 1, title: "Overwrite", category: "logistics", dueAt: null, note: "" })).rejects.toThrow("changed");
});

test("assignment requires acceptance, override requires owner reason, reopening retains completion history", async () => {
  const { alice, bob, users, taskId, householdId, t } = await setup();
  await alice.mutation(api.tasks.requestAssignment, { taskId, expectedVersion: 1, assigneeId: users.bob, override: false });
  expect(await bob.query(api.tasks.get, { taskId })).toMatchObject({ ownerId: null, requestedOwnerId: users.bob });
  await bob.mutation(api.tasks.transition, { taskId, expectedVersion: 2, operation: "acceptAssignment" });
  await expect(alice.mutation(api.tasks.transition, { taskId, expectedVersion: 3, operation: "release" })).rejects.toThrow("current owner");
  await expect(bob.mutation(api.tasks.requestAssignment, { taskId, expectedVersion: 3, assigneeId: users.alice, override: true, reason: "Correction" })).rejects.toThrow("household owner");
  await expect(alice.mutation(api.tasks.requestAssignment, { taskId, expectedVersion: 3, assigneeId: users.alice, override: true })).rejects.toThrow("Reason");
  await bob.mutation(api.tasks.transition, { taskId, expectedVersion: 3, operation: "complete" });
  await expect(alice.mutation(api.tasks.transition, { taskId, expectedVersion: 4, operation: "reopen" })).rejects.toThrow("Reason");
  await alice.mutation(api.tasks.transition, { taskId, expectedVersion: 4, operation: "reopen", reason: "Missing one item" });
  expect(await alice.query(api.tasks.get, { taskId })).toMatchObject({ status: "open", completedBy: users.bob, version: 5 });
  const events = await t.run(ctx => ctx.db.query("events").withIndex("by_householdId_and_sequence", q => q.eq("householdId", householdId)).take(20));
  expect(events.some(e => e.type === "task.complete")).toBe(true);
  expect(events.some(e => e.type === "task.reopen" && e.after.includes("Missing one item"))).toBe(true);
});

test("partial handover acceptance preserves retained and unassigned work and immutable receipts", async () => {
  const { alice, bob, users, taskId, householdId } = await setup();
  await alice.mutation(api.tasks.transition, { taskId, expectedVersion: 1, operation: "claim" });
  const retainedId = await alice.mutation(api.tasks.create, { householdId, title: "Prepare meal", category: "meal", dueAt: null, note: "Vegetarian", requestedOwnerId: users.alice, requestId: "meal" });
  const unassignedId = await alice.mutation(api.tasks.create, { householdId, title: "Arrange ride", category: "ride", dueAt: null, note: "", requestedOwnerId: null, requestId: "ride" });
  const handoverId = await alice.mutation(api.handovers.prepare, { householdId, recipientId: users.bob, proposedTaskIds: [taskId, retainedId, unassignedId], introduction: "Here is what remains.", note: "", requestId: "handover" });
  await alice.mutation(api.handovers.publish, { handoverId, expectedVersion: 1 });
  expect((await bob.query(api.handovers.get, { handoverId })).stale).toBe(false);
  const receiptId = await bob.mutation(api.handovers.acceptHandover, { handoverId, expectedVersion: 2, acceptedTaskIds: [taskId], takeCoverage: false });
  expect(await bob.mutation(api.handovers.acceptHandover, { handoverId, expectedVersion: 2, acceptedTaskIds: [taskId], takeCoverage: false })).toBe(receiptId);
  await expect(bob.mutation(api.handovers.acceptHandover, { handoverId, expectedVersion: 2, acceptedTaskIds: [retainedId], takeCoverage: false })).rejects.toThrow("different selection");
  expect((await alice.query(api.tasks.get, { taskId })).ownerId).toBe(users.bob);
  expect((await alice.query(api.tasks.get, { taskId: retainedId })).ownerId).toBe(users.alice);
  expect((await alice.query(api.tasks.get, { taskId: unassignedId })).ownerId).toBeNull();
  const accepted = await bob.query(api.handovers.get, { handoverId });
  expect(accepted.receipt).toMatchObject({ transferredTaskIds: [taskId], retainedTaskIds: [retainedId], unassignedTaskIds: [unassignedId] });
  const oldSnapshot = accepted.items.find(i => i.snapshot.taskId === taskId)!.snapshot;
  await bob.mutation(api.tasks.edit, { taskId, expectedVersion: 3, title: "Updated groceries", category: "errand", dueAt: null, note: "Added bread" });
  const afterEdit = await bob.query(api.handovers.get, { handoverId });
  expect(afterEdit.items.find(i => i.snapshot.taskId === taskId)!.snapshot).toEqual(oldSnapshot);
  expect(afterEdit.receipt).toEqual(accepted.receipt);
  expect(afterEdit.currentMaterialRevision).toBeGreaterThan(accepted.receipt!.receiptRevision);
});

test("task completion makes a pending handover stale; refresh creates a new immutable version", async () => {
  const { alice, bob, users, taskId, householdId } = await setup();
  const handoverId = await alice.mutation(api.handovers.prepare, { householdId, recipientId: users.bob, proposedTaskIds: [taskId], introduction: "", note: "", requestId: "pending" });
  await alice.mutation(api.handovers.publish, { handoverId, expectedVersion: 1 });
  await alice.mutation(api.tasks.transition, { taskId, expectedVersion: 1, operation: "complete" });
  await expect(bob.mutation(api.handovers.acceptHandover, { handoverId, expectedVersion: 2, acceptedTaskIds: [taskId], takeCoverage: false })).rejects.toThrow("Information changed");
  const refreshed = await alice.mutation(api.handovers.refresh, { handoverId, expectedVersion: 2, requestId: "refresh" });
  expect(refreshed).not.toBe(handoverId);
  expect((await alice.query(api.handovers.get, { handoverId })).handover.status).toBe("superseded");
  expect((await alice.query(api.handovers.get, { handoverId: refreshed })).items).toHaveLength(0);
  await alice.mutation(api.handovers.publish, { handoverId: refreshed, expectedVersion: 1 });
  await bob.mutation(api.handovers.acceptHandover, { handoverId: refreshed, expectedVersion: 2, acceptedTaskIds: [], takeCoverage: false });
  expect((await alice.query(api.tasks.get, { taskId })).status).toBe("done");
});

test("new unreviewed information invalidates acceptance atomically", async () => {
  const { t, alice, bob, users, householdId, taskId } = await setup();
  const handoverId = await alice.mutation(api.handovers.prepare, { householdId, recipientId: users.bob, proposedTaskIds: [taskId], introduction: "", note: "", requestId: "news" });
  await alice.mutation(api.handovers.publish, { handoverId, expectedVersion: 1 });
  // Ingestion's material-change primitive is tested here without a provider call.
  await t.run(async ctx => { const { record } = await import("./model/events"); await record(ctx, { householdId, actorId: null, type: "source.received", entity: { kind: "household", id: householdId }, after: "New office information awaiting review." }); });
  await expect(bob.mutation(api.handovers.acceptHandover, { handoverId, expectedVersion: 2, acceptedTaskIds: [taskId], takeCoverage: false })).rejects.toThrow("Information changed");
  expect((await alice.query(api.tasks.get, { taskId })).ownerId).toBeNull();
});

test("invitations are email bound, consumed once, revocable, and cannot restore access after removal", async () => {
  const { t, alice, users, householdId } = await setup();
  const outsider = t.withIdentity({ subject: users.outsider });
  const invite = await alice.action(api.invites.create, { householdId, email: "outsider@example.test" });
  await expect(alice.action(api.invites.preview, { token: invite.token })).rejects.toThrow("invitation was sent to");
  expect((await outsider.action(api.invites.preview, { token: invite.token })).nickname).toBe("Dad");
  expect(await outsider.action(api.invites.respond, { token: invite.token, accept: true })).toBe(householdId);
  expect(await outsider.action(api.invites.respond, { token: invite.token, accept: true })).toBe(householdId);
  expect((await outsider.action(api.invites.preview, { token: invite.token })).status).toBe("accepted");
  const team = await alice.query(api.team.list, { householdId });
  const target = team.members.find(m => m.membership.userId === users.outsider)!;
  await alice.mutation(api.team.remove, { householdId, memberId: target.membership._id });
  await expect(outsider.action(api.invites.preview, { token: invite.token })).rejects.toThrow("unavailable");
  await expect(outsider.action(api.invites.respond, { token: invite.token, accept: true })).rejects.toThrow("unavailable");
  const renewed = await alice.action(api.invites.create, { householdId, email: "outsider@example.test" });
  await alice.mutation(api.inviteStore.revoke, { inviteId: renewed.inviteId });
  await expect(outsider.action(api.invites.respond, { token: renewed.token, accept: true })).rejects.toThrow("expired or was revoked");
  const stored = await t.run(ctx => ctx.db.get(invite.inviteId));
  expect(stored!.tokenHash).not.toBe(invite.token);
  expect(stored!.tokenHash).toHaveLength(64);
});

test("invitation expiry rejects a previously previewed link at the exact deadline without granting membership", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-20T12:00:00Z"));
  const { t, alice, users, householdId } = await setup();
  const outsider = t.withIdentity({ subject: users.outsider });
  const invite = await alice.action(api.invites.create, { householdId, email: "outsider@example.test" });
  vi.setSystemTime(invite.expiresAt - 1);
  expect((await outsider.action(api.invites.preview, { token: invite.token })).status).toBe("pending");
  vi.setSystemTime(invite.expiresAt);
  await expect(outsider.action(api.invites.preview, { token: invite.token })).rejects.toThrow("expired");
  for (const accept of [true, false]) {
    await expect(outsider.action(api.invites.respond, { token: invite.token, accept })).rejects.toThrow("expired");
  }
  expect(await t.run(ctx => ctx.db.query("memberships").withIndex("by_householdId_and_userId", q => q.eq("householdId", householdId).eq("userId", users.outsider)).unique())).toBeNull();
  expect((await t.run(ctx => ctx.db.get(invite.inviteId)))?.status).toBe("pending");
  await expect(outsider.query(api.tasks.list, { householdId, status: "open", paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow("unavailable");

  // Expiry limits joining, not an already accepted member's return shortcut.
  const renewed = await alice.action(api.invites.create, { householdId, email: "outsider@example.test" });
  vi.setSystemTime(renewed.expiresAt - 1);
  expect(await outsider.action(api.invites.respond, { token: renewed.token, accept: true })).toBe(householdId);
  vi.setSystemTime(renewed.expiresAt + 1);
  expect((await outsider.action(api.invites.preview, { token: renewed.token })).status).toBe("accepted");
  expect(await outsider.action(api.invites.respond, { token: renewed.token, accept: true })).toBe(householdId);
});

test("owner transfer preserves one owner, and membership removal invalidates handovers", async () => {
  const { alice, bob, users, householdId, taskId } = await setup();
  const team = await alice.query(api.team.list, { householdId });
  const aliceMembership = team.members.find(m => m.membership.userId === users.alice)!.membership._id;
  await expect(alice.mutation(api.team.remove, { householdId, memberId: aliceMembership })).rejects.toThrow("Transfer ownership");
  const handoverId = await alice.mutation(api.handovers.prepare, { householdId, recipientId: users.bob, proposedTaskIds: [taskId], introduction: "", note: "", requestId: "remove-member" });
  await alice.mutation(api.handovers.publish, { handoverId, expectedVersion: 1 });
  await alice.mutation(api.team.transferOwnership, { householdId, newOwnerId: users.bob });
  await bob.mutation(api.team.remove, { householdId, memberId: aliceMembership });
  await expect(alice.query(api.handovers.get, { handoverId })).rejects.toThrow("unavailable");
  await expect(bob.mutation(api.handovers.acceptHandover, { handoverId, expectedVersion: 2, acceptedTaskIds: [taskId], takeCoverage: false })).rejects.toThrow("active household member");
});

test("planned coverage never starts by time, simultaneous starts yield one active owner, explicit handover transfers it", async () => {
  const { alice, bob, users, householdId } = await setup();
  const startsAt = Date.now() - 3600000, endsAt = Date.now() + 3600000;
  const first = await alice.mutation(api.coverage.create, { householdId, startsAt, endsAt, volunteer: true, note: "", requestId: "coverage-a" });
  const second = await bob.mutation(api.coverage.create, { householdId, startsAt, endsAt, volunteer: true, note: "", requestId: "coverage-b" });
  expect((await alice.query(api.households.get, { householdId })).currentCoverageId).toBeNull();
  const results = await Promise.allSettled([alice.mutation(api.coverage.transition, { coverageId: first, expectedVersion: 1, operation: "start" }), bob.mutation(api.coverage.transition, { coverageId: second, expectedVersion: 1, operation: "start" })]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  const activeId = (await alice.query(api.households.get, { householdId })).currentCoverageId!;
  const sender = activeId === first ? alice : bob, recipient = activeId === first ? bob : alice, recipientId = activeId === first ? users.bob : users.alice;
  const handoverId = await sender.mutation(api.handovers.prepare, { householdId, recipientId, proposedTaskIds: [], coverageId: activeId, introduction: "", note: "", requestId: "coverage-transfer" });
  await sender.mutation(api.handovers.publish, { handoverId, expectedVersion: 1 });
  await recipient.mutation(api.handovers.acceptHandover, { handoverId, expectedVersion: 2, acceptedTaskIds: [], takeCoverage: true });
  expect((await recipient.query(api.coverage.get, { coverageId: activeId })).activeOwnerId).toBe(recipientId);
});

test("visit completion does not complete its ride and foreign rides cannot be attached", async () => {
  const { t, alice, users, householdId } = await setup();
  const visitId = await alice.mutation(api.visits.create, { householdId, title: "Office visit", confirmedStartsAt: Date.now() + 86400000, timezone: "UTC", confirmedAddress: "Test Clinic", phone: "", note: "", checklist: [{ key: "keys", label: "Bring keys", done: false }], requestId: "visit" });
  const rideId = await alice.mutation(api.tasks.create, { householdId, title: "Ride", category: "ride", dueAt: null, note: "", requestedOwnerId: users.alice, requestId: "ride-visit" });
  await alice.mutation(api.visits.linkRide, { visitId, expectedVersion: 1, taskId: rideId });
  await alice.mutation(api.visits.transition, { visitId, expectedVersion: 2, operation: "complete" });
  const result = await alice.query(api.visits.get, { visitId });
  expect(result.visit.status).toBe("completed"); expect(result.ride!.status).toBe("open");
  const other = t.withIdentity({ subject: users.outsider });
  const otherHousehold = await other.mutation(api.households.create, { nickname: "Other", timezone: "UTC", firstTask: "Other task", adultConfirmed: true, authorityStatement: "Authorized", noticeVersion: "v1", emailImport: false, aiProcessing: false, requestId: "other" });
  const foreignRide = await other.mutation(api.tasks.create, { householdId: otherHousehold, title: "Other ride", category: "ride", dueAt: null, note: "", requestedOwnerId: null, requestId: "foreign" });
  await expect(alice.mutation(api.visits.linkRide, { visitId, expectedVersion: 3, taskId: foreignRide })).rejects.toThrow("unavailable");
});

test("DST spring gap uses the next valid instant and fall repetition uses the first offset", () => {
  const spring = occurrence("2026-03-08", "02:30", "America/New_York");
  expect(new Date(spring.dueAt).toISOString()).toBe("2026-03-08T07:00:00.000Z");
  expect(spring.dstAdjustment).toContain("Nonexistent");
  const fall = occurrence("2026-11-01", "01:30", "America/New_York");
  expect(new Date(fall.dueAt).toISOString()).toBe("2026-11-01T05:30:00.000Z");
  expect(fall.dstAdjustment).toContain("-04:00");
  const normal = occurrence("2026-09-19", "08:00", "Asia/Kolkata");
  expect(new Date(normal.dueAt).toISOString()).toBe("2026-09-19T02:30:00.000Z");
  expect(normal.dstAdjustment).toBeUndefined();
});

test("recurrence generation is idempotent, preserves completed/edited occurrences, and revises only future dates", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-19T12:00:00Z"));
  const { t, alice, householdId } = await setup();
  const fields = { title: "Check in", category: "checkin" as const, note: "", localTime: "08:00", timezone: "America/New_York", weekdays: [1, 2, 3, 4, 5, 6, 7], activeUntil: null, proposedOwnerId: null };
  const seriesId = await alice.mutation(api.recurrence.create, { householdId, ...fields, activeFrom: "2026-09-19", requestId: "daily" });
  const getOccurrences = () => t.run(ctx => ctx.db.query("tasks").withIndex("by_seriesId_and_occurrenceLocalDate", q => q.eq("seriesId", seriesId)).take(100));
  expect(await getOccurrences()).toHaveLength(31);
  expect(await t.mutation(internal.recurrence.generate, { seriesId })).toBe(0);
  const all = await getOccurrences(), done = all.find(task => task.occurrenceLocalDate === "2026-09-20")!, edited = all.find(task => task.occurrenceLocalDate === "2026-09-21")!;
  await alice.mutation(api.tasks.transition, { taskId: done._id, expectedVersion: 1, operation: "complete" });
  await alice.mutation(api.tasks.edit, { taskId: edited._id, expectedVersion: 1, title: "Special check in", category: "checkin", dueAt: edited.dueAt, note: "One occurrence only" });
  const doneBefore = await alice.query(api.tasks.get, { taskId: done._id });
  await alice.mutation(api.recurrence.editFuture, { seriesId, expectedVersion: 1, fromDate: "2026-09-20", ...fields, localTime: "09:00" });
  expect(await alice.query(api.tasks.get, { taskId: done._id })).toEqual(doneBefore);
  expect((await alice.query(api.tasks.get, { taskId: edited._id })).title).toBe("Special check in");
  const series = await t.run(ctx => ctx.db.query("taskSeries").withIndex("by_householdId_and_status", q => q.eq("householdId", householdId).eq("status", "active")).take(10));
  const newSeries = series.find(row => row._id !== seriesId)!;
  expect(newSeries.suppressedDates).toEqual(["2026-09-20", "2026-09-21"]);
  const future = await t.run(ctx => ctx.db.query("tasks").withIndex("by_seriesId_and_occurrenceLocalDate", q => q.eq("seriesId", newSeries._id)).take(100));
  expect(future.some(task => task.occurrenceLocalDate === "2026-09-20")).toBe(false);
  expect(new Date(future.find(task => task.occurrenceLocalDate === "2026-09-22")!.dueAt!).toISOString()).toBe("2026-09-22T13:00:00.000Z");
  await alice.mutation(api.recurrence.cancelFuture, { seriesId: newSeries._id, expectedVersion: 1, fromDate: "2026-09-22" });
  expect(await t.mutation(internal.recurrence.generate, { seriesId: newSeries._id })).toBe(0);
  expect((await alice.query(api.tasks.get, { taskId: done._id })).status).toBe("done");
});

test("personal notification reads do not change material revision or accept responsibility", async () => {
  const { alice, bob, users, householdId, taskId } = await setup();
  await alice.mutation(api.tasks.requestAssignment, { taskId, expectedVersion: 1, assigneeId: users.bob, override: false });
  const before = await bob.query(api.households.get, { householdId });
  const notifications = await bob.query(api.notifications.list, { householdId, unreadOnly: true, paginationOpts: { numItems: 10, cursor: null } });
  expect(notifications.page).toHaveLength(1);
  await expect(alice.mutation(api.notifications.read, { notificationId: notifications.page[0]._id })).rejects.toThrow("unavailable");
  await bob.mutation(api.notifications.readAll, { householdId });
  expect((await bob.query(api.households.get, { householdId })).materialRevision).toBe(before.materialRevision);
  expect((await bob.query(api.tasks.get, { taskId })).ownerId).toBeNull();
});

test("source approval verifies quotes and target versions, with one winner for conflicting approvals", async () => {
  const { t, alice, bob, users, householdId, taskId } = await setup();
  await alice.mutation(api.care.saveProfile,{householdId,expectedVersion:0,preferredName:"Synthetic parent",dateOfBirth:"",allergiesState:"unknown",allergies:"",conditions:"",preferences:"",communication:"",emergencyInstructions:"",authorizedUserIds:[users.bob],authorityStatement:"Synthetic test only"});
  const ids = await t.run(async ctx => {
    const sourceId = await ctx.db.insert("sources", { householdId, kind: "email", contentHash: "test-hash", plaintext: "Please pick up bread.", capturedAt: Date.now(), publishedAt: null, retentionUntil: Date.now() + 86400000, extractionState: "ready", warnings: [], truncated: false, unresolvedReferences: 2, version: 1 });
    const fields = { householdId, sourceId, target: { kind: "task" as const, id: taskId }, targetVersion: 1, field: "note" as const, proposedValue: "Pick up bread", previousValue: "", quote: "pick up bread", quoteStart: 7, quoteEnd: 20, status: "pending" as const, version: 1 };
    return { a: await ctx.db.insert("proposals", fields), b: await ctx.db.insert("proposals", { ...fields, proposedValue: "Bring bread" }) };
  });
  await expect(alice.mutation(api.proposals.review,{proposalId:ids.a,expectedVersion:1,decision:"approve",reason:""})).rejects.toThrow("SHARING_CONFIRMATION");
  const results = await Promise.allSettled([alice.mutation(api.proposals.review, { proposalId: ids.a, expectedVersion: 1, decision: "approve", acknowledgeHouseholdSharing:true, reason: "" }), bob.mutation(api.proposals.review, { proposalId: ids.b, expectedVersion: 1, decision: "approve", acknowledgeHouseholdSharing:true, reason: "" })]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  const task = await alice.query(api.tasks.get, { taskId });
  expect(task.version).toBe(2); expect(task.sourceRefs[0].quote).toBe("pick up bread");
  const loser = results[0].status === "rejected" ? ids.a : ids.b;
  await expect(alice.mutation(api.proposals.review, { proposalId: loser, expectedVersion: 1, expectedTargetVersion: 2, decision: "approve", acknowledgeHouseholdSharing:true, reason: "" })).rejects.toThrow("changed since extraction");
  await alice.mutation(api.proposals.review, { proposalId: loser, expectedVersion: 1, decision: "dismiss", reason: "Superseded by reviewed change" });
  const invalid = await t.run(async ctx => { const p = await ctx.db.get(ids.a); return ctx.db.insert("proposals", { householdId, sourceId: p!.sourceId, target: { kind: "task", id: taskId }, targetVersion: 2, field: "note", proposedValue: "Unfounded", previousValue: task.note, quote: "not in source", quoteStart: 0, quoteEnd: 13, status: "pending", version: 1 }); });
  await expect(alice.mutation(api.proposals.review, { proposalId: invalid, expectedVersion: 1, decision: "approve", acknowledgeHouseholdSharing:true, reason: "" })).rejects.toThrow("does not match");
  expect((await alice.query(api.tasks.get, { taskId })).note).toBe(task.note);
});

test("demo households are isolated, creation is idempotent, and role capabilities are single-use and scoped", async () => {
  const { t, alice, users, householdId: realHousehold } = await setup();
  const maya = t.withIdentity({ subject: users.anon });
  const householdId = await maya.action(api.demoTokens.create, {});
  expect(await maya.action(api.demoTokens.create, {})).toBe(householdId);
  await expect(alice.action(api.demoTokens.create, {})).rejects.toThrow("anonymous sample session");
  await expect(maya.query(api.households.get, { householdId: realHousehold })).rejects.toThrow("unavailable");
  const token = await maya.action(api.demoTokens.secondRoleLink, { householdId });
  const leoId = await t.action(internal.demoTokens.redeem, { token });
  await expect(t.action(internal.demoTokens.redeem, { token })).rejects.toThrow("already used");
  const leo = t.withIdentity({ subject: leoId });
  expect((await leo.query(api.households.get, { householdId })).mode).toBe("demo");
  await expect(leo.query(api.households.get, { householdId: realHousehold })).rejects.toThrow("unavailable");
  await expect(leo.action(api.demoTokens.secondRoleLink, { householdId })).rejects.toThrow("owner");
  const tasks = await leo.query(api.tasks.list, { householdId, status: "open", paginationOpts: { numItems: 20, cursor: null } });
  const ride = tasks.page.find(task => task.category === "ride")!;
  await leo.mutation(api.tasks.transition, { taskId: ride._id, expectedVersion: 1, operation: "claim" });
  expect((await maya.query(api.tasks.get, { taskId: ride._id })).ownerId).toBe(leoId);
});

test("timezone preview and confirmation preserve historical and individually edited occurrences", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-19T12:00:00Z"));
  const { t, alice, householdId } = await setup();
  const seriesId = await alice.mutation(api.recurrence.create, { householdId, title: "Morning meal", category: "meal", note: "", localTime: "09:00", timezone: "America/New_York", weekdays: [1, 2, 3, 4, 5, 6, 7], activeFrom: "2026-09-19", activeUntil: null, proposedOwnerId: null, requestId: "tz-series" });
  const rows = await t.run(ctx => ctx.db.query("tasks").withIndex("by_seriesId_and_occurrenceLocalDate", q => q.eq("seriesId", seriesId)).take(40));
  const done = rows[1], edited = rows[2];
  await alice.mutation(api.tasks.transition, { taskId: done._id, expectedVersion: 1, operation: "complete" });
  await alice.mutation(api.tasks.edit, { taskId: edited._id, expectedVersion: 1, title: "Special meal", category: "meal", dueAt: edited.dueAt, note: "" });
  const preview = await alice.action(api.householdTimezone.preview, { householdId, timezone: "America/Los_Angeles" });
  expect(preview.changes.some(item => item.taskId === done._id || item.taskId === edited._id)).toBe(false);
  await expect(alice.mutation(api.householdTimezone.confirm, { householdId, timezone: "America/Los_Angeles", expectedMaterialRevision: preview.materialRevision, previewedAt: preview.previewedAt, confirmed: false })).rejects.toThrow("confirm");
  const changed = await alice.mutation(api.householdTimezone.confirm, { householdId, timezone: "America/Los_Angeles", expectedMaterialRevision: preview.materialRevision, previewedAt: preview.previewedAt, confirmed: true });
  expect(changed).toBe(29);
  expect((await alice.query(api.tasks.get, { taskId: done._id })).dueAt).toBe(done.dueAt);
  expect((await alice.query(api.tasks.get, { taskId: edited._id })).dueAt).toBe(edited.dueAt);
  expect((await alice.query(api.tasks.get, { taskId: rows[0]._id })).dueAt).toBe(rows[0].dueAt! + 3 * 3600000);
  await expect(alice.mutation(api.householdTimezone.confirm, { householdId, timezone: "UTC", expectedMaterialRevision: preview.materialRevision, previewedAt: preview.previewedAt, confirmed: true })).rejects.toThrow("changed");
});

test("draft approval locks exact content, new replies invalidate approval, and revoked contacts block send intent", async () => {
  const { t, alice, users, householdId } = await setup();
  await alice.mutation(api.consents.set, { householdId, scope: "emailImport", granted: true, noticeVersion: "test", authorityStatement: "Authorized synthetic test" });
  const contact = { householdId, email: "office@example.test", label: "Test office", relationship: "Synthetic unit-test contact", allowSend: true, allowReceive: true, allowReply: true, state: "approved" as const };
  await alice.mutation(api.contacts.set, contact);
  const threadId = await t.run(ctx => ctx.db.insert("mailThreads", { householdId, inboxId: "unit-inbox", providerThreadId: "unit-thread", related: null, subject: "Logistics", state: "new", archived: false, quarantined: false, deleting: false, lastMessageAt: Date.now(), version: 1 }));
  const draftId = await alice.mutation(api.drafts.create, { householdId, threadId, related: null, recipient: contact.email, subject: "Entrance question", body: "Which entrance should we use?", sourceRefs: [], requestId: "draft-1" });
  let draft = await alice.query(api.drafts.get, { draftId });
  await expect(alice.mutation(api.drafts.approveSend, { draftId, expectedVersion: 1, expectedHash: draft.contentHash, logicalSendId: "send-1" })).rejects.toThrow("provider draft");
  await t.run(ctx => ctx.db.patch(draftId, { providerDraftId: "unit-provider-draft", providerSyncedVersion: 1 }));
  await expect(alice.mutation(api.drafts.approveSend, { draftId, expectedVersion: 1, expectedHash: "wrong", logicalSendId: "send-1" })).rejects.toThrow("changed");
  await t.run(ctx => ctx.db.patch(threadId, { version: 2, state: "replyReceived" }));
  await expect(alice.mutation(api.drafts.approveSend, { draftId, expectedVersion: 1, expectedHash: draft.contentHash, logicalSendId: "send-1" })).rejects.toThrow("conversation changed");
  await alice.mutation(api.drafts.edit, { draftId, expectedVersion: 1, subject: draft.subject, body: "Thank you. Which entrance is accessible?", sourceRefs: [] });
  draft = await alice.query(api.drafts.get, { draftId });
  await t.run(ctx => ctx.db.patch(draftId, { providerSyncedVersion: 2 }));
  const intentId = await alice.mutation(api.drafts.approveSend, { draftId, expectedVersion: 2, expectedHash: draft.contentHash, logicalSendId: "send-1" });
  expect(await alice.mutation(api.drafts.approveSend, { draftId, expectedVersion: 2, expectedHash: draft.contentHash, logicalSendId: "send-1" })).toBe(intentId);
  await expect(alice.mutation(api.drafts.edit, { draftId, expectedVersion: 2, subject: "Changed", body: "Changed", sourceRefs: [] })).rejects.toThrow("locked");
  expect((await alice.query(api.sendIntents.get, { sendIntentId: intentId })).body).toBe(draft.body);
  await expect(t.withIdentity({ subject: users.outsider }).query(api.sendIntents.get, { sendIntentId: intentId })).rejects.toThrow("unavailable");
  await alice.mutation(api.sendIntents.cancel, { sendIntentId: intentId });
  await alice.mutation(api.contacts.set, { ...contact, expectedVersion: 1, state: "blocked" });
  draft = await alice.query(api.drafts.get, { draftId });
  await t.run(ctx => ctx.db.patch(draftId, { providerSyncedVersion: draft.version }));
  await expect(alice.mutation(api.drafts.approveSend, { draftId, expectedVersion: draft.version, expectedHash: draft.contentHash, logicalSendId: "send-2" })).rejects.toThrow("Confirm this contact");
});

test("family forwarded mail cannot impersonate the office reply address", async () => {
  const { t, alice, householdId } = await setup();
  await alice.mutation(api.consents.set, { householdId, scope: "emailImport", granted: true, noticeVersion: "test", authorityStatement: "Authorized test" });
  await alice.mutation(api.contacts.set, { householdId, email: "office@example.test", label: "Office", relationship: "Test", allowSend: true, allowReceive: true, allowReply: true, state: "approved" });
  const threadId = await t.run(async ctx => {
    const id = await ctx.db.insert("mailThreads", { householdId, inboxId: "unit-inbox", providerThreadId: "forward-thread", related: null, subject: "Fwd", state: "new", archived: false, quarantined: false, deleting: false, lastMessageAt: Date.now(), version: 1 });
    await ctx.db.insert("mailMessages", { householdId, threadId: id, providerMessageId: "forward-message", inboxId: "unit-inbox", direction: "inbound", from: "alice@example.test", to: ["inbox@example.test"], plaintext: "Forwarded from office@example.test", subject: "Fwd", occurredAt: Date.now(), delivery: "delivered", attachmentOnly: false, truncated: false, retentionUntil: Date.now() + 86400000, unresolvedReferences: 1 });
    return id;
  });
  await expect(alice.mutation(api.drafts.create, { householdId, threadId, related: null, recipient: "office@example.test", subject: "Question", body: "Entrance?", inReplyTo: "forward-message", sourceRefs: [], requestId: "bad-reply" })).rejects.toThrow("actual approved sender");
  const draftId = await alice.mutation(api.drafts.create, { householdId, related: null, recipient: "office@example.test", subject: "Question", body: "Entrance?", sourceRefs: [], requestId: "new-question" });
  expect((await alice.query(api.drafts.get, { draftId })).inReplyTo).toBeUndefined();
});

test("deletion immediately revokes access and private job progress remains requester-only", async () => {
  const { alice, bob, taskId, householdId } = await setup();
  await expect(bob.mutation(api.privacyJobs.request, { householdId, kind: "delete", confirmed: true, requestId: "not-owner" })).rejects.toThrow("owner");
  const request = { householdId, kind: "delete" as const, confirmed: true, requestId: "delete" };
  const id = await alice.mutation(api.privacyJobs.request, request);
  expect(await alice.mutation(api.privacyJobs.request, request)).toBe(id);
  await expect(alice.query(api.tasks.get, { taskId })).rejects.toThrow("unavailable");
  await expect(bob.query(api.tasks.get, { taskId })).rejects.toThrow("unavailable");
  await expect(bob.query(api.privacyJobs.get, { privacyJobId: id })).rejects.toThrow("unavailable");
  expect((await alice.query(api.privacyJobs.get, { privacyJobId: id })).state).toBe("queued");
});

test("cancelling a recurring rule preserves separately edited and completed occurrences",async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
 const {t,alice,householdId}=await setup();
 const seriesId=await alice.mutation(api.recurrence.create,{householdId,title:'Daily sample check',category:'checkin',note:'Synthetic test',localTime:'09:00',timezone:'America/New_York',weekdays:[1,2,3,4,5,6,7],activeFrom:'2026-09-19',activeUntil:'2026-09-22',proposedOwnerId:null,requestId:'cancel-exceptions'});
 const rows=await t.run(ctx=>ctx.db.query('tasks').withIndex('by_seriesId_and_occurrenceLocalDate',q=>q.eq('seriesId',seriesId)).take(10));
 const done=rows[0],edited=rows[1];
 await alice.mutation(api.tasks.transition,{taskId:done._id,expectedVersion:done.version,operation:'complete'});
 await alice.mutation(api.tasks.edit,{taskId:edited._id,expectedVersion:edited.version,title:'Special one-off check',category:'checkin',dueAt:edited.dueAt,note:'Keep this independently edited occurrence.'});
 const before=await Promise.all([alice.query(api.tasks.get,{taskId:done._id}),alice.query(api.tasks.get,{taskId:edited._id})]);
 await alice.mutation(api.recurrence.cancelFuture,{seriesId,expectedVersion:1,fromDate:'2026-09-19'});
 expect(await alice.query(api.tasks.get,{taskId:done._id})).toEqual(before[0]);
 expect(await alice.query(api.tasks.get,{taskId:edited._id})).toEqual(before[1]);
 for(const task of rows.slice(2))expect((await alice.query(api.tasks.get,{taskId:task._id})).status).toBe('cancelled');
 expect(await t.mutation(internal.recurrence.generate,{seriesId})).toBe(0);
});

test('recurring occurrence pages are scoped, stable across statuses, and linked after a rule split',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
 const {t,alice,bob,users,householdId}=await setup();
 const fields={title:'Daily check',category:'checkin' as const,note:'Synthetic',localTime:'09:00',timezone:'America/New_York',weekdays:[1,2,3,4,5,6,7],activeUntil:null,proposedOwnerId:null};
 const seriesId=await alice.mutation(api.recurrence.create,{householdId,...fields,activeFrom:'2026-09-19',requestId:'pages'});
 const args={seriesId,fromDate:null,paginationOpts:{numItems:25,cursor:null}};
 const first=await alice.query(api.recurrence.occurrences,args);
 expect(first.page).toHaveLength(25);expect(first.isDone).toBe(false);
 expect(first.page[0].occurrenceLocalDate).toBe('2026-10-19');
 const second=await alice.query(api.recurrence.occurrences,{...args,paginationOpts:{numItems:25,cursor:first.continueCursor}});
 expect(second.page).toHaveLength(6);expect(second.isDone).toBe(true);
 expect(new Set([...first.page,...second.page].map(t=>t._id)).size).toBe(31);
 const upcoming=await bob.query(api.recurrence.occurrences,{...args,fromDate:'2026-10-18'});
 expect(upcoming.page.map(t=>t.occurrenceLocalDate)).toEqual(['2026-10-18','2026-10-19']);
 await expect(t.query(api.recurrence.occurrences,args)).rejects.toThrow('Sign in');
 await expect(t.withIdentity({subject:users.outsider}).query(api.recurrence.occurrences,args)).rejects.toThrow('unavailable');
 await expect(alice.query(api.recurrence.occurrences,{...args,fromDate:'2026-02-30'})).rejects.toThrow('valid local date');
 const preserved=second.page.at(-1)!;
 await alice.mutation(api.tasks.transition,{taskId:preserved._id,expectedVersion:1,operation:'complete'});
 const newId=await alice.mutation(api.recurrence.editFuture,{...fields,seriesId,expectedVersion:1,fromDate:'2026-09-19',localTime:'10:00'});
 expect(newId).not.toBe(seriesId);
 expect(await alice.query(api.recurrence.get,{seriesId})).toMatchObject({status:'cancelled',nextSeriesId:newId});
 expect(await alice.query(api.recurrence.get,{seriesId:newId})).toMatchObject({status:'active',previousSeriesId:seriesId,suppressedDates:['2026-09-19']});
 const retained=await alice.query(api.recurrence.occurrences,args);
 expect(retained.page.map(t=>[t._id,t.status])).toEqual([[preserved._id,'done']]);
 const revised=await alice.query(api.recurrence.occurrences,{...args,seriesId:newId,fromDate:'2026-09-19'});
 expect(revised.page[0].occurrenceLocalDate).toBe('2026-09-20');
 expect(new Date(revised.page[0].dueAt!).toISOString()).toBe('2026-09-20T14:00:00.000Z');
 await alice.mutation(api.recurrence.cancelFuture,{seriesId:newId,expectedVersion:1,fromDate:'2026-09-19'});
 const cancelled=await alice.query(api.recurrence.occurrences,{...args,seriesId:newId,fromDate:'2026-09-19'});
 expect(cancelled.page.every(t=>t.status==='cancelled')).toBe(true);
 await expect(alice.mutation(api.recurrence.cancelFuture,{seriesId:newId,expectedVersion:2,fromDate:'2026-09-20'})).rejects.toThrow('cancelled');
 await t.run(async ctx=>{const membership=await ctx.db.query('memberships').withIndex('by_householdId_and_userId',q=>q.eq('householdId',householdId).eq('userId',users.bob)).unique();await ctx.db.patch(membership!._id,{status:'removed'});});
 await expect(bob.query(api.recurrence.occurrences,args)).rejects.toThrow('unavailable');
});

test('future rule edits keep the rolling thirty-day horizon and can revise a later start without creating early work',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
 const {t,alice,householdId}=await setup();
 const fields={title:'Later routine',category:'logistics' as const,note:'',localTime:'09:00',timezone:'America/New_York',weekdays:[1,2,3,4,5,6,7],activeUntil:null,proposedOwnerId:null};
 const seriesId=await alice.mutation(api.recurrence.create,{householdId,...fields,activeFrom:'2026-12-01',requestId:'far-future'});
 const revised=await alice.mutation(api.recurrence.editFuture,{seriesId,expectedVersion:1,...fields,fromDate:'2026-12-01',localTime:'10:00'});
 const args={seriesId:revised,fromDate:null,paginationOpts:{numItems:100,cursor:null}};
 expect((await alice.query(api.recurrence.occurrences,args)).page).toEqual([]);
 expect(await alice.query(api.recurrence.get,{seriesId:revised})).toMatchObject({activeFrom:'2026-12-01',generatedThrough:'2026-10-19'});
 const near=await alice.mutation(api.recurrence.create,{householdId,...fields,activeFrom:'2026-09-19',requestId:'near-future'});
 const later=await alice.mutation(api.recurrence.editFuture,{seriesId:near,expectedVersion:1,...fields,fromDate:'2026-10-01'});
 const page=await alice.query(api.recurrence.occurrences,{...args,seriesId:later});
 expect(page.page).toHaveLength(19);
 expect(page.page[0].occurrenceLocalDate).toBe('2026-10-19');
 expect(page.page.at(-1)!.occurrenceLocalDate).toBe('2026-10-01');
 await expect(alice.mutation(api.recurrence.editFuture,{seriesId:near,expectedVersion:2,...fields,fromDate:'2026-09-20'})).rejects.toThrow('revised rule');
});

test('timezone previews show each rule zone, avoid unchanged instants and expire before due work can move',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
 const {t,alice,bob,householdId}=await setup();
 const create={householdId,title:'Other-zone routine',category:'logistics' as const,note:'',localTime:'09:00',timezone:'America/Los_Angeles',weekdays:[1,2,3,4,5,6,7],activeFrom:'2026-09-19',activeUntil:'2026-09-20',proposedOwnerId:null,requestId:'independent-zone'};
 const seriesId=await alice.mutation(api.recurrence.create,create);
 const noop=await alice.action(api.householdTimezone.preview,{householdId,timezone:'America/New_York'});
 expect(noop.changes).toEqual([]);expect(noop.seriesIds).toEqual([]);
 expect(await alice.mutation(api.householdTimezone.confirm,{householdId,timezone:noop.toTimezone,expectedMaterialRevision:noop.materialRevision,previewedAt:noop.previewedAt,confirmed:true})).toBe(0);
 expect((await alice.query(api.recurrence.get,{seriesId})).timezone).toBe('America/Los_Angeles');
 const sameInstants=await alice.action(api.householdTimezone.preview,{householdId,timezone:'America/Los_Angeles'});
 expect(sameInstants.changes).toHaveLength(0);expect(sameInstants.unchangedHistoricalCount).toBe(2);
 const preview=await alice.action(api.householdTimezone.preview,{householdId,timezone:'Asia/Kathmandu'});
 expect(preview.changes).toHaveLength(2);expect(preview.changes.every(c=>c.fromTimezone==='America/Los_Angeles')).toBe(true);
 expect(new Date(preview.changes[0].newDueAt).toISOString()).toBe('2026-09-19T03:15:00.000Z');
 await expect(bob.action(api.householdTimezone.preview,{householdId,timezone:'UTC'})).rejects.toThrow('owner');
 vi.setSystemTime(new Date('2026-09-19T12:05:00.001Z'));
 await expect(alice.mutation(api.householdTimezone.confirm,{householdId,timezone:preview.toTimezone,expectedMaterialRevision:preview.materialRevision,previewedAt:preview.previewedAt,confirmed:true})).rejects.toThrow('Preview');
 vi.setSystemTime(new Date('2026-09-19T15:59:59.999Z'));
 const nearDue=await alice.action(api.householdTimezone.preview,{householdId,timezone:'UTC'});
 vi.setSystemTime(new Date('2026-09-19T16:00:00.001Z'));
 await expect(alice.mutation(api.householdTimezone.confirm,{householdId,timezone:nearDue.toTimezone,expectedMaterialRevision:nearDue.materialRevision,previewedAt:nearDue.previewedAt,confirmed:true})).rejects.toThrow('became due');
});
