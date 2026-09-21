/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
const modules = import.meta.glob("./**/*.ts");
const input = {
  nickname: "Parent",
  displayName: "Caregiver",
  timezone: "America/New_York",
  firstTask: "Pick up groceries",
  adultConfirmed: true,
  authorityStatement: "Authorized synthetic test",
  noticeVersion: "2026-09-20",
  emailImport: false,
  aiProcessing: false,
  requestId: "onboarding-test",
};
async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => ({
    verified: await ctx.db.insert("users", {
      email: "test@example.test",
      emailVerificationTime: 1,
    }),
    other: await ctx.db.insert("users", {
      email: "other@example.test",
      emailVerificationTime: 1,
    }),
    unverified: await ctx.db.insert("users", {
      email: "unverified@example.test",
    }),
  }));
  return { t, ids, user: t.withIdentity({ subject: ids.verified }) };
}
test("viewer is nullable when signed out and exposes only the caller profile", async () => {
  const { t, ids, user } = await setup();
  expect(await t.query(api.onboarding.viewer, {})).toBeNull();
  await user.mutation(api.team.setDisplayName, {
    displayName: "Private display name",
  });
  expect(await user.query(api.onboarding.viewer, {})).toMatchObject({
    id: ids.verified,
    verified: true,
    displayName: "Private display name",
  });
  expect(
    await t
      .withIdentity({ subject: ids.other })
      .query(api.onboarding.viewer, {}),
  ).toMatchObject({ id: ids.other, displayName: "" });
});
test("onboarding atomically stores name, first responsibility, membership and independent permissions", async () => {
  const { t, user, ids } = await setup();
  const id = await user.mutation(api.households.create, input);
  expect(await user.mutation(api.households.create, input)).toBe(id);
  const rows = await user.query(api.tasks.list, {
    householdId: id,
    status: "open",
    paginationOpts: { cursor: null, numItems: 20 },
  });
  expect(rows.page).toHaveLength(1);
  expect(rows.page[0]).toMatchObject({ title: input.firstTask, ownerId: null });
  expect(await user.query(api.onboarding.viewer, {})).toMatchObject({
    displayName: input.displayName,
  });
  const consents = await t.run((ctx) =>
    ctx.db
      .query("consents")
      .withIndex("by_householdId_and_scope", (q) => q.eq("householdId", id))
      .take(10),
  );
  expect(consents.map((c) => [c.scope, c.granted]).sort()).toEqual([
    ["aiProcessing", false],
    ["coordination", true],
    ["emailImport", false],
  ]);
  await expect(
    t
      .withIdentity({ subject: ids.other })
      .query(api.households.get, { householdId: id }),
  ).rejects.toThrow("unavailable");
});
test("invalid setup cannot partially save a profile or household", async () => {
  const { t, user, ids } = await setup();
  await expect(
    user.mutation(api.households.create, { ...input, displayName: "   " }),
  ).rejects.toThrow("Your name");
  await expect(
    user.mutation(api.households.create, { ...input, adultConfirmed: false }),
  ).rejects.toThrow("adults");
  await expect(
    t
      .withIdentity({ subject: ids.unverified })
      .mutation(api.households.create, input),
  ).rejects.toThrow("Verify your email");
  expect(await t.run((ctx) => ctx.db.query("profiles").take(10))).toHaveLength(
    0,
  );
  expect(
    await t.run((ctx) => ctx.db.query("households").take(10)),
  ).toHaveLength(0);
});
