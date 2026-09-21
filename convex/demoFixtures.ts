import { v } from "convex/values";
import { internalQuery, env } from "./_generated/server";
import { fail, member, userMutation, userQuery } from "./model/access";

export const read = internalQuery({
  args: { key: v.string(), now: v.number() }, returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const householdId = ctx.db.normalizeId("households", args.key); if (!householdId) return null;
    const household = await ctx.db.get(householdId);
    if (!household || household.mode !== "demo" || household.status !== "active" || (household.expiresAt ?? 0) <= args.now) return null;
    const session = await ctx.db.query("demoSessions").withIndex("by_householdId", q => q.eq("householdId", householdId)).unique();
    if (!session) return null;
    return `Sample Clinic — demo fixture\nThis is a synthetic public logistics page, not a real clinic or appointment.\n\nAddress: 100 Sample Street, Example City.\nPublic visiting hours: 09:00–17:00.\nParking: visitor parking in the sample lot.\n${session.fixtureVersion === 1 ? "Entrance: use the east entrance. Accessible entry is at the east entrance." : "Entrance notice: the east entrance is closed. Use the west entrance. Accessible entry is at the west entrance."}\nBring: house keys and a contact phone number.\n\nNo medical instructions are provided by this fixture.\n`;
  },
});

export const url = userQuery({
  args: { householdId: v.id("households") }, returns: v.string(),
  handler: async (ctx, args) => { const { household } = await member(ctx, args.householdId); if (household.mode !== "demo") fail("DEMO_REQUIRED", "This route is only for a sample household."); return `${env.CONVEX_SITE_URL}/demo-fixtures/${household._id}`; },
});

export const change = userMutation({
  args: { householdId: v.id("households"), version: v.union(v.literal(1), v.literal(2)) }, returns: v.null(),
  handler: async (ctx, args) => {
    const { household } = await member(ctx, args.householdId, true);
    if (household.mode !== "demo") fail("DEMO_REQUIRED", "This route is only for a sample household.");
    const demo = await ctx.db.query("demoSessions").withIndex("by_householdId", q => q.eq("householdId", household._id)).unique();
    if (!demo) return fail("NOT_FOUND", "Sample household unavailable.");
    await ctx.db.patch(demo._id, { fixtureVersion: args.version }); return null;
  },
});
