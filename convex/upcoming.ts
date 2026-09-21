import {redactSourceRefs} from "./model/mailAccess";
import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import schema from "./schema";
import { member, range, userQuery } from "./model/access";

export const list = userQuery({
  args: { householdId: v.id("households"), kind: v.union(v.literal("tasks"), v.literal("coverage"), v.literal("visits")), includeCancelled: v.optional(v.boolean()), from: v.number(), to: v.number(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.union(schema.doc("tasks"), schema.doc("coverage"), schema.doc("visits"))),
  handler: async (ctx, args) => {
    await member(ctx, args.householdId); range(args.from, args.to);
    if (args.kind === "tasks") {const result=await ctx.db.query("tasks").withIndex("by_householdId_and_status_and_dueAt", q => q.eq("householdId", args.householdId).eq("status", "open").gte("dueAt", args.from).lte("dueAt", args.to)).paginate(args.paginationOpts);return {...result,page:await Promise.all(result.page.map(async row=>({...row,sourceRefs:await redactSourceRefs(ctx,row.sourceRefs,ctx.user._id)})))};}
    if (args.kind === "coverage") {
      // Coverage lasts at most seven days. Keep the original cursor even when
      // a page contains only blocks that ended before the requested interval.
      const result = await ctx.db.query("coverage").withIndex("by_householdId_and_startsAt", q => q.eq("householdId", args.householdId).gte("startsAt", Math.max(0, args.from - 7 * 86400000)).lt("startsAt", args.to)).paginate(args.paginationOpts);
      return { ...result, page: result.page.filter(row => row.endsAt > args.from && (args.includeCancelled || row.state !== "cancelled")) };
    }
    const result=await ctx.db.query("visits").withIndex("by_householdId_and_status_and_confirmedStartsAt", q => q.eq("householdId", args.householdId).eq("status", "upcoming").gte("confirmedStartsAt", args.from).lte("confirmedStartsAt", args.to)).paginate(args.paginationOpts);
    return {...result,page:await Promise.all(result.page.map(async row=>({...row,sourceRefs:await redactSourceRefs(ctx,row.sourceRefs,ctx.user._id)})))};
  },
});
