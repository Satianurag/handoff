import {digest} from "./sourceText";
import type { UserMutationCtx } from "./access";
import { fail, text } from "./access";

export async function priorRequest(ctx: UserMutationCtx, operation: string, requestId: string, fingerprint: string) {
  text(requestId, "Request ID", 128);
  const prior = await ctx.db.query("requests").withIndex("by_userId_and_operation_and_requestId", q => q.eq("userId", ctx.user._id).eq("operation", operation).eq("requestId", requestId)).unique();
  if (prior && prior.fingerprint !== fingerprint && prior.fingerprint !== digest(fingerprint)) fail("IDEMPOTENCY_CONFLICT", "This request ID was already used with different input.");
  return prior;
}

export async function saveRequest(ctx: UserMutationCtx, operation: string, requestId: string, fingerprint: string, resultId: string) {
  await ctx.db.insert("requests", { userId: ctx.user._id, operation, requestId, fingerprint: digest(fingerprint), resultId, expiresAt: Date.now() + 30 * 86400000 });
}
