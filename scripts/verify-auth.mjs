// Prints only verification outcomes; tokens remain in memory.
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const client = new ConvexHttpClient(process.env.CONVEX_URL);
try {
  const result = await client.action(api.auth.signIn, { provider: "anonymous" });
  if (!result.tokens?.token) throw new Error("Missing session token");
  client.setAuth(result.tokens.token);
  const user = await client.query(api.households.me, {});
  if (!user.anonymous) throw new Error("Unexpected account type");
  let blocked = false;
  try { await client.mutation(api.households.create, { nickname: "Synthetic verification", timezone: "UTC", firstTask: "Test", adultConfirmed: true, authorityStatement: "Synthetic", noticeVersion: "test", emailImport: false, aiProcessing: false, requestId: "anonymous-denial-check" }); }
  catch { blocked = true; }
  if (!blocked) throw new Error("Anonymous real household creation was allowed");
  await client.action(api.auth.signOut, {});
  console.log(JSON.stringify({ authenticatedRoundTrip: true, anonymousRealHouseholdDenied: true, signedOut: true }));
} catch {
  console.error("Authentication verification failed; no credentials printed.");
  process.exitCode = 1;
}
