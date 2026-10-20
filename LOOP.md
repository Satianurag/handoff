# The TestSprite loop

> **Judges, start here.** A two-minute path:
> 1. The [scorecard](#scorecard).
> 2. [PR #12](https://github.com/Satianurag/handoff/pull/12): TestSprite failed on that PR's own preview, GitHub blocked the merge, and the fix in the same PR turned it green.
> 3. The [run log](#run-log), with every execution ID.
> 4. The committed evidence in [`testsprite/`](testsprite/): plans, run history and failure bundles.

Handoff is tested by a TestSprite 3.0 suite of browser tests. They run against the live sample household at [`/demo`](https://admired-fish-176.convex.site/demo) and against each pull request's own preview. TestSprite project: `98d946ba-f237-453f-b6e5-2b1fea4ca0fa`.

## Scorecard

Figures as of 2026-10-20.

| | |
|---|---|
| Suite | 17 frontend tests: 4 kept from 53 TestSprite proposals, 13 written by hand |
| App bugs caught by TestSprite | 4: three in the production baseline, one by the Push trigger on `main` |
| Test-plan errors caught | 1, replaced |
| Fix PRs | [#2](https://github.com/Satianurag/handoff/pull/2), [#3](https://github.com/Satianurag/handoff/pull/3), [#4](https://github.com/Satianurag/handoff/pull/4), [#12](https://github.com/Satianurag/handoff/pull/12) |
| PR-triggered runs on PR previews | PRs #8, #10, #11 and #12; see the [run log](#run-log) |
| Merge gate | The `main-gate` ruleset requires the `TestSprite V3` status; GitHub showed `blocked` until TestSprite passed on PR #8 and PR #12 |
| Test runs recorded | 229 for the current tests, as of 16:40 UTC ([`testsprite/run-history.json`](testsprite/run-history.json)) |

## Bugs TestSprite caught

| # | Found in | What TestSprite saw | Cause | Fix | Verified |
|---|---|---|---|---|---|
| 1 | Baseline, run `e46d51b6` | A mailbox-capacity warning instead of the scripted office conversation in the shared Inbox. | Each sample household provisioned real AgentMail inboxes; the free plan allows three. | [#2](https://github.com/Satianurag/handoff/pull/2): sample mail stays inside Convex on the reserved `demo.handoff.invalid` domain. | Run `76950a6e` passed |
| 2 | Baseline, run `cf03f6c1` | Reopening a used one-time role link showed "We couldn't open your space" and a retry button that could never work. | The used-link error fell through to the generic connection error. | [#3](https://github.com/Satianurag/handoff/pull/3): a specific used/expired message and an "Open a new sample" action. | Run `0042830c` passed |
| 3 | Baseline, run `13cc3b7d` | History said "Visit completed" but not which visit. | History rows had no target label. | [#4](https://github.com/Satianurag/handoff/pull/4): rows name the visit or responsibility when the reader can still see it. | Run `3732cfa2` passed |
| 4 | Push trigger on `main`, run `099f367d` ([bundle](testsprite/failures/099f367d-efca-4eea-bbdb-2cad176736cf/)) | Leo had been asked to take a responsibility. He pressed "Take this", and History recorded "Responsibility taken" instead of "assignment accepted". | Work screens offered "Take this" while an assignment request was pending, and the backend accepted that claim from any member, silently dropping the request. The Visits screen already handled this correctly. | [#12](https://github.com/Satianurag/handoff/pull/12): no "Take this" while a request is pending; the backend rejects the claim. | Red `8f623eac`, green `ee743e6c` on the PR preview |

One baseline red was the test's fault. "Add a visit question" (run `dbef2b7f`, blocked) opened the recipient role, which correctly has no medical access, so the page showed "contains private care information". We checked the flow by hand and replaced the plan with one that grants care access first. The new test `17eecef2` passed in run `7fd1465a`.

Fixes found while building the suite, not by TestSprite: [#5](https://github.com/Satianurag/handoff/pull/5) (zero serious axe issues, 44px targets), [#6](https://github.com/Satianurag/handoff/pull/6) (AI document reading on a Gemini API key, with bounded retries) and [#7](https://github.com/Satianurag/handoff/pull/7) (PDF previews broke in browsers older than Chrome 140, because pdf.js 6 calls `Uint8Array.prototype.toHex`).

## How the PR gate works

1. [`preview.yml`](.github/workflows/preview.yml) deploys each same-repository PR to a Convex preview named `pr-<N>`.
2. Its `preview` job registers `https://handoff-pr-<N>.satimon.com` with a Cloudflare Worker, using a GitHub Actions OIDC token, and checks that the alias redirects to the preview.
3. The TestSprite GitHub App Pull Request trigger waits for the `preview` check. It then runs the suite against `https://handoff-pr-{pr}.satimon.com`, with "Block PR until tests pass" on.
4. TestSprite comments on the PR and posts the `TestSprite V3` status. The `main-gate` ruleset on `main` requires that status, and blocks force pushes and branch deletion.

Setup steps and gotchas are in the [recipe](docs/testsprite-convex-recipe.md).

## Run log

All times are UTC on 2026-10-20. "CLI" is `testsprite test run`. "PR" is the GitHub App Pull Request trigger on that PR's preview. "Push" is the GitHub App Push trigger on `main`, which tests production.

| Time | Trigger | Commit | Result | Execution | Notes |
|---|---|---|---|---|---|
| 11:42 | CLI | production | 12/16: 3 failed, 1 blocked | `56442753` | Baseline. Bugs 1–3 and the wrong plan. |
| 12:50 | CLI | production at `0c22765` | 15/16: 1 blocked | `e811c248` | After #2–#4. The blocked test was the wrong plan. |
| 13:01 | CLI | production | Replacement plan passed | — | Run `7fd1465a` |
| 14:11 | Push | `ed74b93` | 16/16 | `4de6aa07` | |
| 14:26 | PR #10 | `93e9731` | 2/16: 1 failed, 13 blocked | `91e86e74` | Stalled on `/demo`. Not reproduced. |
| 14:35 | CLI | production, direct preview and alias | "Demo boots" passed on each | — | Reruns after the stall |
| 14:43 | CLI | alias for PR #10 | 16/16 | — | Full suite on the alias |
| 14:49 | PR #10 | `65d92a4` | 16/16 | `39ec1d57` | |
| 15:03 | Push | `65d92a4` | 15/16: 1 failed | `32c56fe1` | Bug 4 (run `099f367d`) |
| 15:11 | PR #8 | `ca1c902` | 16/16 | `0774513f` | |
| 15:43 | PR #8 | `5bf6aee` | 16/16 | `b95c0706` | First run under `main-gate`: `blocked` while running, `clean` after |
| 15:50 | Push | `5bf6aee` | 16/16 | `111bbaaa` | |
| 16:20 | PR #11 | `779757b` | 16/16 | `53954151` | Pipeline hardening |
| 16:26 | Push | `779757b` | 16/17: 1 failed | `0e2a6b78` | New test `b59c2a62` fails on production, which still had bug 4 (run `6f8d0eac`) |
| 16:31 | PR #12 | `67ea994` | 16/17: 1 failed | `8f623eac` | Test added, no app change yet. `b59c2a62` fails (run `0c25e3ba`); GitHub reports `blocked` |
| 16:37 | PR #12 | `2b84d15` | 17/17 | `ee743e6c` | The fix (run `4116f429`). GitHub reports `clean` |

Each execution ID opens in the TestSprite dashboard (login required) at `https://www.testsprite.com/dashboard-v3/o/2a412a58-535a-50c7-acd5-60264d0a7740/projects/98d946ba-f237-453f-b6e5-2b1fea4ca0fa/execution/<id>`. The TestSprite comment on each PR shows that PR's latest run publicly, with per-test screenshots; the commit statuses keep every run's result.

## Lessons

| Lesson | Where it came from | What we do |
|---|---|---|
| Generated proposals mostly checked that a page loads. | 49 of 53 proposals discarded | Write plans for stateful flows and negative paths by hand. |
| A red test can be a wrong plan. | Visit-question plan, run `dbef2b7f` | Walk the flow by hand before writing or blaming a plan. |
| A one-off failure is not a diagnosis. | PR #10 run at 14:26, not reproduced | Rerun on every target before changing code; record it as unexplained. |
| Two buttons for one intent let one bypass the other. | Bug 4, run `099f367d` | Offer one action per state, and enforce it in the backend. |
| Sample sessions live in `sessionStorage`. | Early deep-link plans | Start at `/demo` in a fresh context; keep `?sample=1` on deep links ([test guide](testsprite/test-guide.md)). |

## Known gaps

- The suite is frontend-only. Access rules are tested through the UI; backend rules are covered by Convex unit tests (`npm test`), not by TestSprite API tests.
- The PR #10 run at 14:26 stalled on `/demo` (2 passed, 1 failed, 13 blocked). It did not reproduce and its cause is unknown. Convex logs showed anonymous sign-ins but no later `demoTokens:create` call.
- Fork PRs get no preview, because preview secrets are never exposed to forks, so TestSprite does not run on them.
- Aliases exist for PRs 1–60. Cloudflare allows 100 Workers custom domains per zone. For a later PR, the `preview` check fails with a message naming the route to add.
- Only the Pull Request trigger has "Block PR until tests pass" on. Push trigger runs on `main` post `TestSprite V3` as success even when a test fails (run `32c56fe1`, "15/16 passed · 1 failed"); they are a production monitor, not a gate.
- Sample households use Convex-local mail, so the suite does not exercise real AgentMail delivery.

## Evidence in this repository

| Path | Contents |
|---|---|
| [`testsprite/plans/`](testsprite/plans/) | Every test plan as stored in TestSprite |
| [`testsprite/run-history.json`](testsprite/run-history.json) | Every recorded run of the 17 current tests: time, trigger, target, status and run ID. Runs of the retired visit-question plan were deleted with it. |
| [`testsprite/failures/`](testsprite/failures/) | Failure bundles from `testsprite test artifact get`: the agent's failure analysis, the failed steps and the generated test code. Videos stay in TestSprite. |
| [`testsprite/test-guide.md`](testsprite/test-guide.md) | The guide every test follows |
