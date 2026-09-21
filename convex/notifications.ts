import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import schema from "./schema";
import { fail, member, userMutation, userQuery } from "./model/access";

export const list = userQuery({
  args: { householdId: v.id("households"), unreadOnly: v.boolean(), paginationOpts: paginationOptsValidator }, returns: paginationResultValidator(schema.doc("notifications")),
  handler: async (ctx, args) => {
    await member(ctx, args.householdId);
    if (args.unreadOnly) return ctx.db.query("notifications").withIndex("by_userId_and_householdId_and_readAt", q => q.eq("userId", ctx.user._id).eq("householdId", args.householdId).eq("readAt", null)).order("desc").paginate(args.paginationOpts);
    return ctx.db.query("notifications").withIndex("by_householdId_and_userId", q => q.eq("householdId", args.householdId).eq("userId", ctx.user._id)).order("desc").paginate(args.paginationOpts);
  },
});

// A visibly capped badge keeps this query bounded even after a long absence.
export const unreadCount = userQuery({
  args: { householdId: v.id("households") }, returns: v.object({ count: v.number(), capped: v.boolean() }),
  handler: async (ctx, args) => {
    await member(ctx, args.householdId);
    const rows = await ctx.db.query("notifications").withIndex("by_userId_and_householdId_and_readAt", q => q.eq("userId", ctx.user._id).eq("householdId", args.householdId).eq("readAt", null)).take(100);
    return { count: Math.min(rows.length, 99), capped: rows.length > 99 };
  },
});

export const read = userMutation({
  args: { notificationId: v.id("notifications") }, returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.notificationId);
    if (!item || item.userId !== ctx.user._id) return fail("NOT_FOUND", "Notification unavailable.");
    await member(ctx, item.householdId);
    if (item.readAt === null) await ctx.db.patch(item._id, { readAt: Date.now(), emailState: item.emailState === "pending" ? "cancelled" : item.emailState });
    return null;
  },
});

export const readAll = userMutation({
  args: { householdId: v.id("households") }, returns: v.object({ updated: v.number(), hasMore: v.boolean() }),
  handler: async (ctx, args) => {
    await member(ctx, args.householdId);
    const unread = await ctx.db.query("notifications").withIndex("by_userId_and_householdId_and_readAt", q => q.eq("userId", ctx.user._id).eq("householdId", args.householdId).eq("readAt", null)).take(501);
    for (const item of unread.slice(0, 500)) await ctx.db.patch(item._id, { readAt: Date.now(), emailState: item.emailState === "pending" ? "cancelled" : item.emailState });
    return { updated: Math.min(unread.length, 500), hasMore: unread.length > 500 };
  },
});

export const preferences = userMutation({
  args: { householdId: v.id("households"), emailNotifications: v.boolean() }, returns: v.null(),
  handler: async (ctx, args) => {
    const { membership, household } = await member(ctx, args.householdId);
    if (args.emailNotifications && (ctx.user.isAnonymous || !ctx.user.emailVerificationTime || household.mode === "demo")) fail("VERIFIED_ACCOUNT_REQUIRED", "Generic email reminders require a verified real account.");
    await ctx.db.patch(membership._id, { emailNotifications: args.emailNotifications }); return null;
  },
});
