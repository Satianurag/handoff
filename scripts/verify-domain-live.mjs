// End-to-end synthetic Convex domain check. Session tokens stay in memory.
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const url = process.env.CONVEX_URL;
const maya = new ConvexHttpClient(url), leo = new ConvexHttpClient(url);
let householdId;
try {
  const login = await maya.action(api.auth.signIn, { provider: "anonymous" });
  if (!login.tokens?.token) throw new Error("No anonymous session");
  maya.setAuth(login.tokens.token);
  householdId = await maya.action(api.demoTokens.create, {});
  const roleToken = await maya.action(api.demoTokens.secondRoleLink, { householdId });
  const role = await leo.action(api.auth.signIn, { provider: "demo-role", params: { token: roleToken } });
  if (!role.tokens?.token) throw new Error("No scoped role session");
  leo.setAuth(role.tokens.token);
  const recipient = await leo.query(api.households.me, {});
  const tasks = await maya.query(api.tasks.list, { householdId, status: "open", paginationOpts: { numItems: 20, cursor: null } });
  const ride = tasks.page.find(t => t.category === "ride");
  if (!ride) throw new Error("No sample ride");
  const handoverId = await maya.mutation(api.handovers.prepare, { householdId, recipientId: recipient.id, proposedTaskIds: [ride._id], introduction: "Synthetic backend verification", note: "", requestId: "live-domain-handover" });
  await maya.mutation(api.handovers.publish, { handoverId, expectedVersion: 1 });
  await leo.mutation(api.handovers.acceptHandover, { handoverId, expectedVersion: 2, acceptedTaskIds: [ride._id], takeCoverage: false });
  const accepted = await maya.query(api.handovers.get, { handoverId });
  const transferred = await maya.query(api.tasks.get, { taskId: ride._id });
  if (accepted.receipt?.transferredTaskIds.length !== 1 || transferred.ownerId !== recipient.id || accepted.receipt.retainedTaskIds.length < 1) throw new Error("Invalid partial transfer");
  const today = await leo.query(api.today.get, { householdId, now: Date.now(), dayEnd: Date.now() + 86400000, mine: false });
  if (!today.lastReceipt) throw new Error("Reactive read contract missing receipt");
  console.log(JSON.stringify({ syntheticTwoSessionSignIn: true, partialTransfer: true, retainedWork: true, receiptRead: true }));
} catch {
  console.error("Live domain verification failed; private payloads and tokens omitted.");
  process.exitCode = 1;
} finally {
  if (householdId) {
    try {
      await maya.mutation(api.privacyJobs.request, { householdId, kind: "delete", confirmed: true, requestId: "live-domain-cleanup" });
      console.log("Synthetic household access revoked; tracked cleanup queued.");
    } catch { console.error("Synthetic cleanup request failed."); process.exitCode = 1; }
  }
  await Promise.allSettled([maya.action(api.auth.signOut, {}), leo.action(api.auth.signOut, {})]);
}
