// Minimal static file server, so `npm test` needs no python and no global tooling.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".wasm": "application/wasm", ".png": "image/png",
};

export function startServer(port = 8787) {
  const server = http.createServer((req, res) => {
    // strip the ?v= cache-busting query the app puts on every module
    const rel = decodeURIComponent(req.url.split("?")[0]);
    const file = path.join(ROOT, rel === "/" ? "index.html" : rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end("not found: " + rel); return; }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(port, () => resolve({
      url: "http://localhost:" + port,
      close: () => new Promise((r) => server.close(r)),
    }));
  });
}
