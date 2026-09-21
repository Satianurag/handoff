import { requireMailAccess, requireSourceAccess, canReadMail } from "./model/mailAccess";
import { sameEntity } from "./model/entities";
import {linkEvidence} from "./model/sourceUses";
import { queueOperation } from "./model/operations";
import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx, env } from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel";
import schema from "./schema";
import { checkVersion, fail, internalUserMutation, member, text } from "./model/access";
import { contentHash, validateEvidence } from "./model/mail";
import { digest } from "./model/sourceText";
import { limits, numericSetting, modelDayConfig } from "./model/limits";
import { notify, record } from "./model/events";
import { PROMPT_VERSION, SCHEMA_VERSION, type Operation } from "./model/generationContract";
import { redactIdentifiers, validateExtraction, validateQuestion, validateIntroduction } from "./model/generationValidation";
import { entity } from "./validators";

async function activeAi(ctx: QueryCtx | MutationCtx, householdId: Id<"households">, userId: Id<"users"> | null, now: number) {
  const household = await ctx.db.get(householdId);
  if (!household || household.status !== "active" || !household.aiProcessing || (household.expiresAt && household.expiresAt <= now)) return fail("AI_PAUSED", "Automatic processing is paused; your board still works.");
  if (userId) {
    const membership = await ctx.db.query("memberships").withIndex("by_householdId_and_userId", q => q.eq("householdId", householdId).eq("userId", userId)).unique();
    if (!membership || membership.status !== "active" || membership.accessPreset === "limited_helper") return fail("NOT_FOUND", "Household unavailable.");
  }
  return household;
}

async function enqueue(ctx: MutationCtx, args: { householdId: Id<"households">; actorId: Id<"users"> | null; operation: Operation; expectedVersion: number; instruction: string; sourceId?: Id<"sources">; draftId?: Id<"mailDrafts">; handoverId?: Id<"handovers">; fingerprint: string; target: Doc<"jobs">["target"] }) {
  const household = await activeAi(ctx, args.householdId, args.actorId, Date.now());
  const provider = env.GENERATION_PROVIDER ?? "gemini", model = provider === "gemini" ? env.GEMINI_MODEL ?? "gemini-3.8-flash" : env.OPENAI_MODEL;
  if (!model) return fail("MODEL_CONFIGURATION_REQUIRED", "Choose and verify a generation model first.");
  const inputHash = digest(JSON.stringify([args.operation, args.fingerprint, args.instruction, args.expectedVersion, provider, model, PROMPT_VERSION, SCHEMA_VERSION, household.consentVersion]));
  const operationKey = `generate:${args.operation}:${inputHash}`;
  const prior = await ctx.db.query("jobs").withIndex("by_householdId_and_operationKey", q => q.eq("householdId", household._id).eq("operationKey", operationKey)).unique();
  if (prior) {
    if (prior.state === "failed" && prior.retryAt && prior.retryAt > Date.now()) return fail("MODEL_COOLDOWN", "Automatic processing is waiting for its retry time. You can still edit confirmed details manually.");
    if(!prior.workflowId&&args.actorId&&["failed","cancelled"].includes(prior.state))await ctx.db.patch(prior._id,{state:"queued",requestedBy:args.actorId,updatedAt:Date.now(),retryAt:undefined});
    return prior._id;
  }
  const now = Date.now();
  const jobId = await ctx.db.insert("jobs", { householdId: household._id, operationKey, kind: args.operation, requestedBy: args.actorId, target: args.target, state: "queued", attempts: 0, createdAt: now, updatedAt: now, consentVersion: household.consentVersion });
  await ctx.db.insert("generationRuns", { householdId: household._id, jobId, operation: args.operation, expectedVersion: args.expectedVersion, instruction: args.instruction, ...(args.sourceId ? { sourceId: args.sourceId } : {}), ...(args.draftId ? { draftId: args.draftId } : {}), ...(args.handoverId ? { handoverId: args.handoverId } : {}), provider, model, state: "queued", promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION, inputHash, createdAt: now });
  return jobId;
}

async function extractionRequest(ctx: MutationCtx, sourceId: Id<"sources">, actorId: Id<"users"> | null) {
  const source = await ctx.db.get(sourceId); if (!source) return fail("NOT_FOUND", "Source unavailable.");
  if (source.retiring || ["quarantined", "unsupported"].includes(source.extractionState) || !source.plaintext.trim()) return fail("SOURCE_UNSUPPORTED", "This source needs manual review.");
  const thread = source.threadId ? await ctx.db.get(source.threadId) : null;
  if (source.threadId && (!thread || thread.quarantined || thread.deleting)) return fail("SOURCE_UNSUPPORTED", "This source needs manual review.");
  const household = await activeAi(ctx, source.householdId, actorId, Date.now());
  if (source.kind === "email" && !household.emailImport) return fail("EMAIL_DISABLED", "Email processing is paused.");
  const watch = source.watchId ? await ctx.db.get(source.watchId) : null;
  const target = watch ? await ctx.db.get(watch.visitId) : thread?.related?.kind === "visit" || thread?.related?.kind === "task" ? await ctx.db.get(thread.related.id) : null;
  return enqueue(ctx, { householdId: source.householdId, actorId, operation: "extractLogistics", expectedVersion: source.version, instruction: "", sourceId, fingerprint: `${source._id}:${source.contentHash}:${source.previousSourceId ?? ""}:${target?._id ?? ""}:${target?.version ?? 0}`, target: { kind: "source", id: source._id } });
}

export const requestExtraction = internalUserMutation({ args: { sourceId: v.id("sources") }, returns: v.id("jobs"), handler: async (ctx, args) => { const source = await ctx.db.get(args.sourceId); if (!source) return fail("NOT_FOUND", "Source unavailable."); await requireSourceAccess(ctx,source); return extractionRequest(ctx, args.sourceId, ctx.user._id); } });
export const requestSourceInternal = internalMutation({ args: { sourceId: v.id("sources") }, returns: v.id("jobs"), handler: async (ctx, args) => extractionRequest(ctx, args.sourceId, null) });
export const requestQuestion = internalUserMutation({
  args: { draftId: v.id("mailDrafts"), expectedVersion: v.number(), instruction: v.string() }, returns: v.id("jobs"),
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId); if (!draft) return fail("NOT_FOUND", "Draft unavailable.");
    await requireMailAccess(ctx,draft.householdId); checkVersion(draft, args.expectedVersion);
    if (draft.correctionDraftId || draft.state !== "editable" || draft.syncToken) return fail("DRAFT_LOCKED", "Wait for the draft to be editable before generating.");
    return enqueue(ctx, { householdId: draft.householdId, actorId: ctx.user._id, operation: "draftQuestion", expectedVersion: draft.version, instruction: text(args.instruction, "Question", 2000), draftId: draft._id, fingerprint: `${draft._id}:${draft.contentHash}:${JSON.stringify(draft.sourceRefs)}`, target: draft.threadId ? { kind: "thread", id: draft.threadId } : draft.related ?? { kind: "household", id: draft.householdId } });
  },
});
export const requestIntroduction = internalUserMutation({
  args: { handoverId: v.id("handovers"), expectedVersion: v.number() }, returns: v.id("jobs"),
  handler: async (ctx, args) => {
    const handover = await ctx.db.get(args.handoverId); if (!handover) return fail("NOT_FOUND", "Handover unavailable.");
    const { household } = await member(ctx, handover.householdId); checkVersion(handover, args.expectedVersion);
    if (handover.senderId !== ctx.user._id || handover.status !== "draft" || handover.baseMaterialRevision !== household.materialRevision) return fail("STALE_HANDOVER", "Refresh the unpublished handover before generating an introduction.");
    return enqueue(ctx, { householdId: household._id, actorId: ctx.user._id, operation: "introduceHandover", expectedVersion: handover.version, instruction: "", handoverId: handover._id, fingerprint: `${handover._id}:${handover.version}:${handover.baseMaterialRevision}`, target: { kind: "handover", id: handover._id } });
  },
});

const contextValidator = v.object({
  run: schema.doc("generationRuns"), job: schema.doc("jobs"), household: schema.doc("households"),
  source: v.union(schema.doc("sources"), v.null()), previous: v.union(schema.doc("sources"), v.null()),
  draft: v.union(schema.doc("mailDrafts"), v.null()), handover: v.union(schema.doc("handovers"), v.null()),
  sources: v.array(schema.doc("sources")), eventIds: v.array(v.string()), input: v.string(),
  target: v.union(entity, v.null()), targetVersion: v.union(v.number(), v.null()), timezone: v.union(v.string(), v.null()),
});
async function context(ctx: QueryCtx | MutationCtx, jobId: Id<"jobs">, now: number) {
  const run = await ctx.db.query("generationRuns").withIndex("by_jobId", q => q.eq("jobId", jobId)).unique();
  const job = await ctx.db.get(jobId); if (!job || !run) return fail("NOT_FOUND", "Generation unavailable.");
  const currentProvider = env.GENERATION_PROVIDER ?? "gemini";
  const currentModel = currentProvider === "gemini" ? env.GEMINI_MODEL ?? "gemini-3.8-flash" : env.OPENAI_MODEL;
  if (run.promptVersion !== PROMPT_VERSION || run.schemaVersion !== SCHEMA_VERSION || run.provider !== currentProvider || run.model !== currentModel) return fail("GENERATION_VERSION_CHANGED", "Generation configuration changed. Request a new review using the current version.");
  const household = await activeAi(ctx, job.householdId, job.requestedBy, now);
  if (job.consentVersion !== household.consentVersion) return fail("CONSENT_CHANGED", "Processing permission changed. Request generation again.");
  const source = run.sourceId ? await ctx.db.get(run.sourceId) : null, draft = run.draftId ? await ctx.db.get(run.draftId) : null, handover = run.handoverId ? await ctx.db.get(run.handoverId) : null;
  if(job.requestedBy&&(draft||source?.kind==="email")&&!await canReadMail(ctx,household._id,job.requestedBy))return fail("CARE_ACCESS_REQUIRED","Access to private email changed before processing.");
  const names = [household.nickname];
  const previous = source?.previousSourceId ? await ctx.db.get(source.previousSourceId) : null;
  let target: Doc<"jobs">["target"] = null, targetVersion: number | null = null, timezone: string | null = null;
  const sources: Doc<"sources">[] = [];
  let input: string, eventIds: string[] = [];
  if (run.operation === "extractLogistics") {
    if (!source || source.retiring || source.householdId !== household._id || source.version !== run.expectedVersion || ["quarantined", "unsupported"].includes(source.extractionState)) return fail("SOURCE_CHANGED", "Source changed or is unavailable for automatic processing.");
    if (source.kind === "email" && !household.emailImport) return fail("EMAIL_DISABLED", "Email processing is paused.");
    if (source.watchId) { const watch = await ctx.db.get(source.watchId); if (watch && watch.householdId === household._id) target = { kind: "visit", id: watch.visitId }; }
    if (source.threadId) { const thread = await ctx.db.get(source.threadId); if (!thread || thread.deleting || thread.quarantined) return fail("SOURCE_CHANGED", "Source conversation unavailable."); target = thread.related; }
    let targetContext: { kind: string; title: string; address?: string } | null = null;
    if (target?.kind === "visit") { const visit = await ctx.db.get(target.id); if (!visit || visit.householdId !== household._id || visit.status !== "upcoming") return fail("TARGET_CHANGED", "The matching visit is no longer upcoming."); targetVersion = visit.version; timezone = visit.timezone; targetContext = { kind: "visit", title: redactIdentifiers(visit.title, names), address: visit.confirmedAddress }; }
    else if (target?.kind === "task") { const task = await ctx.db.get(target.id); if (!task || task.householdId !== household._id || task.status !== "open") return fail("TARGET_CHANGED", "The matching task is no longer open."); targetVersion = task.version; targetContext = { kind: "task", title: redactIdentifiers(task.title, names) }; }
    else target = null;
    input = JSON.stringify({ operation: run.operation, target: targetContext, confirmedTimezone: timezone, source: { sourceId: "S1", kind: source.kind, capturedAt: source.publishedAt ?? source.capturedAt, text: redactIdentifiers(source.plaintext, names), previousText: previous ? redactIdentifiers(previous.plaintext, names) : null }, comparison: source.comparison ?? "baseline" });
  } else if (run.operation === "draftQuestion") {
    if (!draft || draft.householdId !== household._id || draft.version !== run.expectedVersion || draft.correctionDraftId || draft.state !== "editable" || draft.syncToken) return fail("DRAFT_CHANGED", "Draft changed. Request generation again.");
    if (!household.emailImport) return fail("EMAIL_DISABLED", "Email processing is paused.");
    for (const ref of draft.sourceRefs) { const s = await ctx.db.get(ref.sourceId); if (!s || s.retiring || s.householdId !== household._id || ["quarantined", "unsupported"].includes(s.extractionState)) return fail("SOURCE_CHANGED", "A draft source is unavailable."); if (!sources.some(row => row._id === s._id)) sources.push(s); }
    input = JSON.stringify({ operation: run.operation, question: redactIdentifiers(run.instruction, names), currentDraft: { subject: redactIdentifiers(draft.subject, names), body: redactIdentifiers(draft.body, names) }, sources: sources.map((s, i) => ({ sourceId: `S${i + 1}`, text: redactIdentifiers(s.plaintext, names) })) });
  } else {
    if (!handover || handover.householdId !== household._id || handover.version !== run.expectedVersion || handover.status !== "draft" || handover.senderId !== job.requestedBy || handover.baseMaterialRevision !== household.materialRevision) return fail("HANDOVER_CHANGED", "Refresh the handover before generating again.");
    const changes = await ctx.db.query("handoverChanges").withIndex("by_handoverId", q => q.eq("handoverId", handover._id)).order("desc").take(20);
    const events = changes.filter(c => c.kind === "event"); eventIds = events.map((_, i) => `E${i + 1}`);
    input = JSON.stringify({ operation: run.operation, responsibilityCount: handover.snapshotItemCount, materialChangeCount: handover.snapshotChangeCount, unreviewedProposalCount: handover.snapshotProposalCount, changesArePartial: handover.snapshotChangeCount > events.length, recentEvents: events.map((e, i) => ({ eventId: `E${i + 1}`, summary: redactIdentifiers(e.summary, names) })), note: redactIdentifiers(handover.note, names), ownershipHasNotTransferred: true });
  }
  if (new TextEncoder().encode(input).length > 120000) return fail("CONTEXT_TOO_LARGE", "This evidence exceeds the automatic review limit. Review it manually or use fewer excerpts.");
  return { run, job, household, source, previous, draft, handover, sources, eventIds, input, target, targetVersion, timezone };
}
export const read = internalQuery({ args: { jobId: v.id("jobs"), now: v.number() }, returns: contextValidator, handler: async (ctx, args) => context(ctx, args.jobId, args.now) });

export const claim = internalMutation({
  args: { jobId: v.id("jobs"), inputBytes: v.number() }, returns: v.boolean(),
  handler: async (ctx, args) => {
    const { run, job } = await context(ctx, args.jobId, Date.now());
    if (!["queued", "failed"].includes(job.state)) return false;
    if (run.retryAfterAt && run.retryAfterAt > Date.now()) return false;
    if (!Number.isInteger(args.inputBytes) || args.inputBytes < 1 || args.inputBytes > 200000) return fail("INVALID_BUDGET", "Invalid generation input size.");
    const day = new Date().toISOString().slice(0, 10), inputBudget = await numericSetting(ctx, "dailyModelInputTokens", 1000000, 1000000000), outputBudget = await numericSetting(ctx, "dailyModelOutputTokens", 100000, 1000000000);
    // UTF-8 bytes are a conservative text-token reservation. Full documented
    // model output capacity is reserved; no max-token clamp is sent to Gemini.
    const reservedInput = args.inputBytes + 2048;
    const openaiCapacity = run.provider === "openai" ? await ctx.db.query("operatorSettings").withIndex("by_key", q => q.eq("key", "verifiedOpenAiOutputCapacity")).unique() : null;
    if (run.provider === "openai" && (!openaiCapacity?.enabled || !openaiCapacity.numericValue)) return fail("MODEL_REVALIDATION_REQUIRED", "Verify the selected OpenAI model's output capacity before switching runtime providers.");
    const reservedOutput = run.provider === "gemini" ? 65536 : openaiCapacity!.numericValue!;
    await limits.limit(ctx, "modelInput", { key: day, count: reservedInput, config: await modelDayConfig(ctx,"modelInput",day,day,inputBudget), throws: true });
    await limits.limit(ctx, "modelOutput", { key: day, count: reservedOutput, config: await modelDayConfig(ctx,"modelOutput",day,day,outputBudget), throws: true });
    await limits.limit(ctx, "householdGenerations", { key: `${job.householdId}:${day}`, config: await modelDayConfig(ctx,"householdGenerations",`${job.householdId}:${day}`,day,await numericSetting(ctx,"dailyHouseholdGenerations",40)), throws: true });
    await ctx.db.patch(job._id, { state: "running", attempts: job.attempts + 1, updatedAt: Date.now(), safeError: undefined, retryAt: undefined });
    await ctx.db.patch(run._id, { state: "running", reservedInput, reservedOutput, budgetDay: day, safeError: undefined });
    if (run.sourceId) await ctx.db.patch(run.sourceId, { extractionState: "processing" });
    return true;
  },
});

async function settle(ctx: MutationCtx, run: Doc<"generationRuns">, usage: { input: number; output: number }) {
  if (!run.budgetDay || run.reservedInput === undefined || run.reservedOutput === undefined) return;
  for (const [name, actual, reserved, setting, fallback] of [["modelInput", usage.input, run.reservedInput, "dailyModelInputTokens", 1000000], ["modelOutput", usage.output, run.reservedOutput, "dailyModelOutputTokens", 100000]] as const) {
    if (!Number.isSafeInteger(actual) || actual < 0 || actual > 2000000) return fail("INVALID_USAGE", "Provider usage metadata is invalid.");
    const adjustment = actual - reserved;
    await limits.limit(ctx, name, { key: run.budgetDay, count: adjustment, reserve: adjustment > 0, config: await modelDayConfig(ctx,name,run.budgetDay,run.budgetDay,await numericSetting(ctx,setting,fallback,1000000000)) });
  }
}

export const finish = internalMutation({
  args: { jobId: v.id("jobs"), json: v.string(), inputHash: v.string(), target: v.union(entity, v.null()), targetVersion: v.union(v.number(), v.null()), inputTokens: v.number(), outputTokens: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    const c = await context(ctx, args.jobId, Date.now());
    if (c.run.state !== "running" || c.job.state !== "running") return null;
    if (digest(c.input) !== args.inputHash || !sameEntity(c.target, args.target) || c.targetVersion !== args.targetVersion) return fail("CONTEXT_CHANGED", "The evidence changed while generation ran. No generated changes were applied.");
    if (args.json.length > 200000) return fail("MODEL_OUTPUT_TOO_LARGE", "Generated output needs manual review.");
    let raw: unknown;
    try { raw = JSON.parse(args.json); } catch { return fail("MODEL_SCHEMA_INVALID", "Generated output was not valid structured data."); }
    if (c.run.operation === "extractLogistics" && c.source) {
      const verified = validateExtraction(raw, { sourceId: "S1", plaintext: c.source.plaintext, kind: c.source.kind, capturedAt: c.source.publishedAt ?? c.source.capturedAt, ...(c.previous ? { previousText: c.previous.plaintext } : {}), ...(c.timezone ? { timezone: c.timezone } : {}) });
      const existing = await ctx.db.query("proposals").withIndex("by_sourceId", q => q.eq("sourceId", c.source!._id)).take(101);
      if (existing.length > 100) return fail("PROPOSAL_LIMIT", "Review the existing proposals first.");
      let added = 0, invalidated = 0;
      for(const prior of existing){
        if(prior.status==="pending"&&(!sameEntity(prior.target,c.target)||prior.targetVersion!==c.targetVersion)){
          await ctx.db.patch(prior._id,{status:"invalid",reason:"Source match or confirmed item version changed. Review the new extraction.",version:prior.version+1});invalidated++;
        }
      }
      const targetRow = c.target?.kind === "visit" || c.target?.kind === "task" ? await ctx.db.get(c.target.id) : null;
      for (const p of verified.proposals) {
        if (c.target?.kind === "visit" && ["dueAt"].includes(p.field) || c.target?.kind === "task" && ["startsAt", "address", "phone"].includes(p.field)) continue;
        if (existing.some(e => e.status!=="invalid"&&sameEntity(e.target,c.target)&&e.targetVersion===c.targetVersion&&e.field === p.field && e.proposedValue === p.proposedValue && e.quote === p.quote)) continue;
        let previousValue: string | number | null = null;
        if (targetRow) {
          if (p.field === "startsAt" && "confirmedStartsAt" in targetRow) previousValue = targetRow.confirmedStartsAt;
          else if (p.field === "address" && "confirmedAddress" in targetRow) previousValue = targetRow.confirmedAddress;
          else if (p.field === "phone" && "phone" in targetRow) previousValue = targetRow.phone;
          else if (p.field === "dueAt" && "dueAt" in targetRow) previousValue = targetRow.dueAt;
          else if (p.field === "title" || p.field === "note") previousValue = targetRow[p.field];
        }
        if (previousValue === p.proposedValue) continue;
        await ctx.db.insert("proposals", { householdId: c.household._id, sourceId: c.source._id, target: c.target, targetVersion: c.targetVersion, field: p.field, proposedValue: p.proposedValue, previousValue, ...(p.rawDateText ? { rawDateText: p.rawDateText } : {}), quote: p.quote, quoteStart: p.start, quoteEnd: p.end, status: "pending", version: 1 }); added++;
      }
      await ctx.db.patch(c.source._id, { extractionState: "ready", unresolvedReferences: Math.max(0,c.source.unresolvedReferences + added - invalidated), warnings: [...c.source.warnings.filter(s => !s.startsWith("AI review:")), ...(verified.rejected ? [`AI review: ${verified.rejected} unsupported candidate(s) were withheld.`] : []), ...(verified.abstentionReason ? ["AI review: No supported change could be established for part or all of this source; review the original manually."] : [])] });
      if (added) {
        const { eventId } = await record(ctx, { householdId: c.household._id, actorId: null, type: "source.proposalsReady", entity: { kind: "source", id: c.source._id }, after: `${added} logistical changes need review; confirmed information is unchanged.` });
        const members = await ctx.db.query("memberships").withIndex("by_householdId_and_status", q => q.eq("householdId", c.household._id).eq("status", "active")).take(21);
        for (const m of members) await notify(ctx, { householdId: c.household._id, userId: m.userId, target: { kind: "source", id: c.source._id }, type: "source.review", eventId, dedupeKey: `generation:${c.run._id}:${m.userId}` });
      }
    } else if (c.run.operation === "draftQuestion" && c.draft) {
      const verified = validateQuestion(raw, c.sources.map((s, i) => ({ sourceId: `S${i + 1}`, plaintext: s.plaintext })));
      const refs = verified.references.map(ref => ({ sourceId: c.sources[Number(ref.sourceId.slice(1)) - 1]._id, quote: ref.quote, start: ref.start, end: ref.end }));
      await validateEvidence(ctx, c.household._id, refs);
      await ctx.db.patch(c.draft._id, { subject: verified.subject, body: verified.body, sourceRefs: refs, contentHash: contentHash(c.draft.recipient, verified.subject, verified.body, c.draft.inReplyTo), version: c.draft.version + 1, providerSyncedVersion: undefined, updatedAt: Date.now(), lastError: undefined });
      await linkEvidence(ctx,c.draft.householdId,{kind:"draft",id:c.draft._id},refs);
      await queueOperation(ctx,{householdId:c.draft.householdId,kind:"syncDraft",key:`draft:${c.draft._id}:${c.draft.version+1}`,draftId:c.draft._id,actorId:c.draft.editorId,target:c.draft.threadId?{kind:"thread",id:c.draft.threadId}:c.draft.related,automatic:true});
    } else if (c.run.operation === "introduceHandover" && c.handover) {
      const verified = validateIntroduction(raw, c.eventIds);
      const changes = await ctx.db.query("handoverChanges").withIndex("by_handoverId", q => q.eq("handoverId", c.handover!._id)).order("desc").take(20);
      const events = changes.filter(change => change.kind === "event");
      const introductionEventIds: Id<"events">[] = [];
      for (const alias of verified.eventIds) {
        const id = ctx.db.normalizeId("events", events[Number(alias.slice(1)) - 1]?.referenceId ?? "");
        const event = id ? await ctx.db.get(id) : null;
        if (!event || event.householdId !== c.household._id) return fail("EVENT_REMOVED", "A referenced handover event is unavailable.");
        introductionEventIds.push(event._id);
      }
      await ctx.db.patch(c.handover._id, { introduction: verified.introduction, introductionEventIds, version: c.handover.version + 1, updatedAt: Date.now() });
    }
    await settle(ctx, c.run, { input: args.inputTokens, output: args.outputTokens });
    await ctx.db.patch(c.run._id, { state: "succeeded", inputTokens: args.inputTokens, outputTokens: args.outputTokens, completedAt: Date.now(), reservedInput: undefined, reservedOutput: undefined });
    await ctx.db.patch(c.job._id, { state: "succeeded", updatedAt: Date.now(), safeError: undefined });
    return null;
  },
});

export const failed = internalMutation({
  args: { jobId: v.id("jobs"), reason: v.string(), inputTokens: v.optional(v.number()), outputTokens: v.optional(v.number()), onlyIfUnstarted: v.optional(v.boolean()), retryable: v.optional(v.boolean()), retryAfterAt: v.optional(v.number()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.query("generationRuns").withIndex("by_jobId", q => q.eq("jobId", args.jobId)).unique(), job = await ctx.db.get(args.jobId);
    if (!run || !job || job.state === "succeeded" || job.state === "cancelled") return null;
    if (args.onlyIfUnstarted && (run.state === "running" || run.reservedInput !== undefined)) return null;
    const reason = /^[A-Z_0-9]{1,80}$/.test(args.reason) ? args.reason : "MODEL_OPERATION_FAILED";
    if (args.inputTokens !== undefined && args.outputTokens !== undefined) await settle(ctx, run, { input: args.inputTokens, output: args.outputTokens });
    await ctx.db.patch(run._id, { state: "failed", safeError: reason, completedAt: Date.now(), retryable: args.retryable ?? false, retryAfterAt: args.retryAfterAt, ...(args.inputTokens !== undefined ? { inputTokens: args.inputTokens, outputTokens: args.outputTokens, reservedInput: undefined, reservedOutput: undefined } : {}) });
    const safeError = reason === "MODEL_DAILY_LIMIT" ? "Today’s automatic-processing limit has been reached. Try again after the retry time; you can still edit confirmed details manually." : "Automatic processing could not complete. Manual coordination still works. Retry after checking the original source.";
    await ctx.db.patch(job._id, { state: "failed", safeError, updatedAt: Date.now(), retryAt: args.retryAfterAt });
    if (run.sourceId) {
      const source = await ctx.db.get(run.sourceId),household=await ctx.db.get(job.householdId);
      if(source&&["processing","pending"].includes(source.extractionState))await ctx.db.patch(source._id,{extractionState:!household?.aiProcessing||(source.kind==="email"&&!household.emailImport)||household.consentVersion!==job.consentVersion?"paused":"failed"});
    }
    return null;
  },
});
