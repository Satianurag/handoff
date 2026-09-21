import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const keys = ["AGENTMAIL_API_KEY", "FIRECRAWL_API_KEY"];
for (const name of keys) {
  if (!process.env[name]?.trim()) throw new Error(`Missing ${name}. Load the ignored .env.local file.`);
}
for (const deployment of ["dev", "prod"]) {
  for (const name of keys) {
    const result = spawnSync("npx", ["convex", "env", "set", name, "--deployment", deployment], {
      cwd: root, input: process.env[name], encoding: "utf8",
    });
    if (result.status !== 0) throw new Error(`Failed to configure ${name} on ${deployment}; raw output withheld.`);
  }
  console.log(`${deployment}: sponsor credentials configured.`);
}
