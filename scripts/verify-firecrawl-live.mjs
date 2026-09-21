// Real Firecrawl transport against synthetic and public sources. No secret output.
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
const client = new ConvexHttpClient(process.env.CONVEX_URL);
let householdId, phase = "sign-in";
async function until(read,predicate,timeout=180000){const end=Date.now()+timeout;while(Date.now()<end){const value=await read();if(predicate(value))return value;if(value?.state==="failed")throw new Error(value.safeError??"Background operation failed");await new Promise(r=>setTimeout(r,1000));}throw new Error("Observation window expired");}
try {
  const login = await client.action(api.auth.signIn, { provider: "anonymous" });
  if (!login.tokens?.token) throw new Error("session unavailable");
  client.setAuth(login.tokens.token);
  householdId = await client.action(api.demoTokens.create, {});
  await until(()=>client.query(api.inbox.connection,{householdId}),v=>v?.status==="ready"&&v.contactSyncState==="ready");
  await client.mutation(api.consents.set,{householdId,scope:"aiProcessing",granted:false,noticeVersion:"synthetic-firecrawl",authorityStatement:"Verify crawling only; generation is separately verified"});
  const visits = await client.query(api.upcoming.list, { householdId, kind: "visits", from: Date.now(), to: Date.now() + 7 * 86400000, paginationOpts: { numItems: 10, cursor: null } });
  const visitId = visits.page[0]?._id;
  if (!visitId) throw new Error("sample visit missing");
  const url = await client.query(api.demoFixtures.url, { householdId });
  phase = "fixture baseline";
  const watchId = await client.mutation(api.watches.create, { visitId, url, requestId: "fixture-watch" });
  const baseline = await until(()=>client.query(api.watches.get,{watchId}),v=>!!v.lastSuccessfulSourceId);
  if (!baseline.lastSuccessfulSourceId) throw new Error(baseline.lastResult ?? "no source");
  const initial = await client.query(api.sources.get, { sourceId: baseline.lastSuccessfulSourceId });
  if (initial.comparison !== "baseline" || !initial.plaintext.includes("east entrance")) throw new Error("baseline mismatch");
  console.log(JSON.stringify({ phase, realTransport: true, sourceStored: true }));
  phase = "public location map";
  const candidates = await client.action(api.web.map, { householdId, url: "https://www.ucsfhealth.org/locations/mission-bay-campus" });
  if (!candidates.length || candidates.some(c => new URL(c.url).hostname !== "www.ucsfhealth.org")) throw new Error("map candidates invalid");
  console.log(JSON.stringify({ phase, sameDomainCandidates: candidates.length }));
  phase = "real public location scrape";
  const realWatchId = await client.mutation(api.watches.create, { visitId, url: "https://www.ucsfhealth.org/locations/mission-bay-campus", requestId: "public-location" });
  const realWatch = await until(()=>client.query(api.watches.get,{watchId:realWatchId}),v=>!!v.lastSuccessfulSourceId);
  if (!realWatch.lastSuccessfulSourceId) throw new Error("public source missing");
  const realSource = await client.query(api.sources.get, { sourceId: realWatch.lastSuccessfulSourceId });
  if (!/parking|street|entrance/i.test(realSource.plaintext)) throw new Error("no logistical text");
  console.log(JSON.stringify({ phase, logisticalText: true, sourceStored: true }));
  phase = "changed fixture";
  await client.mutation(api.demoFixtures.change, { householdId, version: 2 });
  const cooldownRemaining = Math.max(0, baseline.lastAttemptAt + 61000 - Date.now());
  if (cooldownRemaining) await new Promise(resolve => setTimeout(resolve, cooldownRemaining));
  await client.action(api.web.checkNow, { watchId, requestId: "changed" });
  const changedWatch = await until(()=>client.query(api.watches.get,{watchId}),v=>!!v.lastSuccessfulSourceId&&v.lastSuccessfulSourceId!==baseline.lastSuccessfulSourceId);
  const changed = await client.query(api.sources.get, { sourceId: changedWatch.lastSuccessfulSourceId });
  if (changed.comparison !== "changed" || changed.previousSourceId !== initial._id || !changed.plaintext.includes("west entrance")) throw new Error("change comparison mismatch");
  console.log(JSON.stringify({ phase, comparison: "changed", previousEvidenceRetained: true }));
} catch {
  console.error(`Firecrawl verification failed at ${phase}; private payloads and credentials omitted.`);
  process.exitCode = 1;
} finally {
  if (householdId) {
    try { const privacyJobId=await client.mutation(api.privacyJobs.request, { householdId, kind: "delete", confirmed: true, requestId: "firecrawl-verification-cleanup" }); await until(()=>client.query(api.privacyJobs.get,{privacyJobId}),v=>v.state==="succeeded"&&!v.workflowId,20*60000); console.log("Synthetic household and provider resources deleted."); }
    catch { console.error("Synthetic cleanup request failed."); process.exitCode = 1; }
  }
  await client.action(api.auth.signOut, {}).catch(() => {});
}
