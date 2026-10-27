// ‘나의 하이디라오’ 페이지(claude.ai 아티팩트)를 만든다: haidilao.html의 __FONT_*__ 자리에
// 프리젠테이션 웹폰트(SIL OFL 1.1)를 data URI로 넣어 dist/haidilao.html로 쓴다.
// 아티팩트는 Google Fonts 말고 다른 곳의 폰트를 불러올 수 없어서 글꼴을 파일 안에 넣는다.
// 폰트는 FONT_DIR(이미 받아 둔 폴더)에서 읽고, 없으면 jsDelivr에서 받는다.
//   node haidilao/build.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const WEIGHTS = ["3Light", "4Regular", "6SemiBold", "8ExtraBold"];
const CDN = "https://cdn.jsdelivr.net/gh/projectnoonnu/2404@1.0";

async function font(w) {
  const file = `Freesentation-${w}.woff2`;
  if (process.env.FONT_DIR) return fs.readFile(path.join(process.env.FONT_DIR, file));
  const res = await fetch(`${CDN}/${file}`);
  if (!res.ok) throw new Error(`${file}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

let html = await fs.readFile(path.join(here, "haidilao.html"), "utf8");
for (const w of WEIGHTS) {
  const mark = `__FONT_${w}__`;
  if (!html.includes(mark)) throw new Error(`haidilao.html: ${mark} 자리가 없어요`);
  html = html.replace(mark, `data:font/woff2;base64,${(await font(w)).toString("base64")}`);
}
await fs.mkdir(path.join(here, "dist"), { recursive: true });
await fs.writeFile(path.join(here, "dist", "haidilao.html"), html);
console.log(`dist/haidilao.html ${(html.length / 1024 / 1024).toFixed(2)}MB`);
