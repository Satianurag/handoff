import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import schema from "./schema";
import { entity } from "./validators";
import { authorizeEntity } from "./model/entities";
import { fail, member, userQuery } from "./model/access";

export const forEntity = userQuery({
  args: { householdId: v.id("households"), target: v.union(entity, v.null()), paginationOpts: paginationOptsValidator }, returns: paginationResultValidator(schema.doc("jobs")),
  handler: async (ctx, args) => { await authorizeEntity(ctx, args.householdId, args.target); return ctx.db.query("jobs").withIndex("by_householdId_and_target", q => q.eq("householdId", args.householdId).eq("target", args.target)).order("desc").paginate(args.paginationOpts); },
});

export const get = userQuery({
  args: { jobId: v.id("jobs") }, returns: schema.doc("jobs"),
  handler: async (ctx, args) => { const job = await ctx.db.get(args.jobId); if (!job) return fail("NOT_FOUND", "Job unavailable."); await member(ctx, job.householdId); return job; },
});
