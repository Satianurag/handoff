import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { fail, text } from "./model/access";
import { limits, modelDayConfig } from "./model/limits";

export const configure = internalMutation({
  args: { key: v.string(), enabled: v.boolean(), numericValue: v.optional(v.number()), textValue: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, args) => {
    text(args.key, "Setting key", 80);
    if (args.numericValue !== undefined && (!Number.isSafeInteger(args.numericValue) || args.numericValue < 1 || args.numericValue > 1000000000)) fail("INVALID_SETTING", "Numeric limits must be whole numbers from one through one billion.");
    if (args.textValue !== undefined) text(args.textValue, "Setting value", 2000, true);
    const row = await ctx.db.query("operatorSettings").withIndex("by_key", q => q.eq("key", args.key)).unique();
    if (["dailyModelInputTokens", "dailyModelOutputTokens"].includes(args.key)) {
      const fallback = args.key === "dailyModelInputTokens" ? 1000000 : 100000;
      const before = row?.enabled && row.numericValue !== undefined ? row.numericValue : fallback;
      const after = args.enabled && args.numericValue !== undefined ? args.numericValue : fallback;
      {
        const name = args.key === "dailyModelInputTokens" ? "modelInput" : "modelOutput";
        // Change remaining allowance by the same delta; preserve all consumed
        // and uncertain reservations rather than resetting the usage ledger.
        await limits.limit(ctx, name, { key: new Date().toISOString().slice(0, 10), count: before - after, reserve: true, config: await modelDayConfig(ctx,name,new Date().toISOString().slice(0,10),new Date().toISOString().slice(0,10),before) });
      }
    }
    if (row) await ctx.db.patch(row._id, { ...args, updatedAt: Date.now() });
    else await ctx.db.insert("operatorSettings", { ...args, updatedAt: Date.now() });
    return null;
  },
});
