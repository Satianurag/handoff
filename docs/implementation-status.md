# Current product and release status

Updated 21 September 2026. This page supersedes earlier checkpoint descriptions. Historical plans and ledgers retain the states they originally measured; they are not unresolved current implementation lists.

## Product implemented

Handoff is a web app for adult children coordinating an aging parent’s care. The full connected loop is original record or message → reviewed next step → visit and travel preparation → accepted responsibility → follow-up → explicit handover. It includes private records and versioned extraction, care/medicine reference, providers, maps/places, separate travel commitments, limited-helper access, waiting items linked to real conversations/originals, and immutable accepted handovers. The framework remains native HTML/CSS/JavaScript with Convex realtime.

## Production release

- Development: `https://befitting-cobra-234.convex.cloud`; implementation and controlled live flows verified there.
- Live frontend: [https://admired-fish-176.convex.site](https://admired-fish-176.convex.site). Matching production backend: `https://admired-fish-176.convex.cloud`. Official Static Hosting deployed 86 assets with the current backend.
- Current frontend/backend deployment succeeded. Post-deployment AgentMail and Firecrawl authentication each returned HTTP 200. A controlled production core smoke then passed private PDF round-trip and grant, actual Gemini PDF extraction with pending page/quote evidence, reviewed-task acceptance observed through authenticated realtime, care/visit/immutable pack, limited-helper travel acceptance with medical-data denial, and actual Firecrawl public fixture capture.
- Final production browser and mail journey checks remain in progress. The controlled production sample is retained for those checks; its final deletion is not yet claimed.
- Public repository, video, social post and submitted entry have not yet been verified. [Submission checklist](submission.md) is authoritative for these deliverables.

## Known limits

AgentMail previously reported three occupied inbox slots: two sign-in senders and one preserved existing household. The latest controlled test temporarily rotated authorized disposable resources, proved the three-message attachment/reply workflow, deleted its synthetic household, and restored sign-in mailboxes. This is valid integration evidence, not enough capacity for arbitrary new public households. New household mail needs one slot; the complete controlled sample needs two. Manual coordination remains available when provisioning fails visibly.

The runtime is Gemini-only. Official All Gas judging requires actual OpenAI, Firecrawl and AgentMail product work; optional SDK code and Codex use do not establish OpenAI generation. No operator legal/privacy contact, processor contract approval, real caregiver adoption or formal compliance certification is inferred from synthetic tests.

## Evidence scope

See [public verification summary](evidence-summary.md), [handover](HANDOVER.md), and [operations](operations.md). Local TypeScript and all 112 existing backend tests pass after stale fixtures were aligned to current care/mail permissions. Further release evidence is appended only after the deployed app and backend have actually been inspected. Historical raw receipts remain local operator artifacts; public prose contains no real mailbox addresses or application record IDs.
