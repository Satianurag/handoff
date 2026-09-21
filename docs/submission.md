# Convex All Gas submission checklist

Rules checked 21 September 2026 against the [official event page](https://www.convex.dev/hackathons/all-gas) and [Luma event](https://luma.com/convex-allgas-hackathon). No numeric judging weights or guaranteed eligibility decision are published. The live signed-out submission page was inspected and requires sign-up/sign-in before exposing the form. No account was created and no submission was sent. Public source was inspected to prepare the fields below; current event/account-specific overrides remain unverified.

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


## Prepared VibeApps form fields

Read-only source check: [VibeApps form](https://github.com/waynesutton/vibeapps/blob/7f17164d1b2be39afa991bfde0a23a8654690f28/src/pages/JudgingGroupSubmitPage.tsx), [submission mutation](https://github.com/waynesutton/vibeapps/blob/7f17164d1b2be39afa991bfde0a23a8654690f28/convex/stories.ts), and [video rendering](https://github.com/waynesutton/vibeapps/blob/7f17164d1b2be39afa991bfde0a23a8654690f28/src/components/StoryDetail.tsx), checked 21 September 2026. These are source-level findings; the live service's deployed commit and event configuration are not established by the public repository.

| Field | Prepared value / action |
| --- | --- |
| App Title | Handoff |
| App/Project Tagline | Keep your parent’s records, visits and family responsibilities connected, with explicit handovers. |
| Description | Use the honest project description below, including actual model disclosure and evaluation limits. |
| App Website Link | `https://admired-fish-176.convex.site` |
| GitHub Repo URL | `https://github.com/Satianurag/handoff` |
| Video Demo | `https://github.com/Satianurag/handoff/releases/download/submission-preview/handoff-walkthrough.mp4` |
| Screenshot or Image | [Fictional Handoff records screenshot](../web/assets/product-records.png); upload the actual image file. |
| Your Name / Email | Actual entrant identity/contact from the authenticated account; not invented or prefilled here. |
| Team information | Actual entrant/team information only; official event maximum is four people. |
| Tags | Preserve the event's automatically applied tag; choose relevant available care/family/product tags if requested. Exact choices are dynamic. |
| Additional links / custom questions | Supply the actual social URL only after publication, and accurate answers to fields exposed after sign-in. No fabricated social link or sponsor claim. |

The generic form defaults require title, tagline, app URL, screenshot, submitter name and tags. The tagline is capped at 140 characters. Event administrators can override required/visible fields and add custom questions, so this is not a claim that those defaults are the complete All Gas form. Official All Gas rules separately require public repo and video even where the generic form marks them optional. At most four additional images are accepted by the server; its client has a conflicting five-image message, so use four or fewer.

The source accepts a general URL for `Video Demo`, stores it as a string without a YouTube/Vimeo-only restriction, and explicitly renders direct `.mp4` URLs using a video element. The published GitHub MP4 therefore matches the source's supported format and its download was verified. Actual playback inside the authenticated live VibeApps page remains unverified; a public download is not proof of a completed submission or organizer acceptance of the screenshot-based presentation.

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
