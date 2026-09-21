# Handoff handover

The family-care implementation and controlled development verification are complete. The current frontend/backend are now deployed at [the public app](https://admired-fish-176.convex.site). Post-deployment browser, provider, production sign-in and synthetic-household cleanup checks passed; their precise scope is in [current status](implementation-status.md).

## Product

Handoff helps adult children coordinate an aging parent’s care: private originals → reviewed next steps → visit preparation and transport → explicit acceptance → follow-up and handover. [The product direction](family-care-product-direction.md) records the rationale. The existing app is native HTML/CSS/JavaScript with Convex realtime, not a native mobile app or PWA.

Implemented: PDF/JPEG/PNG records and immutable versions; evidence-based extraction and approval-gated tasks; care profile/medicine reference/providers; visit questions and immutable printable packs; email-bound expiring file/pack shares; separate travel commitments; saved destinations and public address search; limited helpers and replacement acceptance; real public-page review; approved email sends/replies; waiting-item evidence; notifications; private export/deletion.

Care access is separate from ordinary coordination. Record/pack links recheck current grants; downgrading a member revokes prior medical access. Later information appears beside accepted handovers without rewriting their receipts. Source changes, messages and AI output never silently change a confirmed plan or close unresolved work.

Public repository: [Satianurag/handoff](https://github.com/Satianurag/handoff). Fresh production core and three-message mail verification passed. The [public narrated walkthrough](https://github.com/Satianurag/handoff/releases/download/submission-preview/handoff-walkthrough.mp4) shows actual deployed-app screenshots and is explicitly a frame-based video, not continuous screen capture. [Current status](implementation-status.md) records remaining provider capacity and submission gaps.

## Verification and final fixes

The controlled live attachment workflow used real provider inboxes and signed webhooks: incoming PDF → private original → reviewed question → delivery → threaded reply → new-information review → explicit resolution. A duplicate-byte import defect was fixed by retaining each actual email attachment origin in `recordMailOrigins`. The original file remains deduplicated; permission-aware association/export/deletion retains provenance.

Scoped live checks also cover first-use record/visit/task paths, original exports and deletion, real Gemini extraction, task/helper acceptance, provider-backed visit packs, saved errand destinations, rescheduling/reacceptance, care handover indicators and share authorization. Full-size 1920×1080 browser evidence was inspected; the latest scoped browser console was clean. These are bounded observations, not a guarantee that no defect can ever occur. [Verification summary](evidence-summary.md) states the limits.

Controlled samples from the final development and production provider journeys were deleted through the tracked privacy workflow; provider, storage, workflow and database stages succeeded. Stable sign-in mailboxes were restored and the existing real household was preserved. The temporary production OTP recipient was also removed after successful public sign-in/sign-out, and both deployment sign-in senders were restored. Production care/household content is empty; minimal inactive authentication metadata is retained. At the operator’s subsequent request, the development sign-in inbox was deleted; production sign-in and the existing household remain intact, with 2/3 slots occupied. One additional household inbox can fit; a fresh complete sample still needs two free slots. Further testing uses production.

## Operate and release

Run `npm ci`, configure `.env.local` from `.env.example`, then `npx convex dev --once` and `npm run dev:web`. Local default is `http://localhost:4173/`; a port override is supported. Development uses `befitting-cobra-234`; production uses `admired-fish-176`. See [operations](operations.md) for deployment and [submission](submission.md) for missing public artifacts.

The selected runtime uses Gemini behind the requested Responses-shaped application interface. It is verified and needs no separate OpenAI service/key. Organizer eligibility is a separate [submission consideration](submission.md#organizer-eligibility-note). Before accepting real health information, the operator must supply actual privacy/contact and processor arrangements. The public evaluation must keep synthetic labeling and must not claim clinical advice, healthcare certification, invented testimonials or measured outcomes.

## Final ownership

Coding and maintained documentation are complete for the user-selected Google Cloud generation stack and Responses-shaped interface. A fresh production-credential model request on 21 September 2026 returned HTTP 200 and the expected result. The entrant handles registration, social publication and the final submission using [the prepared fields](submission.md). Published source, app and video URLs are recorded there.
