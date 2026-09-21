import { ConvexHttpClient } from "convex/browser";
import { AgentMailClient } from "agentmail";
import { api } from "../convex/_generated/api.js";
import { execFileSync } from "node:child_process";
const client = new ConvexHttpClient(process.env.CONVEX_URL);
const provider = new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY, maxRetries: 0 });
let householdId, phase = "anonymous authentication";
try {
  const auth = await client.action(api.auth.signIn, { provider: "anonymous" }); client.setAuth(auth.tokens.token);
  phase = "demo creation"; householdId = await client.action(api.demoTokens.create, {});
  phase = "demo provision"; await client.action(api.mail.provision, { householdId });
  phase = "demo initial mail"; await client.action(api.mail.demoOfficeMessage, { householdId, scenario: "initial" });
  const account = await client.query(api.inbox.connection, { householdId });
  phase = "demo delivery";
  let incoming;
  for (let n = 0; n < 20; n++) {
    const page = await provider.inboxes.messages.list(account.address, { labels: ["received"], limit: 10 });
    if (page.messages.length) { incoming = page.messages[0]; break; }
    await new Promise(r => setTimeout(r, 2000));
  }
  if (!incoming) throw new Error("No incoming");
  phase = "demo ingestion";
  execFileSync("npx", ["convex", "run", "mail:ingestMessage", JSON.stringify({ inboxId: account.address, messageId: incoming.messageId })], { stdio: ["ignore", "pipe", "pipe"] });
  const threads = await client.query(api.inbox.list, { householdId, filter: "new", paginationOpts: { numItems: 10, cursor: null } });
  if (!threads.page.length) throw new Error("No inbox projection");
  console.log(JSON.stringify({ isolatedDemoMailbox: true, controlledOfficeDelivered: true, inboundProjection: true }));
} catch (e) {
  console.error(JSON.stringify({ failed: true, phase, appCode: typeof e?.data?.code === "string" ? e.data.code : null, providerStatus: e?.statusCode ?? null }));
  if (householdId) { const status = await client.query(api.inbox.connection, { householdId }); console.error(JSON.stringify({ status: status?.status, error: status?.lastError })); }
  process.exitCode = 1;
} finally {
  if (householdId) await client.mutation(api.privacyJobs.request, { householdId, kind: "delete", confirmed: true, requestId: "demo-mail-cleanup" });
  await client.action(api.auth.signOut, {});
}
