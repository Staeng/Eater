// Fill a card in from the web: Naver Place (menu photo, 대표 메뉴, category, coordinates) and
// what blogs say about booking it on CatchTable. Every step is best effort; failures leave the card as is.
import { naverMenuPhoto } from "./naver.js";
import { catchtableSearch, catchtablePrompt, CATCHTABLE_SCHEMA, SHOP_URL } from "./catchtable.js";
import { askClaude, readJson } from "./claude.js";

const str = v => (typeof v === "string" ? v.trim() : "");
const same = (a, b) => { const x = a.replace(/\s/g, ""), y = b.replace(/\s/g, ""); return x.includes(y) || y.includes(x); };

async function judgeCatchtable(name, where, report) {
  const found = await catchtableSearch(name, where);
  if (!found) { report.catchtable = "검색 실패"; return null; }
  if (!/캐치테이블/.test(found.text)) { report.catchtable = "언급 없음"; return null; }
  try {
    const message = await askClaude({
      system: "너는 맛집 예약 정보를 정리하는 도우미야. 주어진 검색 결과에 근거가 있는 것만 답해.",
      content: [{ type: "text", text: catchtablePrompt(name, where, found) }],
      schema: CATCHTABLE_SCHEMA,
      jsonHint: '{"mode":"예약|웨이팅|없음|모름","advance":false,"shop":"","note":""}',
    });
    if (message.stop_reason === "refusal") { report.catchtable = "거절"; return null; }
    const out = readJson(message);
    if (!out) { report.catchtable = "응답 형식 오류"; return null; }
    report.catchtable = `${out.mode}${out.advance ? " (미리 예약)" : ""}${out.shop ? " " + out.shop : ""}`;
    const shop = found.shops.some(s => s.url === out.shop) && SHOP_URL.test(out.shop) ? out.shop : "";
    return { mode: str(out.mode), advance: out.advance === true, shop, note: str(out.note).slice(0, 60) };
  } catch (err) {
    console.warn("catchtable:", err.message);
    report.catchtable = "판단 실패: " + err.message.slice(0, 80);
    return null;
  }
}

// `p` is a place as Claude returned it or as stored; `memo` is the text the links must come from.
// Returns a short report of what each lookup found.
export async function enrichPlace(p, memo) {
  const report = { naver: "건너뜀", catchtable: "건너뜀" };
  const raw = str(p.link);
  const link = raw && memo.includes(raw) ? raw : "";
  let name = str(p.name);
  if (!link && !name) return report;
  const where = [p.gu, p.dong].filter(v => typeof v === "string").join(" ");
  const menus = Array.isArray(p.menus) ? p.menus.filter(m => typeof m === "string" && m.trim()) : [];

  const info = await naverMenuPhoto({ link, name, where, menus });
  report.naver = info ? (info.image ? "메뉴 사진 찾음" : "메뉴 사진 없음") : "못 찾음";
  if (info) {
    if (!name && info.name) name = p.name = info.name;
    if (!p.address && info.address) p.address = info.address;
    if (info.lat) { p.lat = info.lat; p.lng = info.lng; }
    p.placeId = info.placeId;
    if (info.link) p.naverLink = info.link;
    // only a menu photo; a storefront/interior picture from earlier versions is dropped
    p.photoUrl = info.image || "";
    // memo's menus first, then the place's 대표 메뉴 (skipping near-duplicates like 곰탕 / 나주곰탕)
    const merged = [...menus];
    for (const m of [...(info.menus || []), info.menu].filter(Boolean)) if (!merged.some(x => same(x, m))) merged.push(m);
    p.menus = merged.slice(0, 4);
    // Naver's category wins, except that a generic 한식 doesn't undo a more specific pick
    if (info.category && !(info.category === "한식" && ["소고기", "돼지고기", "닭·오리", "해산물", "면요리"].includes(p.category))) p.category = info.category;
  }

  if (name) {
    const ct = await judgeCatchtable(name, p.gu || where, report);
    if (ct && ct.mode === "예약") p.catchtable = ct.shop || "https://app.catchtable.co.kr/ct/search/total?keyword=" + encodeURIComponent(name);
    const note = ct && (ct.mode === "예약" || ct.mode === "웨이팅") ? ct.note || (ct.advance ? "캐치테이블 예약 필요" : "") : "";
    const memoNow = str(p.memo);
    if (note && !memoNow.includes("캐치테이블")) p.memo = memoNow ? `${memoNow} · ${note}` : note;
  }
  return report;
}
