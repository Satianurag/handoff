"use node";
import { AgentMailClient, AgentMailError, type AgentMail } from "agentmail";
import { env } from "../_generated/server";
import { contentHash } from "./mail";
import { fail } from "./access";

export function mailClient() { return new AgentMailClient({ apiKey: env.AGENTMAIL_API_KEY, maxRetries: 0, timeoutInSeconds: 30 }); }
export function mailbox(value: string) {
  const match = value.trim().match(/^(?:[^<>\r\n]*<)?([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>?$/);
  if (!match) return fail("INVALID_PROVIDER_ADDRESS", "The email service returned an ambiguous address.");
  return match[1].toLowerCase();
}
export function statusCode(error: unknown) { return error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : null; }
export function providerRetryDelay(error:unknown){
 const value=error instanceof AgentMailError?error.rawResponse?.headers.get("retry-after"):null;
 const delay=value?/^\d+$/.test(value)?Number(value)*1000:Date.parse(value)-Date.now():0;
 return Math.max(30000,Number.isFinite(delay)?delay:0);
}
export function providerDraftHash(draft: AgentMail.Draft) {
  if (draft.to?.length !== 1 || draft.cc?.length || draft.bcc?.length || draft.replyTo?.length || draft.attachments?.length || draft.html || draft.forwardOf || draft.sendAt || draft.sendStatus) return fail("PROVIDER_DRAFT_MISMATCH", "Provider draft contains unapproved content or recipients.");
  return contentHash(mailbox(draft.to[0]), draft.subject ?? "", draft.text ?? "", draft.inReplyTo);
}

// An allowlist with zero entries permits everyone. Keep a reserved .invalid
// sentinel so a household with no approved contacts remains closed in all directions.
const sentinel = "nobody@handoff-deny.invalid";
export async function syncLists(client: AgentMailClient, inboxId: string, desired: { send: string[]; receive: string[]; reply: string[] }) {
  for (const direction of ["send", "receive", "reply"] as const) {
    const wanted = new Set([sentinel, ...desired[direction]]);
    const entries: AgentMail.PodListEntry[] = [];
    let pageToken: string | undefined;
    do {
      const page = await client.inboxes.lists.list(inboxId, direction, "allow", { limit: 100, pageToken });
      entries.push(...page.entries); pageToken = page.nextPageToken;
      if (entries.length > 1000) return fail("POLICY_LIMIT", "Email policies need operator review.");
    } while (pageToken);
    // Install sentinel before deletions so the list never becomes permissive.
    if (!entries.some(e => e.entry === sentinel)) await client.inboxes.lists.create(inboxId, direction, "allow", { entry: sentinel });
    for (const entry of entries) if (!wanted.has(entry.entry)) {
      if (entry.readOnly) return fail("READ_ONLY_POLICY", "An inherited email policy needs operator review.");
      await client.inboxes.lists.delete(inboxId, direction, "allow", entry.entry);
    }
    for (const address of wanted) if (address !== sentinel && !entries.some(e => e.entry === address)) await client.inboxes.lists.create(inboxId, direction, "allow", { entry: address });
  }
}
