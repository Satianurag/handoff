"use node";
import { randomUUID } from "node:crypto";
import { IdentityPoolClient } from "google-auth-library";
import { importPKCS8, SignJWT } from "jose";
import OpenAI from "openai";
import { z } from "zod";
import { env } from "../_generated/server";

// Deliberate Responses API subset. Call sites use responses.create and the
// standard output_text/status/usage fields regardless of runtime provider.
export type ResponseRequest = { model: string; input: string; media?: { mimeType: string; data: string }; outputTokenLimit?: number; inputTokenReservation?: number; instructions: string; store: false; text: { format: { type: "json_schema"; name: string; schema: Record<string, unknown>; strict: true } } };
export type ResponseResult = { id: string; object: "response"; status: "completed" | "incomplete" | "failed"; model: string; provider: "gemini" | "openai"; output_text: string; usage: { input_tokens: number; output_tokens: number; total_tokens: number }; refusal: boolean };
const supportedGeminiModels = new Set(["gemini-3.8-flash", "gemini-3.5-flash", "gemini-3-flash-preview"]);
const vertexResult = z.object({
  responseId: z.string().optional(), modelVersion: z.string().optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  candidates: z.array(z.object({ finishReason: z.string().optional(), content: z.object({ parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })) }).optional() })).optional(),
  usageMetadata: z.object({ promptTokenCount: z.number().optional(), candidatesTokenCount: z.number().optional(), thoughtsTokenCount: z.number().optional(), totalTokenCount: z.number().optional() }).optional(),
});
export class GenerationError extends Error {
  constructor(readonly code: string, readonly retryable = false, readonly retryAfterMs?: number) { super(code); }
}
let cachedAuth: Promise<IdentityPoolClient> | undefined;
async function vertexAuth() {
  if (!cachedAuth) cachedAuth = (async () => {
    const key = await importPKCS8(env.GEMINI_AUTH_PRIVATE_KEY!, "RS256");
    return new IdentityPoolClient({ audience: env.GEMINI_AUTH_AUDIENCE!, subject_token_type: "urn:ietf:params:oauth:token-type:jwt", token_url: "https://sts.googleapis.com/v1/token", scopes: ["https://www.googleapis.com/auth/cloud-platform"], subject_token_supplier: { getSubjectToken: async () => new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: env.GEMINI_AUTH_KEY_ID! }).setIssuer(env.GEMINI_AUTH_ISSUER!).setAudience(env.GEMINI_AUTH_AUDIENCE!).setSubject(env.GEMINI_AUTH_SUBJECT!).setIssuedAt().setExpirationTime("5m").setJti(randomUUID()).sign(key) } });
  })().catch(() => { cachedAuth = undefined; throw new GenerationError("MODEL_AUTH_UNAVAILABLE"); });
  return cachedAuth;
}
export function generationConfig() {
  const provider = env.GENERATION_PROVIDER ?? "gemini";
  const model = provider === "gemini" ? env.GEMINI_MODEL ?? "gemini-3.8-flash" : env.OPENAI_MODEL;
  if (!model || (provider === "openai" && !env.OPENAI_API_KEY)) throw new GenerationError("MODEL_CONFIGURATION_REQUIRED");
  if (provider === "gemini" && !supportedGeminiModels.has(model)) throw new GenerationError("MODEL_REVALIDATION_REQUIRED");
  return { provider, model };
}

export function buildGeminiRequestBody(request: ResponseRequest) {
  return {
    systemInstruction: { parts: [{ text: request.instructions }] },
    contents: [{
      role: "user",
      parts: [
        { text: request.input },
        ...(request.media ? [{ inlineData: request.media }] : []),
      ],
    }],
    generationConfig: {
      ...(request.outputTokenLimit !== undefined ? { maxOutputTokens: request.outputTokenLimit } : {}),
      responseMimeType: "application/json",
      responseJsonSchema: request.text.format.schema,
      thinkingConfig: { thinkingLevel: "HIGH" },
    },
  };
}

const maxGeminiAttempts = 3;
const retryBackoffMs = [1_000, 3_000];
const retryAfterLimitMs = 5_000;
const geminiRequestTimeoutMs = 60_000;

function retryAfterMilliseconds(response: Response) {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const milliseconds = /^\d+$/.test(value)
    ? Number(value) * 1_000
    : Date.parse(value) - Date.now();
  return Number.isFinite(milliseconds) && milliseconds >= 0
    ? Math.min(milliseconds, retryAfterLimitMs)
    : undefined;
}

function unavailablePayload(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== "object") return false;
  const detail = error as { status?: unknown; code?: unknown };
  return detail.status === "UNAVAILABLE" || detail.code === "UNAVAILABLE";
}

async function isUnavailableResponse(response: Response) {
  if (response.status === 429 || response.status === 503) return true;
  try {
    return unavailablePayload(await response.clone().json());
  } catch {
    return false;
  }
}

function retryDelay(attempt: number, retryAfterMs?: number) {
  if (retryAfterMs !== undefined) return retryAfterMs;
  const backoff = retryBackoffMs[Math.min(attempt, retryBackoffMs.length - 1)];
  return Math.round(backoff * (0.8 + Math.random() * 0.4));
}

function wait(milliseconds: number) {
  return new Promise<void>(resolve => setTimeout(resolve, milliseconds));
}

async function fetchGeminiContent(url: string, headers: Record<string, string>, request: ResponseRequest) {
  const body = JSON.stringify(buildGeminiRequestBody(request));
  for (let attempt = 0; attempt < maxGeminiAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(geminiRequestTimeoutMs),
      });
    } catch {
      if (attempt === maxGeminiAttempts - 1) {
        throw new GenerationError("MODEL_PROVIDER_UNAVAILABLE", true);
      }
      await wait(retryDelay(attempt));
      continue;
    }

    if (response.ok) {
      if (!(await isUnavailableResponse(response))) return response;
      if (attempt === maxGeminiAttempts - 1) {
        throw new GenerationError("MODEL_PROVIDER_UNAVAILABLE", true);
      }
      await wait(retryDelay(attempt));
      continue;
    }

    const unavailable = await isUnavailableResponse(response);
    const retryable = [408, 429, 500, 502, 503, 504].includes(response.status) || unavailable;
    const retryAfterMs = retryAfterMilliseconds(response);
    if ((response.status === 429 || response.status === 503 || unavailable) && attempt < maxGeminiAttempts - 1) {
      await wait(retryDelay(attempt, retryAfterMs));
      continue;
    }
    throw new GenerationError(`MODEL_HTTP_${response.status}`, retryable, retryAfterMs);
  }
  throw new GenerationError("MODEL_PROVIDER_UNAVAILABLE", true);
}

async function create(request: ResponseRequest): Promise<ResponseResult> {
  const { provider, model } = generationConfig();
  if (request.model !== model || request.store !== false) throw new GenerationError("MODEL_CONFIGURATION_MISMATCH");
  if (provider === "openai") {
    if(request.media||request.outputTokenLimit!==undefined) throw new GenerationError("DOCUMENT_PROVIDER_REQUIRES_GEMINI");
    try {
      const response = await new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 0 }).responses.create(request);
      // Missing usage is unknown consumption, never a zero-cost generation.
      // The caller retains the full reservation on this error.
      if (!response.usage) throw new GenerationError("MODEL_USAGE_UNAVAILABLE");
      const refusal = response.output.some(item => item.type === "message" && item.content.some(part => part.type === "refusal"));
      return { id: response.id, object: "response", provider, model: response.model, status: response.status === "completed" ? "completed" : response.status === "incomplete" ? "incomplete" : "failed", output_text: response.output_text, refusal, usage: { input_tokens: response.usage?.input_tokens ?? 0, output_tokens: response.usage?.output_tokens ?? 0, total_tokens: response.usage?.total_tokens ?? 0 } };
    } catch (error) {
      if (error instanceof GenerationError) throw error;
      if (error instanceof OpenAI.APIError && error.status) throw new GenerationError(`MODEL_HTTP_${error.status}`, [408, 429, 500, 502, 503, 504].includes(error.status));
      throw new GenerationError("MODEL_PROVIDER_UNAVAILABLE", true);
    }
  }
  if(request.outputTokenLimit!==undefined&&(!Number.isSafeInteger(request.outputTokenLimit)||request.outputTokenLimit<16384||request.outputTokenLimit>65536))throw new GenerationError("INVALID_DOCUMENT_OUTPUT_LIMIT");
  try {
    let response: Response;
    if (env.GEMINI_API_KEY) {
      response = await fetchGeminiContent(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        request,
      );
    } else {
      const auth = await vertexAuth(), { token } = await auth.getAccessToken();
      if (!token) throw new GenerationError("MODEL_AUTH_UNAVAILABLE");
      response = await fetchGeminiContent(
        `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(env.GOOGLE_CLOUD_PROJECT!)}/locations/global/publishers/google/models/${encodeURIComponent(model)}:generateContent`,
        { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-goog-user-project": env.GOOGLE_CLOUD_PROJECT! },
        request,
      );
    }
    const parsed = vertexResult.safeParse(await response.json());
    if (!parsed.success) throw new GenerationError("MODEL_RESPONSE_INVALID");
    const result = parsed.data, candidate = result.candidates?.[0];
    const output_text = (candidate?.content?.parts ?? []).filter(p => !p.thought).map(p => p.text ?? "").join("");
    const input = result.usageMetadata?.promptTokenCount ?? request.inputTokenReservation ?? new TextEncoder().encode(request.input + request.instructions + JSON.stringify(request.text.format.schema)).length + 2048;
    const output = result.usageMetadata?.candidatesTokenCount === undefined ? request.outputTokenLimit ?? 65536 : Math.max(result.usageMetadata.candidatesTokenCount + (result.usageMetadata.thoughtsTokenCount ?? 0), result.usageMetadata.totalTokenCount !== undefined && result.usageMetadata.promptTokenCount !== undefined ? result.usageMetadata.totalTokenCount - result.usageMetadata.promptTokenCount : 0);
    return { id: result.responseId ?? `gemini-${randomUUID()}`, object: "response", status: candidate?.finishReason === "STOP" ? "completed" : "incomplete", provider, model: result.modelVersion ?? model, output_text, refusal: !!result.promptFeedback?.blockReason || ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"].includes(candidate?.finishReason ?? ""), usage: { input_tokens: input, output_tokens: output, total_tokens: result.usageMetadata?.totalTokenCount ?? input + output } };
  } catch (error) { if (error instanceof GenerationError) throw error; throw new GenerationError("MODEL_PROVIDER_UNAVAILABLE", true); }
}
export const generationClient = { responses: { create } };
