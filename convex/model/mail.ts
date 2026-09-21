import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { Infer } from "convex/values";
import { sourceRef } from "../validators";
import { email, fail } from "./access";

export function contentHash(recipient: string, subject: string, body: string, inReplyTo?: string) {
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify({ recipient, subject, body, inReplyTo: inReplyTo ?? null }))));
}

export async function permittedRecipient(ctx: QueryCtx | MutationCtx, householdId: Id<"households">, recipient: string, isReply: boolean) {
  const household = await ctx.db.get(householdId);
  if (!household || household.status !== "active" || !household.emailImport) fail("EMAIL_DISABLED", "Email processing is paused for this household.");
  const address = email(recipient);
  if (household.mode === "demo") {
    const demo = await ctx.db.query("demoSessions").withIndex("by_householdId", q => q.eq("householdId", householdId)).unique();
    if (!demo?.officeAddress || email(demo.officeAddress) !== address || demo.expiresAt <= Date.now()) fail("DEMO_RECIPIENT_RESTRICTED", "Sample mail can use only its active operator-controlled office inbox.");
  }
  const contact = await ctx.db.query("contacts").withIndex("by_householdId_and_email", q => q.eq("householdId", householdId).eq("email", address)).unique();
  if (!contact || contact.state !== "approved" || !contact.allowSend || (isReply && !contact.allowReply)) fail("CONTACT_NOT_APPROVED", "Confirm this contact and the send direction before proceeding.");
  return address;
}

export async function validateEvidence(ctx: QueryCtx | MutationCtx, householdId: Id<"households">, refs: Infer<typeof sourceRef>[]) {
  if (refs.length > 20) fail("TOO_MANY_SOURCES", "Use at most twenty source excerpts.");
  for (const ref of refs) {
    const source = await ctx.db.get(ref.sourceId);
    if (!source || source.retiring || source.householdId !== householdId) fail("NOT_FOUND", "Source unavailable.");
    if (!Number.isInteger(ref.start) || !Number.isInteger(ref.end) || ref.start < 0 || ref.end <= ref.start || ref.quote.length > 2000 || source.plaintext.slice(ref.start, ref.end) !== ref.quote) fail("INVALID_EVIDENCE", "A source excerpt does not match its original.");
  }
}
