"use node";
import { v } from "convex/values";
import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { validatePublicDns } from "./model/publicDns";
import { publicUrl } from "./model/publicUrl";

const firecrawl = new FirecrawlClient(components.firecrawl);

export const map = action({
  args: { householdId: v.id("households"), url: v.string() }, returns: v.array(v.object({ url: v.string(), title: v.string(), description: v.string() })),
  handler: async (ctx, args): Promise<{ url: string; title: string; description: string }[]> => {
    await ctx.runMutation(internal.webStore.beginMap, args);
    const url = await validatePublicDns(args.url);
    const result = await firecrawl.map(ctx, url, { search: "location parking visiting", limit: 20, includeSubdomains: false, ignoreQueryParameters: true });
    const candidates: { url: string; title: string; description: string }[] = [];
    for (const link of result.links.slice(0, 20)) {
      try { const candidate = publicUrl(link.url); if (new URL(candidate).hostname === new URL(url).hostname) candidates.push({ url: candidate, title: (link.title ?? "").slice(0, 200), description: (link.description ?? "").slice(0, 500) }); } catch { /* Exclude nonpublic or tokenized candidates. */ }
    }
    return candidates;
  },
});

export async function checkPublicSource(ctx: ActionCtx, args: { watchId: Id<"watches">; jobId: Id<"jobs"> }) {
  const work = await ctx.runMutation(internal.webStore.claim, args);
  if (!work) return null;
  try {
    const url = await validatePublicDns(work.url);
    // Installed component v0.1.1 unwraps body.data. Its actual source and types
    // return the document here, not a REST envelope.
    const result = await firecrawl.scrape(ctx, url, { formats: ["markdown", { type: "changeTracking", modes: ["git-diff"], tag: work.tag }], onlyMainContent: true });
    const finalUrl = result.metadata?.url;
    if (typeof finalUrl === "string") {
      const validated = await validatePublicDns(finalUrl);
      if (new URL(validated).hostname !== new URL(url).hostname) throw new Error("REDIRECT_REQUIRES_REVIEW");
    }
    if ((result.metadata?.statusCode ?? 200) >= 400 || result.metadata?.error || typeof result.markdown !== "string" || !result.markdown.trim()) throw new Error("NO_PUBLIC_TEXT");
    const raw = result.changeTracking?.changeStatus;
    const trackingStatus = raw === "new" || raw === "changed" || raw === "same" ? raw : "unknown";
    return await ctx.runMutation(internal.webStore.finish, { ...args, watchVersion: work.watchVersion, markdown: result.markdown.slice(0, 100000), trackingStatus, ...(result.warning ? { warning: "The provider reported a comparison warning; inspect the original source." } : {}) });
  } catch {
    await ctx.runMutation(internal.webStore.failed, { ...args, reason: "Public page check failed or returned an unsafe redirect. The last successful source is preserved; manual logistics entry remains available." });
    return null;
  }
}

export const checkNow = action({
  args: { watchId: v.id("watches"), requestId: v.string() }, returns: v.id("jobs"),
  handler: async (ctx, args): Promise<Id<"jobs">> => {
    const jobId = await ctx.runMutation(internal.webStore.begin, args);
    await ctx.runMutation(internal.operationStore.start, { watchId: args.watchId, jobId }); return jobId;
  },
});

export const perform = internalAction({
  args: { watchId: v.id("watches"), jobId: v.id("jobs") }, returns: v.union(v.id("sources"), v.null()),
  handler: async (ctx, args): Promise<Id<"sources"> | null> => checkPublicSource(ctx, args),
});
