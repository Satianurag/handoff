import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import schema from "./schema";
import { fail, member, userQuery } from "./model/access";
import { canReadRecordFor } from "./recordsAccess";

export const list = userQuery({
  args: {
    householdId: v.id("households"),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("dismissed")),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(schema.doc("recordProposals").extend({
    recordTitle: v.string(),
    filename: v.string(),
    canReview: v.boolean(),
  })),
  handler: async (ctx, args) => {
    await member(ctx, args.householdId);
    const result = await ctx.db.query("recordProposals")
      .withIndex("by_householdId_and_status", q => q.eq("householdId", args.householdId).eq("status", args.status))
      .order("desc").paginate(args.paginationOpts);
    const page = [];
    for (const proposal of result.page) {
      const record = await ctx.db.get(proposal.recordId);
      if (!record || record.currentVersionId !== proposal.versionId ||
          !await canReadRecordFor(ctx, record, ctx.user._id)) continue;
      const file = await ctx.db.get(proposal.versionId);
      if (!file || file.recordId !== record._id) continue;
      page.push({ ...proposal, recordTitle: record.title, filename: file.filename,
        canReview: record.createdBy === ctx.user._id });
    }
    // Keep native cursor boundaries even when inaccessible rows leave an empty page.
    return { ...result, page };
  },
});

export const forTask = userQuery({
  args: { taskId: v.id("tasks") },
  returns: v.union(v.object({recordId:v.id("records"),recordTitle:v.string(),versionId:v.id("recordVersions"),page:v.number(),quote:v.string()}),v.null()),
  handler: async (ctx,args) => {
    const task=await ctx.db.get(args.taskId);
    if(!task)fail("NOT_FOUND","Responsibility unavailable.");
    await member(ctx,task.householdId);
    const proposal=await ctx.db.query("recordProposals").withIndex("by_taskId",q=>q.eq("taskId",task._id)).unique();
    if(!proposal||proposal.householdId!==task.householdId)return null;
    const record=await ctx.db.get(proposal.recordId);
    if(!record||!await canReadRecordFor(ctx,record,ctx.user._id))return null;
    return {recordId:record._id,recordTitle:record.title,versionId:proposal.versionId,page:proposal.page,quote:proposal.quote};
  },
});
