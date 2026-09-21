# Recording a Handoff demo

Show one family-care story: paperwork, a connected plan, and explicitly accepted responsibility. Use clearly fictional care information. A prepared demo is useful; it is not evidence of real-world adoption or outcomes.

## Suggested sequence

1. **Today:** show the next visit, named responsibilities and unanswered follow-ups. Explain the problem: families need to know what changed, what remains unfinished and who agreed to do it.
2. **Incoming handover:** review the snapshot, select the offered responsibilities and accept them. Show the saved receipt. Record this before other material changes, which deliberately make earlier snapshots stale.
3. **Original record:** show the PDF beside its AI source quote. Review one suggestion. A reviewed suggestion does not silently change medicines or confirmed plans.
4. **Appointment:** show the original paperwork, questions, saved visit pack and separate outbound, return and companion responsibilities. Briefly show the map and arrival details.
5. **Waiting follow-up:** show an actual received email attached to the question it answers. Arrival does not automatically resolve a follow-up.
6. **Today or receipt:** close on the resulting responsibilities and shared state.

Aim for roughly 2:40 of edited footage. Record at 1920×1080 and 100% browser zoom with notifications hidden. Cut navigation pauses while retaining the actual interactions and saved results. Do not show login codes, credentials or unrelated account information. Source PDFs and care information should remain visibly fictional.

## Technical claims

- Convex stores shared state, enforces access and transactions, delivers live query updates, runs durable workflows and serves the site.
- AgentMail carries real provider messages; label fictional message content honestly.
- Google Cloud Gemini reads documents through an OpenAI-shaped adapter. Do not describe it as an OpenAI-service call.
- Firecrawl supports public-page capture. Claim it was demonstrated only when an actual capture appears in the recording.
- The map supports arrival planning; it does not locate a person or verify that a fictional provider exists.

## Operator fixture support

`videoFixtures:members` is internal-only. Given an active household and its owner, it creates or reuses two credential-free display fixtures, Maya (demo) and Leo (demo). It adds no auth accounts, sessions, emails, phone numbers or login tokens. Existing members and household records remain untouched. Household, owner and account-specific recording data must not be embedded in the public repository.

Prepare records and responsibilities through the normal application APIs. Leave a current incoming handover, pending document suggestions and a requested ride for live actions. Refresh snapshots after preparation changes; do not bypass stale-state checks. Check coverage dates immediately before recording.
