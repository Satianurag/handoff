"use node";
import { createHash, randomBytes } from "node:crypto";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

export const create = action({
  args: {}, returns: v.id("households"),
  handler: async (ctx): Promise<Id<"households">> => ctx.runMutation(internal.demoStore.create, { capabilityHash: createHash("sha256").update(randomBytes(32)).digest("hex") }),
});

export const secondRoleLink = action({
  args: { householdId: v.id("households") }, returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const token = randomBytes(32).toString("base64url");
    await ctx.runMutation(internal.demoStore.issueCapability, { householdId: args.householdId, capabilityHash: createHash("sha256").update(token).digest("hex") });
    return token;
  },
});

export const redeem = internalAction({
  args: { token: v.string() }, returns: v.id("users"),
  handler: async (ctx, args): Promise<Id<"users">> => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(args.token)) throw new Error("Demo role link unavailable.");
    return ctx.runMutation(internal.demoStore.consumeCapability, { capabilityHash: createHash("sha256").update(args.token).digest("hex") });
  },
});

// Reset is intentionally two-phase: the client follows the cleanup receipt,
// then calls completeReset. No replacement resources exist before deletion.
export const reset = action({
  args: { householdId: v.id("households") }, returns: v.object({ cleanupJobId: v.id("privacyJobs") }),
  handler: async (ctx, args): Promise<{ cleanupJobId: Id<"privacyJobs"> }> => {
    await ctx.runMutation(internal.demoStore.authorizeReset, args);
    const cleanupJobId = await ctx.runMutation(api.privacyJobs.request, { householdId: args.householdId, kind: "delete", confirmed: true, requestId: `demo-reset-${args.householdId}` });
    return { cleanupJobId };
  },
});

export const completeReset = action({
  args: { cleanupJobId: v.id("privacyJobs") }, returns: v.id("households"),
  handler: async (ctx, args): Promise<Id<"households">> => {
    await ctx.runMutation(internal.demoStore.authorizeReplacement, args);
    return ctx.runMutation(internal.demoStore.create, { capabilityHash: createHash("sha256").update(randomBytes(32)).digest("hex") });
  },
});
