# Convex All Gas submission checklist

Rules checked 21 September 2026 against the [official event page](https://www.convex.dev/hackathons/all-gas) and [Luma event](https://luma.com/convex-allgas-hackathon). No numeric judging weights or guaranteed eligibility decision are published. The submission form is a client-rendered page; its account-specific fields have not been verified.

## Required artifacts and eligibility

- [ ] Luma registration confirmed for at least one team member; entrant eligibility attested (18+, at most four people, event employee/family and jurisdiction exclusions).
- [x] New project build log records work beginning 19 September 2026, after the event's 25 August start. This is repository history evidence, not identity verification.
- [x] Convex database/functions/realtime and the Convex plugin used in development; root [hackathon.md](../hackathon.md) maintained.
- [x] Public deployment at [admired-fish-176.convex.site](https://admired-fish-176.convex.site), using official Static Hosting and the matching production backend. Production browser, provider, sign-in and cleanup evidence is recorded in [current status](implementation-status.md).
- [x] Public GitHub repository: [Satianurag/handoff](https://github.com/Satianurag/handoff), initial main commit `e0174c0` pushed.
- [ ] Actual OpenAI product generation. Current runtime is Gemini. A compatible interface, installed SDK or Codex development does not establish this criterion.
- [x] Fresh production Firecrawl capture and AgentMail PDF/question/reply workflow passed after deployment; [sanitized receipt](public-release-evidence.json) distinguishes these from earlier development checks.
- [x] Public [walkthrough video](https://github.com/Satianurag/handoff/releases/download/submission-preview/handoff-walkthrough.mp4) in the [GitHub release](https://github.com/Satianurag/handoff/releases/tag/submission-preview): 141.567 seconds, 1920×1080, narration and captions. It uses actual deployed-app screenshots assembled into a walkthrough; it is not a continuous interaction recording.
- [ ] X or LinkedIn post with the live app and tags for Convex, OpenAI, Firecrawl and AgentMail; record the actual post URL.
- [ ] Submit repo, live app and video through the [exact VibeApps submission form](https://vibeapps.dev/judging/convex-all-gas-hackathon-openai/submit), then retain its actual confirmation/link.
- [x] Runtime reference-site bitmaps and masks replaced by original Handoff SVG artwork; open font notices retained. Private design-reference and raw provider evidence paths are excluded from public Git publication.

Official deadline: 22 September, 12 PM Pacific; winners announced 25 September. The official pages itemize $16,500 cash and $8,500 Codex credits, plus sponsor benefits. Luma also advertises a $45,000 combined headline including Firecrawl build credits; do not present that headline as cash. Auth v2 and paid Convex AI Gateway are offered resources, not mandatory architecture.

## Honest project description

Handoff helps adult children coordinate an aging parent’s care. Upload the original paperwork, review source-backed next steps, prepare the next visit and transport, and ask someone to accept responsibility. A new result or email reply stays connected to the original and the waiting item, so the family can review it and explicitly decide what is finished. Limited helpers see their assigned work; care records stay under separate sharing controls. Accepted handovers preserve who agreed to what while later updates remain visible.

Convex powers the shared live state, access checks, private files and durable work. Firecrawl captures public appointment logistics for review. AgentMail provides real inbound mail, reviewed outgoing questions and threaded replies. Gemini currently supplies document/source-text suggestions; suggestions never diagnose, prescribe or silently change the plan. OpenAI product-generation eligibility remains unresolved and must not be concealed in the entry.

## Published video and optional live click-through outline

1. Open the public landing page: name the adult-child/aging-parent use case and enter the clearly labeled fictional sample.
2. Upload the fictional care PDF; show its original, exact page evidence and one reviewed next step.
3. Link it to a visit; show provider, questions, saved destination and separate travel commitments.
4. In the helper view, accept the responsibility; show the coordinator's live update and unchanged private-file boundary.
5. Show a real incoming attachment and approved question/reply linked to a waiting item; review the reply and explicitly close it.
6. Prepare and partially accept a handover; show its immutable receipt and a later-information indicator.

Use only actual visible product/provider outcomes. If capacity prevents a fresh mail loop, label previously recorded evidence as recorded; do not stage fake delivered states. Keep the recording under the official limit; no calendar or build-time estimates are needed.

## Social draft — not posted

“Built Handoff for families coordinating an aging parent’s care: connect original paperwork, reviewed next steps, visits and explicitly accepted responsibilities. Replies stay linked to unresolved follow-ups. Built with Convex, with real Firecrawl capture and AgentMail messaging. Explore the fictional sample: https://admired-fish-176.convex.site. @convex @OpenAI @firecrawl @agentmail #ConvexAllGas”

The sponsor tags satisfy attribution, not an assertion that all sponsor product criteria are met. Include actual model disclosure in the linked project/build log. Publishing a social post and submitting the entry are separate actions; no publication is claimed here.
