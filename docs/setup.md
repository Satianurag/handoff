# Setup and deployment

This document covers a fresh clone. Configuration scripts are operator tools: several configure both development and production, and the model/webhook scripts contain the original deployment origins. Read and adapt those targets for your project before running them.

## 1. Local project

Use Node.js 22 or newer and run `npm ci`. Copy `.env.example` to `.env.local`, then run `npx convex dev` to select or create your own project. Convex writes the deployment selection; set `CONVEX_URL` to that deployment’s `.convex.cloud` URL for the frontend.

The first backend push can require the component environment variables below. Set them in the selected project’s Convex Dashboard, then let `convex dev` retry. Keep it running while developing the backend.

## 2. Server environment

Set these in Convex for each deployment you intend to use. Local `.env.local` values are not automatically server environment variables.

| Variables | Purpose |
| --- | --- |
| `AGENTMAIL_API_KEY`, `FIRECRAWL_API_KEY` | Required provider/component credentials |
| `JWT_PRIVATE_KEY`, `JWKS` | Matching Convex Auth signing key pair |
| `SITE_URL` | Frontend origin: local server for development, public site for production |
| `AGENTMAIL_WEBHOOK_SECRET` | Verify AgentMail’s signed incoming events |
| `GENERATION_PROVIDER=gemini`, `GEMINI_MODEL=gemini-3.8-flash` | Selected provider and the model pinned by this implementation |
| `GOOGLE_CLOUD_PROJECT` | Project authorized for model inference |
| `GEMINI_AUTH_PRIVATE_KEY`, `GEMINI_AUTH_KEY_ID` | Model-only signing key and key ID |
| `GEMINI_AUTH_ISSUER`, `GEMINI_AUTH_AUDIENCE`, `GEMINI_AUTH_SUBJECT` | Matching Google workload identity configuration |

Convex supplies `CONVEX_SITE_URL` to the backend. It is the auth issuer origin, distinct from the frontend’s `SITE_URL`. The current Gemini adapter calls the global Vertex endpoint; changing the pinned model requires updating and validating the adapter’s model contract.

For a single setting, use `npx convex env set NAME` with the value on standard input, or use the Dashboard. Target production explicitly with `--prod`; do not copy development settings into production by accident.

## 3. Email-code authentication and inboxes

[Convex Auth](https://labs.convex.dev/auth) handles sessions. The custom email provider in `convex/auth.ts` sends an eight-digit code through AgentMail; no Google OAuth client is involved.

`scripts/prepare-auth-env.mjs` creates and verifies matching auth keys for **both** development and production without replacing an existing complete pair. Run it only after selecting your intended Convex project. Set `SITE_URL` separately for each deployment.

Configure an AgentMail webhook at `https://YOUR-DEPLOYMENT.convex.site/agentmail/webhook` for:

- `message.received` and `message.received.unauthenticated`
- `message.sent`, `message.delivered`, `message.bounced`, `message.rejected` and `message.complained`

Store the webhook’s signing secret as `AGENTMAIL_WEBHOOK_SECRET`. The setup tool `scripts/configure-agentmail-webhook.mjs` implements this registration; replace its original site origins before using it in a fork. It reads the API key from the process environment and supports `--prod`.

Each deployment creates a stable sign-in sender on demand. Household mail needs its own inbox; the provider-backed fictional sample uses two controlled inboxes. Available capacity is determined by the AgentMail account. Deleting messages does not free inbox slots.

## 4. Model-only Google Cloud access

The adapter uses Google Workload Identity Federation to exchange a short-lived signed assertion for Vertex access. It does not use Google for user sign-in, the application database or hosting.

Before using `scripts/configure-gemini-auth.mjs`:

1. Select your Google Cloud project with `gcloud`, enable Vertex AI and arrange access to the pinned model.
2. Provide a custom IAM role named `handoffGeminiInference` with the permissions needed for inference. The script binds this existing role; it does not create it.
3. Replace the script’s development/production issuer origins with your Convex sites and review its pool/provider names.
4. Run it with an operator identity authorized to configure workload federation and the narrowly scoped role binding. It configures both Convex deployments and stores the matching model variables there.

See Google’s [Workload Identity Federation documentation](https://cloud.google.com/iam/docs/workload-identity-federation). Configuration success is separate from model availability or quota. No OpenAI key is required for the selected runtime.

## 5. Public sources and maps

The registered Firecrawl component uses `FIRECRAWL_API_KEY`. Handoff uses its single-page `map` and `scrape` actions for public logistics and change comparison. `FIRECRAWL_WEBHOOK_SECRET` is optional; the application’s current path does not depend on a crawl webhook.

Maps use the bundled MapLibre client, OpenFreeMap tiles and server-side Photon address search. Do not put private care documents into place-search queries.

## 6. Frontend and deployment

```sh
npm run dev:web       # Local frontend, port 4173
npm run build:web     # Generate dist/ and public config
npm run preview:web   # Preview the built output
npm run deploy       # Official Convex Static Hosting deployment
```

The public backend URL is resolved in this order: process `VITE_CONVEX_URL`, process `CONVEX_URL`, then `.env.local`’s `CONVEX_URL`. Static Hosting supplies `VITE_CONVEX_URL` for its target deployment. The build includes only that public URL; provider secrets are server-side.

`npm run deploy:backend` updates backend code without publishing frontend assets. For a new deployment, check the landing page, direct app routes and actual email-code sign-in after publishing.

## Verification tools

`npm run typecheck`, `npm test`, `npm run test:web` and `npm run build:web` run the local checks. Backend tests use `convex-test` and Vitest; frontend checks use Node’s test runner.

The `scripts/verify-*-live.mjs` tools make real calls and can create, send or delete controlled synthetic resources. Some are tied to the original deployment and local operator state. Inspect targets before using them; they are not required just to start the app. Their reports and recording materials are intentionally excluded from Git. The PDF under `scripts/fixtures/` is fictional test input, not user data.
