import { defineApp } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import firecrawl from "@firecrawl/firecrawl-convex/convex.config";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import workflow from "@convex-dev/workflow/convex.config";
import { v } from "convex/values";

const app = defineApp({ env: { FIRECRAWL_API_KEY: v.string(), FIRECRAWL_WEBHOOK_SECRET: v.optional(v.string()), AGENTMAIL_API_KEY: v.string(), AGENTMAIL_WEBHOOK_SECRET: v.optional(v.string()),
  GENERATION_PROVIDER: v.optional(v.union(v.literal("gemini"), v.literal("openai"))), OPENAI_API_KEY: v.optional(v.string()), OPENAI_MODEL: v.optional(v.string()),
  GEMINI_MODEL: v.optional(v.string()), GEMINI_AUTH_PRIVATE_KEY: v.optional(v.string()), GEMINI_AUTH_KEY_ID: v.optional(v.string()), GEMINI_AUTH_ISSUER: v.optional(v.string()), GEMINI_AUTH_AUDIENCE: v.optional(v.string()), GEMINI_AUTH_SUBJECT: v.optional(v.string()), GOOGLE_CLOUD_PROJECT: v.optional(v.string()) } });
app.use(staticHosting);
app.use(rateLimiter);
app.use(workflow);
app.use(workflow, { name: "generationWorkflow" });
app.use(firecrawl, { httpPrefix: "/firecrawl/", env: { FIRECRAWL_API_KEY: app.env.FIRECRAWL_API_KEY, FIRECRAWL_WEBHOOK_SECRET: app.env.FIRECRAWL_WEBHOOK_SECRET } });
export default app;
