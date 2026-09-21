import {canReadMail,canReadSource,canReadEvent,redactSourceRefs} from "./model/mailAccess";
import { captureCareSnapshot, verifyCareSnapshot, buildCareSnapshot, canReadCareHandover, acceptCareFollowUps } from "./careHandover";
import { Temporal } from "@js-temporal/polyfill";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { handoverState } from "./validators";
import {linkEvidence} from "./model/sourceUses";
import { v } from "convex/values";
import schema from "./schema";
import type { Id, Doc } from "./_generated/dataModel";
import { activeAssignee, isLimitedHelper, checkVersion, fail, member, text, userMutation, userQuery, type UserMutationCtx } from "./model/access";
import { notify, record } from "./model/events";
import { priorRequest, saveRequest } from "./model/requests";

const MAX_ITEMS = 250;
const MAX_CHANGES = 500;

async function completeSnapshot(ctx: UserMutationCtx, h: Doc<"handovers">) {
  const [items, changes, context] = await Promise.all([
    ctx.db.query("handoverItems").withIndex("by_handoverId", q => q.eq("handoverId", h._id)).take(MAX_ITEMS + 1),
    ctx.db.query("handoverChanges").withIndex("by_handoverId", q => q.eq("handoverId", h._id)).take(MAX_CHANGES * 2 + 1),
    ctx.db.query("handoverContextItems").withIndex("by_handoverId", q => q.eq("handoverId", h._id)).take(201),
  ]);
  if (items.length !== h.snapshotItemCount || changes.length !== h.snapshotChangeCount + h.snapshotProposalCount || (h.snapshotSchemaVersion === 2 && context.length !== h.snapshotContextCount)) {
    fail("INCOMPLETE_SNAPSHOT", "The saved handover is incomplete. Ask the sender to refresh it before continuing.");
  }
  return items;
}

async function snapshot(ctx: UserMutationCtx, args: {
  householdId: Id<"households">; recipientId: Id<"users">; proposedTaskIds: Id<"tasks">[];
  coverageId?: Id<"coverage">; introduction: string; note: string; supersedesId?: Id<"handovers">;
}) {
  const { household } = await member(ctx, args.householdId);
  await activeAssignee(ctx, household._id, args.recipientId);
  if(await isLimitedHelper(ctx,household._id,args.recipientId))fail("LIMITED_HELPER_ACCESS","Limited helpers receive individual task requests, not full household handovers.");
  if (args.recipientId === ctx.user._id) fail("INVALID_RECIPIENT", "Choose another household member.");
  const includeMail=await canReadMail(ctx,household._id,ctx.user._id)&&await canReadMail(ctx,household._id,args.recipientId);
  const sharedRefs=async(refs:Doc<"tasks">["sourceRefs"])=>redactSourceRefs(ctx,await redactSourceRefs(ctx,refs,ctx.user._id),args.recipientId);
  const introduction = text(args.introduction, "Introduction", 2000, true), note = text(args.note, "Note", 4000, true);
  const owned = await ctx.db.query("tasks").withIndex("by_householdId_and_ownerId_and_status", q => q.eq("householdId", household._id).eq("ownerId", ctx.user._id).eq("status", "open")).take(MAX_ITEMS + 1);
  const unassigned = await ctx.db.query("tasks").withIndex("by_householdId_and_ownerId_and_status", q => q.eq("householdId", household._id).eq("ownerId", null).eq("status", "open")).take(MAX_ITEMS + 1);
  const tasks = [...owned, ...unassigned];
  if (tasks.length > MAX_ITEMS) fail("HANDOVER_TOO_LARGE", "Review or close older open responsibilities before preparing this handover. No items were omitted.");
  const proposed = new Set(args.proposedTaskIds);
  if (proposed.size !== args.proposedTaskIds.length || proposed.size > MAX_ITEMS || [...proposed].some(id => !tasks.some(t => t._id === id))) fail("INVALID_SELECTION", "Select current responsibilities that are yours or unassigned.");
  let coverage = null;
  if (args.coverageId) {
    const row = await ctx.db.get(args.coverageId);
    if (!row || row.householdId !== household._id) return fail("NOT_FOUND", "Coverage unavailable.");
    if (!["planned", "committed", "active"].includes(row.state) || (row.activeOwnerId && row.activeOwnerId !== ctx.user._id) || (row.state!=="active"&&row.plannedOwnerId&&row.plannedOwnerId!==ctx.user._id)) fail("INVALID_COVERAGE", "Choose your own or unassigned coverage.");
    if(row.endsAt<=Date.now())fail("EXPIRED_COVERAGE","Update the coverage end before offering it in a handover.");
    coverage = { coverageId: row._id, version: row.version, startsAt: row.startsAt, endsAt: row.endsAt, activeOwnerId: row.activeOwnerId, plannedOwnerId: row.plannedOwnerId, state: row.state, note: row.note };
  }
  const lastReceipt = household.lastReceiptId ? await ctx.db.get(household.lastReceiptId) : null;
  const rawChanges = await ctx.db.query("events").withIndex("by_householdId_and_sequence", q => q.eq("householdId", household._id).gt("sequence", lastReceipt?.eventSequence ?? household.lastAcceptedSequence ?? 0)).take(MAX_CHANGES + 1);
  const rawProposals = await ctx.db.query("proposals").withIndex("by_householdId_and_status", q => q.eq("householdId", household._id).eq("status", "pending")).take(MAX_CHANGES + 1);
  if (rawChanges.length > MAX_CHANGES || rawProposals.length > MAX_CHANGES) fail("HANDOVER_TOO_LARGE", "This handover exceeds the review limit. Resolve pending information or request operator assistance; no changes were omitted.");
  const changes=[];for(const event of rawChanges)if(await canReadEvent(ctx,event,ctx.user._id)&&await canReadEvent(ctx,event,args.recipientId))changes.push(event);
  const proposals=[];for(const proposal of rawProposals){const source=await ctx.db.get(proposal.sourceId);if(await canReadSource(ctx,source,ctx.user._id)&&await canReadSource(ctx,source,args.recipientId))proposals.push(proposal);}
  const now = Date.now();
  const localStart = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(household.timezone).startOfDay();
  const visitRows = await ctx.db.query("visits").withIndex("by_householdId_and_status_and_confirmedStartsAt", q => q.eq("householdId", household._id).eq("status", "upcoming").gte("confirmedStartsAt", localStart.epochMilliseconds).lt("confirmedStartsAt", localStart.add({ days: 7 }).epochMilliseconds)).take(101);
  const visits = new Map(visitRows.map(row => [row._id, row]));
  for (const id of new Set(tasks.flatMap(task => task.visitId ? [task.visitId] : []))) {
    const visit = await ctx.db.get(id);
    if (visit && visit.householdId === household._id) visits.set(id, visit);
  }
  if (visits.size > 100) fail("HANDOVER_TOO_LARGE", "More than 100 visits need review. No visit context was omitted.");
  const context: Omit<Doc<"handoverContextItems">, "_id" | "_creationTime" | "householdId" | "handoverId">[] = [];
  for (const visit of visits.values()) {
    const ride = visit.rideTaskId ? await ctx.db.get(visit.rideTaskId) : null;
    const returnRide=visit.returnRideTaskId?await ctx.db.get(visit.returnRideTaskId):null,companion=visit.companionTaskId?await ctx.db.get(visit.companionTaskId):null;
    context.push({ sourceRefs: await sharedRefs(visit.sourceRefs), snapshot: { kind: "visit", visitId: visit._id, version: visit.version, title: visit.title, status: visit.status, confirmedStartsAt: visit.confirmedStartsAt, timezone: visit.timezone, confirmedAddress: visit.confirmedAddress, phone: visit.phone, note: visit.note, checklist: visit.checklist,...(visit.transport?{transport:visit.transport}:{}),returnRide:returnRide&&returnRide.householdId===household._id?{taskId:returnRide._id,title:returnRide.title,status:returnRide.status,ownerId:returnRide.ownerId}:null,companion:companion&&companion.householdId===household._id?{taskId:companion._id,title:companion.title,status:companion.status,ownerId:companion.ownerId}:null, ride: ride && ride.householdId === household._id ? { taskId: ride._id, title: ride.title, status: ride.status, ownerId: ride.ownerId } : null } });
  }
  let threadCount = 0;
  const targets = [...tasks.map(task => ({ kind: "task" as const, id: task._id })), ...[...visits.keys()].map(id => ({ kind: "visit" as const, id }))];
  if(includeMail)for (const target of targets) for (const state of ["new", "waiting", "replyReceived"] as const) {
    const threads = await ctx.db.query("mailThreads").withIndex("by_householdId_related_deleting_quarantined_state", q => q.eq("householdId", household._id).eq("related", target).eq("deleting", false).eq("quarantined", false).eq("state", state)).take(101 - threadCount);
    threadCount += threads.length;
    if (threadCount > 100) fail("HANDOVER_TOO_LARGE", "More than 100 linked questions need review. No question context was omitted.");
    for (const thread of threads) context.push({ sourceRefs: [], snapshot: { kind: "thread", threadId: thread._id, version: thread.version, subject: thread.subject, state, related: target, lastMessageAt: thread.lastMessageAt } });
  }
  const handoverId = await ctx.db.insert("handovers", {
    householdId: household._id, senderId: ctx.user._id, recipientId: args.recipientId, baseMaterialRevision: household.materialRevision,
    lastReceiptId: household.lastReceiptId, introduction, note, coverage, status: "draft", version: 1,
    mailContextRestricted:includeMail,snapshotSchemaVersion: 2, snapshotContextCount: context.length, snapshotItemCount: tasks.length, snapshotChangeCount: changes.length, snapshotProposalCount: proposals.length,
    ...(args.supersedesId ? { supersedesId: args.supersedesId } : {}), createdAt: now, updatedAt: now,
  });
  for (const item of context) await ctx.db.insert("handoverContextItems", { ...item, householdId: household._id, handoverId });
  for (const task of tasks) await ctx.db.insert("handoverItems", { householdId: household._id, handoverId, snapshot: {
    taskId: task._id, version: task.version, title: task.title, status: task.status, ownerId: task.ownerId,
    dueAt: task.dueAt, proposed: proposed.has(task._id), note: task.note, sourceRefs: await sharedRefs(task.sourceRefs),
  } });
  for (const event of changes) await ctx.db.insert("handoverChanges", { householdId: household._id, handoverId, kind: "event", referenceId: event._id, summary: `${event.type}: ${event.after}`, sourceRefs: event.sourceRefs });
  for (const proposal of proposals) await ctx.db.insert("handoverChanges", { householdId: household._id, handoverId, kind: "proposal", referenceId: proposal._id, summary: `Unreviewed ${proposal.field}: ${String(proposal.proposedValue ?? "unspecified")}`, sourceRefs: [{ sourceId: proposal.sourceId, quote: proposal.quote, start: proposal.quoteStart, end: proposal.quoteEnd }] });
  await linkEvidence(ctx,household._id,{kind:"handover",id:handoverId},[...context.flatMap(item=>item.sourceRefs),...tasks.flatMap(t=>t.sourceRefs),...changes.flatMap(e=>e.sourceRefs),...proposals.map(p=>({sourceId:p.sourceId,quote:p.quote,start:p.quoteStart,end:p.quoteEnd}))],true);
  await captureCareSnapshot(ctx,handoverId,lastReceipt?.acceptedAt??0);
  return handoverId;
}

export const prepare = userMutation({
  args: { householdId: v.id("households"), recipientId: v.id("users"), proposedTaskIds: v.array(v.id("tasks")), coverageId: v.optional(v.id("coverage")), introduction: v.string(), note: v.string(), requestId: v.string() }, returns: v.id("handovers"),
  handler: async (ctx, args) => {
    await member(ctx, args.householdId);
    const fingerprint = JSON.stringify(args), prior = await priorRequest(ctx, "handovers.prepare", args.requestId, fingerprint);
    if (prior) { const id = ctx.db.normalizeId("handovers", prior.resultId); if (!id) return fail("NOT_FOUND", "Handover unavailable."); return id; }
    const id = await snapshot(ctx, args);
    await saveRequest(ctx, "handovers.prepare", args.requestId, fingerprint, id); return id;
  },
});

export const get = userQuery({
  args: { handoverId: v.id("handovers") },
  returns: v.object({ handover: schema.doc("handovers"), context: v.array(schema.doc("handoverContextItems")), contextCaptured: v.boolean(), items: v.array(schema.doc("handoverItems")), changes: v.array(schema.doc("handoverChanges")), receipt: v.union(schema.doc("handoverReceipts"), v.null()), stale: v.boolean(), currentMaterialRevision: v.number() }),
  handler: async (ctx, args) => {
    const handover = await ctx.db.get(args.handoverId); if (!handover || handover.retiring) return fail("NOT_FOUND", "Handover unavailable.");
    const { household } = await member(ctx, handover.householdId);
    if(handover.mailContextRestricted!==false&&!await canReadMail(ctx,handover.householdId,ctx.user._id))fail("CARE_ACCESS_REQUIRED","This saved handover can include private email context. Ask for care access or a new handover containing only shared responsibilities.");
    const items = await ctx.db.query("handoverItems").withIndex("by_handoverId", q => q.eq("handoverId", handover._id)).take(MAX_ITEMS + 1);
    const changes = await ctx.db.query("handoverChanges").withIndex("by_handoverId", q => q.eq("handoverId", handover._id)).take(MAX_CHANGES * 2 + 1);
    if (items.length !== handover.snapshotItemCount || changes.length !== handover.snapshotChangeCount + handover.snapshotProposalCount) fail("INCOMPLETE_SNAPSHOT", "The handover snapshot is incomplete. Refresh before continuing.");
    const context = await ctx.db.query("handoverContextItems").withIndex("by_handoverId", q => q.eq("handoverId", handover._id)).take(201);
    if (handover.snapshotSchemaVersion === 2 && context.length !== handover.snapshotContextCount) fail("INCOMPLETE_SNAPSHOT", "The handover context is incomplete. Refresh before continuing.");
    const receipt = await ctx.db.query("handoverReceipts").withIndex("by_handoverId", q => q.eq("handoverId", handover._id)).unique();
    return { handover, items, changes, context, contextCaptured: handover.snapshotSchemaVersion === 2, receipt, stale: ["draft", "pending"].includes(handover.status) && handover.baseMaterialRevision !== household.materialRevision, currentMaterialRevision: household.materialRevision };
  },
});

export const edit = userMutation({
  args: { handoverId: v.id("handovers"), expectedVersion: v.number(), introduction: v.string(), note: v.string(), proposedTaskIds: v.array(v.id("tasks")) }, returns: v.null(),
  handler: async (ctx, args) => {
    const h = await ctx.db.get(args.handoverId); if (!h || h.retiring) return fail("NOT_FOUND", "Handover unavailable.");
    await member(ctx, h.householdId); checkVersion(h, args.expectedVersion);
    if (h.senderId !== ctx.user._id || h.status !== "draft") fail("INVALID_STATE", "Only the sender can edit an unpublished draft.");
    const items = await ctx.db.query("handoverItems").withIndex("by_handoverId", q => q.eq("handoverId", h._id)).take(MAX_ITEMS + 1);
    const selected = new Set(args.proposedTaskIds);
    if (selected.size !== args.proposedTaskIds.length || [...selected].some(id => !items.some(i => i.snapshot.taskId === id))) fail("INVALID_SELECTION", "Select responsibilities in this snapshot.");
    for (const item of items) await ctx.db.patch(item._id, { snapshot: { ...item.snapshot, proposed: selected.has(item.snapshot.taskId) } });
    await ctx.db.patch(h._id, { introduction: text(args.introduction, "Introduction", 2000, true), introductionEventIds: undefined, note: text(args.note, "Note", 4000, true), version: h.version + 1, updatedAt: Date.now() });
    return null;
  },
});

export const publish = userMutation({
  args: { handoverId: v.id("handovers"), expectedVersion: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    const h = await ctx.db.get(args.handoverId); if (!h || h.retiring) return fail("NOT_FOUND", "Handover unavailable.");
    const { household } = await member(ctx, h.householdId); checkVersion(h, args.expectedVersion);
    if (h.senderId !== ctx.user._id || h.status !== "draft") fail("INVALID_STATE", "Only the sender can publish this draft.");
    await activeAssignee(ctx, h.householdId, h.recipientId);
    if(await isLimitedHelper(ctx,h.householdId,h.recipientId))fail("LIMITED_HELPER_ACCESS","The recipient now has limited-helper access. Send individual task requests instead.");
    await completeSnapshot(ctx, h);
    if(h.mailContextRestricted!==false&&(!await canReadMail(ctx,h.householdId,h.senderId)||!await canReadMail(ctx,h.householdId,h.recipientId)))fail("STALE_HANDOVER","Email access changed. Refresh this handover before publishing.");
    await verifyCareSnapshot(ctx,h);
    if (household.materialRevision !== h.baseMaterialRevision) fail("STALE_HANDOVER", "Information changed. Refresh and review the handover before publishing.");
    await ctx.db.patch(h._id, { status: "pending", publishedAt: Date.now(), updatedAt: Date.now(), version: h.version + 1 });
    const event = await record(ctx, { householdId: h.householdId, actorId: ctx.user._id, type: "handover.published", entity: { kind: "handover", id: h._id }, after: "Awaiting explicit acceptance.", handoverId: h._id, material: false });
    await notify(ctx, { householdId: h.householdId, userId: h.recipientId, target: { kind: "handover", id: h._id }, type: "handover.incoming", eventId: event.eventId, dedupeKey: `${event.eventId}:${h.recipientId}` });
    return null;
  },
});

export const refresh = userMutation({
  args: { handoverId: v.id("handovers"), expectedVersion: v.number(), requestId: v.string() }, returns: v.id("handovers"),
  handler: async (ctx, args) => {
    const h = await ctx.db.get(args.handoverId); if (!h || h.retiring) return fail("NOT_FOUND", "Handover unavailable.");
    await member(ctx, h.householdId);
    const fingerprint = JSON.stringify(args), prior = await priorRequest(ctx, "handovers.refresh", args.requestId, fingerprint);
    if (prior) { const id = ctx.db.normalizeId("handovers", prior.resultId); if (!id) return fail("NOT_FOUND", "Handover unavailable."); return id; }
    checkVersion(h, args.expectedVersion);
    if(h.mailContextRestricted!==false&&!await canReadMail(ctx,h.householdId,ctx.user._id))fail("CARE_ACCESS_REQUIRED","Private email access is required to refresh this saved handover. Prepare a new handover containing only shared responsibilities instead.");
    if (h.senderId !== ctx.user._id || !["draft", "pending"].includes(h.status)) fail("INVALID_STATE", "Only the sender can refresh an unresolved handover.");
    const oldItems = await ctx.db.query("handoverItems").withIndex("by_handoverId", q => q.eq("handoverId", h._id)).take(MAX_ITEMS + 1);
    const proposedTaskIds: Id<"tasks">[] = [];
    for (const item of oldItems) { const task = await ctx.db.get(item.snapshot.taskId); if (item.snapshot.proposed && task && task.status === "open" && (task.ownerId === ctx.user._id || task.ownerId === null)) proposedTaskIds.push(task._id); }
    const block = h.coverage ? await ctx.db.get(h.coverage.coverageId) : null;
    const coverageId = block && ["planned", "committed", "active"].includes(block.state) && (!block.activeOwnerId || block.activeOwnerId === ctx.user._id) && (block.state==="active"||!block.plannedOwnerId||block.plannedOwnerId===ctx.user._id) && block.endsAt>Date.now() ? block._id : undefined;
    const retainMailText=h.mailContextRestricted===false||await canReadMail(ctx,h.householdId,h.recipientId);
    const id = await snapshot(ctx, { householdId: h.householdId, recipientId: h.recipientId, proposedTaskIds, coverageId, introduction:retainMailText?h.introduction:"", note:retainMailText?h.note:"", supersedesId: h._id });
    await ctx.db.patch(h._id, { status: "superseded", supersededById: id, version: h.version + 1, updatedAt: Date.now(), resolvedAt: Date.now(), retentionUntil: Date.now() + 90 * 86400000 });
    await saveRequest(ctx, "handovers.refresh", args.requestId, fingerprint, id); return id;
  },
});

export const acceptHandover = userMutation({
  args: { handoverId: v.id("handovers"), expectedVersion: v.number(), acceptedTaskIds: v.array(v.id("tasks")), acceptedFollowUpIds:v.optional(v.array(v.id("followUps"))), takeCoverage: v.boolean() }, returns: v.id("handoverReceipts"),
  handler: async (ctx, args) => {
    const h = await ctx.db.get(args.handoverId); if (!h || h.retiring) return fail("NOT_FOUND", "Handover unavailable.");
    const { household } = await member(ctx, h.householdId);
    if (h.recipientId !== ctx.user._id) fail("FORBIDDEN", "Only the named recipient may accept this handover.");
    const accepted = new Set(args.acceptedTaskIds);
    if (accepted.size !== args.acceptedTaskIds.length || accepted.size > MAX_ITEMS) fail("INVALID_SELECTION", "Choose each responsibility once.");
    if (h.status === "accepted") {
      const receipt = await ctx.db.query("handoverReceipts").withIndex("by_handoverId", q => q.eq("handoverId", h._id)).unique();
      if (receipt && receipt.tookCoverage === args.takeCoverage && receipt.transferredTaskIds.length === accepted.size && receipt.transferredTaskIds.every(id => accepted.has(id))) { const care=await ctx.db.query("handoverCareSnapshots").withIndex("by_handoverId",q=>q.eq("handoverId",h._id)).unique();const selected=args.acceptedFollowUpIds??[];if((care?.acceptedFollowUpIds??[]).length===selected.length&&(care?.acceptedFollowUpIds??[]).every(id=>selected.includes(id)))return receipt._id; }
      return fail("ALREADY_ACCEPTED", "This handover was already accepted with a different selection.");
    }
    checkVersion(h, args.expectedVersion);
    if (h.status !== "pending") fail("INVALID_STATE", "This handover is not awaiting acceptance.");
    await activeAssignee(ctx, h.householdId, h.senderId);
    if(h.mailContextRestricted!==false&&(!await canReadMail(ctx,h.householdId,h.senderId)||!await canReadMail(ctx,h.householdId,h.recipientId)))fail("STALE_HANDOVER","Email access changed. Ask the sender to refresh this handover.");
    if (household.materialRevision !== h.baseMaterialRevision) fail("STALE_HANDOVER", "Information changed. Ask the sender to refresh this handover before accepting.");
    const items = await completeSnapshot(ctx, h);
    if (items.length !== h.snapshotItemCount || [...accepted].some(id => !items.some(i => i.snapshot.taskId === id && i.snapshot.proposed))) fail("INVALID_SELECTION", "Select proposed responsibilities from this handover.");
    const current: Doc<"tasks">[] = [];
    for (const item of items) {
      const task = await ctx.db.get(item.snapshot.taskId);
      if (!task || task.householdId !== h.householdId || task.version !== item.snapshot.version || task.status !== "open" || task.ownerId !== item.snapshot.ownerId) fail("STALE_HANDOVER", "A responsibility changed. Refresh the handover.");
      current.push(task);
    }
    await acceptCareFollowUps(ctx,h,args.acceptedFollowUpIds??[]);
    const now = Date.now();
    if (args.takeCoverage) {
      if (!h.coverage) return fail("INVALID_COVERAGE", "No coverage was proposed in this handover.");
      const block = await ctx.db.get(h.coverage.coverageId);
      if (!block || block.householdId !== h.householdId || block.version !== h.coverage.version || !["planned", "committed", "active"].includes(block.state) || (block.activeOwnerId && block.activeOwnerId !== h.senderId) || (block.state!=="active"&&block.plannedOwnerId&&block.plannedOwnerId!==h.senderId)) fail("STALE_HANDOVER", "Coverage changed. Refresh the handover.");
      if (block.endsAt <= now) fail("EXPIRED_COVERAGE", "The proposed coverage has ended. Refresh its end time before accepting.");
      if (household.currentCoverageId && household.currentCoverageId !== block._id) {
        const active = await ctx.db.get(household.currentCoverageId);
        if (!active || active.activeOwnerId !== h.senderId) fail("COVERAGE_CONFLICT", "Another member is currently responsible for coverage.");
        await ctx.db.patch(active._id, { state: "ended", actualEnd: now, activeOwnerId: null, version: active.version + 1, updatedAt: now, retentionUntil: now + 90 * 86400000 });
      }
      await ctx.db.patch(block._id, { state: "active", plannedOwnerId: ctx.user._id, activeOwnerId: ctx.user._id, actualStart: now, version: block.version + 1, updatedAt: now });
      await ctx.db.patch(household._id, { currentCoverageId: block._id });
    }
    const retainedTaskIds: Id<"tasks">[] = [], unassignedTaskIds: Id<"tasks">[] = [];
    for (const task of current) {
      if (accepted.has(task._id)) {
        await ctx.db.patch(task._id, { ownerId: ctx.user._id, requestedOwnerId: null, version: task.version + 1, updatedAt: now });
        await record(ctx, { householdId: h.householdId, actorId: ctx.user._id, type: "task.handoverAccepted", entity: { kind: "task", id: task._id }, before: task.ownerId ?? "unassigned", after: ctx.user._id, handoverId: h._id });
      } else if (task.ownerId === null) unassignedTaskIds.push(task._id); else retainedTaskIds.push(task._id);
    }
    const event = await record(ctx, { householdId: h.householdId, actorId: ctx.user._id, type: "handover.accepted", entity: { kind: "handover", id: h._id }, after: `${accepted.size} responsibilities accepted; ${retainedTaskIds.length} retained; ${unassignedTaskIds.length} unassigned; coverage ${args.takeCoverage ? "accepted" : "unchanged"}.`, handoverId: h._id });
    const latest = await ctx.db.get(household._id);
    const receiptId = await ctx.db.insert("handoverReceipts", { householdId: h.householdId, handoverId: h._id, senderId: h.senderId, recipientId: h.recipientId, acceptedAt: now, receiptRevision: latest!.materialRevision, eventSequence: event.sequence, tookCoverage: args.takeCoverage, transferredTaskIds: [...accepted], retainedTaskIds, unassignedTaskIds, retentionUntil: now + 90 * 86400000 });
    await ctx.db.patch(household._id, { lastReceiptId: receiptId, lastAcceptedSequence: event.sequence });
    const recipientMembership = await ctx.db.query("memberships").withIndex("by_householdId_and_userId", q => q.eq("householdId", h.householdId).eq("userId", h.recipientId)).unique();
    if (recipientMembership) await ctx.db.patch(recipientMembership._id, { lastAcceptedSequence: event.sequence, lastAcceptedAt: now });
    await ctx.db.patch(h._id, { status: "accepted", resolvedAt: now, updatedAt: now, version: h.version + 1, retentionUntil: now + 90 * 86400000 });
    await notify(ctx, { householdId: h.householdId, userId: h.senderId, target: { kind: "handover", id: h._id }, type: "handover.accepted", eventId: event.eventId, dedupeKey: `${event.eventId}:${h.senderId}` });
    return receiptId;
  },
});

export const resolve = userMutation({
  args: { handoverId: v.id("handovers"), expectedVersion: v.number(), operation: v.union(v.literal("decline"), v.literal("cancel")), reason: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const h = await ctx.db.get(args.handoverId); if (!h || h.retiring) return fail("NOT_FOUND", "Handover unavailable.");
    await member(ctx, h.householdId); checkVersion(h, args.expectedVersion);
    if (!(["draft", "pending"] as string[]).includes(h.status)) fail("INVALID_STATE", "This handover is already resolved.");
    if (args.operation === "decline" ? h.recipientId !== ctx.user._id || h.status !== "pending" : h.senderId !== ctx.user._id) fail("FORBIDDEN", "You cannot perform this action on this handover.");
    const reason = text(args.reason, "Reason", 1000);
    await ctx.db.patch(h._id, { status: args.operation === "decline" ? "declined" : "cancelled", reason, version: h.version + 1, resolvedAt: Date.now(), updatedAt: Date.now(), retentionUntil: Date.now() + 90 * 86400000 });
    const event = await record(ctx, { householdId: h.householdId, actorId: ctx.user._id, type: `handover.${args.operation}`, entity: { kind: "handover", id: h._id }, after: reason, handoverId: h._id, material: false });
    const userId = args.operation === "decline" ? h.senderId : h.recipientId;
    await notify(ctx, { householdId: h.householdId, userId, target: { kind: "handover", id: h._id }, type: `handover.${args.operation}`, eventId: event.eventId, dedupeKey: `${event.eventId}:${userId}` });
    return null;
  },
});

export const list = userQuery({
  args: { householdId: v.id("households"), status: handoverState, direction: v.union(v.literal("incoming"), v.literal("outgoing"), v.literal("all")), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("handovers")),
  handler: async (ctx, args) => {
    await member(ctx, args.householdId);
    const rows = args.direction === "incoming"
      ? ctx.db.query("handovers").withIndex("by_householdId_and_recipientId_and_status", q => q.eq("householdId", args.householdId).eq("recipientId", ctx.user._id).eq("status", args.status))
      : args.direction === "outgoing"
        ? ctx.db.query("handovers").withIndex("by_householdId_and_senderId_and_status", q => q.eq("householdId", args.householdId).eq("senderId", ctx.user._id).eq("status", args.status))
        : ctx.db.query("handovers").withIndex("by_householdId_and_status", q => q.eq("householdId", args.householdId).eq("status", args.status));
    const result = await rows.order("desc").paginate(args.paginationOpts);
    const mailAccess=await canReadMail(ctx,args.householdId,ctx.user._id);
    return { ...result, page: result.page.filter(row => !row.retiring&&(row.mailContextRestricted===false||mailAccess)) };
  },
});

export const getCareContext=userQuery({
 args:{handoverId:v.id("handovers")},
 returns:v.object({captured:v.boolean(),accessible:v.boolean(),stale:v.boolean(),newInformation:v.boolean(),snapshot:v.union(v.string(),v.null()),capturedAt:v.union(v.number(),v.null()),acceptedFollowUpIds:v.array(v.id("followUps"))}),
 handler:async(ctx,args)=>{
  const h=await ctx.db.get(args.handoverId);if(!h||h.retiring)fail("NOT_FOUND","Handover unavailable.");await member(ctx,h.householdId);
  if(h.senderId!==ctx.user._id&&h.recipientId!==ctx.user._id)return {captured:false,accessible:false,stale:false,newInformation:false,snapshot:null,capturedAt:null,acceptedFollowUpIds:[]};
  const row=await ctx.db.query("handoverCareSnapshots").withIndex("by_handoverId",q=>q.eq("handoverId",h._id)).unique();
  if(!row)return {captured:!!h.careSnapshotCaptured,accessible:false,stale:!!h.careSnapshotCaptured,newInformation:false,snapshot:null,capturedAt:null,acceptedFollowUpIds:[]};
  if(!await canReadCareHandover(ctx,row,ctx.user._id))return {captured:true,accessible:false,stale:["draft","pending"].includes(h.status),newInformation:false,snapshot:null,capturedAt:null,acceptedFollowUpIds:[]};
  let stale=false,newInformation=false;
  if(["draft","pending"].includes(h.status)){try{const current=await buildCareSnapshot(ctx,h.householdId,h.senderId,h.recipientId,row.since);stale=!current||current.fingerprint!==row.fingerprint;}catch{stale=true;}}
  if(h.status==="accepted"){try{const current=await buildCareSnapshot(ctx,h.householdId,h.senderId,h.recipientId,row.since);newInformation=!!current&&current.fingerprint!==(row.acceptedFingerprint??row.fingerprint);}catch{newInformation=true;}}
  return {captured:true,accessible:true,stale,newInformation,snapshot:row.snapshot,capturedAt:row.capturedAt,acceptedFollowUpIds:row.acceptedFollowUpIds??[]};
 }
});
