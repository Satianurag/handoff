import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { member, fail, type UserQueryCtx, type UserMutationCtx } from "./model/access";
import { canReadRecordFor } from "./recordsAccess";

export async function canReadCare(ctx: QueryCtx | MutationCtx, householdId: Id<"households">, userId: Id<"users">) {
 const membership = await ctx.db.query("memberships").withIndex("by_householdId_and_userId",q=>q.eq("householdId",householdId).eq("userId",userId)).unique();
 if(!membership || membership.status!=="active"||membership.accessPreset==="limited_helper")return false;
 const profile = await ctx.db.query("careProfiles").withIndex("by_householdId", q=>q.eq("householdId",householdId)).unique();
 return !!profile && (profile.createdBy === userId || profile.authorizedUserIds.includes(userId));
}
export async function requireHealthAccess(ctx: UserQueryCtx | UserMutationCtx, householdId: Id<"households">, _write = false) {
 await member(ctx,householdId);
 const profile = await ctx.db.query("careProfiles").withIndex("by_householdId",q=>q.eq("householdId",householdId)).unique();
 if(!profile || !(profile.createdBy===ctx.user._id || profile.authorizedUserIds.includes(ctx.user._id))) return fail("CARE_ACCESS_REQUIRED","Ask the care profile creator to grant access to care information.");
 return profile;
}
export async function canReadCareSource(ctx: QueryCtx | MutationCtx, source: {documentId?:Id<"records">}, userId:Id<"users">) {
 if(!source.documentId)return true;
 const doc=await ctx.db.get(source.documentId);
 return !!doc && await canReadRecordFor(ctx,doc,userId);
}

export async function canReadVisitPack(ctx: QueryCtx | MutationCtx, pack: import("./_generated/dataModel").Doc<"visitPacks">, userId: Id<"users">) {
 if (pack.createdBy !== userId && !(pack.readerIds ?? []).includes(userId)) return false;
 if (!await canReadCare(ctx, pack.householdId, userId)) return false;
 for (const documentId of pack.sourceDocumentIds ?? pack.documentIds) {
  if (!await canReadCareSource(ctx, {documentId}, userId)) return false;
 }
 return true;
}
