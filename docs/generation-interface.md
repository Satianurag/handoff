# Generation interface

Runtime: Gemini 3.8 Flash through Vertex model inference with deployment-specific workload federation. Google Cloud is used only for inference and its necessary token exchange. No Google sign-in or other Google application service is used.

`convex/model/responses.ts` exposes the deliberately narrow Responses API contract used by this product: `generationClient.responses.create({model, input, instructions, store:false, text:{format:{type:"json_schema",name,schema,strict:true}}})`. Results have `id`, `object`, `status`, `model`, `output_text`, `usage`, `refusal`, and an explicit `provider`. This is an application adapter, not a claim of complete OpenAI HTTP compatibility or actual OpenAI usage.

The source-text generation request sets `thinkingConfig.thinkingLevel="HIGH"` and structured JSON output. It does not set `maxOutputTokens`, temperature, safety settings, a thinking budget, tools, or a fallback model. Provider safety refusals and incomplete responses produce a recoverable failed job. Source text and user notes are data; they cannot change the request configuration or invoke tools.

Document extraction is a separate inline-media path in `recordsWorkflow.ts`: HIGH thinking with a page-aware output limit (16,384 tokens for one page, +2,048 per additional page, capped at 65,536). It reserves that same capacity, includes thought-token usage and rejects incomplete output. The source-text adapter described here intentionally has no output-token override. Both paths require review before domain changes.

## Product actions

- `generate.extractLogistics({sourceId})` returns a job ID. It creates pending proposals with exact stored-source quotes and offsets. It never updates a confirmed task or visit.
- `generate.draftQuestion({draftId,expectedVersion,instruction})` returns a job ID. It updates an editable local draft; the recipient remains unchanged. The provider draft must be saved and the current content explicitly approved before sending.
- `generate.introduceHandover({handoverId,expectedVersion})` returns a job ID. It updates only an unpublished sender-owned handover introduction. The deterministic items and ownership remain unchanged.
- `jobs.get({jobId})` is an authorized reactive status read. `jobs.forEntity` exposes the associated progress list.

All actions derive identity from Convex Auth and check household membership. Workers recheck membership, consent version, source/target version and household lifecycle before applying generated content. A result from an earlier source, draft, handover or permission version is discarded. Identical source/prompt/schema/model inputs reuse a job rather than create duplicate proposals.

## Evidence and dates

The stored source uses minimal documented whitespace normalization (`model/sourceText.ts`). Model-facing text removes email addresses, known recipient nicknames and common explicit identifier labels. Only non-redacted source excerpts can be cited. Output is parsed with strict Zod schemas and then checked semantically. Unsupported or missing quotes, clinical instructions, prompt injection, unchanged source sentences, ambiguous dates and mismatched source IDs are withheld. A public web page cannot establish a private appointment time.

Prompt v2 asks the model to copy the exact date phrase into rawDateText and proposedValue; the model never supplies the authoritative timestamp. Chrono's strict parser checks explicit year/month/day/hour components. Temporal resolves a confirmed visit timezone and rejects nonexistent or repeated DST instants. Numeric slash dates, missing years, relative dates, missing am/pm and ambiguous timezone abbreviations require manual confirmation.

These checks reduce errors but do not prove source truth or complete semantic accuracy. All proposals remain subject to human review. The fixture report describes the complete model-plus-validation pipeline. Proposal precision counts surfaced proposals after schema, evidence, and semantic validation; negative abstention likewise means no proposal surfaced, including candidates rejected by the validator. These are synthetic fixture results, not raw-model accuracy or estimated production performance. Unit tests exercise the deterministic checks separately.

## Usage control and failures

Before generation, the official Convex rate-limiter component reserves a conservative input-token allowance and the model's documented full output capacity. This is an application budget reservation, not a per-request model token clamp. Provider usage, including Gemini thinking tokens, settles the reservation. Unknown transport outcomes retain their reservation. An explicit HTTP 429 rejection is distinguished from an uncertain send/generation outcome. Retries cannot reset consumed usage.

Default deployment allowance: 1,000,000 input tokens and 100,000 output tokens per UTC budget day; default household allowance: 40 generations. The operator can change `dailyModelInputTokens`, `dailyModelOutputTokens` and `dailyHouseholdGenerations` using `operator.configure`. Changing token limits adjusts remaining allowance without clearing the usage ledger. Development's temporary evaluation increase has been restored to the default 100,000 output tokens without clearing consumed or uncertain usage. Fixed windows are anchored at UTC midnight; legacy randomized windows are re-anchored atomically with their existing debit preserved. No model quality setting changes with these application limits.

The prior v1 partial report is retained separately; it is not a completed benchmark. The current 40 synthetic evaluation fixtures are in `convex/fixtures/extraction.ts`. `node scripts/evaluate-extraction.mjs` runs real deployed Gemini calls through restricted internal evaluation functions and writes `docs/extraction-evaluation.json`. Optional fixture indices rerun selected cases; intermediate reports are explicitly incomplete. HTTP 429/transient failures get bounded retries respecting `Retry-After`, with truncated exponential backoff and jitter. Product jobs persist the next allowed retry time. [Official model retry guidance](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/retry-strategy). Production content is never sent to the evaluator.

## Explicit OpenAI switch for source-text actions

The official OpenAI SDK branch exists but has not been exercised because no OpenAI credit/key was supplied. Set `OPENAI_API_KEY`, select `OPENAI_MODEL`, explicitly set `GENERATION_PROVIDER=openai`, and record the documented full model output capacity in the enabled `verifiedOpenAiOutputCapacity` operator setting. Rerun the fixtures and end-to-end checks before declaring that runtime verified. Existing application action names, request arguments and result handling remain unchanged. Adding a key alone does not silently change the provider. This switch covers the source-text adapter; the document extraction path remains Gemini-specific until separately implemented and verified. Do not describe the entire product as OpenAI-powered after changing only one adapter.

`store:false` is forwarded to OpenAI; it does not mean zero provider retention. Gemini uses direct Vertex generation and no explicit response store or context cache. Provider contractual retention and health-data suitability require separate verification before real care-data release.

Official references: [Responses structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Gemini 3.8 Flash model](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-8-flash), [Google Auth workload federation](https://github.com/googleapis/google-auth-library-nodejs), [Zod JSON Schema](https://zod.dev/json-schema), [Chrono](https://github.com/wanasit/chrono), [Convex Rate Limiter](https://github.com/get-convex/rate-limiter).
