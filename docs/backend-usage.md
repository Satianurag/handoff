# Invoke Handoff APIs

The complete web app uses these same Convex APIs. See [current status](implementation-status.md) for deployment and validation, [function inventory](backend-function-inventory.md) for source registrations, and [operations](operations.md) for provider capacity and privacy. Exact current validators are in the linked source and generated TypeScript API.

## Local verification

Run from this repository with the existing ignored `.env.local` (the provider scripts incur real API usage):

```sh
npm test
npm run typecheck
npx convex dev --once
node --env-file=.env.local scripts/verify-webhook-live.mjs
node --env-file=.env.local scripts/verify-firecrawl-live.mjs
node --env-file=.env.local scripts/verify-privacy-live.mjs
```

Run provider verifiers one at a time and await cleanup before starting the next: this account has three inbox slots. Each script uses controlled synthetic recipients. Prefix `CONVEX_URL=https://admired-fish-176.convex.cloud` to target production where supported. `verify-retention-live.mjs` is development-only because it deliberately ages synthetic records. Run `verify-notifications-live.mjs` after demo verifiers: it creates a stable auth sender in that deployment. Earlier `verify-generation-live.mjs`, `verify-agentmail-live.mjs`, `verify-demo-mail-live.mjs` and domain/realtime scripts record pre-workflow gate checks; their synchronous assumptions are historical and they are not the current operational verification suite.

The current webhook verifier observes two authenticated WebSocket sessions, a claim race and completion, real signed inbound mail, automatic Gemini proposals, explicit approval, genuine send/delivery/reply and complete cleanup. The completed generation gate separately verified all three model operations.
The evaluator uses only its forty fixed synthetic fixtures. It saves results incrementally; a partial report is not a pass. Optional numeric arguments select fixture indices. Resume is allowed only when the report's prompt version matches the deployed evaluator. Model quality remains HIGH; application budget checks and provider backoff still apply.

## Authenticated client

Use the official Convex client in a Node script. Keep the token in memory:

```js
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
const client = new ConvexHttpClient(process.env.CONVEX_URL);
const auth = await client.action(api.auth.signIn, { provider: "anonymous" });
client.setAuth(auth.tokens.token);
const householdId = await client.action(api.demoTokens.create, {});
```

Anonymous sessions can only use their own synthetic household. Real accounts use `auth.signIn({provider:"agentmail-otp",params:{email}})`, then the same function with `params:{email,code}`. Normalize the email with `trim().toLowerCase()` before **both** calls. The official Auth package does not itself apply the Email provider's normalization hook in this version. Read the actual eight-digit code from the recipient's mailbox; do not expose it in logs. Google sign-in is not configured.

A scoped second demo role is created with `demoTokens.secondRoleLink({householdId})`. A separate client authenticates using `auth.signIn({provider:"demo-role",params:{token:capability}})`. The capability is one-use, expires with the household, and cannot choose an arbitrary user ID.

## Firecrawl

Create a watch on an existing upcoming visit:

```js
const watchId = await client.mutation(api.watches.create, {
  visitId, url: publicLocationUrl, requestId: crypto.randomUUID(),
});
// Creation already queues the first check. For an explicit later refresh:
const jobId = await client.action(api.web.checkNow, {
  watchId, requestId: crypto.randomUUID(),
});
const job = await client.query(api.jobs.get, { jobId });
const watch = await client.query(api.watches.get, { watchId });
const source = watch.lastSuccessfulSourceId
  ? await client.query(api.sources.get, { sourceId: watch.lastSuccessfulSourceId })
  : null;
```

`web.map({householdId,url})` returns validated same-host location candidates. Neither mapping nor crawling sends private household text to Firecrawl. Failed checks preserve the last successful source. `watches.setActive` pauses/resumes with the current version.

## AgentMail

Household creation queues durable provisioning when email is enabled. `inbox.connection` returns its address/status; wait for `status:"ready"` and `contactSyncState:"ready"`. `mail.provision({householdId})` explicitly retries the same operation. `contacts.set`, membership changes, and email-consent changes automatically synchronize all three provider allowlists. Consent withdrawal closes them. Unknown or ambiguous incoming senders are quarantined.

Create an editable draft with `drafts.create` and edit using its current version. Each change automatically queues the provider save. `mail.syncDraft({draftId})` is an explicit retry. Observe `drafts.get` until `providerSyncedVersion === version` and `syncToken` is absent. Approval uses that exact version and hash and starts the durable send:

```js
const draft = await client.query(api.drafts.get, { draftId });
const sendIntentId = await client.mutation(api.drafts.approveSend, {
  draftId, expectedVersion: draft.version, expectedHash: draft.contentHash,
  logicalSendId: crypto.randomUUID(),
});
// Approval already queued the send. Observe this receipt reactively.
const receipt = await client.query(api.sendIntents.get, { sendIntentId });
```

Only run the approval/send example for an explicitly authorized recipient and message. Verification scripts use controlled synthetic recipients. Reusing an intent does not create a fresh logical email. For an uncertain outcome, call `mail.reconcile({sendIntentId})`; absence of a provider receipt is not proof that no email was sent.

The demo-only `mail.demoOfficeMessage({householdId,scenario:"initial"})` sends fixed synthetic plaintext from the controlled office to that same household. `scenario:"reply"` exercises the controlled reply. The internal `mail:ingestMessage` takes the actual `inboxId` and `messageId`, fetches the canonical provider message, and projects it idempotently. Genuine signed AgentMail webhooks are registered on development and production. They fetch the canonical message, project it, and queue Gemini extraction automatically. Delivery receipts also arrive through verified webhooks. Forged signatures and conflicting event identities are rejected before ingestion.

## Generation and review

```js
const extractionJob = await client.action(api.generate.extractLogistics, { sourceId });
const questionJob = await client.action(api.generate.draftQuestion, {
  draftId, expectedVersion: currentDraft.version,
  instruction: "Ask which entrance is accessible.",
});
const introductionJob = await client.action(api.generate.introduceHandover, {
  handoverId, expectedVersion: currentHandover.version,
});
```

Read each result with `jobs.get`. Read proposals with `proposals.list`, the editable question with `drafts.get`, and the introduction plus complete deterministic list with `handovers.get`. `visits.get` returns `{visit,ride,returnRide,companion,watches}`, not the visit document directly.

Generation never confirms a proposal, sends a question, publishes/accepts a handover, or transfers responsibility. The named domain mutations perform those separate explicit actions. See `generation-interface.md` for the selected Responses-shaped Gemini adapter, date validation and budgets.

## Operator calls

The authenticated Convex CLI can call internal functions. Public member APIs still require a member identity; do not invent a `userId` parameter to bypass that requirement.

```sh
npx convex run operator:configure '{"key":"dailyModelOutputTokens","enabled":true,"numericValue":100000}'
npx convex run mail:cleanupProvider '{"privacyJobId":"ACTUAL_AUTHORIZED_PRIVACY_JOB_ID"}'
```

Changing a token allowance preserves consumed and uncertain reservations. Provider cleanup requires an existing authorized deletion request; it is not an unrestricted deletion API. A successful `null` CLI return can have empty stdout.

## Private export and deletion

`privacyJobs.request({householdId,kind:"export",confirmed:false,requestId})` starts a durable export. Observe the requester-only `privacyJobs.get`. After success, paginate `privacyExportStore.parts`, then call `privacyExport.download({partId})` for each part and write the returned bytes to its filename. Files are UTF-8 NDJSON, one `{table,record}` per line; part metadata includes byte length, row count, and SHA-256. Data is collected in bounded pages while the household remains usable, so this is an export over an interval rather than a transactionally frozen snapshot. No public storage URL is returned. Each download rechecks requester identity, current membership, and the 24-hour expiry. Joining the same household does not grant access to someone else's export. Auth secrets, invitation/capability hashes, and provider idempotency keys are excluded.

`privacyJobs.request({householdId,kind:"delete",confirmed:true,requestId})` immediately revokes household access, cancels pending work, waits for potentially running external actions, deletes the household's exclusive AgentMail resources, purges household tables and exports, and retains a minimal requester-only receipt. A send already accepted by an email provider cannot be recalled. `privacyJobs.retry({privacyJobId})` resumes a failed request; it does not fabricate success. Scoped deletion uses `privacyJobs.deleteThread` and `drafts.discard`; thread deletion removes the original source/proposals and evidence references while retaining separately confirmed responsibilities. Full household export/deletion and actual scoped provider thread/draft deletion passed live verification.

Native crons now scan due public watches, extend recurrence in household-local time, expire demos, dispatch authorized privacy requests, and expire private exports. New watches and resumed watches also enqueue their first check. `web.checkNow` returns a job ID immediately; use `jobs.get` and `watches.get` for progress. Model work has its own serialized Workflow queue. Provider work uses a separate queue with concurrency four. The web app subscribes to these real operations and presents their progress and recoverable failures.

Historical backend checks are summarized in [the evidence summary](evidence-summary.md); current release checks belong in [release status](implementation-status.md). Live scripts: `verify-webhook-live.mjs` exercises the automatic incoming-mail → proposals → reviewed draft → approved send → delivery → reply path; `verify-privacy-live.mjs` exercises private export and complete household deletion. Generic notification dispatch, 30/90-day retention and stale-job reconciliation are implemented. The raw-source/mail and scoped-deletion provider paths passed genuine live checks.


## Notifications, retention and matching

`notifications.preferences({householdId,emailNotifications})` controls generic opt-in email. Reminders recheck the task/conversation, membership, read state and preference before sending. Unknown sends reconcile without being resent.

`threads.attach({threadId,expectedVersion,related})` matches an email conversation to a task or visit. It versions the attached sources and queues new extraction when consent allows. The previous match cannot approve a stale proposal; regenerated proposals require explicit review. Already confirmed task/visit values remain unchanged.

Fixed crons also handle consent re-enable processing, interrupted jobs, uncertain sends, generic reminders, raw-source/mail retention and operational-history expiry. `retentionFixtures.age` is an internal development-only synthetic-message age simulator used by the live verifier; it rejects production and real households.

Static hosting uses the official Convex component. The framework-free consumer app includes records, care, places, visits, tasks, mail, accepted handovers and privacy controls. The current deployment result and deep-link verification are recorded in [implementation status](implementation-status.md).

## Connected care APIs

Private originals use authenticated `/records/file` upload/read routes and `records:list/detail/update/extract/review/createTask`. A record remains private when its reviewed next step becomes a household task; sharing the task requires explicit acknowledgment. `recordsMail:listAttachments/importAttachment` reads actual AgentMail attachments. `recordMailOrigins` retains each real message/attachment association even when original bytes deduplicate.

`followUpMail:detail/markRead/linkThread/linkRecord` joins waiting items to conversations and permitted originals. Incoming mail increments evidence revision; it never resolves the waiting item automatically. `visits:provider/setProvider` connects provider details to visit preparation; immutable packs pin their selected provider version. `places:forVisit/linkVisit/forTask/linkTask` connects destinations to visits and standalone errands; changed travel needs renewed acceptance.

`careShares:create/list/revoke/shared` and `records:createShare/listShares/revokeShare/shared` create recipient-email-bound, expiring access. They do not send mail automatically or grant household membership. The browser exposes the copyable link. Every read rechecks current authorization.
