import http from "node:http";
import { isAppRoute } from "../web/routes.js";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { publicConfig } from "./public-web-config.mjs";
const preview = process.argv.includes("--dist");
const root = resolve(preview ? "dist" : "web");
const port = Number(process.env.PORT || 4173);
// A release preview must use the config that will actually be uploaded.
const config = preview
  ? await readFile(resolve(root, "config.js"), "utf8")
  : await publicConfig();
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
};
http
  .createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Cache-Control", "no-store");
      if (pathname === "/config.js") {
        res.writeHead(200, { "Content-Type": mime[".js"] });
        res.end(config);
        return;
      }
      const path = resolve(
        root,
        "." +
          (pathname === "/"
            ? "/index.html"
            : isAppRoute(pathname)
              ? "/index.html"
              : pathname),
      );
      if (!path.startsWith(root + sep) || !(await stat(path)).isFile())
        throw Error("not found");
      res.writeHead(200, {
        "Content-Type": mime[extname(path)] || "application/octet-stream",
      });
      res.end(await readFile(path));
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  })
  .listen(port, "127.0.0.1", () =>
    console.log(`Handoff: http://localhost:${port}`),
  );
