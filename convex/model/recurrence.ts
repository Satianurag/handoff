import { Temporal } from "@js-temporal/polyfill";
import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { fail } from "./access";

export const HORIZON_DAYS = 30;

export function localDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("INVALID_DATE", "Use a local date in YYYY-MM-DD format.");
  try { return Temporal.PlainDate.from(value, { overflow: "reject" }); }
  catch { return fail("INVALID_DATE", "Choose a valid local date."); }
}

export function wallTime(value: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail("INVALID_TIME", "Use a local time in HH:mm format.");
  return Temporal.PlainTime.from(value);
}

export function todayIn(zone: string, now: number) {
  return Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(zone).toPlainDate();
}

export function occurrence(date: string, time: string, zone: string) {
  const plain = localDate(date).toPlainDateTime(wallTime(time));
  const earlier = plain.toZonedDateTime(zone, { disambiguation: "earlier" });
  const later = plain.toZonedDateTime(zone, { disambiguation: "later" });
  if (!earlier.toPlainDateTime().equals(plain)) {
    // A gap shifts to its first valid instant, not the requested minute plus
    // the gap duration (02:30 becomes 03:00, not 03:30).
    const transition = earlier.getTimeZoneTransition("next");
    const chosen = transition && transition.epochMilliseconds <= later.epochMilliseconds ? transition : later;
    return { dueAt: chosen.epochMilliseconds, dstAdjustment: `Nonexistent local time moved to ${chosen.toPlainDateTime().toString()} ${chosen.offset}` };
  }
  return { dueAt: earlier.epochMilliseconds, ...(earlier.epochMilliseconds !== later.epochMilliseconds ? { dstAdjustment: `Repeated local time uses first occurrence ${earlier.offset}` } : {}) };
}

export function weekdays(values: number[]) {
  if (!values.length || values.length > 7 || new Set(values).size !== values.length || values.some(day => !Number.isInteger(day) || day < 1 || day > 7)) fail("INVALID_WEEKDAYS", "Choose distinct weekdays numbered Monday=1 through Sunday=7.");
  return [...values].sort((a, b) => a - b);
}

export async function generateOccurrences(ctx: MutationCtx, series: Doc<"taskSeries">, from: string, through: string, revise = false) {
  let date = localDate(from); const end = localDate(through);
  const distance = date.until(end).days;
  if (distance < 0 || distance > HORIZON_DAYS) fail("INVALID_HORIZON", "Generate at most thirty days at once.");
  let changed = 0;
  for (let step = 0; step <= distance; step++, date = date.add({ days: 1 })) {
    const key = date.toString();
    if (series.suppressedDates?.includes(key)) continue;
    const existing = await ctx.db.query("tasks").withIndex("by_seriesId_and_occurrenceKey", q => q.eq("seriesId", series._id).eq("occurrenceKey", key)).unique();
    const scheduled = series.status === "active" && key >= series.activeFrom && (!series.activeUntil || key <= series.activeUntil) && series.weekdays.includes(date.dayOfWeek);
    if (existing && (existing.status === "done" || existing.seriesException || !revise)) continue;
    if (!scheduled) {
      if (existing?.status === "open") { await ctx.db.patch(existing._id, { status: "cancelled", version: existing.version + 1, cancelledAt: Date.now(), retentionUntil: Date.now() + 90 * 86400000, updatedAt: Date.now() }); changed++; }
      continue;
    }
    const instant = occurrence(key, series.localTime, series.timezone);
    if (existing) {
      await ctx.db.patch(existing._id, { title: series.title, category: series.category, note: series.note, dueAt: instant.dueAt, dstAdjustment: instant.dstAdjustment, requestedOwnerId: series.proposedOwnerId === existing.ownerId ? null : series.proposedOwnerId, status: "open", cancelledAt: undefined, retentionUntil: undefined, version: existing.version + 1, updatedAt: Date.now() }); changed++;
    } else {
      await ctx.db.insert("tasks", { householdId: series.householdId, seriesId: series._id, occurrenceKey: key, occurrenceLocalDate: key,
        title: series.title, category: series.category, note: series.note, ...instant, ownerId: null, requestedOwnerId: series.proposedOwnerId,
        status: "open", sourceRefs: [], version: 1, createdBy: series.createdBy, updatedAt: Date.now() }); changed++;
    }
  }
  const generatedThrough = !series.generatedThrough || through > series.generatedThrough ? through : series.generatedThrough;
  await ctx.db.patch(series._id, { generatedThrough });
  return changed;
}
