import { redactSourceRefs } from "./model/mailAccess";
import { coverageState,accessPreset } from "./validators";
import { syncPolicies } from "./model/operations";
import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import schema from "./schema";
import { activeAssignee, clearCareGrant, fail, member, text, userMutation, userQuery } from "./model/access";
import { record } from "./model/events";

export const list = userQuery({
  args: { householdId: v.id("households") },
  returns: v.object({ members: v.array(v.object({ membership: schema.doc("memberships"), displayName: v.string() })), invites: v.array(schema.doc("invites").omit("tokenHash")) }),
  handler: async (ctx, args) => {
    const { membership } = await member(ctx, args.householdId);
    const members = await ctx.db.query("memberships").withIndex("by_householdId_and_status", q => q.eq("householdId", args.householdId).eq("status", "active")).take(21);
    const projected = await Promise.all(members.map(async m => {
      const profile = await ctx.db.query("profiles").withIndex("by_userId", q => q.eq("userId", m.userId)).unique();
      const user = await ctx.db.get(m.userId);
      return { membership: m, displayName: profile?.displayName ?? user?.name ?? "Household member" };
    }));
    const invites = membership.role === "owner" ? await ctx.db.query("invites").withIndex("by_householdId_and_status", q => q.eq("householdId", args.householdId).eq("status", "pending")).take(21) : [];
    return { members: projected, invites: invites.map(({ tokenHash: _tokenHash, ...invite }) => invite) };
  },
});

// A member page must follow departures/rejoins and ownership changes without
// relying on the active-member list captured when the route first opened.
export const get = userQuery({
  args: { householdId: v.id("households"), memberId: v.id("memberships") },
  returns: v.object({ membership: schema.doc("memberships"), displayName: v.string(), viewerIsOwner: v.boolean(), viewerIsSelf: v.boolean() }),
  handler: async (ctx, args) => {
    const { household } = await member(ctx, args.householdId);
    const target = await ctx.db.get(args.memberId);
    if (!target || target.householdId !== household._id) return fail("NOT_FOUND", "This member is unavailable.");
    const profile = await ctx.db.query("profiles").withIndex("by_userId", q => q.eq("userId", target.userId)).unique();
    const user = await ctx.db.get(target.userId);
    return { membership: target, displayName: profile?.displayName ?? user?.name ?? "Household member", viewerIsOwner: household.ownerId === ctx.user._id, viewerIsSelf: target.userId === ctx.user._id };
  },
});

export const setDisplayName = userMutation({
  args: { displayName: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const displayName = text(args.displayName, "Display name", 80);
    const prior = await ctx.db.query("profiles").withIndex("by_userId", q => q.eq("userId", ctx.user._id)).unique();
    if (prior) await ctx.db.patch(prior._id, { displayName, updatedAt: Date.now() });
    else await ctx.db.insert("profiles", { userId: ctx.user._id, displayName, updatedAt: Date.now() });
    return null;
  },
});

export const transferOwnership = userMutation({
  args: { householdId: v.id("households"), newOwnerId: v.id("users") }, returns: v.null(),
  handler: async (ctx, args) => {
    const { household, membership } = await member(ctx, args.householdId, true);
    if (args.newOwnerId === ctx.user._id) return null;
    await activeAssignee(ctx, household._id, args.newOwnerId);
    const next = await ctx.db.query("memberships").withIndex("by_householdId_and_userId", q => q.eq("householdId", household._id).eq("userId", args.newOwnerId)).unique();
    if(next?.accessPreset==="limited_helper")fail("LIMITED_HELPER_ACCESS","Change this person to care-circle access before transferring household ownership.");
    await ctx.db.patch(membership._id, { role: "member" });
    await ctx.db.patch(next!._id, { role: "owner" });
    await ctx.db.patch(household._id, { ownerId: args.newOwnerId });
    await record(ctx, { householdId: household._id, actorId: ctx.user._id, type: "team.ownerTransferred", entity: { kind: "household", id: household._id }, before: ctx.user._id, after: args.newOwnerId });
    return null;
  },
});

export const remove = userMutation({
  args: { householdId: v.id("households"), memberId: v.id("memberships") }, returns: v.null(),
  handler: async (ctx, args) => {
    const { household } = await member(ctx, args.householdId);
    const target = await ctx.db.get(args.memberId);
    if (!target || target.householdId !== household._id) return fail("NOT_FOUND", "Member unavailable.");
    const self = target.userId === ctx.user._id;
    if (!self && household.ownerId !== ctx.user._id) fail("FORBIDDEN", "Only the owner may remove another member.");
    if (target.userId === household.ownerId) fail("LAST_OWNER", "Transfer ownership or delete the household before leaving.");
    if (target.status !== "active") return null;
    // Revocation is immediate. Unfinished work keeps its attribution and is
    // returned by team.responsibilities until an explicit owner override.
    await ctx.db.patch(target._id, { status: self ? "left" : "removed", endedAt: Date.now(),privacyRevokedAt:Date.now(),emailNotifications:false });
    await clearCareGrant(ctx,household._id,target.userId);
    await syncPolicies(ctx,household._id);
    await record(ctx, { householdId: household._id, actorId: ctx.user._id, type: self ? "team.left" : "team.removed", entity: { kind: "household", id: household._id }, after: `${target.userId}; existing responsibilities require reassignment.` });
    return null;
  },
});

export const responsibilities = userQuery({
  args: { householdId: v.id("households"), memberId: v.id("memberships"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("tasks")),
  handler: async (ctx, args) => {
    await member(ctx, args.householdId);
    const target = await ctx.db.get(args.memberId);
    if (!target || target.householdId !== args.householdId) return fail("NOT_FOUND", "Member unavailable.");
    const result=await ctx.db.query("tasks").withIndex("by_householdId_and_ownerId_and_status", q => q.eq("householdId", args.householdId).eq("ownerId", target.userId).eq("status", "open")).paginate(args.paginationOpts);return {...result,page:await Promise.all(result.page.map(async row=>({...row,sourceRefs:await redactSourceRefs(ctx,row.sourceRefs,ctx.user._id)})))};
  },
});

export const formerMembers = userQuery({
  args: { householdId: v.id("households"), status: v.union(v.literal("removed"), v.literal("left")), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("memberships")),
  handler: async (ctx, args) => {
    await member(ctx, args.householdId, true);
    return ctx.db.query("memberships").withIndex("by_householdId_and_status", q => q.eq("householdId", args.householdId).eq("status", args.status)).paginate(args.paginationOpts);
  },
});

export const requestedResponsibilities = userQuery({
  args: { householdId: v.id("households"), memberId: v.id("memberships"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("tasks")),
  handler: async (ctx, args) => {
    await member(ctx, args.householdId);
    const target = await ctx.db.get(args.memberId);
    if (!target || target.householdId !== args.householdId) return fail("NOT_FOUND", "Member unavailable.");
    const result=await ctx.db.query("tasks").withIndex("by_householdId_and_requestedOwnerId_and_status", q => q.eq("householdId", args.householdId).eq("requestedOwnerId", target.userId).eq("status", "open")).paginate(args.paginationOpts);return {...result,page:await Promise.all(result.page.map(async row=>({...row,sourceRefs:await redactSourceRefs(ctx,row.sourceRefs,ctx.user._id)})))};
  },
});

export const coverage = userQuery({
  args: { householdId: v.id("households"), memberId: v.id("memberships"), state: coverageState, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("coverage")),
  handler: async (ctx, args) => {
    await member(ctx, args.householdId);
    const target = await ctx.db.get(args.memberId);
    if (!target || target.householdId !== args.householdId) return fail("NOT_FOUND", "Member unavailable.");
    const rows = args.state === "active"
      ? ctx.db.query("coverage").withIndex("by_householdId_and_activeOwnerId_and_state", q => q.eq("householdId", args.householdId).eq("activeOwnerId", target.userId).eq("state", args.state))
      : ctx.db.query("coverage").withIndex("by_householdId_and_plannedOwnerId_and_state", q => q.eq("householdId", args.householdId).eq("plannedOwnerId", target.userId).eq("state", args.state));
    return rows.paginate(args.paginationOpts);
  },
});

export const setAccessPreset=userMutation({args:{householdId:v.id("households"),userId:v.id("users"),accessPreset},returns:v.null(),handler:async(ctx,args)=>{
 const {household}=await member(ctx,args.householdId,true);if(args.userId===household.ownerId&&args.accessPreset==="limited_helper")fail("LAST_OWNER","The household owner needs full coordination access.");
 const target=await ctx.db.query("memberships").withIndex("by_householdId_and_userId",q=>q.eq("householdId",args.householdId).eq("userId",args.userId)).unique();if(!target||target.status!=="active")fail("NOT_FOUND","Active household member unavailable.");
 if((target.accessPreset??"care_circle")===args.accessPreset)return null;
 await ctx.db.patch(target._id,{accessPreset:args.accessPreset,...(args.accessPreset==="limited_helper"?{emailNotifications:false,privacyRevokedAt:Date.now()}:{})});
 if(args.accessPreset==="limited_helper"){
  const profile=await ctx.db.query("careProfiles").withIndex("by_householdId",q=>q.eq("householdId",args.householdId)).unique();if(profile?.authorizedUserIds.includes(args.userId))await ctx.db.patch(profile._id,{authorizedUserIds:profile.authorizedUserIds.filter(id=>id!==args.userId),version:profile.version+1,updatedAt:Date.now()});
 }
 await syncPolicies(ctx,household._id);await record(ctx,{householdId:household._id,actorId:ctx.user._id,type:"team.accessChanged",entity:{kind:"household",id:household._id},after:args.accessPreset==="limited_helper"?"Member access restricted to assigned responsibilities.":"Member can coordinate household work; medical sharing still requires explicit access."});return null;
}});
