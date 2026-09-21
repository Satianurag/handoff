"use node";

import { createHash, randomBytes } from "node:crypto";
import { v } from "convex/values";
import {accessPreset} from "./validators";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

function hash(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid invitation link.");
  return createHash("sha256").update(token).digest("hex");
}

export const create = action({
  args: { householdId: v.id("households"), email: v.string(), accessPreset:v.optional(accessPreset) }, returns: v.object({ inviteId: v.id("invites"), token: v.string(), expiresAt: v.number() }),
  handler: async (ctx, args): Promise<{ inviteId: Id<"invites">; token: string; expiresAt: number }> => {
    const token = randomBytes(32).toString("base64url");
    const result = await ctx.runMutation(internal.inviteStore.create, { ...args, tokenHash: hash(token) });
    return { ...result, token };
  },
});

export const preview = action({
  args: { token: v.string() }, returns: v.object({ inviteId: v.id("invites"), nickname: v.string(), inviterName: v.string(), expiresAt: v.number(), status: v.string(), accessPreset }),
  handler: async (ctx, args): Promise<{ inviteId: Id<"invites">; nickname: string; inviterName: string; expiresAt: number; status: string; accessPreset:"care_circle"|"limited_helper" }> => ctx.runQuery(internal.inviteStore.preview, { tokenHash: hash(args.token), now: Date.now() }),
});

export const respond = action({
  args: { token: v.string(), accept: v.boolean() }, returns: v.id("households"),
  handler: async (ctx, args): Promise<Id<"households">> => ctx.runMutation(internal.inviteStore.respond, { tokenHash: hash(args.token), accept: args.accept }),
});
