// Look over the cards already saved on the live app with the same check new cards get:
// `npm run audit` (reads only; set EATER_URL for another deployment).
import { reviewCard } from "../lib/quality.js";

const base = process.env.EATER_URL || "https://mukkit.vercel.app";
const { places } = await (await fetch(base + "/api/places")).json();
let ok = 0;
for (const p of places) {
  const copy = JSON.parse(JSON.stringify(p));
  const issues = reviewCard(copy);
  if (!p.area) issues.push("권역 없음");
  if (JSON.stringify(copy.menus) !== JSON.stringify((p.menus || []).slice(0, 2))) issues.push(`메뉴 정리 필요 (${(p.menus || []).join(", ")} → ${copy.menus.join(", ")})`);
  if (issues.length) console.log(`⚠️ ${p.name || "(이름 없음)"}: ${issues.join(" / ")}`);
  else ok++;
}
console.log(`\n문제 없음 ${ok}곳 / 전체 ${places.length}곳`);
