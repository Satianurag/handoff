import { requireMailAccess } from "./model/mailAccess";
import { syncPolicies } from "./model/operations";
import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import schema from "./schema";
import { checkVersion, email, fail, member, text, userMutation, userQuery } from "./model/access";
import { record } from "./model/events";

export const list = userQuery({
  args: { householdId: v.id("households"), state: v.union(v.literal("approved"), v.literal("blocked")), paginationOpts: paginationOptsValidator }, returns: paginationResultValidator(schema.doc("contacts")),
  handler: async (ctx, args) => { await requireMailAccess(ctx, args.householdId); return ctx.db.query("contacts").withIndex("by_householdId_and_state", q => q.eq("householdId", args.householdId).eq("state", args.state)).paginate(args.paginationOpts); },
});

export const set = userMutation({
  args: { householdId: v.id("households"), expectedVersion: v.optional(v.number()), email: v.string(), label: v.string(), relationship: v.string(), allowSend: v.boolean(), allowReceive: v.boolean(), allowReply: v.boolean(), state: v.union(v.literal("approved"), v.literal("blocked")) }, returns: v.id("contacts"),
  handler: async (ctx, args) => {
    const { household } = await requireMailAccess(ctx, args.householdId);
    const address = email(args.email);
    if (household.mode === "demo") {
      const demo = await ctx.db.query("demoSessions").withIndex("by_householdId", q => q.eq("householdId", household._id)).unique();
      if (!demo?.officeAddress || email(demo.officeAddress) !== address) fail("DEMO_RECIPIENT_RESTRICTED", "Sample mail can use only its operator-controlled office inbox.");
    }
    const prior = await ctx.db.query("contacts").withIndex("by_householdId_and_email", q => q.eq("householdId", household._id).eq("email", address)).unique();
    if (prior) {
      if (args.expectedVersion === undefined) fail("CONFLICT", "Reload this contact before changing its permissions.");
      checkVersion(prior, args.expectedVersion);
    } else if (args.expectedVersion !== undefined) fail("CONFLICT", "This contact is no longer available. Review before creating it again.");
    if (!prior && (await ctx.db.query("contacts").withIndex("by_householdId_and_email", q => q.eq("householdId", household._id)).take(200)).length >= 200) fail("CONTACT_LIMIT", "Each household supports 200 contacts.");
    const fields = { householdId: household._id, email: address, label: text(args.label, "Contact name", 120), relationship: text(args.relationship, "Contact approval", 1000), allowSend: args.allowSend, allowReceive: args.allowReceive, allowReply: args.allowReply, state: args.state, confirmedBy: ctx.user._id, version: (prior?.version ?? 0) + 1, updatedAt: Date.now() };
    const id = prior ? prior._id : await ctx.db.insert("contacts", fields);
    if (prior) await ctx.db.patch(prior._id, fields);
    await syncPolicies(ctx,household._id);
    await record(ctx, { householdId: household._id, actorId: ctx.user._id, type: "contact.confirmed", entity: { kind: "household", id: household._id }, after: `${args.label}: ${args.state}; send=${args.allowSend}, receive=${args.allowReceive}, reply=${args.allowReply}` });
    return id;
  },
});
