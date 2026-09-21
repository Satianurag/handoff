import type {Id} from "./_generated/dataModel";
import {startOperation} from "./model/operations";
import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { fail, internalUserMutation, member, text } from "./model/access";
import { limits, dailyAllowance } from "./model/limits";
import { sourceText, logisticsHash } from "./model/sourceText";
import { publicUrl } from "./model/publicUrl";
import { record } from "./model/events";
import { todayIn } from "./model/recurrence";

export const beginMap = internalUserMutation({
  args: { householdId: v.id("households"), url: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    await member(ctx, args.householdId); publicUrl(args.url);
    await dailyAllowance(ctx,"householdSourceChecks",args.householdId);
    await dailyAllowance(ctx,"globalPageOperations",undefined,4); return null;
  },
});

async function beginCheck(ctx:MutationCtx,watchId:Id<"watches">,requestId:string,actorId:Id<"users">|null){
 const watch=await ctx.db.get(watchId);if(!watch)return fail("NOT_FOUND","Source watch unavailable.");
 const household=await ctx.db.get(watch.householdId);if(!household||household.status!=="active"||(household.expiresAt&&household.expiresAt<=Date.now()))return fail("NOT_FOUND","Household unavailable.");
    text(requestId, "Check ID", 128);
    const key = `watch:${watch._id}:${requestId}`;
    const prior = await ctx.db.query("jobs").withIndex("by_householdId_and_operationKey", q => q.eq("householdId", household._id).eq("operationKey", key)).unique();
    if (prior) return prior._id;
    if (!watch.active) fail("WATCH_PAUSED", "Resume this source watch before checking it.");
    const visit = await ctx.db.get(watch.visitId); if (!visit || visit.status !== "upcoming") fail("VISIT_ENDED", "Source checks stop when the visit ends.");
    if (watch.currentJobId) { const running = await ctx.db.get(watch.currentJobId); if (running && ["queued", "running"].includes(running.state)) return running._id; }
    await limits.limit(ctx, "sourceRefresh", { key: watch._id, throws: true });
    await dailyAllowance(ctx,"householdSourceChecks",household._id);
    // The component has up to four attempts. Reserve all potential calls so
    // its retry policy cannot bypass the deployment ceiling.
    await dailyAllowance(ctx,"globalPageOperations",undefined,4);
    const id = await ctx.db.insert("jobs", { householdId: household._id, operationKey: key, kind: "refreshWatch", watchId:watch._id, requestedBy: actorId, target: { kind: "visit", id: watch.visitId }, state: "queued", attempts: 0, createdAt: Date.now(), updatedAt: Date.now(), consentVersion: household.consentVersion });
    await ctx.db.patch(watch._id, { currentJobId: id, state: "processing", lastAttemptAt: Date.now() }); return id;
}

export const begin = internalUserMutation({
  args: { watchId: v.id("watches"), requestId: v.string() }, returns: v.id("jobs"),
  handler: async (ctx, args) => {
    const watch = await ctx.db.get(args.watchId); if (!watch) return fail("NOT_FOUND", "Source watch unavailable.");
    const { household } = await member(ctx, watch.householdId);
    return beginCheck(ctx,watch._id,args.requestId,ctx.user._id);
  },
});

export const claim = internalMutation({
  args: { watchId: v.id("watches"), jobId: v.id("jobs") }, returns: v.union(v.object({ url: v.string(), tag: v.string(), watchVersion: v.number() }), v.null()),
  handler: async (ctx, args) => {
    const watch = await ctx.db.get(args.watchId), job = await ctx.db.get(args.jobId);
    if (!watch || !job || watch.householdId !== job.householdId || watch.currentJobId !== job._id || job.state !== "queued") return null;
    const household = await ctx.db.get(watch.householdId), visit = await ctx.db.get(watch.visitId);
    const membership = job.requestedBy ? await ctx.db.query("memberships").withIndex("by_householdId_and_userId", q => q.eq("householdId", watch.householdId).eq("userId", job.requestedBy!)).unique() : null;
    if (!household || household.status !== "active" || !watch.active || visit?.status !== "upcoming" || (job.requestedBy && membership?.status !== "active") || (household.mode === "demo" && (household.expiresAt ?? 0) <= Date.now())) {
      await ctx.db.patch(job._id, { state: "cancelled", updatedAt: Date.now(), safeError: "Source check is no longer authorized." }); return null;
    }
    await ctx.db.patch(job._id, { state: "running", attempts: job.attempts + 1, updatedAt: Date.now() });
    return { url: watch.url, tag: watch.tag, watchVersion: watch.version };
  },
});

export const finish = internalMutation({
  args: { watchId: v.id("watches"), jobId: v.id("jobs"), watchVersion: v.number(), markdown: v.string(), trackingStatus: v.union(v.literal("new"), v.literal("changed"), v.literal("same"), v.literal("unknown")), warning: v.optional(v.string()) }, returns: v.union(v.id("sources"), v.null()),
  handler: async (ctx, args) => {
    const watch = await ctx.db.get(args.watchId), job = await ctx.db.get(args.jobId);
    if (!watch || !job || watch.householdId !== job.householdId || watch.currentJobId !== job._id || job.state !== "running") return null;
    const household = await ctx.db.get(watch.householdId), visit = await ctx.db.get(watch.visitId);
    const member = job.requestedBy ? await ctx.db.query("memberships").withIndex("by_householdId_and_userId", q => q.eq("householdId", watch.householdId).eq("userId", job.requestedBy!)).unique() : null;
    if (!household || household.status !== "active" || !watch.active || watch.version !== args.watchVersion || visit?.status !== "upcoming" || (job.requestedBy && member?.status !== "active") || (household.expiresAt !== undefined && household.expiresAt <= Date.now())) {
      await ctx.db.patch(job._id, { state: "cancelled", updatedAt: Date.now(), safeError: "Source check invalidated before saving." }); return null;
    }
    const normalized = sourceText(args.markdown);
    if (!normalized.plaintext) fail("EMPTY_SOURCE", "The public page returned no usable text.");
    const previous = watch.lastSuccessfulSourceId ? await ctx.db.get(watch.lastSuccessfulSourceId) : null;
    const relevantHash = logisticsHash(normalized.plaintext);
    const comparison = !previous ? "baseline" : args.warning || args.trackingStatus === "unknown" ? "unknown" : previous.logisticsHash === relevantHash ? "unchanged" : "changed";
    // A -> B -> A is a new observation. Content-address deduplication would
    // reuse A's old predecessor and hide the reversal from extraction/history.
    // The running job is the idempotency boundary for each immutable capture.
    const now = Date.now();
    const sourceId = await ctx.db.insert("sources", { householdId: watch.householdId, kind: "web", watchId: watch._id, url: watch.url, ...(previous ? { previousSourceId: previous._id } : {}), ...normalized, capturedAt: now, publishedAt: null, retentionUntil: now + 30 * 86400000, extractionState: previous?.contentHash === normalized.contentHash ? "ready" : household.aiProcessing ? "pending" : "paused", warnings: [...(normalized.truncated ? ["Source text was truncated; omitted content was not processed."] : []), ...(args.warning ? [args.warning] : []), ...(args.trackingStatus === "unknown" ? ["Provider comparison unavailable; no unchanged claim is made."] : [])], unresolvedReferences: 0, version: 1, logisticsHash: relevantHash, comparison });
    const nextCheckAt = todayIn(household.timezone, now).add({ days: 1 }).toZonedDateTime(household.timezone).epochMilliseconds;
    await ctx.db.patch(watch._id, { state: "ready", lastSuccessfulSourceId: sourceId, lastResult: comparison, nextCheckAt, currentJobId: undefined });
    await ctx.db.patch(job._id, { state: "succeeded", updatedAt: now, safeError: undefined });
    if (!previous || comparison !== "unchanged") await record(ctx, { householdId: watch.householdId, actorId: job.requestedBy, type: "source.checked", entity: { kind: "source", id: sourceId }, after: comparison === "changed" ? "Public logistical text changed; review original evidence." : comparison === "baseline" ? "Public source baseline captured." : comparison === "unknown" ? "Public source captured; comparison unavailable." : "No logistical text change detected.", material: comparison === "changed" || comparison === "unknown" });
    return sourceId;
  },
});

export const failed = internalMutation({
  args: { watchId: v.id("watches"), jobId: v.id("jobs"), reason: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const watch = await ctx.db.get(args.watchId), job = await ctx.db.get(args.jobId);
    if (!watch || !job || watch.householdId !== job.householdId || watch.currentJobId !== job._id) return null;
    if (job.state === "succeeded" || job.state === "cancelled") return null;
    const reason = text(args.reason, "Failure reason", 300);
    await ctx.db.patch(job._id, { state: "failed", safeError: reason, updatedAt: Date.now() });
    await ctx.db.patch(watch._id, { state: "failed", lastResult: reason, currentJobId: undefined, nextCheckAt: Date.now() + 3600000 }); return null;
  },
});

export const beginAutomatic=internalMutation({args:{watchId:v.id("watches")},returns:v.union(v.id("jobs"),v.null()),handler:async(ctx,args):Promise<Id<"jobs">|null>=>{
 const pause=await ctx.db.query("operatorSettings").withIndex("by_key",q=>q.eq("key","pauseAutomaticOperations")).unique();if(pause?.enabled)return null;
 const watch=await ctx.db.get(args.watchId);if(!watch||!watch.active)return null;
 const h=await ctx.db.get(watch.householdId),visit=await ctx.db.get(watch.visitId);
 if(!h||h.status!=="active"||(h.expiresAt&&h.expiresAt<=Date.now())||visit?.status!=="upcoming"){
   await ctx.db.patch(watch._id,{active:false,state:"paused"});return null;
 }
 const id=await beginCheck(ctx,watch._id,`automatic:${watch.version}:${watch.nextCheckAt}`,null);
 await startOperation(ctx,id);
 await ctx.db.patch(watch._id,{nextCheckAt:Date.now()+3600000});return id;
}});
