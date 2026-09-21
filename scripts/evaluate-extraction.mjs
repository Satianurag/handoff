import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
const resultsPath = new URL("../docs/extraction-evaluation.json", import.meta.url);
const only = process.argv.slice(2).map(Number);
const indices = only.length ? only : Array.from({length:40},(_,i)=>i);
const promptVersion="handoff-logistics-v2";
const priorReport=existsSync(resultsPath)?JSON.parse(readFileSync(resultsPath,"utf8")):null;
const results=only.length&&priorReport?.promptVersion===promptVersion?priorReport.results:[];
for (const fixtureIndex of indices) {
  try {
    let result;
    for(let attempt=0;attempt<4;attempt++) {
      const stdout = execFileSync("npx", ["convex", "run", "generationEvaluation:evaluate", JSON.stringify({fixtureIndex})], { encoding:"utf8",stdio:["ignore","pipe","pipe"],maxBuffer:1024*1024 });
      result=JSON.parse(stdout);
      if(result.promptVersion!==promptVersion)throw new Error("Evaluation prompt version changed");
      if(!result.error)break;
      console.log(JSON.stringify({fixtureIndex,providerError:result.error,retry:attempt<3&&result.retryAfterMs>0}));
      if(attempt===3||!result.retryAfterMs)throw new Error("Model evaluation unavailable");
      await new Promise(r=>setTimeout(r,Math.max(result.retryAfterMs,Math.min(300000,30000*2**attempt)+Math.floor(Math.random()*1000))));
    }
    const prior=results.findIndex(r=>r.fixtureIndex===fixtureIndex);
    const row={fixtureIndex,...result}; if(prior>=0)results[prior]=row;else results.push(row);
    console.log(JSON.stringify({fixtureIndex,id:result.id,passed:result.passed,accepted:result.accepted,supported:result.supported}));
  } catch (error) { const diagnostics=String(error.stderr ?? error.message ?? ""); const safeCode=diagnostics.match(/MODEL_[A-Z_0-9]+/)?.[0] ?? (/RateLimit|rate.?limit/i.test(diagnostics)?"APPLICATION_BUDGET_LIMIT":"EVALUATION_EXECUTION_FAILED"); console.error(JSON.stringify({fixtureIndex,failed:true,reason:safeCode,detail:diagnostics.replace(/[^\s]{45,}/g,"[REDACTED]").slice(0,1000)})); process.exitCode=1; break; }
  const positives=results.filter(r=>r.positive), negatives=results.filter(r=>!r.positive), accepted=results.reduce((n,r)=>n+r.accepted,0), supported=results.reduce((n,r)=>n+r.supported,0);
  const report={model:"gemini-3.8-flash",thinking:"HIGH",promptVersion,syntheticFixtures:true,realModelCalls:true,testedAt:new Date().toISOString(),passed:results.filter(r=>r.passed).length,total:results.length,proposalPrecision:accepted?supported/accepted:null,positiveFixtureRecall:positives.length?positives.filter(r=>r.passed).length/positives.length:null,negativeAbstentionRate:negatives.length?negatives.filter(r=>r.passed).length/negatives.length:null,inputTokens:results.reduce((n,r)=>n+r.inputTokens,0),outputTokens:results.reduce((n,r)=>n+r.outputTokens,0),results:results.sort((a,b)=>a.fixtureIndex-b.fixtureIndex)};
  writeFileSync(resultsPath,JSON.stringify(report,null,2)+"\n");
  await new Promise(r=>setTimeout(r,2000));
}
if(results.length!==40||results.some(r=>!r.passed))process.exitCode=1;
