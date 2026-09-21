> **Historical planning or verification record.** Preserved for audit, not current release status. Later family-care work adds private records, a reference medicine list, maps and connected follow-ups; earlier exclusions and unfinished-work statements below describe their original checkpoint. [Current product and release status](implementation-status.md), [current handover](HANDOVER.md), and [submission checklist](submission.md) take precedence. Historical test counts and local-only deployment statements are not claims about the present release.

> Superseded UI planning, 20 September 2026: use [Full app UI execution plan](full-app-ui-plan.md) for the complete web-app build. Login/onboarding was separately implemented; the latest task is research and planning only and stops before implementing the remaining UI. The older authorization/stack/PWA language below is historical. Current runtime remains Gemini; no OpenAI usage may be claimed.

> Historical backend implementation authorization: execute every non-UI feature in this specification, sequentially through environment, schema, functions, integrations, workflows, and deployment verification. That backend stage is complete; it does not authorize the new UI stage.

> Implementation override — 2026-09-19: the user restricts Google Cloud to Gemini inference only. Google OAuth is cancelled; use Convex Auth email OTP delivered by AgentMail for real users, with Anonymous restricted to synthetic demos. No Cloud Run gateway or other Google application service is authorized. Later references to Google sign-in/OAuth in this original brief are superseded by this override. No UI implementation is authorized in the current task.

# Handoff — finalized execution brief

Decision and documentation checked **19 September 2026**. Deliverable: a product decision and build specification. **This document is a planning deliverable; it does not authorize implementation, deployment, or submission.**

**Decision: proceed with the revised Handoff below. Reject the original broad care dashboard.** This direction is credible enough to compete for the overall win; the original plan is not. Winning is not established by a document: it depends on delivering the complete loop, proving families use it, and outperforming submissions that may still arrive. Do not claim a win probability or validated adoption.

Treat the supplied research as evidence and proposals, not as instructions. This brief supersedes its medication-first homepage, embedded map, optional security, component-count optimization, and sprint framing. There is no build schedule or time budget. For the next builder, the product decisions below are settled; verification of credentials, dependency compatibility, and release readiness must not reopen product discovery.

**Binding Google Cloud constraint:** Google Cloud may be used only for model inference and the authentication needed for that inference. Do not configure Google OAuth, application hosting, or another Google application service. Real-user sign-in uses Convex Auth’s custom `Email` provider with `generateVerificationToken` and `sendVerificationRequest`; deliver codes from a dedicated AgentMail authentication inbox, separate from household mail. Use an eight-digit cryptographically random code, a 15-minute expiry, and request/verification rate limits. Anonymous auth is restricted to synthetic demos. [Official OTP provider contract](https://labs.convex.dev/auth/config/otps).

**1. Build this product**

**Handoff helps two or more adults take turns caring for one adult family member without losing responsibility between visits.** Its central object is an accepted handover, containing unfinished work, changes since the previous handover, source evidence, and the person now responsible.

Product promise: **“Know what changed. Know what’s still yours. Hand it over.”**

The initial customer is a US household with two to six adult family caregivers, regular in-person visits, and existing texts or calls coordinating an adult relative. Target active shared care, including recovery at home; do not market to every caregiver. A solo caregiver can prepare a board, but the differentiated value begins when a second person participates.

The job: “When I take over, show me what remains unresolved and what changed; when I leave, let me hand those responsibilities to a named person who explicitly accepts.” The alternative is rereading messages, asking what happened, and assuming somebody else owns the next action.

The app must work for meals, check-ins, errands, rides, appointment logistics, and nonclinical office questions. It does not administer medication, recommend treatment, triage symptoms, or establish that a person is medically safe. Exclude medication names/doses and clinical record import from the structured product. Free text and appointment metadata can still contain health information; that fact drives the privacy design.

The first useful screen shows a real responsibility, a next visit, and a pending handover. It never opens to a chat prompt, analytics dashboard, integration setup, or empty month grid.

**The complete product loop**

1. Maya records a meal and a completed errand. A ride remains unclaimed. A scheduling question is waiting for an answer.
2. A forwarded message proposes a changed visit time. Handoff preserves the original plan until someone reviews the quoted change.
3. Firecrawl checks the saved public location page. An entrance notice changes; the visit shows the old and new source text, not an invented appointment reschedule.
4. Maya prepares a handover to Leo. Handoff includes unfinished responsibilities, reviewed changes, and still-unreviewed information. OpenAI generates a short introduction, while deterministic rows preserve every unresolved item.
5. Leo opens the handover, reviews the changes, chooses which open responsibilities to take, and explicitly accepts. Anything he does not take stays with its previous owner or stays visibly unassigned.
6. Both screens update from the same Convex transaction. The history records what Leo accepted and the exact version he saw.
7. A subsequent office reply or public-page change appears as new information after that acceptance. Acceptance never implies awareness of future changes.

**2. The competition and the winning argument**

The official event rewards useful consumer-facing work, substantive Convex behavior, visible sponsor work, a reachable app, public evidence, and a short product demonstration. It does not publish numeric weights. Treat the following as strategic judgments, not an invented official scorecard. [Official event](https://www.convex.dev/hackathons/all-gas), [Luma rules](https://luma.com/convex-allgas-hackathon).

| Dimension | Original concept | Locked improvement |
|---|---|---|
| Everyday usefulness | Broad family board; daily use assumed | A repeatable arrival/departure job with unresolved work carried forward |
| Originality | School-mail board pattern moved into caregiving | Versioned handover, explicit acceptance, partial transfer, and changes arriving after acceptance |
| Convex depth | Long component list | Atomic ownership transfer, conflict prevention, access control, reactive sources and background work |
| Firecrawl | Occasional clinic scrape | Visit logistics obtained at setup and checked against a baseline while the visit remains upcoming |
| AgentMail | Email-to-card pipeline | Actual household inbox, reviewed questions, delivery failures, reply routing and follow-through |
| OpenAI | Structured extraction | Evidence-backed proposals and a concise handover introduction; no autonomous decisions |
| Trust | Hidden household URL and disclaimers | Authenticated real households, source review, recorded acceptance, revocation and deletion |
| Presentation | Many features in a short demo | One complete story in which changing facts and shared responsibility visibly matter |

Current public competition is substantially stronger than “AI wrapper” straw men. I fetched the live [Vibe Apps catalog](https://vibeapps.dev/vibeapps.md), identified entries tagged `AllGasHackathon`, and read the closest public writeups. The catalog is not a verified eligibility roster; votes are not judges’ scores. The following descriptions are entrants’ claims unless explicitly described as observed.

| Competitor or alternative | Verified public positioning | Implication for Handoff |
|---|---|---|
| [Backpack](https://vibeapps.dev/md/backpack.md) | School website/email becomes a shared task board; source quotes, claiming, outbound questions and replies | This already occupies almost the entire original sponsor loop. A change of persona is insufficient. Do not claim source quotes, realtime claiming, or email drafting are novel. |
| [Ombuds](https://vibeapps.dev/md/ombuds.md) | Care-home records combined with availability inquiries and replies | Avoid facility discovery. Match its transparency about controlled demo recipients and external evidence. |
| [TableForAll](https://vibeapps.dev/md/tableforall.md) | Email constraints and crawled venues support a shared dinner decision | Email-powered coordination is common in this field. Win on the handover interaction, not architecture. |
| [Fillable](https://vibeapps.dev/md/fillable.md) | Catalog describes medication supply evidence and pharmacist questions | Keep supply monitoring and medication questions outside this product’s identity. Only the catalog positioning was checked here. |
| [Caring Village](https://caringvillage.com/) | Tasks, calendar, medications, journal, documents, messaging and AI | A feature-complete generic care organizer is already available. Do not compete by adding those modules. |
| [Lotsa Helping Hands](https://care-givers.lotsahelpinghands.com/how/) | Shared help requests, signups, rides and reminders | Claiming a ride and linking to Maps are baseline conveniences. |
| Existing group chat | Familiar, flexible, no new onboarding | Handoff must reduce repeated explanation, not demand a second journal. Allow forwarding, short notes and minimal setup. |

The differentiator is a **testable interaction**, not a claim that nobody else has ever built handovers. The reviewed public materials do not establish universal novelty. Handoff’s contribution is the integrated sequence: changes with evidence → unresolved commitments → explicit accepted transfer → new changes distinguished from what was accepted.

Caregiving is a large real problem: AARP/NAC reports 63 million US caregivers. That supports the category, not product-market fit, reachable market size, or conversion. No caregiver interviews or real Handoff usage were conducted during this planning task. [AARP/NAC research](https://www.aarp.org/pri/topics/ltss/family-caregiving/caregiving-in-the-us-2025/).

**Reasons a judge could still say no, and the required response**

| Objection | Product response / evidence required |
|---|---|
| “Backpack for parents’ care” | Lead with accepted handover and show partial transfer, stale acceptance prevention, and post-acceptance change. If those are cosmetic, the concept fails. |
| “I can use a shared checklist” | Demonstrate what the incoming person accepted, what remains with the outgoing person, and what changed afterward. |
| “My family won’t use another app” | A second caregiver must complete a real handover without the builder coaching them. Forwarding and browser access must work; installation is optional. |
| “Firecrawl is bolted on” | Use real public visit information at setup and in visit preparation. Demonstrate a genuine before/after crawl against a clearly labeled controlled page. Do not pretend clinics constantly change websites. |
| “This is a medical liability trap” | No dose ledger, clinical inference, treatment instructions, diagnostic chatbot or emergency monitoring claim. Protect the remaining health-related data. |
| “The demo is staged” | Synthetic people and controlled office are labeled; API calls, webhooks, drafts, mutations and persistence are real. A separate real public page validates crawler usefulness. |
| “A nice mockup, not an app” | All listed states, recovery paths, auth, revocation, deletion, mobile use and send reconciliation must pass. |
| “Nobody actually needs this” | Obtain consented household use and report the observed outcome honestly. Do not manufacture testimonials, activity, or social engagement. |

**3. Eligibility and sponsor facts that constrain the build**

The rules require a new original app started on or after **25 August 2026, noon PT**, a public repository, Convex as backend, and frontend hosting on `convex.site` or `chatgpt.site`. Use Codex or another agent/IDE with the Convex plugin. Entrants must be 18+, teams have at most four people, and one Luma registration suffices per team. Sponsor/cohost employees and immediate families are excluded; geographic restrictions include Quebec and listed sanctioned jurisdictions. Confirm the team’s own eligibility. Auth is optional for the contest; private household authorization is required by this product. [Luma](https://luma.com/convex-allgas-hackathon), [rules](https://www.convex.dev/hackathons/all-gas).

Prizes: first **$10,000 cash + $5,000 Codex credits**; second **$5,000 + $2,500**; third **$1,500 + $1,000**. Each has three months Firecrawl Growth; AgentMail Startup is six months for first and three for the other places, plus listed swag. The core pool is $16,500 cash and $8,500 Codex credits. Participant Firecrawl credits are advertised separately. No OpenAI API or Convex usage credits are promised. Do not treat Codex credits as runtime OpenAI API funding. [Prize details](https://luma.com/convex-allgas-hackathon).

No separate sponsor-track prize or numeric judging weights were found. Use all three runtime sponsors; ambiguity in minimum eligibility is irrelevant to an overall-win strategy. Auth v2 is promoted as experimental and is not required. The published judges include Convex, OpenAI, Firecrawl, AgentMail and healthcare AI representatives; expect technical questions and scrutiny of care-related claims. [Judges and criteria](https://www.convex.dev/hackathons/all-gas).

The deadline does not determine this plan’s scope. Historical start-date eligibility remains a fact to satisfy. Submission assets appear only in the checklist at the end.

**4. Scope: every must-have is part of the finished product**

| Must ship | Exact boundary |
|---|---|
| Real households | One care recipient per household; adult users and adult recipient; owner plus members; a user may belong to multiple households |
| Simple onboarding | Email one-time-code sign-in through Convex Auth and AgentMail, recipient nickname, household timezone, consent/authority, one responsibility; inbox provisioned in background |
| Membership | Email-bound invitation links, acceptance after sign-in, expiry, revocation, leave, owner transfer; no public member directory |
| Today | Current coverage, unassigned work, due tasks, next visit, waiting questions, changes, pending handover |
| Responsibilities | Meals, check-ins, errands, rides and custom logistical tasks; create/edit/claim/release/complete/reopen/cancel; attribution and history |
| Recurrence | Daily or selected weekdays, local wall time; edit one occurrence or this-and-future; idempotent occurrence generation |
| Coverage | Planned blocks, volunteer/withdraw, overlap warning, explicit start/end; a plan is not proof somebody arrived |
| Handover | Prepare, edit, choose recipient, publish, review, partial acceptance, decline, cancel, re-review stale version, immutable receipt |
| Visits | Date/time, confirmed address, ride owner, nonclinical bring-list, public source, phone and external navigation; mark completed/cancelled |
| Source review | Proposed changes with exact excerpt, source date and original; approve/edit/dismiss; preserve previous accepted facts |
| Household email | Unique real inbox; forwarding instructions; restricted contacts; source view; attach to task or visit; archive/unarchive/delete thread |
| Questions | Write or generate draft, edit, approve-and-send, delivery status, reply in same thread, resolve/reopen, follow-up draft on request |
| Notifications | In-app changes; opt-in generic email notifications to verified members; no sensitive email digest |
| Product resilience | Manual workflows remain usable through sponsor outages; retry, quota, partial data, duplicate and conflict states |
| Installable web app | Responsive SPA/PWA; cached static shell; clear offline state; no offline care-state writes or cached private records |
| Privacy controls | Access checks, consent withdrawal, export, household deletion, member revocation, retention controls and processor deletion tracking |
| Judge access | A private synthetic demo session reachable without invitation, with the same product components and real integrations |
| Quality evidence | Tests for responsibility correctness and abuse boundaries; real sponsor round trip; usability evidence |

**Cut from this product, not deferred behind placeholder buttons:** medication schedules/dose completion; clinical advice; symptoms/vitals; insurance appeals; emergency alerts; EHR/MyChart and hospital portals; document/PDF/image attachments and OCR; general chat; voice; provider marketplace; public family pages; shared inbox subaddress multiplexing; embedded maps/geocoding/geospatial; location tracking; full calendar grid; calendar sync; push/SMS; native mobile shells; billing; multilingual AI; agent trace UI; RAG/vector search; autonomous external follow-ups; legal or safety scoring.

“No half-app” means the narrow job is complete. It does not mean reproducing all features of a care-management suite.

**5. Information architecture and interaction contract**

Desktop navigation: **Today, Upcoming, Inbox, History**. Household switcher above navigation; Team and Settings below. Mobile: the same four destinations in a labeled bottom bar; household menu exposes Team and Settings. Handover is a prominent action inside Today and a deep-linkable detail screen, not a fifth permanent dashboard. Notification bell opens a sheet. Add opens a menu for Responsibility, Coverage and Visit. Short notes belong to these objects or a handover; there is no separate journal.

All household routes include `/h/:householdId`. Server membership, not the URL, authorizes access. URL-addressable detail pages render as side panels on wide screens and full pages on narrow screens. Back restores list position and filters. External links are explicit. No task-critical action depends on hover, drag-and-drop, swipe, or a tooltip.

**States shared by every authenticated screen**

- Initial query: fixed-layout skeleton; never display “nothing to do” before data arrives.
- Ready: meaningful content and a visible primary action. Background work stays local to the item being processed.
- Empty: explain why empty and offer the next relevant action; distinguish no records from no filter matches.
- Mutation pending: disable repeated action and label it “Saving,” “Claiming,” or “Sending.” Preserve entered values. Ownership transfer and mail send never appear successful before server acknowledgment.
- Error: human-readable explanation beside the operation, retained input, retry only when safe. Whole-screen failure has Retry and Return to Today. A single failed sponsor does not replace the board with an error page.
- Conflict: show the current actor/version and allow refresh/review; never silently overwrite another person’s decision.
- Offline/reconnecting: show status; read-only in-memory data may remain visible with “May be out of date.” Disable claims, completion, transfer and send. Do not intentionally enqueue offline mutations. A fresh offline launch contains only the shell.
- Session expired: sign-in continuation retaining the target route; clear private rendered content. Access revoked/deleted: remove data immediately, explain loss of access, offer household switcher.
- Success: changed row plus attributed activity; short toast only where helpful. Completion offers Undo as a compensating mutation, with conflict checking.
- Unknown route/missing item: 404 within the correct shell, without disclosing another household’s existence.

The following route matrix is exhaustive for the scoped product. Every row inherits those states; its additional states are mandatory.

| Screen / route | Content and every supported action | Empty / loading / error / success / live behavior |
|---|---|---|
| Public `/` | One-sentence promise, authentic product view with synthetic content, “Try a sample household,” “Start your household,” Sign in, privacy links | No fake activity. Sample creation has progress and capacity-error state; start redirects to auth. Returning authenticated user can open Today. |
| `/sign-in` | Enter email, request code, enter code, resend after cooldown, change email, back, privacy; preserve return route | Empty email/code, invalid email, sending, code sent, verifying, incorrect/expired code, throttled request, delivery failure with retry, cancelled flow, success. Verification includes the original email; success returns to setup or the authorized target. Use Convex Auth token expiry and verification; no home-built passwords or recovery flow. |
| `/start` | Recipient nickname; IANA timezone with explicit confirmation; adult/authority statement; data-use choices; add first logistical task; create | Inline validation; duplicate-submit guard; partial inbox provisioning must not duplicate household. Success opens Today; background inbox failure has retry in Settings. The user can begin manually. |
| `/join/:token` | Household inviter identity before acceptance; sign-in; review recipient nickname and household visibility; Accept/Decline | Invalid, expired, wrong account, revoked, already member, household gone. Do not expose care records before acceptance. Acceptance atomically consumes invite and adds membership; team views update. |
| `/h/:id/today` | Current coverage; pending incoming/outgoing handover; “Since your last handover”; unfinished and due work; next visit; waiting questions. Filter Mine/All. Add, open row, claim/release, complete, start/end coverage, review change, prepare handover | New household offers first task and invite. Finished work says “No open tasks for today,” never “All care is safe.” Uncovered period is explicit. Realtime inserts preserve focus; completed rows settle into collapsed Done section. |
| `/h/:id/upcoming` | Agenda grouped by date; responsibilities, coverage and visits; next/previous range; Mine/All; create/edit; change recurrence; claim coverage; link ride to visit | No entries → Add visit or recurring task. No filter match → Clear filter. Overlaps and missing ride ownership are visible. Changes and cancellations update all viewers without refresh. No month calendar. |
| `/h/:id/tasks/:taskId` and task form | Title, category, due local time or “No due time,” owner, status, note, source, history. Create/edit, claim, release, complete, reopen, cancel, restore, propose transfer; recurrence scope chooser | Unsaved-close confirmation; bad time/title; inactive assignee; stale edit; already claimed/completed. Completion records actor and server time. Owner changes are visible. Cancellation retains history; privacy deletion is a separate settings operation. |
| `/h/:id/coverage/:coverageId` and coverage form | Start/end, planned owner, note. Create/edit/cancel, volunteer, withdraw, Start coverage, End coverage | End-before-start and overlap warnings. Planned, unassigned, committed, active, ended, cancelled states. Current banner requires explicit start or accepted handover, never a timer alone. If end passes without a new start, show “Coverage needs confirmation.” |
| `/h/:id/handover/new` | Outgoing work; last accepted handover reference; all open owned items; relevant unassigned items; accepted changes and unreviewed notices; optional brief note; recipient; proposed next coverage end. Generate/rewrite intro, edit it, select proposed items, publish | No prior handover is a valid first handover. No second member → invite action. No unresolved work still permits coverage and note handover. Generation failure retains deterministic rows and editable manual intro. New material change marks preview stale until refreshed. |
| `/h/:id/handovers/:handoverId` | Published snapshot, source links, changes, proposed responsibilities, explicitly retained items, acceptor identity. Recipient accepts selected items, declines with optional reason; sender cancels pending handover; view receipt | Draft/preparing, pending, stale, declined, cancelled, accepted, superseded states. Acceptance disabled until current material changes have been reviewed. New version does not silently re-check acknowledgment. Only nominated member accepts. Success atomically changes selected ownership and coverage, records receipt, updates both Today screens. |
| `/h/:id/visits/:visitId` and visit form | Confirmed time/timezone; address; public page; phone; ride task; reviewed logistical checklist; source freshness; linked office question. Add/edit, choose source, paste note, check now, review proposed change, assign/claim ride, Navigate, Call, complete/cancel/restore | No source → visit remains usable. Source reading progress is inline. Wrong URL/blocked/failed/stale/no relevant facts are distinct. Missing address disables Navigate with explanation. Public notice never silently overwrites private appointment time. Ride completion and visit completion remain separate. |
| Source sheet `/h/:id/sources/:sourceId` | URL or email identity; fetched/received timestamp; quoted text; original plaintext; before/after; proposed field changes. Approve individual change, edit then approve, dismiss with reason, open public original, retry extraction, detach from visit | First scrape creates baseline, not “changed.” No trustworthy extraction → manual entry. Multiple visits/ambiguous date → user selects or leaves unresolved. Already-reviewed changes read-only with reviewer. Source deletion yields “Original removed,” never fabricated evidence. |
| `/h/:id/inbox` | New/Waiting/Archived filters; household forwarding address and Copy; processing rows; unknown-sender review queue; open thread; attach to visit/task; archive/unarchive | Provisioning, ready-empty, processing, failed extraction, attachment-only, quarantined, archived and no-filter-match states. Inbound body may appear before AI proposal. Attachments show “Not imported”; no silent missing content. Notifications and rows arrive reactively. |
| `/h/:id/inbox/:threadId` | Chronological plaintext messages, who sent them, source date, related task/visit, waiting state and drafts. Generate draft, type/edit, approve-send, discard, retry uncertain send through reconciliation, mark resolved/reopen, archive, delete with explicit confirmation | Draft generation/saving/failure; draft stale after new reply; sending/sent/delivered/bounced/rejected/unknown states. New reply shows “Reply received—review,” not automatically “Resolved.” Deleting a thread explains loss of source evidence and external copies. |
| Compose/review sheet | Exact sender, approved recipient, subject, editable plain text, evidence links, “Send this email.” Start from question or reply | Required recipient/body; recipient not approved; stale draft version; send already pending. For forwarded mail, original sender text is not a trusted reply address. Confirm a contact and start a new thread unless the AgentMail message is actually from the office. Send success links to provider-backed thread. |
| Notifications sheet | Unread changes, incoming handovers, assignment requests, replies, delivery failures. Open target, mark read/all read | Empty “You’re caught up”; pending query; retry. Read status is personal and reactive across devices. Reading a notification does not accept a handover or task. |
| `/h/:id/history` | Accepted/declined handovers and attributed task/visit changes; date and type filters; load more; open receipt/source | Empty first-use explanation; no matches; pagination error retry. Immutable receipts retain what was accepted; later corrections are separate events. New events badge rather than jump the scrolled list. |
| `/h/:id/team` | Members, role, invitation status; Invite link, copy, revoke, resend by copying new link, remove member, transfer owner, leave | Invite pending/accepted/expired/revoked. Owner-only administration. Removal shows responsibilities requiring reassignment; invalidate sessions’ access and pending handovers. Last owner cannot leave without transfer or household deletion. No automatic invitation email. |
| `/h/:id/settings` | Nickname/timezone; notification opt-in; email connection and approved contacts; AI processing consent; source watches; privacy policy; Export; leave/delete | Each save is scoped and recoverable. Timezone change previews effects on future recurrence, leaves historical instants unchanged. Inbox unavailable, watch paused, quota exhausted, export preparing/ready/failed, deletion pending/partially failed/complete. Never label deletion complete before all tracked active-data deletes succeed. |
| Public `/privacy`, `/consumer-health-privacy`, `/terms`, `/help` | Actual data uses/processors/retention, rights contact, boundaries, forwarding/help instructions and service limitations | Readable without sign-in, accessible on mobile. Help explains “planned,” “accepted,” “sent” and “source checked.” No invented certifications or response guarantees. |
| `/demo` | Creates isolated synthetic household using anonymous session; opens Today. Scenario controls: open second role view, send controlled office message, change controlled public page, reset, start a real household | Capacity queued/unavailable; all integration failures visible. Demo label persists on every screen and outgoing controlled mail. Reset affects only this session. Starting real use creates a clean household; never merges synthetic identities or data into it. |

**Forms and responsibility rules**

Task assignment to someone else is a request until that member accepts; owner may correct/override with an attributed reason. A handover acceptance can satisfy that request atomically. Claiming an unassigned task requires no second approval. Releasing work makes it visibly unassigned and notifies the household in-app. Completed, cancelled or changed tasks cannot be transferred using an old snapshot.

Completing a task records the action, not a medical truth. Use “Marked done by Maya.” Reopening requires a reason and preserves the original completion event. Soft cancellation is reversible; destructive privacy deletion is not disguised as cancel.

A planned coverage block is a commitment. Active coverage means somebody explicitly started it. Neither is proof of physical presence. Ending coverage without accepted replacement exposes the gap; the app does not claim to dispatch help. Prevent two active coverage owners by checking the current household record transactionally; planned overlaps can exist with a warning.

For recurrence, use a tested timezone library, not UTC-plus-24-hours arithmetic. Store IANA timezone, local wall time and weekdays separately from occurrence UTC timestamps. Generate a bounded rolling horizon and a unique logical key per occurrence; mutations enforce uniqueness through indexed lookup. For DST gaps, move to the next valid local time and label the adjustment; for repeated times use the first occurrence and show its offset. Test both. Editing a series never rewrites completed occurrences.

**6. Design system and consumer-quality bar**

Use **React + TypeScript + Vite**, **Tailwind CSS v4**, **shadcn/ui’s Radix variant**, **Lucide**, and **React Router declarative mode**. Use shadcn’s official Vite setup and component source; do not mix Radix, Base UI and Aria variants in one generated component set. Compose existing primitives rather than authoring dialog, menu, select, toast or navigation behavior. [Vite integration](https://ui.shadcn.com/docs/installation/vite), [Sidebar](https://ui.shadcn.com/docs/components/radix/sidebar), [router](https://reactrouter.com/start/declarative/installation).

Use Sidebar, Button, Badge, Card sparingly, Field, Input, Textarea, Select, Checkbox, Separator, Dialog, AlertDialog, Sheet, DropdownMenu, Tabs, Skeleton, Tooltip and Sonner. Use React Hook Form + Zod for forms and shared validation. Use native date/time inputs inside library fields; no custom calendar picker. Use `date-fns` plus `@date-fns/tz` for local-date operations. Convex owns server state; do not add Redux, a second query cache, or custom WebSockets. Supporting references: [Zod](https://zod.dev/), [timezone library](https://github.com/date-fns/tz).

The custom visual work is the responsibility row, handover receipt, evidence comparison, and page composition. Those are the product. Library chrome should account for nearly all other interactive UI.

| Design decision | Specification |
|---|---|
| Character | Calm, warm, direct. Feels like a well-kept household notebook with reliable controls. No hospital dashboard, neon gradients, chatbot sparkle, stock caregiver hero photo or decorative metric tiles. |
| Typography | Self-host Inter Variable; system fallback. Body 16px/1.5, metadata minimum 14px, section labels 16–18px, main heading 28–32px. Weight 400/500/600; tabular numerals for times. No light gray microtext. |
| Color tokens | Light canvas `#FAF9F6`, white surfaces, main text `#202824`, secondary `#56635C`, brand `#17654A`, neutral border `#D7DED7`; amber and red for action-needed and failure. Validate actual combinations to WCAG AA. Color always accompanied by text/icon. |
| Geometry | 4px spacing scale; 12–16px row gaps; 16–24px surface padding; 12px corner radius; 1px borders; shadows confined to overlays. Consistent alignment of time, description, owner and action. |
| Density | Desktop content max-width 1200px; main list plus 320px next-visit/handover rail where space allows. Show useful work above the fold. Avoid a card nested inside a card for each attribute. |
| Mobile | Works from 360px; one column, 16px gutters, labeled bottom bar and safe-area padding. Detail panels become full-screen pages. Sticky primary action must not cover content or keyboard. Main touch targets at least 44×44 CSS px. |
| Motion | Brief CSS transitions for focus, state and overlays; animate insertion without moving the item being used. No continuous pulse, floating decoration, confetti, typewriter summaries or fake progress. Respect reduced motion. |
| Accessibility | WCAG 2.2 AA target; visible focus, keyboard completion of every loop, proper headings/labels, error summary, return focus after overlay, screen-reader live announcements for saved/failed actions, 200% zoom and reflow checks. Never announce the whole board on every subscription update. |
| Language | “Needs an owner,” “Reply received,” “Leo accepted,” “Couldn’t check this page,” “Changed after you accepted.” Never “AI verified,” “care complete,” “all safe,” or “delivered” before provider confirmation. |
| Trust | Evidence is one tap away beside a claim. Show source-check time separately from author/published date. Unverified and stale content never receives a green success treatment. |

The accessibility target is an engineering quality requirement, not a blanket statement about which accessibility statute applies to this business. [WCAG 2.2](https://www.w3.org/TR/WCAG22/).

PWA: `vite-plugin-pwa`, prompt-based update flow, manifest, 192/512 and maskable icons, standalone display, root service worker. Precache only static application assets and self-hosted fonts. Exclude auth routes, API routes, webhook paths, queries and private data from runtime caching. Use a reload prompt that preserves unsaved work; do not also show a duplicate static-hosting update banner. Install help is optional and dismissible. Background WebSockets are not a notification strategy. [Vite PWA guide](https://vite-pwa-org.netlify.app/guide/).

**7. Locked stack, exact official pieces and their jobs**

Context7 MCP was actually used through the official remote endpoint, with `resolve-library-id` and `query-docs`, for Convex, Firecrawl, AgentMail, OpenAI, shadcn/ui, Vite, React Router and Convex Auth. Relevant library IDs were `/websites/convex_dev`, `/firecrawl/firecrawl-docs`, `/agentmail-to/agentmail-node`, `/websites/developers_openai_api`, `/shadcn-ui/ui`, `/vitejs/vite`, `/remix-run/react-router`, `/get-convex/convex-auth`. Context7 extracts were cross-checked against official documentation and repository source; index snippets sometimes lag newer package releases. [Context7 MCP source and endpoint](https://github.com/upstash/context7).

Registry versions observed during research: `convex 1.46.0`, `@convex-dev/static-hosting 0.2.1`, `@firecrawl/firecrawl-convex 0.1.1`, `@agentmail/convex 0.1.0`, `agentmail 0.5.27`, `@convex-dev/workflow 0.4.8`, `@convex-dev/rate-limiter 0.4.0`, `@convex-dev/auth 0.0.95`, `openai 7.19.0`, `react 19.3.0`, `vite 8.3.0`, `react-router 8.4.0`, `tailwindcss 4.3.3`, `shadcn 4.21.0`, `vite-plugin-pwa 1.3.0`. These were metadata reads, **not a tested compatibility matrix**. At implementation, use compatible official releases, commit the lockfile, and record the actual versions. Do not substitute preview auth or redesign the stack because a patch version differs.

| Piece | Exact use | Official reference |
|---|---|---|
| Convex | `query`, `mutation`, `internalQuery`, `internalMutation`, `internalAction`, `httpAction`; React `useQuery`, `useMutation`, `usePaginatedQuery`; schema validators and indexes | [React](https://docs.convex.dev/client/react), [HTTP actions](https://docs.convex.dev/functions/http-actions), [atomicity](https://docs.convex.dev/database/advanced/occ) |
| Hosting | `@convex-dev/static-hosting`; app-owned root; `registerStaticRoutes`; deploy Vite `dist/` to `convex.site` | [Official component](https://github.com/get-convex/static-hosting) |
| Authentication | `@convex-dev/auth`, email OTP delivered by AgentMail for real users; `Anonymous` only for synthetic demo; `ConvexAuthProvider`; `getAuthUserId` and membership checks | [Setup](https://labs.convex.dev/auth/setup), [Email OTP](https://labs.convex.dev/auth/config/otps), [anonymous](https://labs.convex.dev/auth/config/anonymous) |
| Firecrawl | `@firecrawl/firecrawl-convex`, `FirecrawlClient`, `map`, `scrape`; bounded public-page reading and change tracking | [Official component](https://github.com/firecrawl/firecrawl-convex), [change tracking](https://docs.firecrawl.dev/features/change-tracking) |
| Durable work | `@convex-dev/workflow`, `WorkflowManager`, `workflow.define(...).handler(...)`, `workflow.start`, `step.runAction`, `step.runMutation`; ingestion, scrape processing, approved sends and deletion | [Official Workflow](https://github.com/get-convex/workflow) |
| Limits | `@convex-dev/rate-limiter`, `RateLimiter.limit`; transactional per-user, household and global spend gates | [Official rate limiter](https://github.com/get-convex/rate-limiter) |
| Scheduling | `ctx.scheduler.runAt/runAfter`; fixed `cronJobs()` scan of due watch/reminder/retention rows | [Scheduler](https://docs.convex.dev/scheduling/scheduled-functions), [crons](https://docs.convex.dev/scheduling/cron-jobs) |
| AgentMail | Official `agentmail` Node SDK, `AgentMailClient`, inboxes, pods, threads, drafts, allowlists and signed webhooks | [Node SDK](https://github.com/agentmail-to/agentmail-node), [Drafts](https://docs.agentmail.to/drafts), [multi-tenancy](https://docs.agentmail.to/multi-tenancy) |
| OpenAI | Official `openai` SDK in Node actions; `responses.create` with strict `text.format` JSON schema, `store:false`; `gpt-5.6-luna` | [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [model](https://developers.openai.com/api/docs/models/gpt-5.6-luna) |

**Deliberate AgentMail component exception.** The current component source is version 0.1.0, its component config does not declare credential env wiring, and the relevant upstream fix remains open. Do not base the critical mail path on an unverified patch. Use the official SDK in Convex Node actions, AgentMail’s own thread/draft store, and small Convex projections for realtime UI. This adds application glue while avoiding a forked mail transport. [Component source](https://github.com/agentmail-to/convex), [open fix](https://github.com/agentmail-to/convex/pull/6).

Mount only static hosting, Firecrawl, Workflow and Rate Limiter. Auth is the official library. Workflow already uses Workpool internally: no extra queue framework. Do not add geospatial, presence, agent, action-cache, dynamic-crons or RAG merely to increase the component count. Convex depth comes from actual behavior.

Hosting wiring is fixed: `defineApp()` without an app-wide `/api` prefix; `app.use(staticHosting)` without its root HTTP mount; register auth and `/agentmail/webhook` exact routes, plus controlled demo-fixture routes, before `registerStaticRoutes(http, components.staticHosting)`. Mount Firecrawl under `/firecrawl/` with its typed env configuration. Verify root service worker, auth callbacks, deep-link reloads and webhook URLs on the deployed origin. The official root-routing option preserves these paths; default setup otherwise moves app routes under `/api`. [Hosting routing](https://github.com/get-convex/static-hosting).

Use one paid-capable operational account per sponsor; provision enough inboxes for actual households and simultaneous demo sessions. Do not purchase anything as part of this planning task. Free-tier limits are capacity constraints, not a reason to mix family inboxes. Deployment secrets stay server-side: OpenAI/Firecrawl/AgentMail keys, webhook secret, auth signing keys and model-inference credentials. `VITE_` contains only public configuration.

**8. Sponsor pipelines, including failure behavior**

**Firecrawl: create and maintain the visit’s logistical source.**

The user supplies a public location/preparation URL. Show the domain for confirmation. If they supply a clinic homepage, call `firecrawl.map(ctx, url, {search: "location parking visiting", limit: 20})` and present same-domain candidates for the user to select. Do not let the model choose a clinic branch. Persist the selected exact URL and extraction settings.

Call `firecrawl.scrape(ctx, url, {formats:["markdown", {type:"changeTracking", modes:["git-diff"], tag: watchTag}], onlyMainContent:true})`. The component passes v2 options through. Process `data.markdown`, metadata and `data.changeTracking` according to the actual returned REST envelope. Use `changeStatus` and the warning field; missing tracking data is an unknown comparison, not unchanged. [Component API](https://github.com/firecrawl/firecrawl-convex), [v2 change tracking](https://docs.firecrawl.dev/features/change-tracking).

Product rules: first successful capture establishes a baseline. Keep URL, tag and extraction settings stable. Subsequent successful captures compare relevant public logistical fields: address, entrance, parking, accessible entry, published office hours, and nonclinical items to bring. Retain source excerpts for old and new values. Never extract fasting instructions, medication changes or personalized clinical preparation into an actionable checklist. A general public page cannot establish that a private appointment has changed.

Compare extracted field values and source content hashes before creating a notice. Ignore footer/banner-only changes. Firecrawl detects website changes; the app still needs a lightweight comparison of relevant fields to explain their consequence. Schema changes establish a new baseline rather than manufacture a change alert.

Check saved sources while linked visits are upcoming, once per household-local day plus a user-triggered Check now subject to cooldown. Stop watches after all linked visits end or the user pauses them. Use one static cron to find due watch rows, not one cron registration per household. No endless public crawling.

Block credentialed/tokenized URLs, private addresses, IP literals, localhost, unsupported schemes and patient portals. Only public URLs are sent to Firecrawl; no recipient name, household notes or email. A 403/404, warning, blank result or timeout leaves the last successful source visible with failure/staleness information. Offer manual logistics entry and retry. Do not bypass login, robots restrictions or access controls. Sponsor quotas are rechecked during implementation. [Firecrawl terms](https://www.firecrawl.dev/terms-of-service), [rate limits](https://docs.firecrawl.dev/rate-limits).

**AgentMail: inbox, questions and actual replies.**

Provision one pod and inbox per real household using `client.pods.create({clientId})` and `client.pods.inboxes.create(podId, ...)`, with stable application provisioning IDs. Use SDK casing from its generated TypeScript types; REST fields are snake_case. Persist provider IDs only after successful creation; retries recover the same resource. Use opaque usernames with no recipient name. No shared bare inbox and no `+householdId` dependency. [Multi-tenancy](https://docs.agentmail.to/multi-tenancy), [idempotent resources](https://docs.agentmail.to/idempotency).

Register a signed webhook for the provisioned inboxes, including newly created ones. Verify raw body and `svix-id`, `svix-timestamp`, `svix-signature` with the official Svix library in an internal Node action called by the HTTP action; persist nothing and launch no work until verification succeeds. Deduplicate verified events by provider event ID. Respond after durable ingest, before model extraction. [Webhook verification](https://docs.agentmail.to/webhook-verification).

Provider IDs determine the household before any content is processed. Match replies using inbox ID plus thread/message references, never subject or quoted sender text. Record a bounded plaintext message projection and launch the ingestion workflow once. Treat content and links as untrusted data. Use provider extracted text when available; show the original plaintext on request.

Use inbox-level `client.inboxes.lists.create/list/delete` for send/receive/reply policies. Configure all three directions deliberately: inbound replies have their own list behavior. Maintain app-level approved contact IDs and check them again at send time; provider allowlists are defense in depth, not user authorization. Contacts are entered/confirmed by members, never silently added from an AI extraction. Members may forward mail. Messages rejected by a provider allowlist do not reach the app: explain that the contact must be approved and the message resent. If a delivered event nevertheless has unknown identity or ambiguous routing, quarantine it without extraction or notifications containing its contents. A family forward proves what that family member forwarded, not the original author's authenticity. [Lists API](https://docs.agentmail.to/lists).

Questions use `client.inboxes.drafts.create`, `get`, `update`, `send`, `delete`; reply drafts identify the real provider message via `inReplyTo` in the inspected TypeScript SDK (`in_reply_to` in REST). Use a stable `clientId` for draft creation retries. Use a new explicit contact-confirmed question when the source was forwarded by a family member; replying to that forward would reply to the family member. No default Reply all, CC, BCC, attachments, automatic follow-up, or scheduled send. [Draft lifecycle](https://docs.agentmail.to/drafts), [Create Draft](https://docs.agentmail.to/api-reference/inboxes/drafts/create).

Approve-send first records an immutable approved body/recipient/version hash and logical send ID in a Convex mutation. Lock draft editing while queued/sending. The send action refreshes the provider draft, verifies it matches the approval, rechecks current membership, contact allowance, consent and household status, then calls `drafts.send` with an `Idempotency-Key`. Persist returned provider message and thread IDs immediately; normalize the SDK's camelCase fields and webhook/REST snake_case fields at the integration boundary. Edits or new relevant inbound messages invalidate approval. A retry reuses the same key and exact payload; changing content creates a new approved version. [Send Draft](https://docs.agentmail.to/api-reference/inboxes/drafts/send).

AgentMail documents a 24-hour send idempotency window. Maintain a durable local send ledger beyond that window. For a lost response, reconcile provider thread/message state before retrying; after the window, ambiguous sends become “Status needs checking,” not an automatic new email. Delivery, bounce and rejection webhooks update separate delivery fields; out-of-order events cannot regress a terminal state to pending. “Sent” means provider accepted it; “delivered” is not read or agreed. [Send idempotency](https://docs.agentmail.to/idempotency).

Opt-in member emails use AgentMail and a fixed generic template with an authenticated app link. No recipient nickname, clinic, diagnosis, source excerpt or task title in subject/body. One notification per logical event/member/channel; no nagging campaign. The user’s opt-in authorizes this automation. A question to an office always needs the explicit send action. This brief does not authorize the builder to send real clinic or family emails while testing.

**OpenAI: bounded proposal generation.**

Use the Responses API in a Convex Node action, with model `gpt-5.6-luna`, `store:false`, strict JSON schema, fixed prompt/schema versions and bounded inputs/outputs. Its current official model page documents Structured Outputs support. Handle refusal, incomplete response, malformed or semantically invalid values and provider failure. No API key is needed for this planning task. [Model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [Responses Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

Three operations only:

| Operation | Output contract | Authority |
|---|---|---|
| Extract logistics | `proposals[]`: kind, title, raw date/time text or null, proposed field/value, source ID, exact quote, ambiguity reason or null | Creates review proposals only. No active deadline, owner or confirmed visit update without a human. |
| Draft a question | Subject/body plus referenced source IDs | Edits a provider draft. Cannot choose recipients, send, claim representation, promise medical outcomes or attach records. |
| Introduce a handover | A short editable introduction and referenced event IDs | Cannot remove/complete/reassign items. The complete responsibility list is deterministic and remains visible without AI. |

Every sourced assertion must have a quote that matches the stored source after a documented minimal whitespace normalization. Store source hash and offsets. An exact quote proves provenance, not truth or correct interpretation: reject unsupported inference, wrong branch, ambiguous time and clinical instructions even when surrounding text is quoted. User-entered notes are visibly user-entered, not artificially presented as cited facts.

Do not let email/page text supply instructions, tools, model configuration or URLs to crawl. The model receives explicit source blocks as data and no executable tools. Do not use model confidence percentages as verification. Unknown stays unknown. Hash source + schema + prompt + model versions to deduplicate work; changed user text or extraction version creates a new generation record.

A model outage preserves all manual operations. Never silently switch to a more expensive or differently approved model. Changes to the model require rerunning the extraction fixtures. OpenAI’s default abuse-monitoring retention is distinct from Responses application-state storage; `store:false` does not mean zero retention. State that accurately in the privacy policy. [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

**9. Data model and correctness invariants**

Use Convex IDs internally. Every household-owned row carries `householdId`; every public endpoint validates authentication, membership and role before reading or mutating it. Provider callbacks use verified provider-to-household mappings. Never accept a client-supplied household ID as sufficient authorization. All row lists are indexed, bounded and paginated where needed.

| Table / owner | Required fields and indexes |
|---|---|
| Official auth tables | Managed by Convex Auth. App profile includes display name and verified provider email. Never expose auth records wholesale. |
| `households` | Owner user ID, recipient nickname, timezone, mode real/demo, status active/deleting/deleted, materialRevision, currentCoverageId, consentVersion, processor provisioning state. |
| `memberships` | householdId, userId, role owner/member, status, joinedAt, notification preference; indexes by user, by household/user. One active membership per pair enforced transactionally. |
| `invites` | householdId, email-bound target, token hash, inviter, expiry, status, acceptedBy; index by token hash. Store no raw bearer token. |
| `consents` | householdId, actor, scope, noticeVersion, authority statement, granted/withdrawn timestamp; index by household/scope. |
| `taskSeries` | householdId, title/category, localTime, IANA timezone, weekdays, activeFrom/Until, proposedOwnerId, version/status. |
| `tasks` | householdId, seriesId optional, occurrenceKey optional, title/category, dueAt nullable, ownerId nullable, requestedOwnerId nullable, status open/done/cancelled, note, visitId optional, sourceRefs, version, completion actor/time; indexes by household/status/dueAt, household/owner/status, series/occurrenceKey. |
| `coverage` | householdId, startsAt/endsAt, plannedOwnerId, activeOwnerId optional, state, actualStart/End, version, note; indexes by household/start and household/state. |
| `visits` | householdId, title, confirmedStartsAt, timezone, confirmedAddress, phone, rideTaskId, logistical checklist, status, version, sourceWatchIds; index by household/start. |
| `watches` | householdId, URL, opaque tag, schemaVersion, settingsHash, lastSuccessfulSourceId, lastAttempt/result, nextCheckAt, active/status; indexes by due time and household. No personal information in tag. |
| `sources` | householdId, kind email/web/manual, provider references or URL, content hash, bounded plaintext, exact excerpts, capturedAt, publishedAt nullable, retentionUntil, extraction state, warning/truncation flags; indexes by household/provider-message and watch/hash. |
| `proposals` | householdId, sourceId, target type/ID or unresolved, proposed field/value, raw date text, quote offsets, status pending/approved/dismissed/invalid, reviewer/time, previous value, version; index by household/status. |
| `handovers` | householdId, sender/recipient IDs, baseMaterialRevision, lastReceiptId, item IDs+versions+snapshot labels, changed-event IDs, unreviewed proposal IDs, introduction, note, status, publishedAt, acceptedAt, acceptedItemIds, retainedItemIds, receiptRevision. Snapshots immutable after publish; refresh creates a superseding version. |
| `events` | householdId, monotonically ordered household sequence, actor/type, entity ID, before/after summary, sourceRefs, timestamp, handoverId optional; indexes by household/sequence and entity. App-append-only, subject to privacy deletion. |
| `mailAccounts` | householdId, podId, inboxId, address, provisioning status, allowed-contact sync status; unique lookup by inboxId. |
| `contacts` | householdId, label, exact email, entered/confirmedBy, consent/relationship record, allowed directions, state; index by household/address. |
| `mailThreads` | householdId, inboxId, providerThreadId, related item, status new/waiting/replyReceived/resolved/archived, lastMessageAt, lastProviderCursor; indexes by inbox/thread and household/status/time. |
| `mailMessages` | householdId, provider message/thread IDs, direction, sender/recipient display, bounded plaintext projection, sourceId, sent/receivedAt, delivery facts; indexed provider IDs. AgentMail remains the authoritative transport/thread store. |
| `mailDrafts` | householdId, providerDraftId, thread/item linkage, body/recipient projection, version/hash, editor, state generating/editable/approved/sending/sent/failed; provider drafts own mail preparation. |
| `sendIntents` | householdId, draftId/version/hash, logicalSendId, idempotencyKey, approver, immutable recipient/body snapshot or protected reference, status, provider IDs, attempts, lastError, reconciliation status; unique logical send index. |
| `webhookEvents` | provider event ID, type, inboxId, payload hash, receivedAt, status, workflow ID; no unnecessary full payload copies. Deduplicate in the ingest transaction. |
| `jobs` | householdId, logical operation key, workflowId, source/task references, state, safe error, attempt info; index by household/state and operation key. Stores user-visible progress, not a second job engine. |
| `notifications` | householdId, memberId, entity/event, type, readAt, channel/send intent; dedupe logical event/member/channel. |
| `privacyJobs` | householdId, requestedBy, kind export/delete, stage, per-processor results, requestedAt, completedAt, error; minimal receipt survives until its required retention ends. |

Keep source bodies separate from task/visit rows. Bound normalized text to a conservative size below Convex’s document limit; mark truncation and never claim to have read omitted attachments or content. Export includes domain records, evidence and provider message references with available plaintext, not passwords, signing secrets or API keys.

Critical invariants:

1. **Claims are atomic.** A mutation reads current owner/status/version before assigning. Two concurrent claims yield one winner; the other receives the actual new owner.
2. **Acceptance is atomic.** `acceptHandover` checks identity, active membership, pending status, material revision, selected-item versions and ownership. It transfers selected tasks, starts/replaces coverage only if explicitly included, writes an immutable receipt and events, and updates material revision in the same mutation. No side-effecting email call occurs inside it.
3. **Partial acceptance is explicit.** Receipt lists transferred, retained and unassigned items. Unselected tasks never disappear. Sender and recipient see the same result.
4. **A stale snapshot cannot be accepted.** Relevant task/visit/coverage/proposal changes increment `materialRevision`. New information while reviewing produces a visible diff and requires re-review. Notification read status and display preferences do not increment it.
5. **No time-based silent ownership transfer.** Scheduled coverage starts do not auto-claim tasks or accept handovers. The UI recalculates date/status display at boundaries using the confirmed household timezone.
6. **Source approval is atomic.** Revalidate proposal and target versions, apply selected fields, append event, retain original source and reviewer. Competing approvals cannot apply two conflicting versions.
7. **Side effects are retry-safe, not magically exactly-once.** App transactions atomically record intent; external calls use provider idempotency plus reconciliation. Do not promise cross-system exactly-once delivery.
8. **Revocation stops future effects.** Every queued send/extraction/watch rechecks membership where relevant, household active status and consent immediately before execution. Already delivered email cannot be recalled.

Convex provides serializable mutations; these domain checks still need to be written. [Convex atomicity](https://docs.convex.dev/database/advanced/occ).

**10. Realtime paths and backend responsibilities**

| Visible change | Backend path | Subscription |
|---|---|---|
| Claim, completion, release | Authorized mutation → tasks/events/materialRevision | `today.get`, `tasks.get`, `upcoming.list` |
| Handover publish/accept/decline | Authorized mutation → handover snapshot/ownership/receipt/events/notifications | `handovers.get`, `today.get`, `notifications.list`, `history.list` |
| New email | Signed HTTP event → idempotent ingest → mail projection → extraction workflow → proposals | `inbox.list`, `threads.get`, `proposals.list`, `today.get` |
| Public page check | Watch scheduler/user intent → workflow → Firecrawl action → validated snapshot → proposals | `visits.get`, `sources.get`, `jobs.forEntity` |
| Draft generation/edit/send | Authorized intent → workflow/provider draft → validated approval → send + webhook delivery | `drafts.get`, `threads.get`, `sendIntents.get` |
| Membership removal | Owner mutation → membership state + pending transfers/ownership review | Every household query fails closed; client removes private data |
| Deletion progress | Owner request → cancel effects → provider cleanup workflow → local purge | Requester-only `privacyJobs.get` |

Queries return only the projections a screen needs; no full household dump and no unbounded joined inbox. Separate job status from task data to avoid rerendering the entire board with processing updates. Presence is not required; explicit acknowledgment is the product truth.

Workflow names: `ingestMessage`, `refreshWatch`, `generateDraft`, `sendApprovedDraft`, `deleteHousehold`. Keep steps small and refer to data by ID; avoid placing raw mail into workflow arguments/journals. Where an action returns sensitive output, persist the bounded result inside the action and return only its ID. Retain and clean workflow journals deliberately. Set bounded concurrency and configure retries explicitly; Workflow action retries are not enabled by default. Use provider-aware retry behavior, respect `Retry-After`, stop on invalid credentials/credits/validation errors, and avoid multiplying component retries by outer retries. [Workflow execution and retries](https://github.com/get-convex/workflow).

Use fixed native crons for due watches, generic opted-in reminders, recurrence generation, retention and stale-job reconciliation. Reminder jobs reevaluate current status before sending. A reply or completed task cancels the pending reminder logically even if a scheduled callback still fires.

Apply a household allowance and deployment-wide ceiling before every paid operation. Anonymous demo identities are cheap to create, so per-user limits alone are insufficient. Initial household limits: five active source watches, ten manual source checks and twenty approved sends per day; each watch has a manual-refresh cooldown. Start with at most ten simultaneously active demo households and a global creation cap of thirty per day; the operator may raise these after provisioning capacity. Configure an initial total daily budget of 500 Firecrawl page operations, 1 million OpenAI input tokens / 100,000 output tokens, and 100 outbound messages; these are operator-controlled product limits, not vendor-plan claims. Reserve worst-case allowance transactionally and settle actual usage. Prevent retries and preview refreshes from bypassing ceilings. Show “Automatic processing paused; your board still works” when exhausted. Capacity limits must be visible and adjustable by the operator without a new frontend build. Keep a separate restricted operational view in Convex Dashboard, not a consumer integration console. [Rate Limiter](https://github.com/get-convex/rate-limiter).

**11. Privacy, compliance and operational boundary**

Build a direct-to-family logistics product. Do not sell it to providers or claim it is a clinical system. HIPAA applicability depends on the entity and relationships, not simply whether an app contains health data. A provider relationship can create business-associate obligations; a disclaimer cannot solve that. Consumer health privacy obligations can apply outside HIPAA. [HHS scope](https://www.hhs.gov/hipaa/for-professionals/covered-entities/index.html), [FTC guidance](https://www.ftc.gov/business-guidance/resources/collecting-using-or-sharing-consumer-health-information-look-hipaa-ftc-act-health-breach).

Assume the remaining identifiable care information is sensitive. The combination of user records and external messages warrants an HBNR applicability review; do not state that removing medications automatically excludes the product. Washington’s health-data law includes small businesses and consent/privacy/deletion requirements. California CMIA §56.06 can reach some health-information software. This planning review is not a determination of every US state obligation or of vendor contractual suitability. [Washington statute](https://app.leg.wa.gov/RCW/default.aspx?cite=19.373&full=true), [California §56.06](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=56.06.).

Implement these release requirements as product behavior:

- Real households require verified sign-in and membership; unguessable links alone are insufficient. Anonymous sessions can access only their own synthetic household. Test authorization on every query, mutation, action, export, source and provider lookup.
- Account holders and recipients are adults. Capture the creator’s authority to coordinate and share the recipient’s information; family relationship alone is not permission. Provide a rights contact and route for the recipient or authorized representative to request access/deletion.
- Show who in the household can see the shared board before inviting or joining. All members can see household records; do not imply per-note privacy. Owner-only administration is distinct from content visibility.
- Prominent public Privacy and separate Consumer Health Data Privacy links. Disclose categories, purpose, sources, recipients/processors, retention, rights and withdrawal. Obtain appropriate, unbundled consent for email import and AI processing. Withdrawal stops new relevant processing; manual coordination remains available.
- No ads, pixels, session replay, external font requests, tracking links or sensitive content in analytics/error logs. Product telemetry is limited to operational counts and explicitly consented research observations.
- Use plaintext email rendering; no remote images, HTML execution, auto-opened links or attachment previews. Email and crawled content cannot change permissions or invoke tools.
- Store the minimum: nickname rather than full identity; no DOB, SSN, insurance number, diagnosis fields, portal password or full medical record upload. Minimize identifiers before OpenAI calls; names are not needed to extract a time/entrance proposal.
- Default retention: demo households expire after 24 hours; raw/projection mail and source text after 30 days unless an active unresolved item requires them; completed operational history and receipts after 90 days. Keep current tasks/visits while active. Retention execution and provider cleanup must match the disclosed policy, not just the UI.
- Deletion immediately revokes access, pauses integrations and cancels future work. Delete AgentMail drafts/threads/inbox/pod as applicable, local projections, evidence, notifications and component workflow records. Use the provider’s official deletion APIs and keep a minimal status receipt. Do not promise recipient email recall or instant deletion from processor security logs/backups. [AgentMail thread deletion](https://docs.agentmail.to/api-reference/inboxes/threads/delete).
- Export uses a private authorized response/download with no durable public link. No publicly accessible care PDFs or storage URLs. Browser download is user initiated; explain that the downloaded copy leaves app access control.
- A written incident runbook identifies the operator, containment, evidence preservation and applicable notification assessment. Verify contractual processor retention/deletion and any required health-data agreements before admitting real household health information. A public synthetic demo alone does not establish readiness for real care data.

Do not cover every screen with legal banners. Onboarding, privacy pages, source/clinical boundaries and Help carry precise disclosures. Use a concise persistent boundary in relevant views: “For coordination. Confirm medical instructions with your care team.” Do not imply that this statement creates legal compliance.

**12. Demo and validation that can withstand judging**

The public sample path must create an isolated synthetic household, not show a video or mutate a shared public board. Anonymous sessions use the same schema, queries, mutations, design and workflows as real households. The only differences are synthetic identities, restricted destinations, controlled fixtures and expiry. Demo roles are server-bound to that household; clients cannot choose arbitrary user IDs.

Use one recipient, Maya and Leo, a meal, grocery pickup, one ride, one visit and one unanswered logistical question. A second-role preview uses a separate session/capability restricted to that demo household; label it “Leo’s demo view.” A judge can experience the loop alone, while a second browser can demonstrate actual realtime propagation.

Provide a controlled public “Sample Clinic — demo fixture” logistics page with real HTTP responses, two text versions and an unmistakable synthetic label. Scenario actions change that page, then call the real Firecrawl path. A controlled office inbox sends and replies using AgentMail; every recipient is an operator-owned allowlisted inbox. Scripted replies are disclosed. Neither the AI extraction nor the email/crawl transport is faked. Also verify at least one user-selected real clinic’s public logistical page; a fixture alone does not establish usefulness against the web.

The demonstration story is: open Today → expose an unowned ride and waiting question → receive the office reply → review the proposed visit change → check the public source and review the entrance change → publish a handover → accept part of it in Leo’s view → show ownership and remaining work update → show a later change marked new. Let the product carry the story. If a live integration fails, show the real recovery state, not a fake success animation.

**Definition of done — binary acceptance tests**

| Area | Passing evidence |
|---|---|
| Core differentiation | Published handover contains all unresolved selected/retained items, material changes and unreviewed notices; recipient acceptance records exactly what was reviewed and taken. |
| Two-person correctness | Simultaneous claim, completion-versus-transfer, sender edit-versus-acceptance, two acceptance attempts and newly arrived proposal-versus-acceptance have correct single outcomes. |
| Live product | Two independent sessions observe task, proposal, reply and accepted handover updates without refresh. Reconnection resynchronizes accurately. |
| Real sponsor depth | A real public page produces cited logistical fields; controlled page change creates genuine comparison evidence; external controlled email creates a source; approved draft is delivered and its reply routes back; OpenAI output affects the review surface. |
| Email correctness | Duplicate webhook, spoofed signature, missing/unknown inbox, out-of-order delivery, forwarded message, mismatched draft approval, lost send response and expired idempotency-window scenarios pass. No automatic resend of an ambiguous message. |
| Extraction | Maintain at least 40 fixtures covering ambiguous dates, multiple branches, contradictory instructions, unchanged footer, malformed text, prompt injection, clinical content, duplicates and attachment-only mail. No unsupported proposal is auto-applied; every surfaced quote matches. Report extraction precision and abstention separately. |
| Tenant isolation | Cross-household IDs, stale invite, wrong-account invite, removed member, demo-to-real escalation, unauthorized export and provider ID access all fail closed. |
| Failure usability | Model/crawler/email outage, quota exhaustion, offline, auth failure, stale data and partial deletion have working UI states and manual continuation where appropriate. |
| Persistence | Reload/deep link preserves confirmed state. No local-storage-only tasks or fake frontend mutations. |
| Recurrence | Idempotent generation; one/future edits; cancellation; timezone change; DST spring gap/fall repetition; midnight turnover. |
| Privacy | Export is private and usable. Delete stops further jobs and removes active data from app and supported provider stores; partial failures remain visible. No private content in static cache or logs. |
| UI | All routes reviewed on narrow mobile and desktop; keyboard-only handover and source review; screen-reader labels and focus; reduced motion; 200% zoom; no overflow or clipped primary actions. |
| Adoption | At least five consenting target households attempt the core loop; at least four complete a two-person handover without builder intervention, and at least three voluntarily use it for a subsequent real handover. These are proposed go/no-go thresholds, not claimed results. If missed, fix onboarding and the handover interaction before adding features. |

Use `convex-test`/Vitest for domain invariants and signed-event handling, and Playwright for separate-session flows and responsive checks. Run genuine provider smoke tests against operator-controlled resources. Tests should exercise outcomes and failure boundaries, not merely mirror implementation functions. No test suite or app was created during this research task.

The concept passes the strategic gate; the finished product earns the winning claim only when these outcomes are observed. If families do not accept and repeat handovers, a prettier board or another sponsor component does not fix the central weakness.

**13. What remains unverified**

The official event and Luma pages, live public catalog, closest entrant writeups, current primary API docs, component source and Context7 extracts were checked. Backpack’s public landing UI was inspected, but competitors were not comprehensively tested end to end. The Vibe Apps submission route loaded only a shell in the browser session; extra authenticated form fields could not be verified. The official published submission checklist is the basis below.

No private submissions, later entrants, judge weighting, judging-agent behavior, trademark clearance for “Handoff,” actual user retention, vendor-account quotas/entitlements, tested package compatibility, complete US legal assessment, or healthcare processor-contract suitability were verified. Do not turn these gaps into claims. “Handoff” is a working name; check naming rights before brand investment. API docs confirm capability, not production keys, credits or successful deployment.

**14. Submission artifacts — checklist only**

- [ ] Eligible team registration and new-project evidence; original work and licenses documented.
- [ ] Public `convex.site` app with public sample entry and fully working private-household flow; test the submitted URL signed out.
- [ ] Public GitHub repository, reproducible setup, environment-variable example without secrets, committed dependency lockfile and test instructions.
- [ ] Root `hackathon.md` maintained from actual build evidence with the official [hackathon skill](https://github.com/get-convex/convex-hackathon-skill); include what works, hosting, auth, models, components, sponsor paths and known limitations.
- [ ] Product video **under three minutes** showing the real loop; label synthetic identities, controlled office and fixture page. Include realtime transfer and actual sponsor effects.
- [ ] X or LinkedIn post tagging Convex, OpenAI, Firecrawl and AgentMail; permission for any participant quote/image; no invented social proof.
- [ ] Submit repository, live URL and video through the official [All Gas submission form](https://vibeapps.dev/judging/convex-all-gas-hackathon-openai/submit); verify any additional fields in the live form.
- [ ] Keep the deployed demo and its integration capacity available for judging; operator contact and privacy/help pages work.
