# Test each Convex PR preview with TestSprite before it can merge

Handoff is a shared workspace for families looking after an aging parent. Here is one thing it has to get right. Maya asks her brother Leo to pick up a prescription. Until the request is answered, nobody else should quietly take it over, and the record should say that Leo accepted.

TestSprite found that we got this wrong. Leo saw a "Take this" button next to the request. Pressing it recorded "Responsibility taken" and silently dropped Maya's request. It was the fourth app bug the suite caught. Each same-repository pull request to Handoff gets its own live preview, and the browser suite has to pass on that preview before GitHub allows the merge.

This is the setup, with the parts that cost us time. All code is in [Satianurag/handoff](https://github.com/Satianurag/handoff).

## Results

- 17 browser tests in the TestSprite 3.0 portal: handovers with receipts, responsibility transfer with attribution, cross-household denial, care-circle permission limits, used one-time links, and required fields.
- 4 app bugs caught, each fixed in its own PR. The first production run passed 12 of 16.
- Each same-repository PR deploys a Convex preview. TestSprite tests that preview, not production, and posts a `TestSprite V3` status that a branch ruleset requires.
- [PR #12](https://github.com/Satianurag/handoff/pull/12) shows the full loop: red on its own preview, merge blocked, green after the fix.

## The shape of it

```text
pull_request ─▶ deploy-preview job ─▶ Convex preview  pr-<N>   (random hostname)
                     │
                     ▼
               preview job ──OIDC──▶ alias Worker:  handoff-pr-<N>.satimon.com ─302─▶ preview
                     │
          `preview` check completes
                     ▼
        TestSprite PR trigger ─▶ runs the suite on handoff-pr-{pr}.satimon.com
                     ▼
        `TestSprite V3` status ─▶ `main-gate` ruleset allows or blocks the merge
```

## Step 1: a Convex preview for each PR

[`.github/workflows/preview.yml`](https://github.com/Satianurag/handoff/blob/main/.github/workflows/preview.yml) runs on `pull_request` (`opened`, `synchronize`, `reopened`) and skips fork PRs, so preview secrets never reach a fork. It has two jobs, so the job that runs `npm ci` and PR code never holds an OIDC token:

```yaml
permissions: {}

jobs:
  deploy:
    name: deploy-preview
    if: github.event.pull_request.head.repo.full_name == github.repository
    permissions:
      contents: read
    outputs:
      preview_url: ${{ steps.deploy.outputs.preview_url }}
    steps:
      # checkout (persist-credentials: false), setup-node, npm ci
      - id: deploy
        run: node scripts/deploy-preview.mjs "pr-${{ github.event.pull_request.number }}"
        env:
          CONVEX_DEPLOY_KEY: ${{ secrets.CONVEX_PREVIEW_DEPLOY_KEY }}

  preview:
    needs: deploy
    permissions:
      deployments: write
      id-token: write
    steps:
      # publish a GitHub Deployment, then register and verify the alias (step 2)
```

The script calls the Convex CLI with a preview deploy key:

```sh
npx convex deploy --preview-name pr-<N> \
  --cmd "node scripts/deploy-preview.mjs pr-<N> --seed-preview-env"
```

Convex runs `--cmd` after the preview exists and before it pushes functions, so that is where we set the environment variables the functions need at push time. URL-dependent variables such as `SITE_URL` are set after `deploy` returns.

Gotchas we hit with Convex CLI 1.46.0:

- Running `convex env set --preview-name pr-<N>` before the first deploy returned `PreviewNotFound`, and a preview deploy key could not set project defaults. Seeding inside `--cmd` avoids both.
- Preview hostnames are random, for example `fortunate-moose-341.convex.site`. Read the URL from the deploy output instead of deriving it from the PR number. We publish it as the GitHub Deployment `environment_url`.
- `@convex-dev/static-hosting` 0.2.1 has no preview target. We run its upload with a 12-line `--require` shim ([`scripts/convex-preview-name.cjs`](https://github.com/Satianurag/handoff/blob/main/scripts/convex-preview-name.cjs)) that adds `--preview-name` to its `convex run` calls.
- On the Free plan, previews expire after 5 days. Push to a stale PR to redeploy it.

## Step 2: a stable URL TestSprite can predict

TestSprite's Pull Request trigger builds the target URL from a pattern. The placeholders are `{pr}`, `{branch}`, `{branch-slug}`, `{sha}`, and `{short-sha}`. A random Convex hostname can't be written that way, so a small Cloudflare Worker sits in front:

- `https://handoff-pr-{pr}.satimon.com` returns a 302 to that PR's preview.
- The `pr → {url, sha}` mapping lives in a SQLite-backed Durable Object.
- The `preview` job registers the mapping with a GitHub Actions OIDC token. There is no shared secret:

```js
const token = await core.getIDToken("https://handoff-previews.satimon.com");
await fetch("https://handoff-previews.satimon.com/register", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ pr, url: previewUrl, sha: context.payload.pull_request.head.sha }),
});
```

Before it stores anything, the Worker verifies the token:

- the RS256 signature, against GitHub's JWKS (a forced refresh for an unknown key ID at most once a minute);
- the issuer, the audience, expiry, and `nbf`/`iat`;
- `repository_id` and `repository_owner_id`, because a repository name can be reused after a rename;
- `event_name` is `pull_request`, `ref` is `refs/pull/<pr>/merge`, and `workflow_ref` is `preview.yml` at that ref.

A token for PR 12 can only register PR 12's alias, and only from the preview workflow. The Worker also accepts only `https://<name>.convex.site` targets. [Its tests](https://github.com/Satianurag/handoff/blob/main/infra/preview-alias/test/worker.test.mjs) cover a wrong audience, repository, owner, PR ref or workflow, push events, expired tokens, tampered signatures, unknown key IDs, `alg: none`, and the refresh throttle. They run in CI.

After registering, the job fetches the alias and fails unless it gets the expected 302. A broken alias fails the `preview` check before TestSprite ever starts.

Each alias hostname is a Workers custom domain, and Cloudflare allows 100 per zone. We created custom domains for PRs 1–60 ahead of time. Our PR #8 got no TestSprite run until its hostname existed.

## Step 3: the TestSprite trigger

In the TestSprite portal, open the project, then **GitHub Action → Add Trigger → Pull Request**. Paste a recent PR and click **Detect Events**.

| Setting | Value | Why |
|---|---|---|
| Event | The workflow-level `preview` check | It completes only after the alias works. Don't pick a per-PR deployment environment such as `preview-pr-9`; later PRs won't match it. |
| Target URL pattern | `https://handoff-pr-{pr}.satimon.com` | The stable alias from step 2 |
| Block PR until tests pass | Off for the first few PRs, then on | [TestSprite's docs](https://docs.testsprite.com/web-portal/integrations/github-integration) recommend starting non-blocking |

On PR #10, the `preview` check completed at 14:49:52 UTC, and the TestSprite run started at 14:49:55. It ran all 16 tests against that PR's own preview, and all passed.

## Step 4: make the gate real

"Block PR until tests pass" makes TestSprite report a failed run through the `TestSprite V3` status. GitHub only blocks a merge on a status that a rule requires. We added a branch ruleset on the default branch: **Require status checks to pass → `TestSprite V3`**, plus blocked force pushes and deletion. We left "Require a pull request" off because our merges are fast-forward pushes of the tested PR head; the required `TestSprite V3` status still has to be green on that commit.

For the pending-request bug, we first added a TestSprite test, then opened [PR #12](https://github.com/Satianurag/handoff/pull/12) with a commit that changed no app code. TestSprite failed on the PR's preview, and GitHub kept the merge blocked. The fix commit turned the run green, and the merge unblocked.

## What went wrong, and what we didn't fix

- **A run that didn't reproduce.** Our first PR-triggered run stalled on `/demo` (2 passed, 1 failed, 13 blocked). Single-test reruns in fresh browser contexts on production, the direct preview, and the alias all passed, and so did a full CLI run and the next PR run. We logged it as unexplained and changed no code.
- **A red test that was our fault.** One plan used a role that correctly had no medical access. The app was right; we replaced the plan.
- **Push runs don't gate.** The Push trigger on `main` posts `TestSprite V3` as success even when a test fails, because only the PR trigger blocks. It still caught bug 4, so we treat it as a production monitor.
- **Generated plans were shallow.** TestSprite proposed 53 tests from the live app. We kept 4 and wrote 13 by hand for handovers, permissions, and negative paths.

## Copy this

- [ ] A Convex preview deploy key stored as `CONVEX_PREVIEW_DEPLOY_KEY`
- [ ] `preview.yml` with a `deploy-preview` job and a `preview` job, with permissions scoped per job
- [ ] The alias Worker, with custom domains created ahead of time
- [ ] A TestSprite Pull Request trigger on the `preview` check, with the alias as the Target URL pattern
- [ ] "Block PR until tests pass" on, once the suite is stable
- [ ] A branch ruleset that requires `TestSprite V3`

| Symptom | Likely cause | Fix |
|---|---|---|
| No TestSprite comment on a PR | The alias hostname doesn't exist, so the `preview` check failed | Add the custom domain and redeploy the Worker |
| The trigger never fires on new PRs | It is bound to a per-PR event name | Choose the workflow-level `preview` check |
| A red `TestSprite V3` doesn't block the merge | No rule requires the status | Add the ruleset |
| `PreviewNotFound` from `convex env set` | The preview doesn't exist yet | Seed variables inside `convex deploy --cmd` |

## Over to you

If your preview platform also hands out random URLs, how do you point PR tests at them? We would rather not run an alias service. A TestSprite option to use the GitHub Deployment's `environment_url` as the target would remove step 2 entirely.

[Repository](https://github.com/Satianurag/handoff) · [LOOP.md with every run ID](https://github.com/Satianurag/handoff/blob/main/LOOP.md) · [Try the sample family, no sign-up](https://admired-fish-176.convex.site/demo)
