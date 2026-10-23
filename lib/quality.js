// The last check before a card is saved. It fixes what it can from what the card already holds and
// lists what it couldn't, so the page can say right away which card needs a look.
import { isNoticeName, regionOf } from "./naver.js";

const squash = s => String(s || "").replace(/\s+/g, "");

export function reviewCard(p) {
  // menus: no notices or headings, no repeats, no menu that is just the place's own name
  const seen = new Set();
  p.menus = (Array.isArray(p.menus) ? p.menus : [])
    .map(m => String(m || "").trim())
    .filter(m => m && !isNoticeName(m) && squash(m) !== squash(p.name))
    .filter(m => (seen.has(squash(m)) ? false : seen.add(squash(m))))
    .slice(0, 2);

  // neighbourhood from the address when the memo didn't give one
  if (!p.gu && p.address) {
    const r = regionOf(p.address, "");
    if (r.gu) { p.gu = r.gu; if (!p.city) p.city = r.city; }
  }

  const issues = [];
  if (p.name && !p.placeId && !p.link && !p.naverLink) issues.push("네이버 장소 연결 없음");
  if (p.name && !p.gu) issues.push("동네 정보 없음");
  if (p.name && !p.photoUrl) issues.push("음식 사진 없음");
  if (!p.menus.length) issues.push("메뉴 없음");
  return issues;
}
