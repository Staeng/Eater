// Builds the Vercel site into public/: eater.html (written in claude.ai artifact form, without
// <!doctype>/<head>) gets a real document shell, and everything in static/ is copied next to it.
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "public");

const page = await fs.readFile(path.join(root, "eater.html"), "utf8");
const cut = page.indexOf("</style>") + "</style>".length;
if (cut < 8) throw new Error("eater.html: expected <title>…<style>…</style> at the top");

// Link previews (카톡 등) need an absolute image URL; Vercel exposes the production domain at build time.
const site = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "";
const og = [
  `<meta property="og:type" content="website">`,
  `<meta property="og:title" content="Eater 먹킷리스트">`,
  `<meta property="og:description" content="먹고 싶은 곳을 두서없이 적으면 카드로 정리해 주는 맛집 위시리스트">`,
  site && `<meta property="og:url" content="${site}/">`,
  site && `<meta property="og:image" content="${site}/icon-512.png">`,
].filter(Boolean).join("\n");

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="먹고 싶은 곳을 두서없이 적으면 Claude가 카드로 정리해 주는 맛집 위시리스트">
<meta name="theme-color" content="#FFF6F5">
<meta name="color-scheme" content="light">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Eater">
<meta name="mobile-web-app-capable" content="yes">
${og}
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/fonts/Paperlogy-4Regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/Paperlogy-8ExtraBold.woff2" as="font" type="font/woff2" crossorigin>
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}</style>
${page.slice(0, cut).trim()}
</head>
<body>
${page.slice(cut).trim()}
</body>
</html>
`;

await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
await fs.cp(path.join(root, "static"), out, { recursive: true });
await fs.writeFile(path.join(out, "index.html"), html);
console.log("built public/index.html");
