// Local stand-in for `vercel dev`: serves public/ and runs api/*.js with Vercel's (req, res) helpers.
// Data goes to .data/dev-store.json unless Redis env vars are set.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.env.EATER_LOCAL_STORE ||= path.join(root, ".data", "dev-store.json");
const port = Number(process.env.PORT || 3000);

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};

function helpers(res) {
  res.status = code => { res.statusCode = code; return res; };
  res.json = obj => { if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); return res; };
  res.send = body => { res.end(body); return res; };
  return res;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  helpers(res);
  try {
    if (url.pathname.startsWith("/api/")) {
      const name = url.pathname.slice(5).replace(/[^a-z]/g, "");
      const mod = await import(pathToFileURL(path.join(root, "api", `${name}.js`)).href);
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString("utf8");
      req.query = Object.fromEntries(url.searchParams);
      req.body = raw && /json/.test(req.headers["content-type"] || "") ? JSON.parse(raw) : raw || undefined;
      return await mod.default(req, res);
    }
    const file = path.join(root, "public", url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname));
    if (!file.startsWith(path.join(root, "public"))) return res.status(403).end();
    const body = await fs.readFile(file);
    res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
    res.end(body);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "ERR_MODULE_NOT_FOUND") return res.status(404).end("not found");
    console.error(err);
    res.status(500).end("error");
  }
}).listen(port, () => console.log(`Eater dev server on http://localhost:${port}`));
