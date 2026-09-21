# Handoff — Convex All Gas build log

- **App:** [Handoff](https://admired-fish-176.convex.site)
- **Source:** [Satianurag/handoff](https://github.com/Satianurag/handoff)
- **Walkthrough:** [Narrated product walkthrough](https://github.com/Satianurag/handoff/releases/download/submission-preview/handoff-walkthrough.mp4), 141.6 seconds; actual app screenshots assembled with narration, not continuous screen capture.
- **Started:** 19 September 2026
- **Audience:** Adult children coordinating an aging parent’s care.

## Product

Handoff connects private originals, reviewed next steps, appointments, transport and family responsibilities. A handover requires explicit acceptance and preserves a receipt. An incoming reply adds information to a waiting item; a person reviews it and decides when to close it.

The public release is for fictional evaluation data. It makes no clinical advice, caregiver adoption or compliance-certification claim.

## Stack

Convex database, realtime queries, transactional mutations, auth, private files, HTTP actions and crons. Official components: Static Hosting, Workflow (separate operational and generation instances), Rate Limiter and Firecrawl. AgentMail’s SDK and signed webhooks handle inboxes, reviewed sends, attachments and replies. The frontend uses native HTML/CSS/JavaScript with MapLibre and PDF.js.

Google Cloud Gemini supplies model inference through a Responses-shaped application adapter. Google Cloud is used only for models. Codex and the Convex plugin supported development; the app does not claim actual OpenAI API generation. The event’s sponsor criteria remain subject to organizer assessment.

## Build history

### 19 September — shared state and durable work

Created the Convex project, schema and household authorization. Implemented responsibilities, visits, coverage, partial handover acceptance and immutable receipts. Added provider workflows, signed mail callbacks, source review, recurring work, notifications, export and retention. Configured Google workload federation for model inference.

### 20 September — connected consumer web app

Built email-code sign-in, onboarding and the shared application shell. Connected Today, work, people, inbox and handover views to live Convex queries. Exercised concurrent claims, stale handovers and partial acceptance. Refined the desktop layouts using full-screen references.

### 21 September — care records, visits and production

Connected private PDFs/images, original versions, source-linked review, care essentials, visit questions, printable packs, expiring shares, saved places and separate transport commitments. Linked incoming mail and replies to follow-ups without automatically resolving them.

Published the backend and frontend through official Convex Static Hosting. Controlled production journeys exercised document upload/download permissions, source extraction, real Firecrawl capture and AgentMail attachment/question/reply flows. Verification used fictional data; no real-world outcome is inferred from those checks.

Prepared fictional recording data and public submission images. Revised the README around the product and verified architecture. Removed internal planning, recording instructions and release reports from the tracked repository; retained application source, setup, verification tools and this event-required log.

## Submission status

The app, source and linked walkthrough are public. Registration, social publication and the final submission are handled by the entrant; this log does not claim submission or eligibility confirmation.

[Architecture and usage](README.md) · [Setup](docs/setup.md) · [Official event requirements](https://www.convex.dev/hackathons/all-gas)
