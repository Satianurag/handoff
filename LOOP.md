# The TestSprite loop

Handoff is tested by a curated [TestSprite](https://www.testsprite.com) 3.0 suite of 16 browser tests, run against the live sample household at [`/demo`](https://admired-fish-176.convex.site/demo). This file records what the suite found and how each finding was resolved. The run IDs are TestSprite's own.

Project `98d946ba-f237-453f-b6e5-2b1fea4ca0fa`

## How the suite was built

1. TestSprite generated 53 frontend proposals from the live app. We kept 4 and discarded 49 that only checked that a page loaded.
2. We added 12 hand-written plans for the stateful flows that matter in family care: handover publish → recipient acknowledgement → receipt, responsibility transfer with attribution, permission boundaries, cross-household denial, and negative paths (empty title, review checkbox not ticked, used one-time link).
3. A short test guide tells the agent to start every test at `/demo` in a fresh browser context, keep `?sample=1` on deep links (demo auth is in `sessionStorage`), and use only fictional content.

## Run 1: baseline on production, 12/16

Execution `56442753-26f8-43e7-826b-eb7fcc3dfec9`, 2026-10-20, against `https://admired-fish-176.convex.site`.

| Test | Verdict | Run | What TestSprite saw | Resolution |
|---|---|---|---|---|
| Sample office message arrives in the shared Inbox | failed | `e46d51b6` | A mailbox-capacity warning instead of the scripted office conversation. Each sample household tried to provision real AgentMail inboxes, and the free plan has three. | [#2](https://github.com/Satianurag/handoff/pull/2): sample-household mail now stays inside Convex on the reserved `demo.handoff.invalid` domain. Real households still use AgentMail. |
| Used role link explains it was already used | failed | `cf03f6c1` | Opening a one-time role link a second time showed the generic "We couldn't open your space" with a misleading retry button. | [#3](https://github.com/Satianurag/handoff/pull/3): a specific expired/used message plus an "Open a new sample" action. |
| Complete the visit from the details panel | failed | `13cc3b7d` | The visit was completed, but History only said "Visit completed" and never named which visit. | [#4](https://github.com/Satianurag/handoff/pull/4): History rows name the visit or responsibility when it is still visible to the reader. |
| Add a visit question | blocked | `dbef2b7f` | The plan opened the recipient role, which has no medical access, so visit preparation correctly showed "contains private care information". | This was a test-plan error, not an app bug. The plan was replaced by "Add a visit question after granting care access", which sets up care essentials as the household creator first (see run 3). |

Fixes found while building the suite: [#5](https://github.com/Satianurag/handoff/pull/5) (zero serious axe issues, 44px targets), [#6](https://github.com/Satianurag/handoff/pull/6) (AI document reading on a Gemini API key with bounded retries) and [#7](https://github.com/Satianurag/handoff/pull/7) (PDF previews failed in browsers older than Chrome 140 because pdf.js 6 calls `Uint8Array.prototype.toHex`; we now ship pdf.js's legacy build).

## Run 2: after the fixes, 15/16

Execution `e811c248-0835-44f7-8d13-5d6ee97124c0`, production at `0c22765`.

| Test | Baseline run | Rerun |
|---|---|---|
| Sample office message arrives in the shared Inbox | `e46d51b6` failed | `76950a6e` passed |
| Used role link explains it was already used | `cf03f6c1` failed | `0042830c` passed |
| Complete the visit from the details panel | `13cc3b7d` failed | `3732cfa2` passed |
| Add a visit question (old plan) | `dbef2b7f` blocked | `61b44fb0` blocked: same plan error, plan retired |

## Run 3: corrected visit-question plan, passed

The test `17eecef2-485a-46b9-8179-4942f1a280bf` passed in run `7fd1465a-d48b-4a30-8ce8-a34fe438132c`. Before writing the plan, we checked the flow by hand in a browser. The suite now has 16 tests, and each one's latest verdict is a pass.

## Every PR gets its own live preview

`.github/workflows/preview.yml` creates a named Convex preview (`pr-<number>`) for each same-repository PR. It builds the web app against that preview, uploads the static site, and publishes a GitHub Deployment whose `environment_url` is the preview. TestSprite's GitHub App can then test that PR's own build rather than production. Fork PRs are skipped, so preview secrets are never exposed to forks.

Two Convex details to know if you copy this:

- `convex env set --preview-name X` fails until the preview exists. Run it from inside `convex deploy --preview-name X --cmd "..."`, which runs after the preview is created and before functions deploy (see `scripts/deploy-preview.mjs`).
- Preview hostnames are random (`charming-pig-95.convex.site`), not derived from the PR number. Read the deployment's `environment_url`; don't build the URL yourself.

## PR trigger on preview deployments (PR #10)

The TestSprite GitHub App Pull Request trigger fires on the `preview` workflow event. Its Target URL pattern is `https://handoff-pr-{pr}.satimon.com`, a Cloudflare Worker alias registered by the preview workflow with a GitHub Actions OIDC token. The alias 302-redirects to that PR's Convex preview.

Run 1 was PR-triggered on 2026-10-20 at about 14:26 UTC ([execution](https://www.testsprite.com/dashboard-v3/o/2a412a58-535a-50c7-acd5-60264d0a7740/projects/98d946ba-f237-453f-b6e5-2b1fea4ca0fa/execution/91e86e74-6adb-4d39-b35a-13670d79628e)): 2 passed, 1 failed, and 13 were blocked. All were stuck on `/demo` showing “One moment. Opening your space…”.

Local CDP runs in fresh browser contexts for the preview, production, and alias (six concurrent tabs) all reached Today in 5–7 seconds. Single “Demo boots” reruns through the TestSprite CLI passed 5/5 steps against production, the direct preview URL, and the alias. A full-suite CLI run against the alias at 14:43–14:48 UTC passed 16/16.

Run 2 was PR-triggered on commit `65d92a4`; the preview check completed at 14:49:52 UTC and TestSprite started at 14:49:59 UTC ([execution](https://www.testsprite.com/dashboard-v3/o/2a412a58-535a-50c7-acd5-60264d0a7740/projects/98d946ba-f237-453f-b6e5-2b1fea4ca0fa/execution/39ec1d57-3b8a-41b2-bc42-e2484e7c84ea)): 16/16 passed.

The Run 1 stall was not reproduced and its root cause is not confirmed; no code change was made for it. Convex logs for Run 1 showed anonymous sign-ins but no later `demoTokens:create` call.

## Merge gate

The Pull Request trigger has TestSprite's merge gate on: results are reported as the `TestSprite V3` status and a failed run fails that status. The repository ruleset `main-gate` on the default branch requires `TestSprite V3` to pass, and blocks force pushes and branch deletion. A PR cannot merge into `main` until its own preview passes the TestSprite suite.
