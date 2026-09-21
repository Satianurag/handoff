// Genuine development transport test. Never use an existing household or token.
// This proves SDK/server recovery, not the browser's pending-save presentation.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const url = process.env.CONVEX_URL;
assert.equal(url, "https://befitting-cobra-234.convex.cloud", "Development deployment required");
const nativeWebSocket = globalThis.WebSocket;
const http = new ConvexHttpClient(url, { logger: false });
const sockets = new Set();
const subscriptions = new Set();
const report = { test: "committed mutation with lost response", rounds: [] };
let fault, client, householdId, signedIn = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 30000, interval = 100) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(interval);
  }
  throw new Error(`Timed out: ${label}`);
}
async function bounded(promise, label, timeout = 30000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), timeout);
    })]);
  } finally { clearTimeout(timer); }
}

// Only withhold the selected real server response. No result or query is mocked.
// Hold the close notification until HTTP proves the write committed while the
// SDK's original promise is still pending, then let its normal reconnect run.
class LossyWebSocket {
  constructor(address) {
    this.inner = new nativeWebSocket(address);
    sockets.add(this);
    this.inner.onopen = event => this.onopen?.(event);
    this.inner.onerror = event => this.onerror?.(event);
    this.inner.onclose = event => {
      sockets.delete(this);
      if (this.heldFault && !this.heldFault.released) this.heldFault.closeEvent = event;
      else this.onclose?.(event);
    };
    this.inner.onmessage = event => {
      if (this.heldFault) return;
      const message = JSON.parse(event.data);
      if (fault && !fault.dropped && message.type === "MutationResponse" && message.requestId === fault.requestId && message.success) {
        fault.dropped = true;
        fault.taskId = message.result;
        fault.socket = this;
        this.heldFault = fault;
        this.inner.close(1000, "Synthetic lost save confirmation");
        return;
      }
      this.onmessage?.(event);
    };
  }
  get readyState() { return this.inner.readyState; }
  send(data) {
    const message = JSON.parse(data);
    if (fault && message.type === "Mutation" && message.udfPath === "tasks:create") {
      if (fault.requestId === undefined) fault.requestId = message.requestId;
      if (message.requestId === fault.requestId) fault.sends++;
    }
    this.inner.send(data);
  }
  close(...args) { this.inner.close(...args); }
}
function releaseFault() {
  if (!fault || fault.released) return;
  fault.released = true;
  if (fault.closeEvent) fault.socket.onclose?.(fault.closeEvent);
}

try {
  const auth = await http.action(api.auth.signIn, { provider: "anonymous" });
  assert.ok(auth.tokens?.token, "Anonymous test authentication required");
  signedIn = true;
  http.setAuth(auth.tokens.token);
  householdId = await http.action(api.demoTokens.create, {});
  report.householdId = householdId;
  console.log(JSON.stringify({ started: true, householdId }));
  client = new ConvexClient(url, { webSocketConstructor: LossyWebSocket, logger: false, unsavedChangesWarning: false });
  client.setAuth(async () => auth.tokens.token);
  const listArgs = { householdId, status: "open", paginationOpts: { numItems: 50, cursor: null } };
  let observed, subscriptionError, callbacks = 0;
  const unsubscribe = client.onUpdate(api.tasks.list, listArgs, value => {
    observed = value; callbacks++;
  }, error => { subscriptionError = error; });
  subscriptions.add(unsubscribe);
  await until(() => { if (subscriptionError) throw subscriptionError; return observed; }, "initial subscription");

  for (let round = 1; round <= 3; round++) {
    const title = `Synthetic lost-response verification ${round} ${randomUUID()}`;
    const args = { householdId, title, category: "logistics", dueAt: null,
      note: "Synthetic connectivity test; no real household responsibility.", requestedOwnerId: null, requestId: randomUUID() };
    fault = { sends: 0, dropped: false, released: false };
    let settled = false;
    const originalSave = client.mutation(api.tasks.create, args);
    originalSave.then(() => { settled = true; }, () => { settled = true; });
    await until(() => fault.dropped && fault.closeEvent, "real success response withheld");
    const committed = await http.query(api.tasks.get, { taskId: fault.taskId });
    assert.equal(committed.title, title);
    assert.equal(settled, false, "Original save must remain pending despite committed server write");
    releaseFault();
    const returnedId = await bounded(originalSave, "original save reconciled after reconnect");
    assert.equal(returnedId, committed._id);
    assert.ok(fault.sends >= 2, "SDK must replay the same request after losing its response");
    await until(() => observed?.page.some(task => task._id === returnedId), "subscription catches up");
    const page = await http.query(api.tasks.list, listArgs);
    assert.equal(page.isDone, true, "Duplicate check must cover the complete list");
    assert.equal(page.page.filter(task => task.title === title).length, 1);
    const history = await http.query(api.history.forEntity, { householdId, target: { kind: "task", id: returnedId }, paginationOpts: { numItems: 50, cursor: null } });
    assert.equal(history.isDone, true);
    assert.equal(history.page.filter(event => event.type === "task.created").length, 1);
    assert.equal(await http.mutation(api.tasks.create, args), returnedId, "Explicit same-request retry must return original task");
    report.rounds.push({ round, committedBeforeConfirmation: true, pendingUntilReconnect: true,
      transmissions: fault.sends, recoveredOriginalTask: true, exactlyOneTaskAndCreationEvent: true, subscriptionCaughtUp: true });
    console.log(JSON.stringify(report.rounds.at(-1)));
    fault = null;
  }

  unsubscribe();
  subscriptions.delete(unsubscribe);
  const stoppedAt = callbacks;
  const first = report.rounds.length && observed.page.find(task => task.title.startsWith("Synthetic lost-response verification"));
  await http.mutation(api.tasks.transition, { taskId: first._id, expectedVersion: first.version, operation: "complete" });
  let resubscribed;
  subscriptions.add(client.onUpdate(api.tasks.list, listArgs, value => { resubscribed = value; }));
  await until(() => resubscribed && !resubscribed.page.some(task => task._id === first._id), "resubscription observes intervening completion");
  assert.equal(callbacks, stoppedAt, "Unsubscribed callback must stay inactive");
  report.unsubscribeStoppedCallbacks = true;
  report.resubscribeObservedInterveningWrite = true;
} catch (error) {
  report.failure = String(error?.message ?? error).replace(/[^\s]{45,}/g, "[REDACTED]").slice(0, 700);
  process.exitCode = 1;
} finally {
  releaseFault();
  for (const unsubscribe of subscriptions) {
    try { unsubscribe(); } catch { report.subscriptionCleanupFailed = true; process.exitCode = 1; }
  }
  if (client) await bounded(client.close(), "client closed").catch(() => { process.exitCode = 1; });
  for (const socket of sockets) socket.close();
  if (householdId) {
    try {
      const privacyJobId = await http.mutation(api.privacyJobs.request, { householdId, kind: "delete", confirmed: true, requestId: randomUUID() });
      report.cleanupJobId = privacyJobId;
      console.log(JSON.stringify({ cleanupRequested: true, householdId, privacyJobId }));
      await until(async () => {
        const job = await http.query(api.privacyJobs.get, { privacyJobId });
        if (job.state === "failed") throw new Error(`Synthetic cleanup failed at ${job.stage}`);
        if (job.state !== "succeeded") return false;
        assert.ok(job.processors.every(processor => processor.state === "succeeded"));
        report.cleanupProcessors = job.processors;
        return true;
      }, "all synthetic cleanup processors succeeded", 900000, 2000);
      report.syntheticHouseholdDeleted = true;
    } catch (error) {
      report.cleanupFailure = String(error?.message ?? error).slice(0, 250);
      process.exitCode = 1;
    }
  }
  if (signedIn) await http.action(api.auth.signOut, {}).catch(() => { report.signOutFailed = true; process.exitCode = 1; });
  report.passed = !process.exitCode;
  console.log(JSON.stringify(report));
}
