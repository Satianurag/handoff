import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";

// This nullable query lets the client distinguish a signed-out session from a
// transport failure without exposing any user information before authentication.
export const viewer = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      id: v.id("users"),
      email: v.union(v.string(), v.null()),
      displayName: v.string(),
      verified: v.boolean(),
      anonymous: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    return {
      id: user._id,
      email: user.email ?? null,
      displayName: profile?.displayName ?? "",
      verified: !!user.emailVerificationTime,
      anonymous: user.isAnonymous ?? false,
    };
  },
});
