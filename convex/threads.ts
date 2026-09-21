import {receivedForFollowUp} from "./followUpMailAccess";
import { requireMailAccess, canReadMail } from "./model/mailAccess";
import {internal} from "./_generated/api";
import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import schema from "./schema";
import { entity } from "./validators";
import { authorizeEntity } from "./model/entities";
import { checkVersion, email, fail, member, userMutation, userQuery } from "./model/access";
import { record } from "./model/events";

export const get = userQuery({
  args: { threadId: v.id("mailThreads") }, returns: schema.doc("mailThreads"),
  handler: async (ctx, args) => { const thread = await ctx.db.get(args.threadId); if (!thread || thread.deleting) return fail("NOT_FOUND", "Thread unavailable."); await requireMailAccess(ctx, thread.householdId); return thread; },
});

export const messages = userQuery({
  args: { threadId: v.id("mailThreads"), paginationOpts: paginationOptsValidator }, returns: paginationResultValidator(schema.doc("mailMessages")),
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId); if (!thread || thread.deleting) return fail("NOT_FOUND", "Thread unavailable."); await requireMailAccess(ctx, thread.householdId);
    return ctx.db.query("mailMessages").withIndex("by_threadId_and_occurredAt", q => q.eq("threadId", thread._id)).paginate(args.paginationOpts);
  },
});

// Start at the newest messages, then let the reader load earlier context.
export const recentMessages = userQuery({
  args: { threadId: v.id("mailThreads"), paginationOpts: paginationOptsValidator }, returns: paginationResultValidator(schema.doc("mailMessages")),
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId); if (!thread || thread.deleting) return fail("NOT_FOUND", "Thread unavailable.");
    await requireMailAccess(ctx, thread.householdId);
    return ctx.db.query("mailMessages").withIndex("by_threadId_and_occurredAt", q => q.eq("threadId", thread._id)).order("desc").paginate(args.paginationOpts);
  },
});

export const update = userMutation({
  args: { threadId: v.id("mailThreads"), expectedVersion: v.number(), operation: v.union(v.literal("archive"), v.literal("unarchive"), v.literal("resolve"), v.literal("reopen")) }, returns: v.null(),
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId); if (!thread || thread.deleting) return fail("NOT_FOUND", "Thread unavailable.");
    await requireMailAccess(ctx, thread.householdId); checkVersion(thread, args.expectedVersion);
    const change = args.operation === "archive" ? { archived: true } : args.operation === "unarchive" ? { archived: false } : { state: args.operation === "resolve" ? "resolved" as const : "new" as const };
    await ctx.db.patch(thread._id, { ...change, version: thread.version + 1 });
    await record(ctx, { householdId: thread.householdId, actorId: ctx.user._id, type: `thread.${args.operation}`, entity: { kind: "thread", id: thread._id }, after: args.operation });
    return null;
  },
});

export const attach = userMutation({
  args: { threadId: v.id("mailThreads"), expectedVersion: v.number(), related: v.union(entity, v.null()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId); if (!thread || thread.deleting) return fail("NOT_FOUND", "Thread unavailable.");
    await requireMailAccess(ctx,thread.householdId);await authorizeEntity(ctx, thread.householdId, args.related); checkVersion(thread, args.expectedVersion);
    const {household}=await requireMailAccess(ctx, thread.householdId);
    if (args.related && !["task", "visit"].includes(args.related.kind)) fail("INVALID_TARGET", "Attach a question to a task or visit.");
    const sources=await ctx.db.query("sources").withIndex("by_threadId",q=>q.eq("threadId",thread._id)).take(101);
    if(sources.length>100)fail("THREAD_TOO_LARGE","Split or remove older messages before changing the match; no sources were omitted.");
    await ctx.db.patch(thread._id, { related: args.related, version: thread.version + 1 });
    for(const source of sources){
      if(source.retiring||["quarantined","unsupported"].includes(source.extractionState))continue;
      const extractionState=household.aiProcessing&&household.emailImport&&!thread.quarantined?"pending":"paused";
      await ctx.db.patch(source._id,{version:source.version+1,extractionState});
      if(extractionState==="pending")await ctx.runMutation(internal.operationStore.extractSource,{sourceId:source._id});
    }
    await record(ctx, { householdId: thread.householdId, actorId: ctx.user._id, type: "thread.attached", entity: { kind: "thread", id: thread._id }, after: args.related ? `${args.related.kind}:${args.related.id}` : "Detached" });
    return null;
  },
});

export const releaseQuarantine = userMutation({
  args: { threadId: v.id("mailThreads"), expectedVersion: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId); if (!thread || thread.deleting) return fail("NOT_FOUND", "Thread unavailable.");
    const {household}=await requireMailAccess(ctx, thread.householdId); checkVersion(thread, args.expectedVersion);
    if (!thread.quarantined) return null;
    const messages = await ctx.db.query("mailMessages").withIndex("by_threadId_and_occurredAt", q => q.eq("threadId", thread._id)).take(101);
    if (messages.length > 100) fail("THREAD_TOO_LARGE", "Review a smaller message group before releasing this thread.");
    for (const message of messages) {
      if (message.direction !== "inbound") continue;
      const contact = await ctx.db.query("contacts").withIndex("by_householdId_and_email", q => q.eq("householdId", thread.householdId).eq("email", email(message.from))).unique();
      if (!contact || contact.state !== "approved" || !contact.allowReceive) fail("CONTACT_NOT_APPROVED", "Explicitly approve each actual sender before releasing this thread.");
    }
    await ctx.db.patch(thread._id, { quarantined: false, state: "new", version: thread.version + 1 });
    for(const message of messages){
      if(!message.sourceId)continue;
      const source=await ctx.db.get(message.sourceId);if(!source||source.extractionState!=="quarantined")continue;
      const state=!source.plaintext.trim()?"unsupported":household.emailImport&&household.aiProcessing?"pending":"paused";
      await ctx.db.patch(source._id,{extractionState:state});
      if(state==="pending")await ctx.runMutation(internal.operationStore.extractSource,{sourceId:source._id});
    }
    if(thread.quarantined&&thread.lastInboundAt)await receivedForFollowUp(ctx,thread);
    await record(ctx, { householdId: thread.householdId, actorId: ctx.user._id, type: "thread.quarantineReleased", entity: { kind: "thread", id: thread._id }, after: "Actual senders reviewed; content still awaits source review." }); return null;
  },
});

export const forEntity = userQuery({
  args: { householdId: v.id("households"), target: entity, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("mailThreads")),
  handler: async (ctx, args) => {
    await member(ctx,args.householdId);if(!await canReadMail(ctx,args.householdId,ctx.user._id))return {page:[],isDone:true,continueCursor:""};await authorizeEntity(ctx, args.householdId, args.target);
    const result = await ctx.db.query("mailThreads").withIndex("by_householdId_and_related_and_lastMessageAt", q => q.eq("householdId", args.householdId).eq("related", args.target)).order("desc").paginate(args.paginationOpts);
    return { ...result, page: result.page.filter(row => !row.deleting) };
  },
});

export const replyContext = userQuery({
  args: { threadId: v.id("mailThreads") }, returns: v.union(schema.doc("mailMessages"), v.null()),
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.deleting) return fail("NOT_FOUND", "Conversation unavailable.");
    await requireMailAccess(ctx, thread.householdId);
    return ctx.db.query("mailMessages").withIndex("by_threadId_and_direction_and_occurredAt", q => q.eq("threadId", thread._id).eq("direction", "inbound")).order("desc").first();
  },
});
