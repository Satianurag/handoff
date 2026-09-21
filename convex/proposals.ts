import { canReadSource, requireSourceAccess } from "./model/mailAccess";
import { sameEntity } from "./model/entities";
import {linkEvidence} from "./model/sourceUses";
import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import schema from "./schema";
import type { Doc } from "./_generated/dataModel";
import type { UserQueryCtx } from "./model/access";
import { entity, proposalValue } from "./validators";
import { checkVersion, fail, member, text, timestamp, userMutation, userQuery } from "./model/access";
import { record } from "./model/events";

const targetInfo=v.object({kind:v.union(v.literal("task"),v.literal("visit")),id:v.union(v.id("tasks"),v.id("visits")),title:v.string(),status:v.string(),version:v.number(),value:proposalValue,timezone:v.string()});
const item=schema.doc("proposals").extend({targetInfo:v.union(targetInfo,v.null()),sourceAvailable:v.boolean(),sourceKind:v.union(v.literal("email"),v.literal("web"),v.literal("manual"),v.null()),sourceCapturedAt:v.union(v.number(),v.null())});
async function describe(ctx:UserQueryCtx,proposal:Doc<"proposals">){
  const source=await ctx.db.get(proposal.sourceId),sourceAvailable=!!source&&!source.retiring&&source.householdId===proposal.householdId;
  let target=null;
  if(proposal.target?.kind==="task"||proposal.target?.kind==="visit"){
    const row=await ctx.db.get(proposal.target.id);
    if(row&&row.householdId===proposal.householdId){
      const value=proposal.field==="startsAt"&&"confirmedStartsAt" in row?row.confirmedStartsAt:proposal.field==="address"&&"confirmedAddress" in row?row.confirmedAddress:proposal.field==="dueAt"&&"dueAt" in row?row.dueAt:proposal.field==="phone"&&"phone" in row?row.phone:proposal.field==="note"?row.note:proposal.field==="title"?row.title:null;
      target={kind:proposal.target.kind,id:proposal.target.id,title:row.title,status:row.status,version:row.version,value,timezone:"timezone" in row?row.timezone:""};
    }
  }
  return {...proposal,targetInfo:target,sourceAvailable,sourceKind:sourceAvailable?source.kind:null,sourceCapturedAt:sourceAvailable?source.capturedAt:null};
}
export const get=userQuery({args:{proposalId:v.id("proposals")},returns:item,handler:async(ctx,args)=>{
  const proposal=await ctx.db.get(args.proposalId);if(!proposal)return fail("NOT_FOUND","Suggestion unavailable.");await member(ctx,proposal.householdId);if(!await canReadSource(ctx,await ctx.db.get(proposal.sourceId),ctx.user._id))return fail("CARE_ACCESS_REQUIRED","This source requires care information access.");return describe(ctx,proposal);
}});

export const list = userQuery({
  args: { householdId: v.id("households"), status: v.union(v.literal("pending"), v.literal("approved"), v.literal("dismissed"), v.literal("invalid")), paginationOpts: paginationOptsValidator }, returns: paginationResultValidator(item),
  handler: async (ctx, args) => {
    await member(ctx, args.householdId);
    const result=await ctx.db.query("proposals").withIndex("by_householdId_and_status", q => q.eq("householdId", args.householdId).eq("status", args.status)).paginate(args.paginationOpts);
    const allowed=await Promise.all(result.page.map(async row=>canReadSource(ctx,await ctx.db.get(row.sourceId),ctx.user._id)));return {...result,page:await Promise.all(result.page.filter((_,index)=>allowed[index]).map(row=>describe(ctx,row)))};
  },
});

export const review = userMutation({
  args: { proposalId: v.id("proposals"), expectedVersion: v.number(), decision: v.union(v.literal("approve"), v.literal("dismiss")), target: v.optional(entity), expectedTargetVersion: v.optional(v.number()), editedValue: v.optional(proposalValue), acknowledgeHouseholdSharing:v.optional(v.boolean()), reason: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId); if (!proposal) return fail("NOT_FOUND", "Proposal unavailable.");
    await member(ctx, proposal.householdId); checkVersion(proposal, args.expectedVersion);
    if (proposal.status !== "pending") fail("ALREADY_REVIEWED", "This proposal has already been reviewed.");
    const source = await ctx.db.get(proposal.sourceId);
    if (!source || source.retiring || source.householdId !== proposal.householdId) fail("SOURCE_REMOVED", "Original evidence was removed. Enter a manual correction instead.");
    await requireSourceAccess(ctx,source);
    if(source.kind==="email"&&args.decision==="approve"&&!args.acknowledgeHouseholdSharing)fail("SHARING_CONFIRMATION","Confirm that the approved value can be shared with everyone in the household. Remove unnecessary medical details first.");
    const reason = text(args.reason, "Review note", 1000, args.decision === "approve");
    const target = args.decision === "dismiss" ? proposal.target : args.target ?? proposal.target;
    let previousValue = proposal.previousValue;
    const value = args.decision === "dismiss" || args.editedValue === undefined ? proposal.proposedValue : args.editedValue;
    if (args.decision === "approve") {
      if(source.threadId){
        const thread=await ctx.db.get(source.threadId);
        if(!thread||thread.deleting||!sameEntity(thread.related,proposal.target))fail("SOURCE_MATCH_CHANGED","The conversation match changed. Review its new extraction before approving this proposal.");
      }
      if (!target || (target.kind !== "task" && target.kind !== "visit")) fail("TARGET_REQUIRED", "Choose the matching task or visit before approval.");
      if (proposal.target && (target.kind !== proposal.target.kind || target.id !== proposal.target.id)) fail("TARGET_MISMATCH", "A targeted proposal cannot be applied to a different item.");
      if (!Number.isInteger(proposal.quoteStart) || !Number.isInteger(proposal.quoteEnd) || proposal.quoteStart < 0 || proposal.quoteEnd <= proposal.quoteStart || source.plaintext.slice(proposal.quoteStart, proposal.quoteEnd) !== proposal.quote) fail("INVALID_EVIDENCE", "The proposal quote does not match its source.");
      const ref = { sourceId: source._id, quote: proposal.quote, start: proposal.quoteStart, end: proposal.quoteEnd };
      const version = args.expectedTargetVersion ?? proposal.targetVersion;
      if (version === null || version === undefined) fail("TARGET_VERSION_REQUIRED", "Review the current target version before approval.");
      if (proposal.targetVersion !== null && proposal.targetVersion !== version) fail("CONFLICT", "The target changed since extraction. Enter a manual correction or regenerate the proposal.");
      if (target.kind === "task") {
        const task = await ctx.db.get(target.id); if (!task || task.householdId !== proposal.householdId) return fail("NOT_FOUND", "Task unavailable.");
        checkVersion(task, version);
        if (task.status !== "open") fail("INVALID_STATE", "Only open tasks can receive proposed changes.");
        const patch: Partial<typeof task> = { version: task.version + 1, updatedAt: Date.now(), sourceRefs: [...task.sourceRefs.slice(-19), ref], ...(task.seriesId ? { seriesException: true } : {}) };
        if (proposal.field === "dueAt") { if (value !== null && typeof value !== "number") fail("INVALID_VALUE", "Choose a confirmed date or no due time."); previousValue = task.dueAt; patch.dueAt = value === null ? null : timestamp(value); }
        else if (proposal.field === "title" || proposal.field === "note") { if (typeof value !== "string") fail("INVALID_VALUE", "Enter text for this field."); previousValue = task[proposal.field]; patch[proposal.field] = text(value, proposal.field, proposal.field === "title" ? 160 : 4000, proposal.field === "note"); }
        else fail("INVALID_FIELD", "This field does not belong to a task.");
        await ctx.db.patch(task._id, patch);
      } else {
        const visit = await ctx.db.get(target.id); if (!visit || visit.householdId !== proposal.householdId) return fail("NOT_FOUND", "Visit unavailable.");
        checkVersion(visit, version);
        if (visit.status !== "upcoming") fail("INVALID_STATE", "Only upcoming visits can receive proposed changes.");
        const patch: Partial<typeof visit> = { version: visit.version + 1, updatedAt: Date.now(), sourceRefs: [...visit.sourceRefs.slice(-19), ref] };
        if (proposal.field === "startsAt") {
          if (source.kind === "web") fail("PRIVATE_APPOINTMENT_TIME", "A public page cannot establish a private appointment change. Confirm the visit time manually.");
          if (typeof value !== "number") fail("INVALID_VALUE", "Choose a confirmed date and time."); previousValue = visit.confirmedStartsAt; patch.confirmedStartsAt = timestamp(value);
        } else if (["address", "phone", "note", "title"].includes(proposal.field)) {
          if (typeof value !== "string") fail("INVALID_VALUE", "Enter text for this field.");
          const field = proposal.field === "address" ? "confirmedAddress" : proposal.field as "phone" | "note" | "title";
          previousValue = visit[field]; patch[field] = text(value, field, field === "title" ? 160 : field === "phone" ? 80 : field === "confirmedAddress" ? 1000 : 4000, field !== "title");
        } else fail("INVALID_FIELD", "This field does not belong to a visit.");
        await ctx.db.patch(visit._id, patch);
      }
    }
    if(args.decision==="approve"&&target&&(target.kind==="task"||target.kind==="visit"))await linkEvidence(ctx,proposal.householdId,target,[{sourceId:source._id,quote:proposal.quote,start:proposal.quoteStart,end:proposal.quoteEnd}]);
    await ctx.db.patch(proposal._id, { status: args.decision === "approve" ? "approved" : "dismissed", target, proposedValue: value, previousValue, reviewedBy: ctx.user._id, reviewedAt: Date.now(), reason, version: proposal.version + 1 });
    await ctx.db.patch(source._id, { unresolvedReferences: Math.max(0, source.unresolvedReferences - 1) });
    await record(ctx, { householdId: proposal.householdId, actorId: ctx.user._id, type: `proposal.${args.decision}`, entity: target ?? { kind: "source", id: source._id }, before: String(previousValue ?? ""), after: args.decision === "approve" ? `${proposal.field}: ${String(value ?? "")}` : reason, sourceRefs: [{ sourceId: source._id, quote: proposal.quote, start: proposal.quoteStart, end: proposal.quoteEnd }] });
    return null;
  },
});

export const forSource = userQuery({
  args: { sourceId: v.id("sources"), status: v.union(v.literal("pending"), v.literal("approved"), v.literal("dismissed"), v.literal("invalid")), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(item),
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.retiring) return fail("NOT_FOUND", "Source unavailable.");
    await requireSourceAccess(ctx,source);
    const result=await ctx.db.query("proposals").withIndex("by_sourceId_and_status", q => q.eq("sourceId", source._id).eq("status", args.status)).paginate(args.paginationOpts);
    const allowed=await Promise.all(result.page.map(async row=>canReadSource(ctx,await ctx.db.get(row.sourceId),ctx.user._id)));return {...result,page:await Promise.all(result.page.filter((_,index)=>allowed[index]).map(row=>describe(ctx,row)))};
  },
});

// A complete, field-compatible picker; no time window or fixed frontend cap.
export const matchCandidates=userQuery({
  args:{proposalId:v.id("proposals"),kind:v.union(v.literal("task"),v.literal("visit")),paginationOpts:paginationOptsValidator},
  returns:paginationResultValidator(v.object({_id:v.union(v.id("tasks"),v.id("visits")),title:v.string(),version:v.number(),when:v.union(v.number(),v.null())})),
  handler:async(ctx,args)=>{
    const proposal=await ctx.db.get(args.proposalId);if(!proposal)return fail("NOT_FOUND","Suggestion unavailable.");await member(ctx,proposal.householdId);if(!await canReadSource(ctx,await ctx.db.get(proposal.sourceId),ctx.user._id))return fail("CARE_ACCESS_REQUIRED","This source requires care information access.");
    if(proposal.target||proposal.status!=="pending")return fail("NOT_MATCHABLE","Only unmatched pending suggestions can be matched.");
    const allowed=args.kind==="task"?["dueAt","note","title"]:["startsAt","address","phone","note","title"];
    if(!allowed.includes(proposal.field))return fail("INVALID_FIELD","Choose a compatible responsibility or visit.");
    if(args.kind==="task"){
      const result=await ctx.db.query("tasks").withIndex("by_householdId_and_status_and_dueAt",q=>q.eq("householdId",proposal.householdId).eq("status","open")).paginate(args.paginationOpts);
      return {...result,page:result.page.map(row=>({_id:row._id,title:row.title,version:row.version,when:row.dueAt}))};
    }
    const result=await ctx.db.query("visits").withIndex("by_householdId_and_status_and_confirmedStartsAt",q=>q.eq("householdId",proposal.householdId).eq("status","upcoming")).paginate(args.paginationOpts);
    return {...result,page:result.page.map(row=>({_id:row._id,title:row.title,version:row.version,when:row.confirmedStartsAt}))};
  },
});
