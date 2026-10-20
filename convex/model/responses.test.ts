import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { generationClient, type ResponseRequest } from "./responses";

const environmentKeys = [
  "GENERATION_PROVIDER",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GEMINI_AUTH_PRIVATE_KEY",
  "OPENAI_API_KEY",
];
const originalEnvironment = new Map(environmentKeys.map(key => [key, process.env[key]]));

const request: ResponseRequest = {
  model: "gemini-3.8-flash",
  input: "Read this synthetic record.",
  media: { mimeType: "application/pdf", data: "JVBERi0xLjQK" },
  instructions: "Return the requested JSON.",
  store: false,
  text: { format: { type: "json_schema", name: "test", schema: { type: "object" }, strict: true } },
};

const successBody = {
  responseId: "response-test",
  modelVersion: "gemini-3.8-flash",
  candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{\"ok\":true}" }] } }],
  usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 7, totalTokenCount: 19 },
};

function successResponse() {
  return new Response(JSON.stringify(successBody), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  for (const key of environmentKeys) delete process.env[key];
  process.env.GEMINI_API_KEY = "test-api-key";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("uses the AI Studio API-key header without Vertex token exchange", async () => {
  const fetchMock = vi.fn().mockResolvedValue(successResponse());
  vi.stubGlobal("fetch", fetchMock);

  const result = await generationClient.responses.create(request);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
  expect(new URL(url).search).toBe("");
  expect(init.method).toBe("POST");
  expect(new Headers(init.headers).get("x-goog-api-key")).toBe("test-api-key");
  expect(url).not.toContain("sts.googleapis.com");
  expect(JSON.parse(String(init.body))).toMatchObject({
    systemInstruction: { parts: [{ text: "Return the requested JSON." }] },
    contents: [{ parts: [{ text: "Read this synthetic record." }, { inlineData: request.media }] }],
  });
  expect(init.signal).toBeInstanceOf(AbortSignal);
  expect(result).toMatchObject({
    provider: "gemini",
    status: "completed",
    output_text: "{\"ok\":true}",
    usage: { input_tokens: 12, output_tokens: 7, total_tokens: 19 },
  });
});

test("retries two transient 503 responses and succeeds on the third request", async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: "UNAVAILABLE" } }), { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: "UNAVAILABLE" } }), { status: 503 }))
    .mockResolvedValueOnce(successResponse());
  vi.stubGlobal("fetch", fetchMock);

  const resultPromise = generationClient.responses.create(request);
  await vi.advanceTimersByTimeAsync(4_000);
  const result = await resultPromise;

  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(result.output_text).toBe("{\"ok\":true}");
});

test("returns MODEL_HTTP_400 without retrying", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ error: { status: "INVALID_ARGUMENT" } }), { status: 400 }),
  );
  vi.stubGlobal("fetch", fetchMock);

  await expect(generationClient.responses.create(request)).rejects.toMatchObject({
    code: "MODEL_HTTP_400",
    retryable: false,
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
