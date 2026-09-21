import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { publicConfig } from "./public-web-config.mjs";
import './sync-web-vendors.mjs';
const config = await publicConfig();
await mkdir("dist", { recursive: true });
for (const name of await readdir("dist"))
  await rm(`dist/${name}`, { recursive: true, force: true });
await cp("web", "dist", {
  recursive: true,
  filter: (source) => !source.endsWith(".md"),
});
await writeFile("dist/config.js", config);
console.log(
  "Built Handoff with the official Convex browser client. Only its public deployment URL is included.",
);
