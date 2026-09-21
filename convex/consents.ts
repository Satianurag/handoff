import { syncPolicies } from "./model/operations";
import { queueOperation } from "./model/operations";
import { v } from "convex/values";
import { member, text, userMutation } from "./model/access";
import { record } from "./model/events";

export const set = userMutation({
  args: { householdId: v.id("households"), scope: v.union(v.literal("emailImport"), v.literal("aiProcessing")), granted: v.boolean(), noticeVersion: v.string(), authorityStatement: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const { household } = await member(ctx, args.householdId, true);
    if (household[args.scope] === args.granted) return null;
    await ctx.db.insert("consents", { householdId: household._id, actorId: ctx.user._id, scope: args.scope, granted: args.granted, noticeVersion: text(args.noticeVersion, "Notice version", 80), authorityStatement: text(args.authorityStatement, "Authority statement", 1000), adultConfirmed: true, recordedAt: Date.now() });
    await ctx.db.patch(household._id, { [args.scope]: args.granted, consentVersion: household.consentVersion + 1 });
    if(args.scope==="emailImport"){
      const account=await ctx.db.query("mailAccounts").withIndex("by_householdId",q=>q.eq("householdId",household._id)).unique();
      if(account)await ctx.db.patch(account._id,{status:args.granted?(account.inboxId?"ready":"pending"):"paused"});
      await ctx.db.patch(household._id,{provisioning:args.granted?(account?.inboxId?"ready":"pending"):"paused"});
      await syncPolicies(ctx,household._id);
      if(args.granted&&!account?.inboxId)await queueOperation(ctx,{householdId:household._id,kind:"provisionMail",key:`provision:${household._id}:${household.consentVersion+1}`,actorId:ctx.user._id,automatic:true});
    }
    await record(ctx, { householdId: household._id, actorId: ctx.user._id, type: "consent.changed", entity: { kind: "household", id: household._id }, after: `${args.scope}: ${args.granted ? "granted" : "withdrawn"}` });
    return null;
  },
});
