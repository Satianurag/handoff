import {accessPreset} from "./validators";
import { syncPolicies } from "./model/operations";
import { v } from "convex/values";
import { internalUserMutation, internalUserQuery, userMutation, email, member, clearCareGrant, fail, type UserQueryCtx, type UserMutationCtx } from "./model/access";
import { record } from "./model/events";

async function verifiedInvite(ctx: UserQueryCtx | UserMutationCtx, tokenHash: string, now: number) {
  if (ctx.user.isAnonymous || !ctx.user.email || !ctx.user.emailVerificationTime) fail("VERIFIED_ACCOUNT_REQUIRED", "Sign in with the invitation email.");
  const invite = await ctx.db.query("invites").withIndex("by_tokenHash", q => q.eq("tokenHash", tokenHash)).unique();
  if (!invite) return fail("INVALID_INVITE", "Invitation unavailable.");
  if (email(ctx.user.email!) !== invite.email) fail("WRONG_ACCOUNT", "Sign in with the email address this invitation was sent to.");
  const household = await ctx.db.get(invite.householdId);
  if (!household || household.status !== "active" || household.mode !== "real") return fail("INVALID_INVITE", "Invitation unavailable.");
  if (invite.status === "revoked" || invite.status === "declined" || (invite.status === "pending" && invite.expiresAt <= now)) fail("INVALID_INVITE", "This invitation expired or was revoked.");
  if (invite.status === "accepted") {
    if (invite.acceptedBy !== ctx.user._id) fail("INVITE_USED", "This invitation was already used.");
    // An old accepted link is only a shortcut for a current member. It must
    // not disclose current household/profile details after access is removed.
    await member(ctx, household._id,false,true);
  }
  return { invite, household };
}

export const create = internalUserMutation({
  args: { householdId: v.id("households"), accessPreset:v.optional(accessPreset), email: v.string(), tokenHash: v.string() }, returns: v.object({ inviteId: v.id("invites"), expiresAt: v.number() }),
  handler: async (ctx, args) => {
    const { household } = await member(ctx, args.householdId, true);
    if (household.mode !== "real") fail("DEMO_RESTRICTED", "Demo households use their scoped second-role link.");
    const target = email(args.email);
    if (!/^[a-f0-9]{64}$/.test(args.tokenHash)) fail("INVALID_TOKEN", "Invalid invitation hash.");
    const pending = await ctx.db.query("invites").withIndex("by_householdId_and_status", q => q.eq("householdId", household._id).eq("status", "pending")).take(21);
    const now = Date.now();
    for (const invite of pending) if (invite.email === target || invite.expiresAt <= now) await ctx.db.patch(invite._id, { status: "revoked", resolvedAt: now });
    if (pending.filter(i => i.email !== target && i.expiresAt > now).length >= 20) fail("INVITE_LIMIT", "Revoke an outstanding invitation before creating another.");
    const expiresAt = now + 7 * 86400000;
    const inviteId = await ctx.db.insert("invites", { householdId: household._id, accessPreset:args.accessPreset??"care_circle", email: target, tokenHash: args.tokenHash, invitedBy: ctx.user._id, expiresAt, status: "pending" });
    return { inviteId, expiresAt };
  },
});

export const preview = internalUserQuery({
  args: { tokenHash: v.string(), now: v.number() }, returns: v.object({ inviteId: v.id("invites"), nickname: v.string(), inviterName: v.string(), expiresAt: v.number(), status: v.string(), accessPreset }),
  handler: async (ctx, args) => {
    const { invite, household } = await verifiedInvite(ctx, args.tokenHash, args.now);
    const profile = await ctx.db.query("profiles").withIndex("by_userId", q => q.eq("userId", invite.invitedBy)).unique();
    return { inviteId: invite._id, nickname: household.nickname, inviterName: profile?.displayName ?? "Household owner", expiresAt: invite.expiresAt, status: invite.status, accessPreset:invite.accessPreset??"care_circle" as const };
  },
});

export const respond = internalUserMutation({
  args: { tokenHash: v.string(), accept: v.boolean() }, returns: v.id("households"),
  handler: async (ctx, args) => {
    const { invite, household } = await verifiedInvite(ctx, args.tokenHash, Date.now());
    if (invite.status === "accepted") {
      if (invite.acceptedBy !== ctx.user._id || !args.accept) fail("INVITE_USED", "This invitation was already used.");
      return household._id;
    }
    if (!args.accept) { await ctx.db.patch(invite._id, { status: "declined", resolvedAt: Date.now() }); return household._id; }
    const existing = await ctx.db.query("memberships").withIndex("by_householdId_and_userId", q => q.eq("householdId", household._id).eq("userId", ctx.user._id)).unique();
    const members = await ctx.db.query("memberships").withIndex("by_householdId_and_status", q => q.eq("householdId", household._id).eq("status", "active")).take(21);
    if (existing?.status !== "active" && members.length >= 20) fail("MEMBER_LIMIT", "This household has reached its twenty-member limit.");
    if (existing) await ctx.db.patch(existing._id, { status: "active", endedAt: undefined, joinedAt: Date.now(), role: existing.userId === household.ownerId ? "owner" : "member",accessPreset:existing.userId===household.ownerId?"care_circle":invite.accessPreset??"care_circle",emailNotifications:invite.accessPreset==="limited_helper"?false:existing.emailNotifications,...(invite.accessPreset==="limited_helper"?{privacyRevokedAt:Date.now()}:{}) });
    else await ctx.db.insert("memberships", { householdId: household._id, userId: ctx.user._id, role: "member", accessPreset:invite.accessPreset??"care_circle", ...(invite.accessPreset==="limited_helper"?{privacyRevokedAt:Date.now()}:{}), status: "active", joinedAt: Date.now(), emailNotifications: false, lastReadSequence: 0 });
    if(invite.accessPreset==="limited_helper")await clearCareGrant(ctx,household._id,ctx.user._id);
    await ctx.db.patch(invite._id, { status: "accepted", acceptedBy: ctx.user._id, resolvedAt: Date.now() });
    await syncPolicies(ctx,household._id);
    await record(ctx, { householdId: household._id, actorId: ctx.user._id, type: "team.joined", entity: { kind: "household", id: household._id }, after: "Invited member accepted household visibility and joined." });
    return household._id;
  },
});

export const revoke = userMutation({
  args: { inviteId: v.id("invites") }, returns: v.null(),
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId); if (!invite) return fail("NOT_FOUND", "Invitation unavailable.");
    await member(ctx, invite.householdId, true);
    if (invite.status === "pending") await ctx.db.patch(invite._id, { status: "revoked", resolvedAt: Date.now() });
    return null;
  },
});
