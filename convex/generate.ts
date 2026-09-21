"use node";
import { z } from "zod";
import { v } from "convex/values";
import { isRateLimitError } from "@convex-dev/rate-limiter";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { generationClient, GenerationError, type ResponseResult } from "./model/responses";
import { schemas, systemInstruction } from "./model/generationContract";
import { digest } from "./model/sourceText";

async function perform(ctx: ActionCtx, jobId: Id<"jobs">): Promise<void> {
  let response: ResponseResult | undefined, claimed = false, attempt = 1;
  try {
    const state = await ctx.runQuery(internal.generationStore.read, { jobId, now: Date.now() });
    attempt = state.job.attempts + 1;
    if (!["queued", "failed"].includes(state.job.state)) return;
    const { $schema: _jsonSchemaDialect, ...jsonSchema } = z.toJSONSchema(schemas[state.run.operation], { target: "draft-07" });
    claimed = await ctx.runMutation(internal.generationStore.claim, { jobId, inputBytes: new TextEncoder().encode(state.input + systemInstruction + JSON.stringify(jsonSchema)).length });
    if (!claimed) return;
    response = await generationClient.responses.create({ model: state.run.model, input: state.input, instructions: systemInstruction, store: false, text: { format: { type: "json_schema", name: state.run.operation, schema: jsonSchema, strict: true } } });
    if (response.refusal) throw new GenerationError("MODEL_REFUSED");
    if (response.status !== "completed" || !response.output_text) throw new GenerationError("MODEL_INCOMPLETE");
    await ctx.runMutation(internal.generationStore.finish, { jobId, json: response.output_text, inputHash: digest(state.input), target: state.target, targetVersion: state.targetVersion, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });
  } catch (error) {
    const budgetLimited = !claimed && isRateLimitError(error) && ["modelInput", "modelOutput", "householdGenerations"].includes(error.data.name) && Number.isFinite(error.data.retryAfter) && error.data.retryAfter >= 0;
    const rejectedBeforeGeneration = error instanceof GenerationError && ["MODEL_HTTP_400", "MODEL_HTTP_401", "MODEL_HTTP_403", "MODEL_HTTP_429"].includes(error.code);
    const backoff = Math.min(300000, 30000 * 2 ** Math.min(attempt - 1, 4)) + Math.floor(Math.random() * 1000);
    // Daily allowance failures require a fresh user request after the reset.
    // Short provider failures retain the existing bounded workflow retries.
    await ctx.runMutation(internal.generationStore.failed, { jobId, retryable: error instanceof GenerationError && error.retryable, ...(budgetLimited ? { retryAfterAt: Date.now() + error.data.retryAfter } : error instanceof GenerationError && error.retryable ? { retryAfterAt: Date.now() + Math.max(backoff, error.retryAfterMs ?? 0) } : {}), reason: budgetLimited ? "MODEL_DAILY_LIMIT" : error instanceof GenerationError ? error.code : "MODEL_VALIDATION_OR_STATE_CHANGED", onlyIfUnstarted: !claimed, ...(response ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } : !claimed || rejectedBeforeGeneration ? { inputTokens: 0, outputTokens: 0 } : {}) });
  }
}
export const extractLogistics = action({ args: { sourceId: v.id("sources") }, returns: v.id("jobs"), handler: async (ctx, args): Promise<Id<"jobs">> => { const jobId = await ctx.runMutation(internal.generationStore.requestExtraction, args); await ctx.runMutation(internal.generationWorkflows.start, { jobId }); return jobId; } });
export const draftQuestion = action({ args: { draftId: v.id("mailDrafts"), expectedVersion: v.number(), instruction: v.string() }, returns: v.id("jobs"), handler: async (ctx, args): Promise<Id<"jobs">> => { const jobId = await ctx.runMutation(internal.generationStore.requestQuestion, args); await ctx.runMutation(internal.generationWorkflows.start, { jobId }); return jobId; } });
export const introduceHandover = action({ args: { handoverId: v.id("handovers"), expectedVersion: v.number() }, returns: v.id("jobs"), handler: async (ctx, args): Promise<Id<"jobs">> => { const jobId = await ctx.runMutation(internal.generationStore.requestIntroduction, args); await ctx.runMutation(internal.generationWorkflows.start, { jobId }); return jobId; } });
export const performInternal = internalAction({ args: { jobId: v.id("jobs") }, returns: v.null(), handler: async (ctx, args): Promise<null> => { await perform(ctx, args.jobId); return null; } });
