import { v } from "convex/values";
import { internalUserQuery, fail, member, timezone, timestamp, userMutation, type UserQueryCtx, type UserMutationCtx } from "./model/access";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { occurrence, todayIn } from "./model/recurrence";
import { record } from "./model/events";
import type { Id } from "./_generated/dataModel";

const item = v.object({ taskId: v.id("tasks"), version: v.number(), title: v.string(), localDate: v.string(), fromTimezone: v.string(), oldDueAt: v.number(), newDueAt: v.number(), adjustment: v.union(v.string(), v.null()) });
const previewResult = v.object({ householdId: v.id("households"), fromTimezone: v.string(), toTimezone: v.string(), materialRevision: v.number(), previewedAt: v.number(), seriesIds: v.array(v.id("taskSeries")), changes: v.array(item), unchangedHistoricalCount: v.number() });

async function plan(ctx: UserQueryCtx | UserMutationCtx, householdId: Id<"households">, targetZone: string, now: number) {
  const { household } = await member(ctx, householdId, true);
  const zone = timezone(targetZone); timestamp(now);
  if (zone === household.timezone) return { householdId, fromTimezone: household.timezone, toTimezone: zone, materialRevision: household.materialRevision, previewedAt: now, seriesIds: [] as Id<"taskSeries">[], changes: [] as { taskId: Id<"tasks">; version: number; title: string; localDate: string; fromTimezone: string; oldDueAt: number; newDueAt: number; adjustment: string | null }[], unchangedHistoricalCount: 0 };
  const series = await ctx.db.query("taskSeries").withIndex("by_householdId_and_status", q => q.eq("householdId", householdId).eq("status", "active")).take(101);
  if (series.length > 100) fail("TIMEZONE_CHANGE_TOO_LARGE", "This household exceeds the atomic timezone-change limit. No change was made.");
  const changes: { taskId: Id<"tasks">; version: number; title: string; localDate: string; fromTimezone: string; oldDueAt: number; newDueAt: number; adjustment: string | null }[] = [];
  let unchangedHistoricalCount = 0;
  for (const rule of series) {
    const from = todayIn(rule.timezone, now).subtract({ days: 1 }).toString();
    const occurrences = await ctx.db.query("tasks").withIndex("by_seriesId_and_occurrenceLocalDate", q => q.eq("seriesId", rule._id).gte("occurrenceLocalDate", from)).take(63);
    if (occurrences.length > 62 || changes.length + occurrences.length > 1500) fail("TIMEZONE_CHANGE_TOO_LARGE", "Too many future occurrences to change atomically. No change was made.");
    for (const task of occurrences) {
      if (task.status !== "open" || task.seriesException || task.dueAt === null || task.dueAt < now || !task.occurrenceLocalDate) { unchangedHistoricalCount++; continue; }
      const adjusted = occurrence(task.occurrenceLocalDate, rule.localTime, zone);
      if (adjusted.dueAt === task.dueAt) { unchangedHistoricalCount++; continue; }
      changes.push({ taskId: task._id, version: task.version, title: task.title, localDate: task.occurrenceLocalDate, fromTimezone: rule.timezone, oldDueAt: task.dueAt, newDueAt: adjusted.dueAt, adjustment: adjusted.dstAdjustment ?? null });
    }
  }
  return { householdId, fromTimezone: household.timezone, toTimezone: zone, materialRevision: household.materialRevision, previewedAt: now, seriesIds: series.map(s => s._id), changes, unchangedHistoricalCount };
}

export const buildPreview = internalUserQuery({
  args: { householdId: v.id("households"), timezone: v.string(), now: v.number() }, returns: previewResult,
  handler: async (ctx, args) => plan(ctx, args.householdId, args.timezone, args.now),
});

export const preview = action({
  args: { householdId: v.id("households"), timezone: v.string() }, returns: previewResult,
  handler: async (ctx, args): Promise<Awaited<ReturnType<typeof plan>>> => ctx.runQuery(internal.householdTimezone.buildPreview, { ...args, now: Date.now() }),
});

export const confirm = userMutation({
  args: { householdId: v.id("households"), timezone: v.string(), expectedMaterialRevision: v.number(), previewedAt: v.number(), confirmed: v.boolean() }, returns: v.number(),
  handler: async (ctx, args) => {
    const { household } = await member(ctx, args.householdId, true);
    if (!args.confirmed) fail("CONFIRMATION_REQUIRED", "Review and confirm the future recurrence changes.");
    if (household.materialRevision !== args.expectedMaterialRevision) fail("CONFLICT", "The household changed. Preview the timezone change again.");
    const now = Date.now();
    if (!Number.isFinite(args.previewedAt) || args.previewedAt > now || now - args.previewedAt > 5 * 60000) fail("PREVIEW_EXPIRED", "Preview the timezone change again.");
    const result = await plan(ctx, household._id, args.timezone, args.previewedAt);
    if (result.fromTimezone === result.toTimezone) return 0;
    // Never shift an occurrence that became historical while the preview was open.
    if (result.changes.some(change => change.oldDueAt < now)) fail("PREVIEW_EXPIRED", "An occurrence became due. Preview again before confirming.");
    for (const id of result.seriesIds) {
      const series = await ctx.db.get(id);
      await ctx.db.patch(id, { timezone: result.toTimezone, version: series!.version + 1, updatedAt: now });
    }
    for (const change of result.changes) await ctx.db.patch(change.taskId, { dueAt: change.newDueAt, dstAdjustment: change.adjustment ?? undefined, version: change.version + 1, updatedAt: now });
    await ctx.db.patch(household._id, { timezone: result.toTimezone });
    await record(ctx, { householdId: household._id, actorId: ctx.user._id, type: "household.timezoneChanged", entity: { kind: "household", id: household._id }, before: result.fromTimezone, after: `${result.toTimezone}; ${result.changes.length} future recurring tasks shifted; completed and individually edited occurrences retained.` });
    return result.changes.length;
  },
});
