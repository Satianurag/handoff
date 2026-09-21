import { Email } from "@convex-dev/auth/providers/Email";
import type { ActionCtx } from "./_generated/server";
import { email, fail } from "./model/access";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Email<DataModel>({
    id: "agentmail-otp", name: "Handoff email code", maxAge: 15 * 60,
    normalizeIdentifier: email,
    generateVerificationToken: async () => {
      let code = "";
      while (code.length < 8) {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        for (const byte of bytes) if (byte < 250 && code.length < 8) code += String(byte % 10);
      }
      return code;
    },
    // Convex Auth 0.0.95 passes ctx at runtime; its upstream email callback
    // type omits that second parameter. Optional typing preserves compatibility.
    sendVerificationRequest: async ({ identifier, token }, ctx?: ActionCtx): Promise<void> => {
      if (!ctx) fail("AUTH_CONTEXT", "Sign-in service unavailable.");
      await ctx.runAction(internal.mail.sendOtp, { address: identifier, token });
    },
  }), Anonymous, ConvexCredentials<DataModel>({
    id: "demo-role",
    authorize: async (params, ctx): Promise<{ userId: Id<"users"> } | null> => {
      if (typeof params.token !== "string") return null;
      const userId: Id<"users"> = await ctx.runAction(internal.demoTokens.redeem, { token: params.token });
      return { userId };
    },
  })],
});
