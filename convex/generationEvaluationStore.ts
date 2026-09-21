import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { limits, numericSetting, modelDayConfig } from "./model/limits";
import { fail } from "./model/access";

// Restricted synthetic evaluator shares the actual deployment token ceiling.
// Its reservation is held on uncertain failures, never optimistically refunded.
export const reserve = internalMutation({
  args: { inputBytes: v.number(), fixtureId: v.string() }, returns: v.id("evaluationReservations"),
  handler: async (ctx, args) => {
    if (!Number.isSafeInteger(args.inputBytes) || args.inputBytes < 1 || args.inputBytes > 200000) return fail("INVALID_BUDGET", "Invalid fixture size.");
    const day = new Date().toISOString().slice(0, 10), input = args.inputBytes + 2048, output = 65536;
    await limits.limit(ctx, "modelInput", { key: day, count: input, config: await modelDayConfig(ctx,"modelInput",day,day,await numericSetting(ctx,"dailyModelInputTokens",1000000,1000000000)), throws: true });
    await limits.limit(ctx, "modelOutput", { key: day, count: output, config: await modelDayConfig(ctx,"modelOutput",day,day,await numericSetting(ctx,"dailyModelOutputTokens",100000,1000000000)), throws: true });
    return ctx.db.insert("evaluationReservations", { day, fixtureId: args.fixtureId, reservedInput: input, reservedOutput: output, createdAt: Date.now(), settled: false });
  },
});
export const settle = internalMutation({
  args: { reservationId: v.id("evaluationReservations"), inputTokens: v.number(), outputTokens: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.reservationId); if (!row || row.settled) return null;
    if (![args.inputTokens, args.outputTokens].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 2000000)) return fail("INVALID_USAGE", "Invalid token usage.");
    await limits.limit(ctx, "modelInput", { key: row.day, count: args.inputTokens - row.reservedInput, reserve: true, config: await modelDayConfig(ctx,"modelInput",row.day,row.day,await numericSetting(ctx,"dailyModelInputTokens",1000000,1000000000)) });
    await limits.limit(ctx, "modelOutput", { key: row.day, count: args.outputTokens - row.reservedOutput, reserve: true, config: await modelDayConfig(ctx,"modelOutput",row.day,row.day,await numericSetting(ctx,"dailyModelOutputTokens",100000,1000000000)) });
    await ctx.db.patch(row._id, { settled: true, inputTokens: args.inputTokens, outputTokens: args.outputTokens });
    return null;
  },
});
