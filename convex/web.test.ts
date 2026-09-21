/// <reference types="vite/client" />
import { afterEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workflowTest from "@convex-dev/workflow/test";
import firecrawlTest from "@firecrawl/firecrawl-convex/test";
import { lookup } from "node:dns/promises";
import schema from "./schema";
import { api } from "./_generated/api";
import { publicUrl } from "./model/publicUrl";
import { validatePublicDns } from "./model/publicDns";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));
const modules = import.meta.glob("./**/*.ts");
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.mocked(lookup).mockReset(); vi.mocked(lookup).mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never); });

async function setup() {
  vi.stubEnv("FIRECRAWL_API_KEY", "fc-unit-test-only");
  const t = convexTest(schema, modules);
  await t.run(ctx=>ctx.db.insert("operatorSettings",{key:"pauseAutomaticOperations",enabled:true,updatedAt:Date.now()})); rateLimiterTest.register(t); firecrawlTest.register(t); workflowTest.register(t); workflowTest.register(t,"generationWorkflow");
  const userId = await t.run(ctx => ctx.db.insert("users", { email: "user@example.test", emailVerificationTime: 1 }));
  const user = t.withIdentity({ subject: userId });
  const householdId = await user.mutation(api.households.create, { nickname: "Synthetic", timezone: "UTC", firstTask: "Task", adultConfirmed: true, authorityStatement: "Synthetic test", noticeVersion: "test", emailImport: false, aiProcessing: true, requestId: "household" });
  const visitId = await user.mutation(api.visits.create, { householdId, title: "Visit", confirmedStartsAt: Date.now() + 86400000, timezone: "UTC", confirmedAddress: "", phone: "", note: "", checklist: [], requestId: "visit" });
  const watchId = await user.mutation(api.watches.create, { visitId, url: "https://example.com/location", requestId: "watch" });
  return { t, user, householdId, visitId, watchId };
}

test("URL screening rejects credentials, tokens, portals, private addresses and nonpublic DNS", async () => {
  for (const url of ["file:///etc/passwd", "http://127.0.0.1", "https://[::1]", "https://user:password@example.com", "https://example.com?token=secret", "https://mychart.example.com", "https://example.com/login", "http://localhost", "http://2130706433", "https://example.com:8080"]) expect(() => publicUrl(url)).toThrow();
  expect(publicUrl("https://example.com/location?utm_source=test#part")).toBe("https://example.com/location");
  vi.mocked(lookup).mockResolvedValue([{ address: "10.0.0.1", family: 4 }] as never);
  await expect(validatePublicDns("https://example.com/location")).rejects.toThrow("PUBLIC_URL_REQUIRED");
});

test("component envelope, footer filtering, changed evidence and stale handover invalidation", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-19T12:00:00Z"));
  const { t, user, householdId, watchId } = await setup();
  const bodies = [
    { success: true, data: { markdown: "Entrance: east entrance.\nCopyright 2025", changeTracking: { changeStatus: "new" }, metadata: { url: "https://example.com/location", statusCode: 200 } } },
    { success: true, data: { markdown: "Entrance: east entrance.\nCopyright 2026", changeTracking: { changeStatus: "changed" }, metadata: { url: "https://example.com/location", statusCode: 200 } } },
    { success: true, data: { markdown: "Entrance: west entrance.", changeTracking: { changeStatus: "changed" }, metadata: { url: "https://example.com/location", statusCode: 200 } } },
    { success: true, data: { markdown: "Entrance: east entrance.\nCopyright 2025", changeTracking: { changeStatus: "changed" }, metadata: { url: "https://example.com/location", statusCode: 200 } } },
  ];
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(bodies.shift()), { status: 200 })); vi.stubGlobal("fetch", fetchMock);
  await user.action(api.web.checkNow, { watchId, requestId: "first" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const first = await user.query(api.watches.get, { watchId });
  expect(first.lastResult).toBe("baseline"); expect(first.lastSuccessfulSourceId).not.toBeNull();
  const before = (await user.query(api.households.get, { householdId })).materialRevision;
  vi.setSystemTime(Date.now() + 61000);
  await user.action(api.web.checkNow, { watchId, requestId: "footer" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await user.query(api.watches.get, { watchId })).lastResult).toBe("unchanged");
  expect((await user.query(api.households.get, { householdId })).materialRevision).toBe(before);
  vi.setSystemTime(Date.now() + 61000);
  await user.action(api.web.checkNow, { watchId, requestId: "entrance" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const changed = await user.query(api.watches.get, { watchId });
  expect(changed.lastResult).toBe("changed");
  expect((await user.query(api.households.get, { householdId })).materialRevision).toBe(before + 1);
  const source = await user.query(api.sources.get, { sourceId: changed.lastSuccessfulSourceId! });
  expect(source.previousSourceId).toBeDefined(); expect(source.plaintext).toContain("west entrance");
  vi.setSystemTime(Date.now() + 61000);
  const reversalJob=await user.action(api.web.checkNow,{watchId,requestId:"reversal"});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const reversed=await user.query(api.watches.get,{watchId});
  expect(reversed.lastSuccessfulSourceId).not.toBe(first.lastSuccessfulSourceId);
  const reversal=await user.query(api.sources.get,{sourceId:reversed.lastSuccessfulSourceId!});
  expect(reversal.previousSourceId).toBe(changed.lastSuccessfulSourceId);
  expect(reversal.capturedAt).toBeGreaterThan(source.capturedAt);
  expect(reversal.extractionState).toBe("pending");
  expect((await user.query(api.households.get,{householdId})).materialRevision).toBe(before+2);
  expect(await user.action(api.web.checkNow,{watchId,requestId:"reversal"})).toBe(reversalJob);
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

test("failed fetch preserves prior source and paused watch blocks new paid calls", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-19T12:00:00Z"));
  const { t, user, watchId } = await setup();
  const bodies = [
    { status: 200, body: { success: true, data: { markdown: "Parking: east lot.", changeTracking: { changeStatus: "new" } } } },
    { status: 404, body: { success: false, error: "Not found" } },
  ];
  const fetchMock = vi.fn(async () => { const next = bodies.shift()!; return new Response(JSON.stringify(next.body), { status: next.status }); }); vi.stubGlobal("fetch", fetchMock);
  await user.action(api.web.checkNow, { watchId, requestId: "initial" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const first = await user.query(api.watches.get, { watchId });
  vi.setSystemTime(Date.now() + 61000);
  await user.action(api.web.checkNow, { watchId, requestId: "failure" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const failed = await user.query(api.watches.get, { watchId });
  expect(failed.state).toBe("failed"); expect(failed.lastSuccessfulSourceId).toBe(first.lastSuccessfulSourceId);
  await user.mutation(api.watches.setActive, { watchId, expectedVersion: failed.version, active: false });
  await expect(user.action(api.web.checkNow, { watchId, requestId: "paused" })).rejects.toThrow("Resume");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('visit watches paginate beyond six and retain truthful capture age through failure and removal',async()=>{
 const {t,user,householdId,visitId,watchId}=await setup();
 const sourceId=await t.run(async ctx=>{
  const sourceId=await ctx.db.insert('sources',{householdId,kind:'web',watchId,url:'https://example.com/location',contentHash:'fixture',plaintext:'Synthetic retained source.',capturedAt:1000,publishedAt:null,retentionUntil:Date.now()+86400000,extractionState:'ready',warnings:[],truncated:false,unresolvedReferences:0,version:1,comparison:'changed'});
  await ctx.db.patch(watchId,{lastSuccessfulSourceId:sourceId,lastAttemptAt:2000,state:'failed',lastResult:'Synthetic later failure.'});
  const base=(await ctx.db.get(watchId))!;const {_id,_creationTime,...fields}=base;
  for(let i=0;i<30;i++)await ctx.db.insert('watches',{...fields,url:`https://example.com/old-${i}`,lastSuccessfulSourceId:null,active:false,state:'paused'});
  return sourceId;
 });
 const first=await user.query(api.watches.forVisit,{visitId,paginationOpts:{numItems:25,cursor:null}});
 expect(first.page).toHaveLength(25);expect(first.isDone).toBe(false);
 expect(first.page.find(w=>w._id===watchId)).toMatchObject({lastAttemptAt:2000,lastSuccessfulCapturedAt:1000,lastSuccessfulComparison:'changed',sourceAvailable:true,state:'failed'});
 const second=await user.query(api.watches.forVisit,{visitId,paginationOpts:{numItems:25,cursor:first.continueCursor}});
 expect(second.page).toHaveLength(6);expect(second.isDone).toBe(true);expect(new Set([...first.page,...second.page].map(w=>w._id)).size).toBe(31);
 const outsider=await t.run(ctx=>ctx.db.insert('users',{name:'Outsider'}));
 await expect(t.withIdentity({subject:outsider}).query(api.watches.forVisit,{visitId,paginationOpts:{numItems:25,cursor:null}})).rejects.toThrow();
 await t.run(ctx=>ctx.db.patch(sourceId,{retiring:true}));
 const hidden=await user.query(api.watches.forVisit,{visitId,paginationOpts:{numItems:25,cursor:null}});
 expect(hidden.page.find(w=>w._id===watchId)).toMatchObject({lastSuccessfulCapturedAt:null,lastSuccessfulComparison:null,sourceAvailable:false});
});
