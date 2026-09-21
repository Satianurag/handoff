> **Historical planning or verification record.** Preserved for audit, not current release status. Later family-care work adds private records, a reference medicine list, maps and connected follow-ups; earlier exclusions and unfinished-work statements below describe their original checkpoint. [Current product and release status](implementation-status.md), [current handover](HANDOVER.md), and [submission checklist](submission.md) take precedence. Historical test counts and local-only deployment statements are not claims about the present release.

# Login and onboarding — verified implementation

Implemented on 20 September 2026. Open `http://localhost:4173/sign-in` after `npm run dev:web`. This is a web app using the existing HTML/CSS/JavaScript project and official Convex browser client. No framework or new authentication service was introduced.

## Product decision

One email-code flow handles both account creation and return sign-in. An owner supplies a first name, recipient nickname and confirmed household time zone, adds one useful responsibility, then confirms adult coordination authority. Household email and AI processing are separate, optional, off-by-default choices. Creating the household atomically saves its first responsibility, owner membership, profile name and recorded choices. The next screen contains that real saved responsibility.

An invited person signs in with the invitation's email, supplies a first name if needed, and explicitly joins the household. They do not repeat owner onboarding. A wrong account sees no household details and can sign out without losing the invitation destination. Return sign-in opens an existing household.

This follows [Nielsen Norman Group's onboarding guidance](https://www.nngroup.com/articles/onboarding-tutorials/) on helping people complete real tasks instead of front-loading tutorials, and the [GOV.UK email-address pattern](https://design-system.service.gov.uk/patterns/email-addresses/) for clear labels and email entry. These are design principles, not evidence that this exact flow outperforms every alternative.

Current Convex Auth documentation was queried through Context7 (`/get-convex/convex-auth`) for email OTP and refresh-token rotation. The installed official SDK source was also checked: `ConvexClient.setAuth`, `onUpdate`, `subscribeToConnectionState`, `ConvexHttpClient.action`, and Auth's `auth:signIn` / `auth:signOut`. Email verification submits the original email alongside the code. Google Cloud remains model-only; no Google OAuth was configured.

## Approved visual references

Only the original, fully rendered **1920×1080** desktop captures below informed the new screen layouts. They were inspected at full size, not inferred from contact-sheet thumbnails. Narrow login screenshots, partial renders, small Mobbin previews and tall landing-page captures were excluded from this onboarding pass.

Reference directory: `/Users/Apple/Documents/craft-site-capture/desktop-1920/`.

- `426-notion-import.jpg`: centered card, calm sky background and clear primary action.
- `436-folder-edit.jpg`: input proportions, focus treatment and dialog spacing.
- `402-collection-configuration.jpg`: consistent controls and compact secondary actions.

These informed composition rather than a pixel-for-pixel Craft replica. Existing Handoff typography, palette and decorative assets remain the common visual language. Source Serif 4 and Inter are locally served; the reserved CSS family name `Serif` was corrected to `"Source Serif 4"`. Shared tokens are in `web/tokens.css`: ink `#171916`, muted text `#656460`, page `#faf8f6`, blue `#afc3f5`, yellow `#ffe884`, borders `#dedfd9`. Headings, controls, spacing, focus/error treatment and SVG stroke weights are shared across the flow. Native dialogs provide focus containment and Escape dismissal. Reduced-motion preferences are supported.

Existing decorative-asset provenance and its unverified redistribution license remain documented in `docs/landing-page.md`; this work does not claim a new license.

## Screens and actual wiring

| Screen | Behavior |
| --- | --- |
| `/sign-in` | Email validation; actual AgentMail code delivery; eight-digit verification; invalid-code feedback; 60-second resend cooldown; change email; pending-code recovery after refresh; safe internal return destination. |
| `/start`, step 1 | First name, recipient nickname, browser-suggested IANA time zone, explicit confirmation, field errors. |
| `/start`, step 2 | Editable responsibility, practical suggestion buttons, required-task error, back navigation. |
| `/start`, step 3 | Required adult and authority statements; independent optional email/AI choices; linked care-data explanation; loading, retry and duplicate-submit protection. |
| `/households` | Existing membership lookup, automatic opening of a single household, household selector, create another household. |
| `/join/:token` | Server-verified recipient identity; unavailable/wrong-account recovery; member name; explicit accept or decline. |
| `/h/:id/today` | Real Convex subscriptions; first saved task; claim, complete and add responsibility; owner invitation creation and clipboard copy; team dialog; owner-controlled optional choices. |
| `/privacy`, `/consumer-health-privacy`, `/terms`, `/help` | Shared visual system, accurate processor disclosures and current evaluation limitations. |

Loading, validation and provider failures use real request state. No sign-in, onboarding or household data is fabricated in the UI. The older landing-page sample remains explicitly fictional and local; it is separate from these connected routes.

Setup entries are tab-scoped, expire after one hour, and clear on sign-out or completed setup. Convex Auth owns verification codes and sessions. The small framework-free adapter handles token storage, concurrent refresh deduplication, browser-lock coordination where available, and cross-tab session changes. Only the public Convex URL enters `config.js`; provider credentials remain server-side.

Authorization is enforced in the backend, including verified-account requirements, household memberships, invitation email checks and owner-only consent changes. The new nullable `onboarding:viewer` query exposes only the authenticated user's profile. No client-supplied identity is trusted. Browser route guards are a usability layer, not the authorization boundary.

Today uses the household's calendar-day boundary, including 23/25-hour DST days, rather than blindly adding 24 hours. It refreshes time-dependent subscriptions each minute and uses the SDK's real connection state. Access errors clear household details from the page. Account changes replace the SDK client so a prior account’s cached profile cannot be reused.

## Verification

Verified through the local browser against the **development Convex deployment**, using controlled synthetic accounts and household information:

- Real email OTP delivery, invalid-code rejection, successful owner verification, resend with cooldown reset and change-email.
- Required email, nickname, name, time-zone confirmation, first-task and adult/authority validation.
- Refresh preserves a drafted responsibility and current onboarding step.
- Real household creation produces its first unassigned responsibility and owner profile.
- Claim, completion, empty responsibilities, new responsibility creation and persisted changes.
- Optional choices begin off, can be saved, persist and can be withdrawn; members see disabled owner-only controls.
- Private invitation creation and copy; wrong-account denial; correct second-account OTP; explicit acceptance; both profile names visible in People.
- Sign-out clears the UI; signed-out private routes return to sign-in; return sign-in opens the existing household without creating another.
- A separate authenticated owner session creates a responsibility that appears in the member's browser without reload.
- Real adapter sign-in, token rotation, concurrent-refresh deduplication, authenticated query after refresh and an immediately anonymous query after sign-out passed in Node with a browser-storage shim. This is distinct from a long-running browser token-expiry test.
- Full suite: **60 tests in 11 files passed**. The three new onboarding tests cover own-profile isolation, atomic creation/idempotency and rejection rollback. TypeScript and static build passed.
- Household day-end checks passed US spring/fall DST transitions and India's fractional UTC offset.
- Final desktop geometry checks: viewport and page both 1920×1080, including the final-step error. Shared font families and primary/ink color were inspected through computed styles.

Visual evidence is in `docs/onboarding-qa/`. Final captures use unscaled 1920×1080 screenshots. Historical pre-fix captures are separated and are not the design reference set. Browser checks are not a formal accessibility certification; Firefox, Safari, exhaustive network-failure simulation and a long-running browser-expiry test were not performed in this pass.

Synthetic cleanup succeeded through the tracked household deletion workflow for all four processors. Both controlled recipient inboxes and their pod were removed; temporary token files were removed and verification sessions signed out. Stable authentication senders were untouched. Normal development authentication/profile records may remain.

## Hackathon requirements and remaining release work

Primary sources reviewed: [official Convex All Gas page](https://www.convex.dev/hackathons/all-gas) and [official Luma event page](https://luma.com/convex-allgas-hackathon). Deadline deliberately ignored for product planning as requested.

The brief emphasizes useful everyday consumer applications, originality, real Convex depth, real sponsor generation/crawling/sending, working access, social sharing and clear demonstration. Developer tools, copied applications, frontend-only work and sponsor names without product behavior are poor fits. Onboarding should get a judge into useful shared work, not a sponsor-selection tour.

Eligibility includes adults 18+, teams of at most four, new work beginning on or after the official August 25 start, and the event's employee/family/other exclusions. Eligibility is an entrant attestation, not something this UI verifies. The advertised prize pool is $16,500 cash, $8,500 Codex credits, plus Firecrawl credits; no prize or judging outcome is promised.

Submission/release checklist — not a schedule:

- [x] Convex backend and real authenticated data paths.
- [x] Repository `hackathon.md` with evidence-based implementation history.
- [x] Actual AgentMail and Firecrawl backend integrations (prior live verification); actual AgentMail login in this flow.
- [ ] Resolve **OpenAI generation** criterion: current runtime is Gemini by explicit user choice. A Responses-compatible interface is not OpenAI usage.
- [ ] Complete the remaining consumer product screens: reviewed sources/mail, visits, coverage and accepted handovers. This delivery is login/onboarding plus its genuine first-use household surface.
- [ ] Provide a public frontend at the required `convex.site` or `chatgpt.site` origin and verify unaided judge access. No frontend was published during this task.
- [ ] Configure the production host's app-route fallback to `workspace.html` while `/` serves the landing page. Local development and preview servers already implement that mapping; the hosting component's default `index.html` fallback alone is insufficient.
- [ ] Deploy the new onboarding backend functions to production alongside that frontend. They are currently deployed and verified in development.
- [ ] Complete public-release privacy contact, processor suitability, user-facing export/deletion and decorative-asset rights decisions before real care data is collected.
- [ ] Resolve AgentMail capacity for further household inboxes. This test hit the current inbox limit; only controlled test resources were rotated, with no upgrade or stable-sender deletion.
- [ ] Public source repository and accurate sponsor documentation.
- [ ] Demo video under three minutes, showing real product behavior.
- [ ] X/LinkedIn post with the required Convex, OpenAI, Firecrawl and AgentMail tags and live link.
- [ ] VibeApps submission with live URL, repo, video and social link; recheck official eligibility before submitting.

No public deployment, purchase, social post, commit, push or hackathon submission is claimed.
