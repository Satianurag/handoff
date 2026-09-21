import {numericSetting} from "./model/limits";
import {internal} from "./_generated/api";
import { v } from "convex/values";
import schema from "./schema";
import { checkVersion, fail, member, userMutation, userQuery } from "./model/access";
import { publicUrl } from "./model/publicUrl";
import { digest } from "./model/sourceText";
import { record } from "./model/events";
import { priorRequest, saveRequest } from "./model/requests";
import {paginationOptsValidator,paginationResultValidator} from 'convex/server';

export const forVisit=userQuery({
  args:{visitId:v.id('visits'),paginationOpts:paginationOptsValidator},
  returns:paginationResultValidator(schema.doc('watches').extend({lastSuccessfulCapturedAt:v.union(v.number(),v.null()),lastSuccessfulComparison:v.union(v.string(),v.null()),sourceAvailable:v.boolean()})),
  handler:async(ctx,args)=>{
    const visit=await ctx.db.get(args.visitId);if(!visit)return fail('NOT_FOUND','Visit unavailable.');
    await member(ctx,visit.householdId);
    const result=await ctx.db.query('watches').withIndex('by_visitId',q=>q.eq('visitId',visit._id)).paginate(args.paginationOpts);
    return {...result,page:await Promise.all(result.page.map(async watch=>{
      const source=watch.lastSuccessfulSourceId?await ctx.db.get(watch.lastSuccessfulSourceId):null;
      const available=!!source&&!source.retiring&&source.householdId===visit.householdId;
      return {...watch,lastSuccessfulCapturedAt:available?source.capturedAt:null,lastSuccessfulComparison:available?source.comparison??null:null,sourceAvailable:available};
    }))};
  },
});

export const get = userQuery({
  args: { watchId: v.id("watches") }, returns: schema.doc("watches"),
  handler: async (ctx, args) => { const watch = await ctx.db.get(args.watchId); if (!watch) return fail("NOT_FOUND", "Source watch unavailable."); await member(ctx, watch.householdId); return watch; },
});

export const create = userMutation({
  args: { visitId: v.id("visits"), url: v.string(), requestId: v.string() }, returns: v.id("watches"),
  handler: async (ctx, args) => {
    const visit = await ctx.db.get(args.visitId); if (!visit) return fail("NOT_FOUND", "Visit unavailable.");
    await member(ctx, visit.householdId);
    if (visit.status !== "upcoming") fail("INVALID_STATE", "Only upcoming visits can have active source watches.");
    const url = publicUrl(args.url), fingerprint = JSON.stringify(args);
    const prior = await priorRequest(ctx, "watches.create", args.requestId, fingerprint);
    if (prior) { const id = ctx.db.normalizeId("watches", prior.resultId); if (!id) return fail("NOT_FOUND", "Source watch unavailable."); return id; }
    const maximum=await numericSetting(ctx,"activeHouseholdWatches",5,100);
    const active = await ctx.db.query("watches").withIndex("by_householdId_and_active", q => q.eq("householdId", visit.householdId).eq("active", true)).take(maximum);
    const same = active.find(watch => watch.visitId === visit._id && watch.url === url);
    if (same) return same._id;
    if (active.length >= maximum) fail("WATCH_LIMIT", `Pause a source watch before adding another; the current household limit is ${maximum}.`);
    const id = await ctx.db.insert("watches", { householdId: visit.householdId, visitId: visit._id, url, tag: `handoff-${digest(`${visit.householdId}:${visit._id}:${url}`).slice(0, 24)}`, schemaVersion: 1, settingsHash: digest("markdown|git-diff|onlyMainContent=true|logistics-v1"), lastSuccessfulSourceId: null, nextCheckAt: Date.now(), active: true, state: "pending", createdBy: ctx.user._id, version: 1 });
    await record(ctx, { householdId: visit.householdId, actorId: ctx.user._id, type: "watch.created", entity: { kind: "visit", id: visit._id }, after: `Public source selected: ${new URL(url).hostname}` });
    await saveRequest(ctx, "watches.create", args.requestId, fingerprint, id);
    try{await ctx.runMutation(internal.webStore.beginAutomatic,{watchId:id});}catch{await ctx.db.patch(id,{state:"failed",lastResult:"Automatic check paused by service limits. Manual logistics remain available.",nextCheckAt:Date.now()+3600000});}return id;
  },
});

export const setActive = userMutation({
  args: { watchId: v.id("watches"), expectedVersion: v.number(), active: v.boolean() }, returns: v.null(),
  handler: async (ctx, args) => {
    const watch = await ctx.db.get(args.watchId); if (!watch) return fail("NOT_FOUND", "Source watch unavailable.");
    await member(ctx, watch.householdId); checkVersion(watch, args.expectedVersion);
    if (args.active && !watch.active) {
      const visit = await ctx.db.get(watch.visitId);
      if (!visit || visit.status !== "upcoming") fail("INVALID_STATE", "Restore the visit before enabling its watch.");
      const maximum=await numericSetting(ctx,"activeHouseholdWatches",5,100);
      const active = await ctx.db.query("watches").withIndex("by_householdId_and_active", q => q.eq("householdId", watch.householdId).eq("active", true)).take(maximum);
      if (active.length >= maximum) fail("WATCH_LIMIT", "Pause a source watch first.");
    }
    await ctx.db.patch(watch._id, { active: args.active, state: args.active ? "pending" : "paused", version: watch.version + 1, nextCheckAt: Date.now() });
    if(args.active)try{await ctx.runMutation(internal.webStore.beginAutomatic,{watchId:watch._id});}catch{await ctx.db.patch(watch._id,{state:"failed",lastResult:"Automatic check paused by service limits. Manual logistics remain available.",nextCheckAt:Date.now()+3600000});}return null;
  },
});
