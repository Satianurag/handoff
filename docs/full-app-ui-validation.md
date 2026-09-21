> **Historical planning or verification record.** Preserved for audit, not current release status. Later family-care work adds private records, a reference medicine list, maps and connected follow-ups; earlier exclusions and unfinished-work statements below describe their original checkpoint. [Current product and release status](implementation-status.md), [current handover](HANDOVER.md), and [submission checklist](submission.md) take precedence. Historical test counts and local-only deployment statements are not claims about the present release.

# Full app UI plan — completion audit and current project checks

Checked 20 September 2026. Deliverable: [full-app-ui-plan.md](full-app-ui-plan.md). This report distinguishes planning completion, current implementation evidence, and future release verification. No application source was changed, no provider resources created, and nothing was deployed in this planning task.

## Objective audit

| Requested outcome | Evidence inspected | Result |
|---|---|---|
| Research the best UI/UX flow before implementation | Primary UX/accessibility guidance, current competitor descriptions, official event/Luma pages, Context7 documentation, current code and original desktop images | Complete for planning; no claim of user-validated optimality |
| Decide what the app includes and cuts | Plan §1, §2 and §10; existing tasks/coverage/visits/mail/handover contracts | Scope locked around explicit accepted handovers; no native/PWA/framework expansion |
| Map all screens and states | Plan §3–5: every entry, daily-work, detail, review, handover, inbox, settings, privacy and sample surface inherits the global state contract and has domain-specific states/actions | Complete specification; these unbuilt screens have not been tested as working UI |
| Wire all relevant backend functionality | Plan §6 public endpoint table and §8–9 realtime/provider/data mapping checked against local source | Existing and planned APIs explicitly separated; internal operator/retention/webhook functions intentionally remain server-only |
| Identify missing backend behavior | Plan §7 G1–G14, checked against source | Missing reads, snapshot context, receipt baseline, overlap, dates, contact conflicts, demo/session/hosting issues specified; not implemented |
| Consistent full-screen visual direction | Six original 1920×1080 image references opened visually; current sign-in/help inspected at 1920×1080; shared tokens read | Typography, palette, component behavior, layout and future screenshot gates locked |
| Use current official docs/Context7 | Context7 library IDs and exact API links in plan §9; installed SDK/component source checked | Complete; React/Resend snippets were not mistaken for instructions to change stack |
| Test current project after plan | Fresh final Vitest/typecheck/build, syntax/static/browser/read-only backend checks below | Passed within stated scope; missing product functionality remains missing |
| Stop after plan and mark goal complete | Application source hashes unchanged; final goal action follows this audit | Completion applies to planning only |

## Fresh checks performed

| Check | Observed result | Limit |
|---|---|---|
| `npm test`, rerun after writing plan | **60 tests in 11 files passed**, exit 0; final run began 13:08:07 local runtime | Backend tests; not full consumer UI coverage |
| `npm run typecheck`, after plan | Exit0 | Current tsconfig includes Convex and Vitest config, not browser JS |
| `npm run build:web`, after plan | Exit0 | Builds static distribution; does not publish or prove production routing |
| `node --check` on frontend and scripts | **27 JavaScript/MJS files passed** | Syntax, not behavioral coverage |
| Built preview HTTP checks | **20 expected statuses passed** for landing, auth/setup/household/invite/Today shells, four policy/help routes, SDK/config/fonts/styles/scripts and absent routes | `/h/test-household/plan` correctly returned 404 under current implementation; this records a missing future route, not app completeness |
| Built browser navigation | Landing Start household → actual sign-in; blank email gives inline error and email focus; Privacy/Care data/Help work; signed-out Today redirects to sign-in preserving destination | No OTP send/login or new household created in this planning task |
| Full-screen current browser | Sign-in and Help rendered at 1920×1080; sign-in with validation had no horizontal or vertical overflow; actual computed Source Serif 4 heading confirmed | Not a visual approval of unbuilt screens or every existing landing section |
| Browser console in checked built flow | No warning/error entries returned | Limited to inspected flow/session |
| Read-only development backend | `onboarding:viewer` returned null anonymously; anonymous `households:list` denied access | No authenticated provider round trip rerun |
| Prior onboarding evidence consistency | All six current core frontend hashes match `onboarding-qa/results.json` | Prior real OTP, second-member and realtime evidence remains historical; matching source does not prove all external services are healthy now |

The test runner emitted Node experimental-localStorage warnings. Tests completed successfully. These warnings are not evidence of a browser runtime failure.

Machine-readable HTTP/syntax checks and source hashes: [ui-plan-audit.json](ui-plan-audit.json). Existing authenticated/provider evidence remains in [login-onboarding.md](login-onboarding.md), onboarding QA (local-only `onboarding-qa/results.json`), and backend verification files; none is relabeled as a new live test.

An initial browser observation was 1280×720 because the inherited viewport had reset. That image was excluded from design inference. The viewport was restored to 1920×1080 before valid visual review. One old tab disappeared during inspection; a fresh tab in the same browser resumed the check without recreating app data. No screenshots were cropped or enlarged to fake full-screen evidence.

## Findings that prevent a false “app complete” claim

- Today and a paginated all-work view have different semantics. Current Today caps sections at 20, omits some requested/past-due work, and cannot replace complete list views.
- No public handover list exists; Today returns pending records only. Current handover snapshot does not capture unchanged visit/question context. These are real implementation gaps, not merely styling tasks.
- Drafts outside a thread and send receipts need discoverable lists; contact edits need version checks. Raw mail/source content must remain plain text and send uncertainty must not trigger a fresh email.
- Current coverage agenda filtering misses blocks that started before its date range. Personal change baseline depends on a receipt that can expire. Both need the planned corrections.
- Current sign-out clears browser credentials after a server action, so rejection can skip clearing. The plan explicitly requires a finally-based local cleanup and failure-path tests; this planning task does not patch it.
- Current static component fallback is boolean to `index.html`. Local development separately serves `workspace.html`; production entry routing is not yet complete.
- New onboarding code was previously deployed to development only. Public frontend, full product UI, fresh complete provider demo, production UI rollout, account mail capacity, processor/contact/asset-rights release arrangements, actual OpenAI runtime usage, and submission artifacts remain unverified or unfinished.
- No Firefox/Safari checks, screen-reader audit, long-running browser token expiry, exhaustive outage simulation, or caregiver usability testing were performed now. Their required future gates are in plan §12.

## Scope boundary

Planning completion is supported by a complete actionable specification, source-checked contracts/gaps, current primary research, selected full-screen reference review, and passing current-project baseline checks. The next agent can build from this document without rediscovering the product. It must not treat the completed planning goal as permission to claim the whole app or submission is complete.
