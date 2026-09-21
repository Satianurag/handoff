import { readFile } from "node:fs/promises";
export async function publicConfig() {
  let url = process.env.VITE_CONVEX_URL || process.env.CONVEX_URL;
  if (!url) {
    try {
      const env = await readFile(".env.local", "utf8");
      url = env.match(/^CONVEX_URL\s*=\s*["']?([^\s"']+)/m)?.[1];
    } catch {
      /* Explicit error below. */
    }
  }
  if (!url || !/^https:\/\/[a-z0-9-]+\.convex\.cloud$/.test(url))
    throw new Error(
      "Set CONVEX_URL to the target Convex deployment before serving or building.",
    );
  return `window.HANDOFF_CONFIG=${JSON.stringify({ convexUrl: url })};\n`;
}
