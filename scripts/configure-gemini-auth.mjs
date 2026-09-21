// Model authentication only. Does not deploy a Google-hosted application or change org policy.
import { spawnSync } from "node:child_process";
import { createPublicKey, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { exportPKCS8, generateKeyPair } from "jose";

const root = fileURLToPath(new URL("../", import.meta.url));
function command(bin, args, input, allowFailure = false) {
  const r = spawnSync(bin, args, { cwd: root, input, encoding: "utf8", maxBuffer: 2 ** 20 });
  if (r.status !== 0) {
    if (allowFailure) return null;
    throw new Error(`${bin} ${args.slice(0, 4).join(" ")} failed. Raw output withheld.`);
  }
  return r.stdout.trim();
}
const project = command("gcloud", ["config", "get-value", "project"]);
const gc = (args, allowFailure = false) => command("gcloud", [...args, `--project=${project}`, "--format=json", "--quiet"], undefined, allowFailure);
const projectNumber = JSON.parse(gc(["projects", "describe", project])).projectNumber;
const pool = "handoff-model-inference";
gc(["services", "enable", "sts.googleapis.com"]);
if (!gc(["iam", "workload-identity-pools", "describe", pool, "--location=global"], true)) {
  gc(["iam", "workload-identity-pools", "create", pool, "--location=global", "--display-name=Handoff model inference", "--description=Convex workload authentication for Gemini inference only"]);
}

for (const [deployment, issuer] of [
  ["dev", "https://befitting-cobra-234.convex.site"],
  ["prod", "https://admired-fish-176.convex.site"],
]) {
  const env = (args, input) => command("npx", ["convex", "env", ...args, "--deployment", deployment], input);
  const names = new Set(env(["list", "--names-only"]).split(/\s+/));
  let pem, kid;
  if (names.has("GEMINI_AUTH_PRIVATE_KEY") && names.has("GEMINI_AUTH_KEY_ID")) {
    pem = env(["get", "GEMINI_AUTH_PRIVATE_KEY"]);
    kid = env(["get", "GEMINI_AUTH_KEY_ID"]);
  } else {
    if (names.has("GEMINI_AUTH_PRIVATE_KEY") || names.has("GEMINI_AUTH_KEY_ID")) throw new Error("Incomplete model signing credential; refusing replacement.");
    const pair = await generateKeyPair("RS256", { extractable: true });
    pem = await exportPKCS8(pair.privateKey);
    kid = randomUUID();
    env(["set", "GEMINI_AUTH_PRIVATE_KEY"], pem);
    env(["set", "GEMINI_AUTH_KEY_ID"], kid);
  }
  const publicJwk = createPublicKey(pem).export({ format: "jwk" });
  const provider = `convex-${deployment}`;
  const subject = `handoff-${deployment}-inference`;
  const audience = `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${pool}/providers/${provider}`;
  const temp = mkdtempSync(join(tmpdir(), "handoff-public-jwks-"));
  try {
    const path = join(temp, "jwks.json");
    writeFileSync(path, JSON.stringify({ keys: [{ ...publicJwk, alg: "RS256", use: "sig", kid }] }));
    const existing = gc(["iam", "workload-identity-pools", "providers", "describe", provider, `--workload-identity-pool=${pool}`, "--location=global"], true);
    if (!existing) {
      gc(["iam", "workload-identity-pools", "providers", "create-oidc", provider,
        `--workload-identity-pool=${pool}`, "--location=global", `--issuer-uri=${issuer}`,
        `--allowed-audiences=${audience}`, "--attribute-mapping=google.subject=assertion.sub",
        `--attribute-condition=assertion.sub == '${subject}'`, `--jwk-json-path=${path}`]);
    } else {
      const p = JSON.parse(existing);
      if (p.oidc?.issuerUri !== issuer || p.attributeCondition !== `assertion.sub == '${subject}'`) throw new Error("Existing workload provider differs; refusing mutation.");
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
  const principal = `principal://iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${pool}/subject/${subject}`;
  gc(["projects", "add-iam-policy-binding", project, `--member=${principal}`, `--role=projects/${project}/roles/handoffGeminiInference`, "--condition=None"]);
  for (const [name, value] of Object.entries({
    GEMINI_PROVIDER: "vertex-federation", GEMINI_MODEL: "gemini-3.8-flash",
    GOOGLE_CLOUD_PROJECT: project, GOOGLE_CLOUD_LOCATION: "global",
    GEMINI_AUTH_ISSUER: issuer, GEMINI_AUTH_AUDIENCE: audience, GEMINI_AUTH_SUBJECT: subject,
  })) env(["set", name], value);
  console.log(`${deployment}: inference-only workload federation configured; no secret values displayed.`);
}
