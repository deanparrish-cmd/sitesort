import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "dist/public");
const port = parseInt(process.env.PORT, 10);

if (!port) throw new Error("PORT env var required");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

const indexHtml = path.join(distDir, "index.html");

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const filePath = path.join(distDir, url.pathname);

  // Prevent path traversal
  if (!filePath.startsWith(distDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  let target = filePath;
  let exists = fs.existsSync(target) && fs.statSync(target).isFile();

  // SPA fallback: any unmatched route serves index.html
  if (!exists) {
    target = indexHtml;
    exists = fs.existsSync(target);
  }

  if (!exists) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(target);
  const mime = MIME[ext] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": mime });
  fs.createReadStream(target).pipe(res);
}).listen(port, "0.0.0.0", () => {
  console.log(`Frontend listening on port ${port}`);
});
