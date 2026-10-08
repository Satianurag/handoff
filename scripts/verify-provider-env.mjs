// Read-only authentication checks; never prints credentials or mailbox contents.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const deployment = process.argv[2] ?? "dev";
if (!["dev", "prod"].includes(deployment)) throw new Error("Specify dev or prod.");
for (const [name, url] of [
  ["AGENTMAIL_API_KEY", "https://api.agentmail.to/v0/inboxes?limit=1"],
  ["FIRECRAWL_API_KEY", "https://api.firecrawl.dev/v2/team/credit-usage"],
]) {
  const result = spawnSync("npx", ["convex", "env", "get", name, "--deployment", deployment], { cwd: root, encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error(`Missing ${name} on ${deployment}.`);
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${result.stdout.trim()}` } });
    console.log(`${deployment}: ${name} authentication HTTP ${response.status}`);
    if (!response.ok) process.exitCode = 1;
  } catch {
    console.log(`${deployment}: ${name} authentication network error`);
    process.exitCode = 1;
  }
}
