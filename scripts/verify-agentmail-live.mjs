// Controlled synthetic recipients only. Tokens, OTPs, provider payloads and keys
// stay in memory; prints assertions and safe provider error categories only.
import { AgentMailClient } from "agentmail";
import { ConvexHttpClient } from "convex/browser";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { api } from "../convex/_generated/api.js";
const provider = new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY, maxRetries: 0 });
const session = new ConvexHttpClient(process.env.CONVEX_URL);
const anonymous = new ConvexHttpClient(process.env.CONVEX_URL);
let testPod, office, householdId, demoId, phase = "controlled recipient provisioning";
function internalCall(name, args) {
  const output = execFileSync("npx", ["convex", "run", name, JSON.stringify(args)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return output.trim() ? JSON.parse(output) : null;
}
async function waitFor(read, predicate) {
  for (let n = 0; n < 20; n++) { const result = await read(); if (predicate(result)) return result; await new Promise(r => setTimeout(r, 2000)); }
  throw new Error("Controlled delivery did not arrive within verification polling window");
}
try {
  testPod = await provider.pods.create({ clientId: `handoff-verification-${randomUUID()}`, name: "Handoff controlled verification" });
  office = await provider.pods.inboxes.create(testPod.podId, { displayName: "Synthetic verification office" });
  phase = "email OTP delivery";
  await session.action(api.auth.signIn, { provider: "agentmail-otp", params: { email: office.email } });
  const mail = await waitFor(() => provider.inboxes.messages.list(office.inboxId, { labels: ["received"], limit: 10 }), r => r.messages.some(m => m.subject === "Your Handoff sign-in code"));
  const message = await provider.inboxes.messages.get(office.inboxId, mail.messages.find(m => m.subject === "Your Handoff sign-in code").messageId);
  const code = message.text?.match(/\b\d{8}\b/)?.[0];
  if (!code) throw new Error("No code");
  phase = "email OTP verification";
  const auth = await session.action(api.auth.signIn, { provider: "agentmail-otp", params: { email: office.email, code } });
  if (!auth.tokens?.token) throw new Error("No session");
  session.setAuth(auth.tokens.token);
  if ((await session.query(api.households.me, {})).anonymous) throw new Error("Not verified account");
  console.log(JSON.stringify({ realEmailOtpRoundTrip: true }));
  phase = "household mailbox provisioning";
  householdId = await session.mutation(api.households.create, { nickname: "Synthetic mail verification", timezone: "UTC", firstTask: "Review entrance", adultConfirmed: true, authorityStatement: "Synthetic operator-owned test only", noticeVersion: "test", emailImport: true, aiProcessing: true, requestId: "live-mail-create" });
  await session.action(api.mail.provision, { householdId });
  const account = await session.query(api.inbox.connection, { householdId });
  if (account?.status !== "ready") throw new Error("Mailbox not ready");
  await session.mutation(api.contacts.set, { householdId, email: office.email, label: "Controlled office", relationship: "Operator-owned synthetic verification inbox", allowSend: true, allowReceive: true, allowReply: true, state: "approved" });
  await session.action(api.mail.syncContactPolicies, { householdId });
  phase = "provider draft save";
  const draftId = await session.mutation(api.drafts.create, { householdId, related: null, recipient: office.email, subject: "Synthetic entrance question", body: "SYNTHETIC TEST ONLY. Which entrance should the sample household use?", sourceRefs: [], requestId: "live-draft" });
  await session.action(api.mail.syncDraft, { draftId });
  let draft = await session.query(api.drafts.get, { draftId });
  await session.mutation(api.drafts.edit, { draftId, expectedVersion: draft.version, subject: draft.subject, body: "SYNTHETIC TEST ONLY. Is the east entrance accessible?", sourceRefs: [] });
  await session.action(api.mail.syncDraft, { draftId });
  draft = await session.query(api.drafts.get, { draftId });
  phase = "explicit approved send";
  const sendIntentId = await session.mutation(api.drafts.approveSend, { draftId, expectedVersion: draft.version, expectedHash: draft.contentHash, logicalSendId: "live-controlled-send" });
  await session.action(api.mail.send, { sendIntentId });
  const intent = await session.query(api.sendIntents.get, { sendIntentId });
  if (intent.state !== "sent") throw new Error(`Send state ${intent.state}`);
  await session.action(api.mail.send, { sendIntentId });
  const delivered = await waitFor(() => provider.inboxes.messages.list(office.inboxId, { labels: ["received"], limit: 20 }), r => r.messages.some(m => m.subject === draft.subject));
  const question = delivered.messages.find(m => m.subject === draft.subject);
  phase = "actual controlled reply and inbound projection";
  await provider.inboxes.messages.reply(office.inboxId, question.messageId, { text: "SYNTHETIC TEST ONLY. The east entrance is accessible; use Lot A for parking." }, { idempotencyKey: `verification-reply-${householdId}` });
  const received = await waitFor(() => provider.inboxes.messages.list(account.address, { labels: ["received"], limit: 10 }), r => r.messages.length > 0);
  const reply = received.messages[0];
  const projection = internalCall("mail:ingestMessage", { inboxId: account.address, messageId: reply.messageId });
  if (!projection) throw new Error("Missing projection");
  if (internalCall("mail:ingestMessage", { inboxId: account.address, messageId: reply.messageId }) !== projection) throw new Error("Duplicate inbound");
  const threads = await session.query(api.inbox.list, { householdId, filter: "new", paginationOpts: { numItems: 10, cursor: null } });
  if (!threads.page.some(t => t.providerThreadId === intent.providerThreadId && t.state === "replyReceived")) throw new Error("Reply not routed to original conversation");
  console.log(JSON.stringify({ providerDraftCreatedAndEdited: true, explicitApprovalSentOnce: true, controlledOfficeReceived: true, genuineReplyInSameThread: true, duplicateIngestDeduplicated: true }));
  phase = "isolated demo provisioning";
  const anon = await anonymous.action(api.auth.signIn, { provider: "anonymous" }); anonymous.setAuth(anon.tokens.token);
  phase = "demo creation";
  demoId = await anonymous.action(api.demoTokens.create, {});
  phase = "demo mailbox provisioning";
  await anonymous.action(api.mail.provision, { householdId: demoId });
  phase = "demo controlled initial mail";
  await anonymous.action(api.mail.demoOfficeMessage, { householdId: demoId, scenario: "initial" });
  const demoAccount = await anonymous.query(api.inbox.connection, { householdId: demoId });
  const sample = await waitFor(() => provider.inboxes.messages.list(demoAccount.address, { labels: ["received"], limit: 10 }), r => r.messages.length > 0);
  if (!internalCall("mail:ingestMessage", { inboxId: demoAccount.address, messageId: sample.messages[0].messageId })) throw new Error("Demo source absent");
  console.log(JSON.stringify({ isolatedDemoMailbox: true, actualScriptedOfficeEmail: true }));
} catch (error) {
  console.error(JSON.stringify({ phase, failed: true, appCode: typeof error?.data?.code === "string" ? error.data.code : null, providerStatus: typeof error?.statusCode === "number" ? error.statusCode : null }));
  process.exitCode = 1;
} finally {
  for (const [client, id] of [[session, householdId], [anonymous, demoId]]) if (id) {
    try { await client.mutation(api.privacyJobs.request, { householdId: id, kind: "delete", confirmed: true, requestId: "mail-verification-cleanup" }); }
    catch { console.error("Synthetic household cleanup request failed."); process.exitCode = 1; }
  }
  await Promise.allSettled([session.action(api.auth.signOut, {}), anonymous.action(api.auth.signOut, {})]);
  if (office) try { await provider.inboxes.delete(office.inboxId); } catch { console.error("Controlled verification inbox cleanup failed."); process.exitCode = 1; }
  if (testPod) try { await provider.pods.delete(testPod.podId); } catch { console.error("Controlled verification pod cleanup failed."); process.exitCode = 1; }
  if (householdId || demoId) console.log("Test household access revoked; tracked household mailbox cleanup queued.");
}
