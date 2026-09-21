import {redactSourceRefs} from "./model/mailAccess";
import {requireFormerMember} from "./formerWork";
import { Temporal } from "@js-temporal/polyfill";
import {linkEvidence} from "./model/sourceUses";
import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import schema from "./schema";
import { category, taskStatus } from "./validators";
import { activeAssignee, checkVersion, fail, member, range, text, timestamp, userMutation, userQuery } from "./model/access";
import { record, notify } from "./model/events";
import { priorRequest, saveRequest } from "./model/requests";

export const get = userQuery({
  args: { taskId: v.id("tasks") }, returns: schema.doc("tasks"),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId); if (!task) return fail("NOT_FOUND", "Task unavailable.");
    await member(ctx, task.householdId); return {...task,sourceRefs:await redactSourceRefs(ctx,task.sourceRefs,ctx.user._id)};
  },
});

export const list = userQuery({
  args: { householdId: v.id("households"), status: taskStatus,
    ownership: v.optional(v.union(v.literal("all"), v.literal("mine"), v.literal("requested"), v.literal("unassigned"), v.literal("former"))),
    formerMemberId: v.optional(v.id("memberships")),
    due: v.optional(v.union(v.literal("all"), v.literal("undated"), v.literal("range"), v.literal("overdue"), v.literal("today"), v.literal("later"))),
    now: v.optional(v.number()), from: v.optional(v.number()), to: v.optional(v.number()), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("tasks")),
  handler: async (ctx, args) => {
    const { household } = await member(ctx, args.householdId);
    let formerOwnerId;
    if(args.ownership==="former"){
      if(!args.formerMemberId)return fail("FORMER_MEMBER_REQUIRED","Choose a former household member.");
      formerOwnerId=(await requireFormerMember(ctx,args.householdId,args.formerMemberId)).userId;
    }else if(args.formerMemberId)return fail("INVALID_FILTER","Choose Former member before filtering by that person.");
    let lower = args.from, upper = args.to;
    if (["overdue", "today", "later"].includes(args.due ?? "")) {
      if (args.now === undefined) fail("INVALID_TIME", "Refresh the current date filter.");
      timestamp(args.now);
      const day = Temporal.Instant.fromEpochMilliseconds(args.now).toZonedDateTimeISO(household.timezone).startOfDay();
      const end = day.add({ days: 1 }).epochMilliseconds - 1;
      lower = args.due === "overdue" ? 0 : args.due === "today" ? day.epochMilliseconds : end + 1;
      upper = args.due === "overdue" ? Math.max(0, args.now - 1) : args.due === "today" ? end : 4102444800000;
    }
    const dated = args.due && args.due !== "all" && args.due !== "undated";
    if (args.due === "range") {
      if (args.from === undefined || args.to === undefined) fail("INVALID_RANGE", "Choose a start and end date.");
      range(args.from, args.to, 366);
    }
    // The final index column is dueAt in all branches, so ownership and dates
    // select records before pagination rather than filtering a capped page.
    const rows = args.ownership === "mine" || args.ownership === "unassigned" || args.ownership === "former"
      ? ctx.db.query("tasks").withIndex("by_householdId_and_ownerId_and_status_and_dueAt", q => {
          const base = q.eq("householdId", args.householdId).eq("ownerId", args.ownership === "former" ? formerOwnerId! : args.ownership === "mine" ? ctx.user._id : null).eq("status", args.status);
          return args.due === "undated" ? base.eq("dueAt", null) : dated ? base.gte("dueAt", lower!).lte("dueAt", upper!) : base;
        })
      : args.ownership === "requested"
        ? ctx.db.query("tasks").withIndex("by_householdId_and_requestedOwnerId_and_status_and_dueAt", q => {
            const base = q.eq("householdId", args.householdId).eq("requestedOwnerId", ctx.user._id).eq("status", args.status);
            return args.due === "undated" ? base.eq("dueAt", null) : dated ? base.gte("dueAt", lower!).lte("dueAt", upper!) : base;
          })
        : ctx.db.query("tasks").withIndex("by_householdId_and_status_and_dueAt", q => {
            const base = q.eq("householdId", args.householdId).eq("status", args.status);
            return args.due === "undated" ? base.eq("dueAt", null) : dated ? base.gte("dueAt", lower!).lte("dueAt", upper!) : base;
          });
    const result=await rows.paginate(args.paginationOpts);return {...result,page:await Promise.all(result.page.map(async row=>({...row,sourceRefs:await redactSourceRefs(ctx,row.sourceRefs,ctx.user._id)})))};
  },
});

export const create = userMutation({
  args: { householdId: v.id("households"), title: v.string(), category, dueAt: v.union(v.number(), v.null()), note: v.string(), requestedOwnerId: v.union(v.id("users"), v.null()), visitId: v.optional(v.id("visits")), requestId: v.string() },
  returns: v.id("tasks"),
  handler: async (ctx, args) => {
    await member(ctx, args.householdId);
    const title = text(args.title, "Title", 160), note = text(args.note, "Note", 4000, true);
    if (args.dueAt !== null) timestamp(args.dueAt);
    if (args.requestedOwnerId) await activeAssignee(ctx, args.householdId, args.requestedOwnerId);
    if (args.visitId) { const visit = await ctx.db.get(args.visitId); if (!visit || visit.householdId !== args.householdId) fail("NOT_FOUND", "Visit unavailable."); }
    const fingerprint = JSON.stringify(args), prior = await priorRequest(ctx, "tasks.create", args.requestId, fingerprint);
    if (prior) { const id = ctx.db.normalizeId("tasks", prior.resultId); if (!id) return fail("NOT_FOUND", "Task unavailable."); return id; }
    const self = args.requestedOwnerId === ctx.user._id;
    const taskId = await ctx.db.insert("tasks", { householdId: args.householdId, title, category: args.category, dueAt: args.dueAt, note,
      ...(args.visitId ? { visitId: args.visitId } : {}), ownerId: self ? ctx.user._id : null, requestedOwnerId: self ? null : args.requestedOwnerId,
      status: "open", version: 1, sourceRefs: [], createdBy: ctx.user._id, updatedAt: Date.now() });
    const event = await record(ctx, { householdId: args.householdId, actorId: ctx.user._id, type: "task.created", entity: { kind: "task", id: taskId }, after: title });
    if (args.requestedOwnerId && !self) await notify(ctx, { householdId: args.householdId, userId: args.requestedOwnerId, target: { kind: "task", id: taskId }, type: "assignment.requested", dedupeKey: `${event.eventId}:${args.requestedOwnerId}`, eventId: event.eventId });
    await saveRequest(ctx, "tasks.create", args.requestId, fingerprint, taskId); return taskId;
  },
});

export const edit = userMutation({
  args: { taskId: v.id("tasks"), expectedVersion: v.number(), title: v.string(), category, dueAt: v.union(v.number(), v.null()), note: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId); if (!task) return fail("NOT_FOUND", "Task unavailable.");
    await member(ctx, task.householdId); checkVersion(task, args.expectedVersion);
    if (task.status !== "open") fail("INVALID_STATE", "Reopen or restore this task before editing.");
    const title = text(args.title, "Title", 160), note = text(args.note, "Note", 4000, true);
    if (args.dueAt !== null) timestamp(args.dueAt);
    await ctx.db.patch(task._id, { title, note, category: args.category, dueAt: args.dueAt, version: task.version + 1, updatedAt: Date.now(), ...(task.seriesId ? { seriesException: true } : {}) });
    await record(ctx, { householdId: task.householdId, actorId: ctx.user._id, type: "task.edited", entity: { kind: "task", id: task._id }, before: JSON.stringify({ title: task.title, note: task.note, dueAt: task.dueAt }), after: JSON.stringify({ title, note, dueAt: args.dueAt }) });
    return null;
  },
});

export const transition = userMutation({
  args: { taskId: v.id("tasks"), expectedVersion: v.number(), operation: v.union(v.literal("claim"), v.literal("release"), v.literal("complete"), v.literal("reopen"), v.literal("cancel"), v.literal("restore"), v.literal("acceptAssignment"), v.literal("declineAssignment")), reason: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId); if (!task) return fail("NOT_FOUND", "Task unavailable.");
    const { household } = await member(ctx, task.householdId); checkVersion(task, args.expectedVersion);
    const patch: Partial<typeof task> = { version: task.version + 1, updatedAt: Date.now() };
    const op = args.operation;
    if (["claim", "release", "complete", "cancel", "acceptAssignment", "declineAssignment"].includes(op) && task.status !== "open") fail("INVALID_STATE", "This task is no longer open.");
    if (op === "claim") {
      if (task.ownerId && task.ownerId !== ctx.user._id) fail("ALREADY_CLAIMED", "Another member owns this task.");
      patch.ownerId = ctx.user._id; patch.requestedOwnerId = null;
    } else if (op === "release") {
      if (task.ownerId !== ctx.user._id) fail("FORBIDDEN", "Only the current owner can release this task. Use an attributed owner override if necessary.");
      patch.ownerId = null; patch.requestedOwnerId = null;
    } else if (op === "complete") {
      patch.status = "done"; patch.completedAt = Date.now(); patch.completedBy = ctx.user._id; patch.requestedOwnerId = null; patch.retentionUntil = Date.now() + 90 * 86400000;
    } else if (op === "reopen") {
      if (task.status !== "done") fail("INVALID_STATE", "Only a completed task can be reopened.");
      text(args.reason ?? "", "Reason", 1000); patch.status = "open"; patch.retentionUntil = undefined;
    } else if (op === "cancel") {
      patch.status = "cancelled"; patch.cancelledAt = Date.now(); patch.requestedOwnerId = null; patch.retentionUntil = Date.now() + 90 * 86400000;
      if (task.seriesId) patch.seriesException = true;
    } else if (op === "restore") {
      if (task.status !== "cancelled") fail("INVALID_STATE", "Only a cancelled task can be restored.");
      patch.status = "open"; patch.retentionUntil = undefined;
      if (task.seriesId) patch.seriesException = true;
      if (task.ownerId) {
        const owner = await ctx.db.query("memberships").withIndex("by_householdId_and_userId", q => q.eq("householdId", task.householdId).eq("userId", task.ownerId!)).unique();
        if (!owner || owner.status !== "active") patch.ownerId = null;
      }
    } else {
      if (task.requestedOwnerId !== ctx.user._id) fail("FORBIDDEN", "This assignment request is for another member.");
      patch.requestedOwnerId = null;
      if (op === "acceptAssignment") patch.ownerId = ctx.user._id;
    }
    if(["reopen","restore"].includes(op))await linkEvidence(ctx,task.householdId,{kind:"task",id:task._id},task.sourceRefs);
    await ctx.db.patch(task._id, patch);
    const event = await record(ctx, { householdId: task.householdId, actorId: ctx.user._id, type: `task.${op}`, entity: { kind: "task", id: task._id }, before: `${task.status}; owner=${task.ownerId ?? "unassigned"}`, after: `${patch.status ?? task.status}; owner=${patch.ownerId === undefined ? task.ownerId ?? "unassigned" : patch.ownerId ?? "unassigned"}; ${args.reason ?? ""}` });
    if (op === "release") {
      const members = await ctx.db.query("memberships").withIndex("by_householdId_and_status", q => q.eq("householdId", household._id).eq("status", "active")).take(21);
      for (const m of members) if (m.userId !== ctx.user._id) await notify(ctx, { householdId: household._id, userId: m.userId, target: { kind: "task", id: task._id }, type: "task.unassigned", eventId: event.eventId, dedupeKey: `${event.eventId}:${m.userId}` });
    }
    return null;
  },
});

export const requestAssignment = userMutation({
  args: { taskId: v.id("tasks"), expectedVersion: v.number(), assigneeId: v.id("users"), override: v.boolean(), reason: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId); if (!task) return fail("NOT_FOUND", "Task unavailable.");
    const { household } = await member(ctx, task.householdId); checkVersion(task, args.expectedVersion);
    if (task.status !== "open") fail("INVALID_STATE", "Only open tasks can be assigned.");
    await activeAssignee(ctx, task.householdId, args.assigneeId);
    if (args.override) {
      if (household.ownerId !== ctx.user._id) fail("FORBIDDEN", "Only the household owner can override assignment.");
      text(args.reason ?? "", "Reason", 1000);
    } else if (task.ownerId && task.ownerId !== ctx.user._id) fail("FORBIDDEN", "Only the current task owner may propose its transfer.");
    const selfClaim = args.assigneeId === ctx.user._id && !task.ownerId;
    await ctx.db.patch(task._id, { ownerId: args.override || selfClaim ? args.assigneeId : task.ownerId, requestedOwnerId: args.override || selfClaim ? null : args.assigneeId, version: task.version + 1, updatedAt: Date.now() });
    const event = await record(ctx, { householdId: task.householdId, actorId: ctx.user._id, type: args.override ? "task.assignmentOverridden" : "task.assignmentRequested", entity: { kind: "task", id: task._id }, before: task.ownerId ?? "unassigned", after: `${args.assigneeId}; ${args.reason ?? ""}` });
    await notify(ctx, { householdId: task.householdId, userId: args.assigneeId, target: { kind: "task", id: task._id }, type: args.override ? "assignment.overridden" : "assignment.requested", eventId: event.eventId, dedupeKey: `${event.eventId}:${args.assigneeId}` });
    return null;
  },
});
