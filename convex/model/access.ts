import { getAuthUserId } from "@convex-dev/auth/server";
import { customCtx, customMutation, customQuery } from "convex-helpers/server/customFunctions";
import { ConvexError } from "convex/values";
import { mutation, query, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

async function signedIn(ctx: QueryCtx | MutationCtx) {
  const id = await getAuthUserId(ctx);
  const user = id === null ? null : await ctx.db.get(id);
  if (!user) return fail("UNAUTHENTICATED", "Sign in to continue.");
  return { user };
}

export const userQuery = customQuery(query, customCtx(signedIn));
export const userMutation = customMutation(mutation, customCtx(signedIn));
export const internalUserMutation = customMutation(internalMutation, customCtx(signedIn));
export const internalUserQuery = customQuery(internalQuery, customCtx(signedIn));
export type UserQueryCtx = QueryCtx & { user: Doc<"users"> };
export type UserMutationCtx = MutationCtx & { user: Doc<"users"> };

export async function member(ctx: UserQueryCtx | UserMutationCtx, householdId: Id<"households">, ownerOnly = false, allowHelper = false) {
  const household = await ctx.db.get(householdId);
  const membership = await ctx.db.query("memberships")
    .withIndex("by_householdId_and_userId", q => q.eq("householdId", householdId).eq("userId", ctx.user._id)).unique();
  if (!household || household.status !== "active" || !membership || membership.status !== "active") {
    return fail("NOT_FOUND", "This household is unavailable.");
  }
  if (ctx.user.isAnonymous && household.mode !== "demo") return fail("NOT_FOUND", "This household is unavailable.");
  if(membership.accessPreset==="limited_helper"&&!allowHelper)return fail("LIMITED_HELPER_ACCESS","This account can open only its assigned responsibilities and travel details.");
  if (ownerOnly && (membership.role !== "owner" || household.ownerId !== ctx.user._id)) return fail("FORBIDDEN", "Only the household owner can do this.");
  return { household, membership };
}

export async function activeAssignee(ctx: QueryCtx | MutationCtx, householdId: Id<"households">, userId: Id<"users">) {
  const row = await ctx.db.query("memberships").withIndex("by_householdId_and_userId", q => q.eq("householdId", householdId).eq("userId", userId)).unique();
  if (!row || row.status !== "active") fail("INVALID_ASSIGNEE", "Choose an active household member.");
}

export function checkVersion(row: { version: number }, expected: number) {
  if (!Number.isSafeInteger(expected) || row.version !== expected) fail("CONFLICT", "This item changed. Reload and review the current version.");
}

export function text(value: string, label: string, max = 2000, allowEmpty = false) {
  const result = value.trim();
  if ((!allowEmpty && !result) || result.length > max) fail("INVALID_INPUT", `${label} must contain ${allowEmpty ? 0 : 1}–${max} characters.`);
  return result;
}

export function timestamp(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 4102444800000) fail("INVALID_TIME", "Choose a valid date before 2100.");
  return value;
}

export function timezone(value: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(0); }
  catch { fail("INVALID_TIMEZONE", "Choose an IANA timezone."); }
  return value;
}

export function email(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) fail("INVALID_EMAIL", "Enter a valid email address.");
  return normalized;
}

export function range(from: number, to: number, maxDays = 93) {
  timestamp(from); timestamp(to);
  if (to <= from || to - from > maxDays * 86400000) fail("INVALID_RANGE", `Choose a range of at most ${maxDays} days.`);
}

export async function isLimitedHelper(ctx:QueryCtx|MutationCtx,householdId:Id<"households">,userId:Id<"users">){
 const membership=await ctx.db.query("memberships").withIndex("by_householdId_and_userId",q=>q.eq("householdId",householdId).eq("userId",userId)).unique();return membership?.status==="active"&&membership.accessPreset==="limited_helper";
}

export async function clearCareGrant(ctx:MutationCtx,householdId:Id<"households">,userId:Id<"users">){
 const profile=await ctx.db.query("careProfiles").withIndex("by_householdId",q=>q.eq("householdId",householdId)).unique();
 if(profile?.authorizedUserIds.includes(userId))await ctx.db.patch(profile._id,{authorizedUserIds:profile.authorizedUserIds.filter(id=>id!==userId),version:profile.version+1,updatedAt:Date.now()});
}
