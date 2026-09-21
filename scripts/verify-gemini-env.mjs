import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import { IdentityPoolClient } from "google-auth-library";

const deployment = process.argv[2] ?? "dev";
if (!["dev", "prod"].includes(deployment)) throw new Error("Specify dev or prod.");
const root = fileURLToPath(new URL("../", import.meta.url));
function env(name) {
  const r = spawnSync("npx", ["convex", "env", "get", name, "--deployment", deployment], {
    cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024,
  });
  if (r.status !== 0 || !r.stdout.trim()) throw new Error(`Missing ${name}; raw output withheld.`);
  return r.stdout.trim();
}
const config = Object.fromEntries([
  "GEMINI_AUTH_PRIVATE_KEY", "GEMINI_AUTH_KEY_ID", "GEMINI_AUTH_ISSUER", "GEMINI_AUTH_AUDIENCE",
  "GEMINI_AUTH_SUBJECT", "GOOGLE_CLOUD_PROJECT", "GEMINI_MODEL",
].map(name => [name, env(name)]));
const key = await importPKCS8(config.GEMINI_AUTH_PRIVATE_KEY, "RS256");
const auth = new IdentityPoolClient({
  audience: config.GEMINI_AUTH_AUDIENCE,
  subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
  token_url: "https://sts.googleapis.com/v1/token",
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  subject_token_supplier: {
    getSubjectToken: async () => new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: config.GEMINI_AUTH_KEY_ID })
      .setIssuer(config.GEMINI_AUTH_ISSUER).setAudience(config.GEMINI_AUTH_AUDIENCE)
      .setSubject(config.GEMINI_AUTH_SUBJECT).setIssuedAt().setExpirationTime("5m")
      .setJti(randomUUID()).sign(key),
  },
});
try {
  const { token } = await auth.getAccessToken();
  if (!token) throw new Error("No federated token returned.");
  const url = `https://aiplatform.googleapis.com/v1/projects/${config.GOOGLE_CLOUD_PROJECT}/locations/global/publishers/google/models/${config.GEMINI_MODEL}:generateContent`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-goog-user-project": config.GOOGLE_CLOUD_PROJECT },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Return exactly the word READY." }] }], generationConfig: { thinkingConfig: { thinkingLevel: "HIGH" } } }),
  });
  const result = await response.json();
  if (!response.ok) {
    console.log(JSON.stringify({ deployment, httpStatus: response.status, errorStatus: result.error?.status, message: result.error?.message }));
    process.exitCode = 1;
  } else {
    const text = (result.candidates ?? []).flatMap(c => c.content?.parts ?? []).filter(p => !p.thought).map(p => p.text ?? "").join("").trim();
    console.log(JSON.stringify({ deployment, httpStatus: response.status, model: result.modelVersion, expectedResponse: text === "READY" }));
    if (text !== "READY") process.exitCode = 1;
  }
} catch (error) {
  // Google errors can carry request headers and signed tokens. Emit only safe status fields.
  console.log(JSON.stringify({ deployment, authenticationFailed: true, status: error?.response?.status ?? null, reason: error?.response?.data?.error ?? error?.code ?? null }));
  process.exitCode = 1;
}
