import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { fail } from "./model/access";
import { digest } from "./model/sourceText";

// Operator-only display fixtures. These users have no authentication accounts,
// contact details, sessions or login capabilities. Existing people are untouched.
export const members = internalMutation({
  args: { householdId: v.id("households"), ownerId: v.id("users") },
  returns: v.object({ mayaId: v.id("users"), leoId: v.id("users") }),
  handler: async (ctx, args) => {
    const household = await ctx.db.get(args.householdId);
    const owner = await ctx.db.get(args.ownerId);
    const ownerMembership = await ctx.db.query("memberships")
      .withIndex("by_householdId_and_userId", q => q.eq("householdId", args.householdId).eq("userId", args.ownerId))
      .unique();
    if (!household || household.status !== "active" || household.ownerId !== args.ownerId || !owner ||
      ownerMembership?.status !== "active" || ownerMembership.role !== "owner") {
      fail("INVALID_VIDEO_HOUSEHOLD", "Choose an active household and its current owner.");
    }

    const memberships = await ctx.db.query("memberships")
      .withIndex("by_householdId", q => q.eq("householdId", args.householdId)).take(101);
    if (memberships.length > 100) fail("VIDEO_FIXTURE_LIMIT", "Review household membership before adding video fixtures.");
    const operation = "videoFixtures.member.v1";
    const now = Date.now();
    const result: Id<"users">[] = [];
    let memberCount = memberships.length;

    for (const displayName of ["Maya (demo)", "Leo (demo)"]) {
      const requestId = `${args.householdId}:${displayName}`;
      const fingerprint = digest(JSON.stringify({ householdId: args.householdId, ownerId: args.ownerId, displayName }));
      const prior = await ctx.db.query("requests")
        .withIndex("by_userId_and_operation_and_requestId", q => q.eq("userId", args.ownerId).eq("operation", operation).eq("requestId", requestId))
        .unique();
      if (prior && prior.fingerprint !== fingerprint) fail("IDEMPOTENCY_CONFLICT", "Video fixture input changed.");

      // The bounded fallback preserves idempotency after request receipts expire.
      const candidates: Id<"users">[] = [];
      for (const membership of memberships) {
        const user = await ctx.db.get(membership.userId);
        if (user?.name !== displayName) continue;
        const profile = await ctx.db.query("profiles").withIndex("by_userId", q => q.eq("userId", user._id)).unique();
        const account = await ctx.db.query("authAccounts").withIndex("userIdAndProvider", q => q.eq("userId", user._id)).first();
        const session = await ctx.db.query("authSessions").withIndex("userId", q => q.eq("userId", user._id)).first();
        if (membership.status !== "active" || membership.role !== "member" || user.email || user.phone ||
          account || session || profile?.displayName !== displayName) {
          fail("VIDEO_FIXTURE_CONFLICT", "An existing named member is not an unchanged credential-free video fixture.");
        }
        candidates.push(user._id);
      }
      if (candidates.length > 1) fail("VIDEO_FIXTURE_CONFLICT", "Duplicate named video members need operator review.");
      if (prior && (candidates.length !== 1 || prior.resultId !== candidates[0])) {
        fail("VIDEO_FIXTURE_CONFLICT", "A previously created video member changed or was removed.");
      }

      let userId = candidates[0];
      if (!userId) {
        if (memberCount >= 100) fail("VIDEO_FIXTURE_LIMIT", "Review household membership before adding video fixtures.");
        userId = await ctx.db.insert("users", { name: displayName });
        await ctx.db.insert("profiles", { userId, displayName, updatedAt: now });
        await ctx.db.insert("memberships", {
          householdId: args.householdId, userId, role: "member", accessPreset: "care_circle",
          status: "active", joinedAt: now, emailNotifications: false, lastReadSequence: 0,
        });
        memberCount++;
      }
      if (!prior) await ctx.db.insert("requests", {
        userId: args.ownerId, operation, requestId, fingerprint, resultId: userId,
        expiresAt: now + 30 * 86400000,
      });
      result.push(userId);
    }
    return { mayaId: result[0], leoId: result[1] };
  },
});
