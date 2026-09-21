import {redactSourceRefs} from "./model/mailAccess";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import schema from "./schema";
import { category } from "./validators";
import { activeAssignee, checkVersion, fail, member, text, timezone, userMutation, userQuery } from "./model/access";
import { generateOccurrences, HORIZON_DAYS, localDate, todayIn, wallTime, weekdays } from "./model/recurrence";
import { record } from "./model/events";
import { priorRequest, saveRequest } from "./model/requests";

const fields = { title: v.string(), category, note: v.string(), localTime: v.string(), timezone: v.string(), weekdays: v.array(v.number()), activeUntil: v.union(v.string(), v.null()), proposedOwnerId: v.union(v.id("users"), v.null()) };

export const get = userQuery({
  args: { seriesId: v.id("taskSeries") }, returns: schema.doc("taskSeries"),
  handler: async (ctx, args) => { const series = await ctx.db.get(args.seriesId); if (!series) return fail("NOT_FOUND", "Recurring task unavailable."); await member(ctx, series.householdId); return series; },
});

export const occurrences = userQuery({
  args: { seriesId: v.id("taskSeries"), fromDate: v.union(v.string(), v.null()), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("tasks")),
  handler: async (ctx, args) => {
    const series = await ctx.db.get(args.seriesId);
    if (!series) return fail("NOT_FOUND", "Recurring task unavailable.");
    await member(ctx, series.householdId);
    const from = args.fromDate === null ? null : localDate(args.fromDate).toString();
    const result=await ctx.db.query("tasks").withIndex("by_seriesId_and_occurrenceLocalDate", q => {
      const range = q.eq("seriesId", series._id);
      return from === null ? range : range.gte("occurrenceLocalDate", from).lte("occurrenceLocalDate", "9999-12-31");
    }).order(from === null ? "desc" : "asc").paginate(args.paginationOpts);
    return {...result,page:await Promise.all(result.page.map(async row=>({...row,sourceRefs:await redactSourceRefs(ctx,row.sourceRefs,ctx.user._id)})))};
  },
});

export const create = userMutation({
  args: { householdId: v.id("households"), ...fields, activeFrom: v.string(), requestId: v.string() }, returns: v.id("taskSeries"),
  handler: async (ctx, args) => {
    await member(ctx, args.householdId);
    const zone = timezone(args.timezone), from = localDate(args.activeFrom), today = todayIn(zone, Date.now());
    if (from.toString() < today.toString() || today.until(from).days > 366) fail("INVALID_DATE", "Start the recurrence today or within the next year.");
    wallTime(args.localTime); const days = weekdays(args.weekdays);
    if (args.activeUntil && localDate(args.activeUntil).toString() < from.toString()) fail("INVALID_DATE", "The recurrence end precedes its start.");
    if (args.proposedOwnerId) await activeAssignee(ctx, args.householdId, args.proposedOwnerId);
    const fingerprint = JSON.stringify(args), prior = await priorRequest(ctx, "recurrence.create", args.requestId, fingerprint);
    if (prior) { const id = ctx.db.normalizeId("taskSeries", prior.resultId); if (!id) return fail("NOT_FOUND", "Recurring task unavailable."); return id; }
    const id = await ctx.db.insert("taskSeries", { householdId: args.householdId, title: text(args.title, "Title", 160), category: args.category, note: text(args.note, "Note", 4000, true), localTime: args.localTime, timezone: zone, weekdays: days, activeFrom: from.toString(), activeUntil: args.activeUntil, proposedOwnerId: args.proposedOwnerId, status: "active", version: 1, generatedThrough: null, createdBy: ctx.user._id, updatedAt: Date.now() });
    const series = await ctx.db.get(id);
    await generateOccurrences(ctx, series!, today.toString(), today.add({ days: HORIZON_DAYS }).toString());
    await record(ctx, { householdId: args.householdId, actorId: ctx.user._id, type: "recurrence.created", entity: { kind: "household", id: args.householdId }, after: `${args.title}; local ${args.localTime}; ${zone}; weekdays ${days.join(",")}` });
    await saveRequest(ctx, "recurrence.create", args.requestId, fingerprint, id); return id;
  },
});

export const editFuture = userMutation({
  args: { seriesId: v.id("taskSeries"), expectedVersion: v.number(), fromDate: v.string(), ...fields }, returns: v.id("taskSeries"),
  handler: async (ctx, args) => {
    const series = await ctx.db.get(args.seriesId); if (!series) return fail("NOT_FOUND", "Recurring task unavailable.");
    await member(ctx, series.householdId); checkVersion(series, args.expectedVersion);
    if (series.status !== "active") fail("INVALID_STATE", "This series is cancelled.");
    if (series.nextSeriesId) fail("INVALID_STATE", "Open the revised rule to change future occurrences. Earlier occurrences can be edited individually.");
    const zone = timezone(args.timezone), from = localDate(args.fromDate), today = todayIn(series.timezone, Date.now());
    const latestChange = series.activeFrom > today.add({ days: HORIZON_DAYS }).toString() ? series.activeFrom : today.add({ days: HORIZON_DAYS }).toString();
    if (from.toString() < today.toString() || from.toString() > latestChange) fail("INVALID_DATE", "Choose a date within thirty days, or the start of a rule that begins later.");
    if (args.activeUntil && localDate(args.activeUntil).toString() < from.toString()) fail("INVALID_DATE", "The recurrence end precedes this occurrence.");
    wallTime(args.localTime); const days = weekdays(args.weekdays);
    if (args.proposedOwnerId) await activeAssignee(ctx, series.householdId, args.proposedOwnerId);
    // Split the schedule so generation before fromDate retains the old rule.
    const until = from.subtract({ days: 1 }).toString();
    await ctx.db.patch(series._id, { activeUntil: until, ...(from.toString() <= series.activeFrom ? { status: "cancelled" as const } : {}), version: series.version + 1, updatedAt: Date.now() });
    const newId = await ctx.db.insert("taskSeries", { householdId: series.householdId, title: text(args.title, "Title", 160), category: args.category, note: text(args.note, "Note", 4000, true), localTime: args.localTime, timezone: zone, weekdays: days, activeFrom: from.toString(), activeUntil: args.activeUntil, proposedOwnerId: args.proposedOwnerId, status: "active", version: 1, generatedThrough: null, createdBy: ctx.user._id, updatedAt: Date.now() });
    const existing = await ctx.db.query("tasks").withIndex("by_seriesId_and_occurrenceLocalDate", q => q.eq("seriesId", series._id).gte("occurrenceLocalDate", from.toString())).take(62);
    if (existing.length > 61) fail("RANGE_TOO_DENSE", "Too many generated occurrences to revise atomically.");
    const suppressedDates = new Set((series.suppressedDates ?? []).filter(date => date >= from.toString()));
    for (const task of existing) {
      if (task.status === "done" || task.seriesException) {
        if (task.occurrenceLocalDate) suppressedDates.add(task.occurrenceLocalDate);
      } else await ctx.db.patch(task._id, { seriesId: newId });
    }
    await ctx.db.patch(newId, { suppressedDates: [...suppressedDates], previousSeriesId: series._id });
    await ctx.db.patch(series._id, { nextSeriesId: newId });
    const newSeries = await ctx.db.get(newId);
    const generationStart = todayIn(zone, Date.now());
    await generateOccurrences(ctx, newSeries!, generationStart.toString(), generationStart.add({ days: HORIZON_DAYS }).toString(), true);
    await record(ctx, { householdId: series.householdId, actorId: ctx.user._id, type: "recurrence.editedFuture", entity: { kind: "household", id: series.householdId }, before: `${series.title}; ${series.localTime}; ${series.timezone}`, after: `${args.title}; ${args.localTime}; ${zone}; from ${args.fromDate}` });
    return newId;
  },
});

export const cancelFuture = userMutation({
  args: { seriesId: v.id("taskSeries"), expectedVersion: v.number(), fromDate: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const series = await ctx.db.get(args.seriesId); if (!series) return fail("NOT_FOUND", "Recurring task unavailable.");
    await member(ctx, series.householdId); checkVersion(series, args.expectedVersion);
    if (series.status !== "active") fail("INVALID_STATE", "This series is cancelled.");
    const from = localDate(args.fromDate), today = todayIn(series.timezone, Date.now());
    if (from.toString() < today.toString() || today.until(from).days > HORIZON_DAYS) fail("INVALID_DATE", "Choose a future occurrence within thirty days.");
    const tasks = await ctx.db.query("tasks").withIndex("by_seriesId_and_occurrenceLocalDate", q => q.eq("seriesId", series._id).gte("occurrenceLocalDate", from.toString())).take(62);
    if (tasks.length > 61) fail("RANGE_TOO_DENSE", "Too many occurrences to cancel atomically.");
    for (const task of tasks) if (task.status === "open" && !task.seriesException) await ctx.db.patch(task._id, { status: "cancelled", cancelledAt: Date.now(), version: task.version + 1, updatedAt: Date.now(), retentionUntil: Date.now() + 90 * 86400000 });
    const until = from.subtract({ days: 1 }).toString();
    await ctx.db.patch(series._id, { activeUntil: series.activeUntil && series.activeUntil < until ? series.activeUntil : until, ...(from.toString() <= series.activeFrom ? { status: "cancelled" as const } : {}), version: series.version + 1, updatedAt: Date.now() });
    await record(ctx, { householdId: series.householdId, actorId: ctx.user._id, type: "recurrence.cancelledFuture", entity: { kind: "household", id: series.householdId }, after: `Cancelled from ${from.toString()}; completed and individually edited occurrences unchanged.` });
    return null;
  },
});

export const generate = internalMutation({
  args: { seriesId: v.id("taskSeries") }, returns: v.number(),
  handler: async (ctx, args) => {
    const series = await ctx.db.get(args.seriesId); if (!series || series.status !== "active") return 0;
    const household = await ctx.db.get(series.householdId);
    await ctx.db.patch(series._id,{nextGenerationAt:todayIn(series.timezone,Date.now()).add({days:1}).toZonedDateTime(series.timezone).epochMilliseconds});
    if (!household || household.status !== "active"||(household.expiresAt&&household.expiresAt<=Date.now())) return 0;
    let currentSeries = series;
    if (series.proposedOwnerId) {
      const assignee = await ctx.db.query("memberships").withIndex("by_householdId_and_userId", q => q.eq("householdId", series.householdId).eq("userId", series.proposedOwnerId!)).unique();
      if (!assignee || assignee.status !== "active") {
        currentSeries = { ...series, proposedOwnerId: null, version: series.version + 1 };
        await ctx.db.patch(series._id, { proposedOwnerId: null, version: currentSeries.version });
      }
    }
    const today = todayIn(series.timezone, Date.now());
    if(series.activeUntil&&series.activeUntil<today.toString()){await ctx.db.patch(series._id,{status:"cancelled",version:series.version+1,updatedAt:Date.now()});return 0;}
    const changed = await generateOccurrences(ctx, currentSeries, today.toString(), today.add({ days: HORIZON_DAYS }).toString());
    if (changed) await record(ctx, { householdId: series.householdId, actorId: null, type: "recurrence.generated", entity: { kind: "household", id: series.householdId }, after: `${changed} new responsibilities generated.` });
    return changed;
  },
});

export const list = userQuery({
  args: { householdId: v.id("households"), status: v.union(v.literal("active"), v.literal("cancelled")), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("taskSeries")),
  handler: async (ctx, args) => {
    await member(ctx, args.householdId);
    return ctx.db.query("taskSeries").withIndex("by_householdId_and_status", q => q.eq("householdId", args.householdId).eq("status", args.status)).order("desc").paginate(args.paginationOpts);
  },
});
