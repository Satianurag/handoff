import { requireMailAccess, canReadMail } from "./model/mailAccess";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import schema from "./schema";
import { fail, member, userMutation, userQuery } from "./model/access";

export const get = userQuery({
  args: { sendIntentId: v.id("sendIntents") }, returns: schema.doc("sendIntents"),
  handler: async (ctx, args) => { const intent = await ctx.db.get(args.sendIntentId); if (!intent) return fail("NOT_FOUND", "Send status unavailable."); await requireMailAccess(ctx, intent.householdId); return intent; },
});

export const cancel = userMutation({
  args: { sendIntentId: v.id("sendIntents") }, returns: v.null(),
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.sendIntentId); if (!intent) return fail("NOT_FOUND", "Send status unavailable.");
    const { household } = await requireMailAccess(ctx, intent.householdId);
    if (intent.approvedBy !== ctx.user._id && household.ownerId !== ctx.user._id) fail("FORBIDDEN", "Only the approver or owner can cancel this approval.");
    if (intent.state === "cancelled") return null;
    if (intent.state !== "approved" || intent.attempts > 0) fail("SEND_IN_PROGRESS", "This send has already started. Check its status; cancellation cannot recall email.");
    await ctx.db.patch(intent._id, { state: "cancelled" });
    const draft = await ctx.db.get(intent.draftId);
    if (draft?.state === "approved") await ctx.db.patch(draft._id, { state: "editable", version: draft.version + 1, updatedAt: Date.now() });
    return null;
  },
});

export const forDraft = userQuery({
  args: { draftId: v.id("mailDrafts"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("sendIntents").omit("idempotencyKey", "logicalSendId", "providerDraftId")),
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.state === "deleted") return fail("NOT_FOUND", "Draft unavailable.");
    await requireMailAccess(ctx, draft.householdId);
    const result = await ctx.db.query("sendIntents").withIndex("by_draftId_and_createdAt", q => q.eq("draftId", draft._id)).order("desc").paginate(args.paginationOpts);
    return { ...result, page: result.page.map(({ idempotencyKey: _key, logicalSendId: _logical, providerDraftId: _provider, ...row }) => row) };
  },
});
