# Handoff

A shared care workspace for adult children coordinating an aging parent’s care. Keep original documents, reviewed next steps, visits, transport and family responsibilities connected. A responsibility changes hands only when the next person accepts it; a reply adds new information without silently closing a follow-up.

**Live app: [handoff on Convex](https://admired-fish-176.convex.site).** [Public source](https://github.com/Satianurag/handoff). The current frontend/backend are deployed; real production document, realtime, crawler and three-message email journeys passed. Production email-code sign-in, browser journeys and synthetic-household cleanup also passed. [Narrated walkthrough](https://github.com/Satianurag/handoff/releases/download/submission-preview/handoff-walkthrough.mp4) (141.6 seconds; assembled from actual deployed-app screenshots, not a continuous screen recording). Remaining eligibility, capacity and submission gaps are tracked below. [Current status](docs/implementation-status.md) is authoritative. [Submission requirements](docs/submission.md) include remaining public artifacts and sponsor eligibility.

## What works

- Private PDF/JPEG/PNG originals, immutable versions, source/page evidence and reviewed task creation.
- Care profile and medicine reference, provider directory, visit questions, printable packs and recipient-bound expiring sharing.
- Separate outbound/return/accompanying commitments, saved places/maps, limited helpers and explicit replacement acceptance.
- Real email intake, reviewed draft approval, delivery/replies, linked follow-ups and per-person new-information indicators.
- Realtime tasks, partial handovers with immutable receipts, source-change review, notifications, export and deletion.

Web app only, using native HTML/CSS/JavaScript and shared browser primitives. No native app or PWA. Public evaluation uses fictional information; there is no clinical advice, compliance certification or claimed caregiver adoption.

## Stack and actual integration

Convex owns authenticated data, live queries, indexed mutations, private file storage, signed webhooks, crons and durable work. Authentication uses official Convex Auth. Registered components are Workflow, Rate Limiter, Static Hosting and the official Firecrawl component. AgentMail’s official SDK provisions inboxes and saves/sends approved messages; signed callbacks ingest real replies. Firecrawl maps and scrapes public visit logistics, retaining evidence for review. Maps use MapLibre, OpenFreeMap and Photon, with external Apple Maps directions.

Runtime generation uses **Gemini 3.8 Flash through model-only Vertex federation**, behind the requested Responses-shaped application interface. This chosen stack is implemented and verified; no separate OpenAI account or funded key is required to operate it. See [generation details](docs/generation-interface.md) and the separate [organizer eligibility note](docs/submission.md#organizer-eligibility-note).

## Run locally

```sh
npm ci
# Configure .env.local using .env.example; configure server secrets in Convex.
npx convex dev --once
npm run dev:web
```

Open `http://localhost:4173/`; use `PORT=4177 npm run dev:web` if that port is occupied. Email-code sign-in uses AgentMail. The fictional sample uses isolated Convex sessions; provider-backed sample mail needs two available AgentMail inbox slots. Manual coordination and records do not require successful inbox provisioning.

```sh
npm run typecheck
npm test
npm run test:web
npm run build:web
npm run preview:web
```

`build:web` uses `VITE_CONVEX_URL` first (supplied by the official hosting CLI), then process `CONVEX_URL`, then `.env.local`’s `CONVEX_URL` and includes only that public URL in browser configuration. Preview serves the built configuration. Never place provider secrets in `web/` or `dist/`. `npm run deploy` builds for the selected production backend and publishes through official Convex Static Hosting; `npm run deploy:backend` publishes backend code only. See [operations](docs/operations.md) for deployment safeguards and finite mailbox capacity.

[Handover](docs/HANDOVER.md) · [Verification scope](docs/evidence-summary.md) · [API guide](docs/backend-usage.md) · [Build log](hackathon.md)
