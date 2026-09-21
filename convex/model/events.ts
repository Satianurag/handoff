import type { Infer } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { entity, sourceRef } from "../validators";
import { fail } from "./access";

export async function record(ctx: MutationCtx, input: {
  householdId: Id<"households">; actorId: Id<"users"> | null; type: string; entity: Infer<typeof entity>;
  before?: string; after: string; sourceRefs?: Infer<typeof sourceRef>[]; handoverId?: Id<"handovers">; material?: boolean;
}) {
  const household = await ctx.db.get(input.householdId);
  if (!household) return fail("NOT_FOUND", "Household unavailable.");
  const now = Date.now();
  const sequence = household.eventSequence + 1;
  await ctx.db.patch(household._id, {
    eventSequence: sequence, materialRevision: household.materialRevision + (input.material === false ? 0 : 1), updatedAt: now,
  });
  const eventId = await ctx.db.insert("events", {
    householdId: household._id, actorId: input.actorId, sequence, type: input.type, entity: input.entity,
    before: input.before ?? "", after: input.after, sourceRefs: input.sourceRefs ?? [], timestamp: now,
    ...(input.handoverId ? { handoverId: input.handoverId } : {}), retentionUntil: now + 90 * 86400000,
  });
  return { eventId, sequence };
}

export async function notify(ctx: MutationCtx, input: {
  householdId: Id<"households">; userId: Id<"users">; target: Infer<typeof entity>; type: string; dedupeKey: string; eventId?: Id<"events">;
}) {
  const prior = await ctx.db.query("notifications").withIndex("by_dedupeKey", q => q.eq("dedupeKey", input.dedupeKey)).unique();
  if (prior) return prior._id;
  const member = await ctx.db.query("memberships").withIndex("by_householdId_and_userId", q => q.eq("householdId", input.householdId).eq("userId", input.userId)).unique();
  if (!member || member.status !== "active") return null;
  return ctx.db.insert("notifications", { ...input, readAt: null, createdAt: Date.now(), emailState: member.emailNotifications ? "pending" : "disabled" });
}
