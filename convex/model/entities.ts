import { requireMailAccess, requireSourceAccess } from "./mailAccess";
import type { Infer } from "convex/values";
import { entity } from "../validators";
import type { Id } from "../_generated/dataModel";
import { fail, member, type UserQueryCtx, type UserMutationCtx } from "./access";

/** Entity identity must survive object-key reordering across Convex boundaries. */
export function sameEntity(a: Infer<typeof entity> | null, b: Infer<typeof entity> | null): boolean {
  return a === null || b === null ? a === b : a.kind === b.kind && a.id === b.id;
}

export async function authorizeEntity(ctx: UserQueryCtx | UserMutationCtx, householdId: Id<"households">, target: Infer<typeof entity> | null) {
  await member(ctx, householdId);
  if (!target) return;
  if(target.kind==="thread")await requireMailAccess(ctx,householdId);
  if(target.kind==="source"){const source=await ctx.db.get(target.id);if(source)await requireSourceAccess(ctx,source);}
  if (target.kind === "household") { if (target.id !== householdId) fail("NOT_FOUND", "Related item unavailable."); return; }
  const row = await ctx.db.get(target.id);
  if (!row || !("householdId" in row) || row.householdId !== householdId) fail("NOT_FOUND", "Related item unavailable.");
}
