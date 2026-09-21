# Handoff — family-care product direction

Research and repository review: **20–21 September 2026 (Asia/Kolkata)**. This is the researched product specification. Its repository comparisons describe the pre-implementation checkpoint; the additions were subsequently implemented. See [current handover](HANDOVER.md) and [release status](implementation-status.md) for actual delivered behavior and evidence. Map implementation uses MapLibre, OpenFreeMap and Photon; earlier proposed MapTiler choices below are superseded.

This direction supersedes the earlier execution brief’s exclusion of maps, medical documents and a reference medicine list. Keep the existing accepted-handover mechanism, but make it part of a complete care workflow. Preserve the user’s web-only, native HTML/CSS/JavaScript stack and Google-for-model-inference-only constraint. Do not reinterpret requested features as optional.

## Product decision

**Build the shared care workspace for adult children coordinating an aging parent’s care, especially when appointments, new paperwork or a return home create work for several people.** One adult care recipient per space; multiple spaces remain possible. The parent can participate and control sharing where able. A person coordinating alone must get immediate value from records and visit preparation before inviting anyone.

The promise is: **Keep your parent’s records, appointments and family responsibilities connected, so everyone knows what happens next.**

The complete loop is **capture a record or update → review its meaning for the plan → prepare the visit and transport → name the person responsible → record what happened → hand over unresolved work → follow through on new results and replies**. The organizing object is a care activity with its records, people, location and unresolved questions attached. Do not make families maintain a document cabinet, calendar, task manager and chat as four disconnected systems.

This is a stronger direction than the present vague care/planning pitch. It is a credible product hypothesis, not proof of demand or a guaranteed hackathon win. Adding a vault and map alone will not differentiate it. The distinctive execution must be the continuity from source information to reviewed next steps and explicitly accepted responsibility.

## What the evidence establishes

| Evidence | Verified finding | Product implication and limit |
|---|---|---|
| [NIA caregiver worksheets](https://www.nia.nih.gov/health/caregiving/caregiver-worksheets) and [important-documents checklist](https://www.nia.nih.gov/sites/default/files/2023-04/worksheet-important-documents-and-paperwork.pdf) | Care organization includes shared tasks, medicine lists and accessible important documents. | Records belong in the product. This does not justify copying every financial or password-storage suggestion into Handoff. |
| [NIA visit preparation](https://www.nia.nih.gov/health/medical-care-and-appointments/talking-your-doctor-worksheets) | Preparing questions, relevant history, changes and medicines is part of preparing for a consultation. | Connect selected information to a printable visit pack rather than leaving it scattered across tabs. |
| [AHRQ patient discharge checklist](https://www.ahrq.gov/sites/default/files/wysiwyg/professionals/systems/hospital/engagingfamilies/strategy4/Strat4_Tool_2a_IDEAL_Checklist_508.pdf) | Returning home involves help at home, understanding instructions, follow-up, transport, questions and pending results. | Use return-home and follow-up coordination as a concrete entry scenario. Handoff records the clinician’s instructions; it does not author medical instructions. |
| [ASTP/ONC 2024 national survey brief](https://healthit.gov/data/data-briefs/individuals-access-and-use-patient-portals-and-smartphone-health-apps-2024/) | 59% reported multiple medical records/portals; 7% used an organizer app to combine records. The authors also identify low demand as a possible explanation for low organizer adoption. | Fragmentation is real; willingness to adopt another organizer is unproven. Deliver an immediate useful output, not a large setup form. These are general survey results, not Handoff’s target-market conversion rates. |
| [Patient proxy-access interview study](https://pubmed.ncbi.nlm.nih.gov/30389654/) | Ten older patients described benefits and unwanted disclosures from caregiver portal access. | Support limited sharing. This small 2018 qualitative study identifies concerns; it cannot establish their prevalence today. |
| [AARP/NAC 2025 research](https://www.aarp.org/pri/topics/ltss/family-caregiving/caregiving-in-the-us-2025/) | The US has an estimated 63 million family caregivers across the report’s caregiving population. | The category is substantial. Do not present all 63 million as adult children caring for aging parents, or as Handoff’s reachable market. |

These sources support the jobs families perform. They do not demonstrate that this implementation saves hours, prevents hospitalizations, improves clinical outcomes or will win. No caregiver interviews or real household adoption study were conducted here.

## Competitive reality

These are current first-party product descriptions, not hands-on verification of competing products.

| Product | What its own material already offers | Consequence |
|---|---|---|
| [Caring Village](https://caringvillage.com/app/) | Shared coordination, documents, medication support, calendar, journal and AI. Its [care-team article](https://caringvillage.com/blog/care-coordination/family-professional-caregivers/) also describes handoff checklists. | Neither “all-in-one care” nor “handoff” alone is a unique claim. |
| [Guava](https://guavahealth.com/faq) | Record uploads, connected records, sharing, visit preparation and export. | Searchable PDFs, AI extraction and a visit pack are useful baseline features, not a defensible novelty claim. |
| [Luffu](https://luffu.com/) | Family health organization with documents, multiple input methods, medicines and differentiated access. | Avoid leading with “AI family health companion”; that space is occupied. |
| [Lotsa Helping Hands](https://care-givers.lotsahelpinghands.com/how/) | Volunteer coordination, rides, help requests and reminders. | A map and ride signup need to connect to the visit and responsible person to add value. |
| Group chat plus hospital portals | Familiar communication and authoritative records remain in systems families already use. | Handoff must eliminate repeated explanation and copying. It is a coordination layer, not a replacement hospital record. |

The prior brief reviewed hackathon entries including Backpack and Ombuds. Their individual submission pages could not be re-fetched in this research; the old descriptions are historical evidence, not a freshly verified or exhaustive competition roster. Do not claim no competitor has the same workflow.

## Required product scope

### 1. Medical records and care documents

Add a private, searchable records area accepting **PDF, JPEG and PNG**, through direct upload and reviewed email attachments. Initial product limits: **10 MiB and 100 PDF pages per file**; validate server-side and explain limits before upload. These are conservative product choices, not statements about maximum provider capacity. Support a batch of independently progressing files. Unsupported, oversized, corrupt and password-protected files retain clear recovery instructions and never appear as successfully processed.

Use categories: medical/lab reports, discharge and visit summaries, prescriptions, referrals, insurance, care authority/advance directives, and other care paperwork. Store the untouched original; distinguish document date from upload date, document author from uploader, and email forwarder from original sender. Users can correct title/date/category/provider, link a visit, and decide visibility before information is shared more widely.

Each record has a page preview, original download, provenance, review status, version history and related actions. Extraction produces proposed metadata and next steps with **page references and short source excerpts**. Show uncertainty and missing fields; never invent an appointment date, interpret a result as safe/unsafe, or silently convert ambiguous handwriting into a confirmed medicine dose. A model can describe what the document says, with clear attribution. Any interpretation needed for care goes into a question for the clinician.

Allow manual filing and action creation even if AI fails or the user declines processing. A document can be useful without extraction. Provide text search and filters by type, date, provider and linked visit. Search only accessible content. When no text is available, say so and keep metadata search available; do not imply every scan is fully indexed. Start with native text search, not a new vector database or conversational medical assistant.

Handle exact duplicate uploads by file hash and email attachments by inbox/message/attachment identity. Let users identify a corrected record as a new version; do not overwrite the previous original. Newer does not automatically mean clinically current. Link approved fields to the exact version and reviewer. Deleting a source must explain effects on derived notes, extracts and future access; retain only the minimum non-content audit metadata the retention policy requires.

### 2. A current care profile and medicine reference

Add the parent’s preferred name, emergency contacts, providers, pharmacy, insurance reference, relevant allergies, accessibility/communication needs, routines, preferences and reviewed care instructions. Distinguish **unknown**, **not provided** and **explicitly confirmed none**. A blank allergy field must never render as “no allergies.”

The medicine list stores names, strength, route and directions exactly as entered or reviewed against a source, with prescriber, last-confirmed date and current/discontinued/uncertain status. Keep conflicting lists visible for reconciliation with a clinician or pharmacist; do not resolve them by the latest upload timestamp. Refill requests and collecting a prescription are assignable administrative tasks.

This release is a **reference list**, not an electronic medication administration record: no AI dose advice, interaction checking, inferred adherence, pill counting or “safe to take” claims. A list timestamp means a family member reviewed it, not that a clinician certified it. Clinical emergency instructions are user-provided or source-linked, never model-generated.

### 3. Visit preparation, follow-up and pending answers

Extend each existing visit into a connected workspace: confirmed date/time and timezone, purpose, provider, location, preparation instructions from a source, questions, selected records, medicine reference, accessibility notes and ride responsibility. A referral to book a visit is a task until a date is confirmed; do not create a fictitious appointment.

Produce a **reviewed visit pack**: chosen questions, relevant recent changes, medicine/allergy reference and selected source documents. Let the user preview, remove items and print/download it. Include preparation timestamp and source references. Sharing means a deliberate choice of recipient and content; it is not a blanket export of the entire medical history.

After the visit, capture what the family heard, attach new paperwork, record the next appointment and create reviewed follow-up tasks. Add a first-class **waiting for** state for results, office answers, referral processing and callbacks: owner, requested date, follow-up date, contact and related visit. An incoming report does not automatically mean the question is answered or its contents understood. The assigned person explicitly closes or updates the item.

### 4. The required map and practical transport

Include a map/list view of saved care locations: clinics, hospital departments, pharmacies and other destinations attached to errands. Visits show the same place record, address, entrance/parking instructions, accessibility notes and public source last-checked time. Confirm the selected address and pin after geocoding; do not silently trust the first search result.

Ride work includes pickup, destination, arrival requirement, accompanying person, named driver, acknowledgement and status. Keep a return ride as a separate responsibility when needed. Offer an external directions action and a copyable address. Map failure must leave the complete location/ride list usable. Do not invent route times or show live ETA without a real routing/location source.

Use **MapLibre GL JS with MapTiler** for map tiles and address search; this respects the restriction against adding Google services. A key, suitable plan and applicable usage terms still need confirmation before implementation. No map account was purchased or provisioned. Send only location data needed for map/search, not patient names, document text or diagnoses. No background tracking or geolocation requirement. Hide home addresses from helpers who do not need them.

### 5. Shared responsibilities, availability and handovers

Reuse tasks, recurrence and coverage. Add explicit availability and replacement requests so a person can say they cannot cover an assignment without leaving it silently assumed. A request, an accepted assignment, completion and a completed handover are separate events. Include appointments, meals, errands, home support and administrative calls in one responsibility system.

Add short daily notes with author/time and links to the relevant activity; default to “what changed / what needs attention,” not a mandatory journal. Notes can be subjective observations and must remain labeled as such. Avoid automatically turning an observation into a diagnosis or safety alert.

Keep the existing handover’s accepted version, partial acceptance and ownership transfer. Extend its context to approved documents, visit follow-up, relevant profile changes and pending answers. Newly received information after acceptance stays visibly new. Responsibility can transfer only to someone allowed to see enough context to carry it out. Acceptance is acknowledgement of selected responsibilities, not consent to treatment or certification that the parent is safe.

### 6. One intake queue and a usable care team

Combine uploaded files, forwarded messages, office replies and public location changes into **Needs review**. Each proposal exposes source, changes, related records and accept/edit/reject actions. Preserve the existing plan until approval. Batch review must not hide conflicts or clinical ambiguities.

Create a real care-team directory: family/helper roles plus providers, pharmacy, preferred contact methods and office details. Existing email-contact permissions are reusable but do not already provide this directory. Keep messaging attached to the relevant visit/question/task. Reuse reviewed outbound mail and delivery receipts; do not build another social chat feed.

### 7. Sharing that reflects how care works

Current household owner/member access is too broad for a medical vault. Add clear presets backed by per-resource grants:

- **Care recipient / authorized coordinator:** manage the space within the recorded authority; account ownership alone does not confer medical decision-making authority.
- **Care-circle member:** receive explicitly granted records/profile information and assigned work.
- **Limited helper:** see assigned tasks and the minimum pickup/contact/location details, without automatic access to diagnoses, medicines or reports.

Record who is being cared for, who granted access and the declared basis for coordination. Respect the parent’s participation and preferences; a checkbox is not verification of legal authority. Removing a member revokes future access and subscriptions. Derived summaries, search snippets, notifications, exports and handover snapshots must inherit restrictions from their source material; hiding only the PDF is insufficient.

Allow explicit, recipient-bound, expiring access to selected visit-pack information. For the first implementation, recipients sign in with the existing email-code flow; do not use permanent public file links. Explain that downloaded or emailed copies cannot be recalled. Notification subjects should be generic by default. Do not put report contents in analytics, public support logs or advertising systems.

## Information architecture and interaction contract

Use the existing shared shell and one recipient switcher. Main navigation: **Today · Care plan · Records · People · Inbox**. Settings and history remain secondary. Handovers are prominent actions in Today/Care plan, not another disconnected destination. Medicines and care essentials live within the care profile accessible from the recipient header; the map is available from Care plan and every visit.

| Screen | Main actions and live behavior | Empty, progress and recovery states |
|---|---|---|
| Landing / sample family | Explain audience and complete loop; enter a clearly labeled synthetic family or sign in. | Sample unavailable has a retry and sign-in path; never show fake customer activity as proof. |
| Setup | Create a care space, record authority, choose first useful action: upload a record or add an appointment. Invite afterward. | Saving/saved/failure; preserve entered data. No forced full medical intake. |
| Today | Show next visit, unclaimed responsibilities, pending answers, new information and handover action. Update accepted ownership and review counts live. | Empty gives one useful next action; loading uses stable placeholders; disconnected shows last-known state/time, not false live status. |
| Care plan | List/calendar views of existing tasks and visits; assign, confirm, complete, request replacement; open map. | Clearly separate no work, no filter matches and unavailable data; conflicting edits offer current version and retry. |
| Visit / ride detail | Prepare questions, attach records, review pack, confirm driver, open directions, record outcome and pending results. | No date/provider/driver/records remain individually actionable; canceled and rescheduled visits retain history and update affected tasks. |
| Records | Upload/forward, search/filter, categorize and link. Processing changes appear without reload. | No files; upload progress; queued/processing; needs review; reviewed; partial extraction; retryable failure; unsupported/locked file; access removed. |
| Record detail / review | Preview pages, compare proposed fields to evidence, correct, approve selected actions, replace version, share, download or delete. | Original still accessible during extraction failure; unreadable pages are named; conflicts require a choice; deletion/access loss closes content. |
| Care profile | Edit essentials, providers, medicines and preferences with source/reviewer timestamps. | Unknown versus confirmed-none; unresolved conflicting medicine entries; source removed; stale confirmation visible without fake clinical urgency. |
| People / availability | Invite, choose access, accept/decline coverage, request substitute, revoke or transfer coordination. | Pending/expired/declined invite; no replacement yet; insufficient permission; access changes reflected immediately. |
| Inbox / Needs review | Read linked messages and attachments, review changes, draft/edit/send questions, see replies and delivery state. | No mail; mailbox unavailable; attachment fetch expired; send pending/unknown/failed; retries cannot silently duplicate sends. |
| Handover | Select recipient, preview changes/unresolved work, accept selected responsibilities, view immutable receipt. | No eligible recipient; no open work; partial acceptance; stale version; declined/canceled handover; new information after acceptance. |
| Share / privacy / export | Preview exactly what will be shared, choose recipient/expiry, revoke, export or delete. | No access, expired share, export preparing/ready/failed, deletion pending/completed. State what copies remain outside Handoff. |

Global actions must preserve user-entered work on errors. Do not show a completed action until the backend confirms it. Realtime access revocation clears private content as well as hiding navigation. Accessible list views remain complete alternatives to maps and calendars.

## Landing-page refactor

The current hero, “Your space for care, plans, and peace of mind,” does not say who the product is for or what it does. Replace the generic productivity narrative with this sequence. These are proposed product claims: publish them only as the corresponding functionality becomes real.

1. **Hero:** “Care for your parent, together.” Supporting line: “Keep medical records, appointments, medicines and family responsibilities connected—so everyone knows what happens next.” Primary CTA: **Create your family’s care space**. Secondary: **Explore a sample family**.
2. **Product proof:** one coherent screen sequence showing a report, reviewed follow-up, assigned ride and accepted handover. Use the actual completed product; clearly label synthetic people and records. Avoid a collage of unrelated cards.
3. **The familiar problem:** paperwork in a folder, appointment details in messages, and uncertainty about who is helping. Show the concrete resolution without dramatizing caregiver guilt.
4. **Records that lead somewhere:** find a report, see its source, attach it to the next visit and review the work it creates. Say “Upload or forward your documents”; do not imply automatic access to every hospital portal.
5. **Ready for the next visit:** questions, relevant records, medicine reference, location and a confirmed ride together.
6. **A family plan that stays clear:** named responsibilities, availability/replacement requests, unanswered questions and explicit handovers.
7. **Visible trust:** show the sharing controls, source/reviewer timestamps, export/delete controls and a plain explanation of where AI helps. Link privacy terms and an actual support contact. Trust comes from verifiable behavior.
8. **FAQ and final CTA:** who it is for; whether relatives need an app installation; how records get in; who can see them; what AI does; how to leave/export; current pricing/access terms if defined. Do not invent a free-forever plan.

Preserve **Inter + Source Serif 4** and shared palette in `web/tokens.css` so landing, authentication, records and app feel consistent. Reuse existing controls, spacing, dialogs and empty-state patterns; add PDF.js and MapLibre for specialized surfaces instead of rebuilding viewer/map chrome. Keep high information clarity and comfortable type; reserve color for understandable states and never rely on color alone. Use short functional transitions and reduced-motion support, no decorative parallax. Retain normal web layout behavior without expanding scope into a mobile app or PWA.

Design references may come from full, fully rendered **1920×1080 or equivalent full-desktop captures**, as the user requested. Do not make design decisions from clipped/partially rendered references. Existing Craft-inspired decorative asset redistribution rights were not established; use original or demonstrably licensed graphics in the refactor. A reference is not permission to copy an asset or a competitor’s claims.

Credibility must not use fabricated testimonials, user counts, doctor endorsements, fabricated hospital affiliations, badges inferred from a vendor’s certifications, “100% accurate AI,” “never miss a dose,” “prevents emergencies,” or unverified time-saved numbers. Sponsor logos identify actual infrastructure use, not medical endorsement.

## Implementation handoff: reuse, extend, connect

Repository review confirms the existing tasks, visits/rides, coverage, source review, mail, handovers and receipts are useful foundations. `convex/schema.ts` does **not** yet contain a medical document library, structured medicine reference or limited-helper document access. `_storage` references currently support privacy exports. The Gemini request in `convex/model/responses.ts` currently sends text only. New file handling and access controls are substantive work, not landing-page edits.

| Layer | Locked approach and official reference |
|---|---|
| Backend and realtime | Keep Convex and existing authenticated functions. Native [`ConvexClient.onUpdate`](https://docs.convex.dev/client/javascript/overview) supports the current ES-module frontend; no React migration is needed. |
| Files | Use [Convex file storage](https://docs.convex.dev/file-storage/overview), authenticated upload authorization, metadata registration and private download/preview through an authenticated HTTP action that checks resource access on each request. [Serving-files docs](https://docs.convex.dev/file-storage/serve-files) distinguish public storage URLs from HTTP-action access and document the 20 MB response limit. Do not use `getUrl` as a revocable private-share mechanism. The chosen 10 MiB file cap stays below that response limit. |
| Processing | Reuse installed [`@convex-dev/workflow`](https://www.convex.dev/components/workflow) for durable import → extract → propose transitions and cancellation/retry. Keep an import status for UI, not another custom workflow engine. Use idempotent attachment identities and approval mutations. |
| PDF preview | Use official [Mozilla PDF.js](https://mozilla.github.io/pdf.js/examples/) in the existing vanilla frontend. Feed authenticated bytes to the viewer; preserve page numbers. Do not publish originals to obtain previews. |
| Model | Extend the existing Gemini adapter with PDF/image media parts using the documented [`generateContent` request](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/models/inference). `inlineData` avoids a new Google storage service. [Document understanding](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/document-understanding) has recognition limitations, especially handwriting and precise layout. Parse metadata and source-linked proposals, not diagnoses. Enforce request limits independently of file-storage limits. |
| Email | Reuse AgentMail webhooks, inboxes and reviewed outbound sends. Retrieve attachment metadata with [`inboxes.messages.getAttachment`](https://docs.agentmail.to/api-reference/inboxes/messages/get-attachment), fetch its short-lived `downloadUrl` server-side within byte/type limits, then store the original privately in Convex. Treat inbound files and text as untrusted data. No external message was sent for this research. |
| Public location information | Keep installed `@firecrawl/firecrawl-convex` and [Firecrawl v2 scrape](https://docs.firecrawl.dev/features/scrape), `POST /v2/scrape`, for public clinic/pharmacy pages and quoted access/parking/contact changes. Do not send medical records or scrape signed-in patient portals to manufacture sponsor usage. Public opening hours never prove a patient’s appointment is confirmed. |
| Geographic map | [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) plus [MapTiler geocoding](https://docs.maptiler.com/cloud/api/geocoding/), `GET /geocoding/{query}.json`. Confirm coordinates, retain attribution, constrain keys appropriately, and honor the selected plan/terms. A tile/geocoding provider necessarily receives some location/view information. |
| Authentication and hosting | Retain the existing email-code auth and installed [`@convex-dev/static-hosting`](https://www.convex.dev/components/static-hosting). Do not add Google OAuth or other Google application services. Public frontend assets and private patient files require separate serving/access rules. |

**Context7 use:** current Convex, Gemini and AgentMail documentation was queried through Context7. Direct official docs and installed package types were then cross-checked. A material discrepancy was found: a Context7 AgentMail example described binary attachment output, while the installed AgentMail 0.5.27 `AttachmentResponse` has `downloadUrl` and `expiresAt`. The installed signature plus the direct API reference determine this implementation; do not paste the incompatible example. No provider API calls were made to validate account-level limits.

**Data model additions:** `careProfiles`; `careProviders`/saved `places`; `documents` and immutable `documentVersions` with storage reference, hash, provenance and visibility; extracted `documentPages`/evidence references; `medicineEntries` with reviewed versions; `careNotes`; `visitQuestions` and versioned `visitPacks`; `followUps` for waiting items; member availability and replacement requests; resource grants and expiring recipient shares. Every object belongs to a household and has creator/time/version metadata. Reuse `tasks`, `visits`, `sources`, `proposals`, `events`, `handovers` and mail tables where their semantics fit. A profile/provider directory is distinct from permission to send an email.

**Access and indexes:** server-derived user identity on every operation; membership plus resource grants, never a household ID supplied by the client as sufficient authority. Index by household/status/date and resource identifiers. Search indexes must constrain household and enforce visibility before returning results or counts. Existing broad household queries, exports, mail notifications and event feeds all need review when richer medical data is introduced; a new documents check alone is insufficient.

**Realtime paths:** upload progress → import status → proposal queue; approved proposal → record/profile version and linked task/visit; assignment/availability changes → Today, visit and coverage; incoming attachment/reply → linked waiting item with unread information; accepted handover → ownership and immutable receipt; revoked access → all affected query results and open viewers. Approval and responsibility changes should be atomic mutations with expected-version checks. Model output never directly mutates a medicine list or confirmed appointment.

**Privacy of derived data:** apply source restrictions to extracts, proposed fields, packs and model inputs. A proposed task containing sensitive details defaults to its source’s audience. For a limited helper, a coordinator explicitly creates a minimal logistical task rather than exposing a hidden report by summarizing it. Changing sharing must not leave old cached snippets visible. Expired shares stop future retrieval but cannot recall downloaded copies.

**Processing and deletion:** validate file type/size before processing, reject active/unsupported formats, render as inert document/image content, and keep confidential content out of tool instructions and logs. Malware detection is not verified or claimed. Restrict extraction to authorized requests and defined provider purposes. Deletion covers originals, previews, text, derived AI output, search indexes and queued work, with processor cleanup and backup retention described accurately. Preserve existing export/deletion receipts but extend their coverage to the new data.

## Trust and legal boundaries

US-first is a planning assumption, not a global legal review. Medical uploads change the privacy obligations even if the product gives no medical advice.

- [HHS app guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/health-apps/index.html) and its [developer scenarios](https://www.hhs.gov/sites/default/files/ocr-health-app-developer-scenarios-2-2016.pdf) distinguish consumer-directed apps from services acting for covered providers. Uploading health data does not by itself settle HIPAA status. [Convex’s security page](https://www.convex.dev/security) specifies a signed BAA for applicable HIPAA processing; a vendor badge does not certify Handoff. Actual processor contracts/eligible plans were not inspected.
- The [FTC Health Breach Notification Rule guidance](https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0) is relevant to consumer health-record products. Applicability and incident procedures require an actual operator review; “outside HIPAA” does not mean unregulated. The FTC’s [September 2026 withdrawal](https://www.ftc.gov/news-events/news/press-releases/2026/09/ftc-withdraws-obsolete-policy-statement) concerns an obsolete 2021 policy statement, not withdrawal of the amended rule.
- Washington’s health-data law has specific [collection/sharing](https://app.leg.wa.gov/RCW/default.aspx?cite=19.373.030), [access/deletion](https://app.leg.wa.gov/RCW/default.aspx?cite=19.373.040) and [access-control/security](https://app.leg.wa.gov/RCW/default.aspx?cite=19.373.050) provisions. This is not a complete state-law applicability assessment.
- [HHS guidance on family representatives](https://www.hhs.gov/hipaa/for-professionals/faq/under-hipaa-when-can-a-family-member/index.html) reinforces that family relationship alone is not universal authority. Handoff must not label every household owner a legally authorized representative.
- [Google’s data-retention documentation](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/zero-data-retention) distinguishes model-training commitments from logging/caching/retention arrangements. No-training is not a zero-retention promise. Actual project settings and provider agreements remain unverified. A server/model-readable workflow must not claim end-to-end encryption.

Use synthetic records in the public sample. Before handling real medical records in the new feature, establish the operator’s actual privacy/retention terms and provider arrangements. This is a consequence of the proposed feature, not a claim that the present app has passed a compliance audit.

## Keep out of this release

No diagnosis, triage, treatment advice, medication administration, autonomous clinical changes, emergency monitoring or claimed clinical outcome. No patient-portal credential collection or promised universal EHR synchronization. No medical billing/insurance adjudication, banking/password vault, professional caregiver marketplace, wearable ingestion, live location surveillance, native mobile app, PWA or new general chat product. These exclusions keep the full coordination workflow coherent; records, reference medicines, the map and visit preparation remain required.

## The concrete product story

A family receives a discharge PDF. Maya uploads it, reviews the source-linked proposal to arrange a follow-up, and creates a booking task because no appointment is confirmed yet. She confirms the office’s eventual date, adds questions, selects relevant records and reviews the medicine reference for the visit pack. Leo accepts the pickup and return responsibilities, opens the confirmed clinic location and sees entrance information sourced from its public page. After the visit, Maya adds the new summary and a result they are still waiting for. Leo accepts the next handover. A later emailed attachment appears as new information requiring review, rather than silently rewriting what Leo accepted.

That story exercises records, model-assisted extraction, Convex live state and atomic ownership, public-page crawling, email intake/replies, map logistics and privacy. Every sponsor operation must be real if demonstrated; synthetic patient identities and a controlled office must be labeled. A map is useful here because it serves a real accepted ride, not because another widget fills the screen.

## Hackathon implications and remaining unknowns

The [official current criteria](https://www.convex.dev/hackathons/all-gas) reward everyday usefulness, originality, Convex depth and real OpenAI/Firecrawl/AgentMail work. The expanded workflow improves the product argument. It does not resolve the present Gemini-only runtime’s mismatch with the stated OpenAI product-use criterion. An installed OpenAI package or use of Codex while building does not establish an OpenAI feature in the shipped app. Preserve the user’s model restriction; do not conceal the gap or change providers during this research. A guaranteed-win recommendation is therefore unsupported.

Submission checklist only: public eligible frontend URL; public repository; accurate `hackathon.md`; concise real-product video; required social post; complete submission. No schedule or time estimates are part of this brief. The existing handover records development-only frontend availability and older production backend state; research did not publish a release.

Still unverified: caregiver adoption and willingness to share records; competitor performance; exhaustive current hackathon entries; eligibility interpretation for Gemini-only runtime; MapTiler account/plan; processor BAAs and actual retention settings; account attachment/model quotas; OCR quality on real documents; full jurisdictional legal scope; and a production release. Vendor marketing is not independent proof. Two academic full-text pages and some individual hackathon pages were access-blocked; the cited proxy-access study was checked through its PubMed abstract instead. No claims depend on unread full texts.

The user requested future verification through the live backend, not another broad test campaign. None was run for this research. Once implementation is separately requested, demonstrate this one connected workflow against the actual backend with synthetic medical records, including visible failure/recovery and access differences, rather than reporting historical checks as proof of new features.

**Final judgment:** proceed with this focused family-care workspace direction. Reject a generic dashboard with more modules attached. The landing should explain the parent-care job immediately, and the product should connect records to action and accountability. Research supports the need and exposes the competition; only use can establish whether Handoff is meaningfully better.
