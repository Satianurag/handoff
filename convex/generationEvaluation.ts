"use node";
import { z } from "zod";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { generationClient, generationConfig, GenerationError, type ResponseResult } from "./model/responses";
import { extractionSchema, systemInstruction, PROMPT_VERSION } from "./model/generationContract";
import { extractionFixtures } from "./fixtures/extraction";
import { redactIdentifiers, validateExtraction } from "./model/generationValidation";
import { fail } from "./model/access";

export const evaluate = internalAction({
  args: { fixtureIndex: v.number() }, returns: v.union(v.object({ promptVersion: v.string(), id: v.string(), positive: v.boolean(), passed: v.boolean(), accepted: v.number(), supported: v.number(), rejected: v.number(), inputTokens: v.number(), outputTokens: v.number() }), v.object({ promptVersion: v.string(), id: v.string(), error: v.string(), retryAfterMs: v.number() })),
  handler: async (ctx, args) => {
    const fixture = extractionFixtures[args.fixtureIndex];
    if (!Number.isInteger(args.fixtureIndex) || !fixture) return fail("INVALID_FIXTURE", "Choose an existing synthetic evaluation fixture.");
    const { $schema: _dialect, ...jsonSchema } = z.toJSONSchema(extractionSchema, { target: "draft-07" });
    const input = JSON.stringify({ operation: "extractLogistics", target: { kind: "visit", title: fixture.targetTitle ?? "Sample Office visit", address: "" }, confirmedTimezone: fixture.timezone ?? "UTC", source: { sourceId: "S1", kind: fixture.kind, capturedAt: Date.parse("2026-09-19T12:00:00Z"), text: redactIdentifiers(fixture.text), previousText: fixture.previousText ?? null }, comparison: fixture.previousText ? "changed" : "baseline" });
    const reservationId = await ctx.runMutation(internal.generationEvaluationStore.reserve, { inputBytes: new TextEncoder().encode(input + systemInstruction + JSON.stringify(jsonSchema)).length, fixtureId: fixture.id });
    let response: ResponseResult;
    try { response = await generationClient.responses.create({ model: generationConfig().model, instructions: systemInstruction, input, store: false, text: { format: { type: "json_schema", name: "extractLogistics", strict: true, schema: jsonSchema } } }); }
    catch (error) {
      if (error instanceof GenerationError && ["MODEL_HTTP_400", "MODEL_HTTP_401", "MODEL_HTTP_403", "MODEL_HTTP_429"].includes(error.code)) await ctx.runMutation(internal.generationEvaluationStore.settle, { reservationId, inputTokens: 0, outputTokens: 0 });
      return { promptVersion: PROMPT_VERSION, id: fixture.id, error: error instanceof GenerationError ? error.code : "MODEL_UNAVAILABLE", retryAfterMs: error instanceof GenerationError && error.retryable ? Math.max(30000, error.retryAfterMs ?? 30000) : 0 };
    }
    await ctx.runMutation(internal.generationEvaluationStore.settle, { reservationId, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });
    if (response.status !== "completed" || response.refusal) return fail("MODEL_INCOMPLETE", "Evaluation model response was incomplete.");
    const verified = validateExtraction(JSON.parse(response.output_text), { sourceId: "S1", plaintext: fixture.text, kind: fixture.kind, previousText: fixture.previousText, timezone: fixture.timezone ?? "UTC", capturedAt: Date.parse("2026-09-19T12:00:00Z") });
    const supported = verified.proposals.filter(p => fixture.expect.some(text => String(p.proposedValue).includes(text))).length;
    return { promptVersion: PROMPT_VERSION, id: fixture.id, positive: !fixture.abstain, passed: fixture.abstain ? verified.proposals.length === 0 : verified.proposals.length > 0 && supported === verified.proposals.length, accepted: verified.proposals.length, supported, rejected: verified.rejected, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
  },
});
