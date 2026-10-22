// Fill a card in from the web: Naver Place (menu photo, 대표 메뉴, category, coordinates) and
// what blogs say about booking it on CatchTable. Every step is best effort; failures leave the card as is.
import { naverMenuPhoto } from "./naver.js";
import { bookingSearch, bookingPrompt, BOOKING_SCHEMA, SHOP_URL, catchtableSearchUrl, tablingSearchUrl } from "./catchtable.js";
import { askClaude, readJson } from "./claude.js";

const str = v => (typeof v === "string" ? v.trim() : "");
const same = (a, b) => { const x = a.replace(/\s/g, ""), y = b.replace(/\s/g, ""); return x.includes(y) || y.includes(x); };

async function judgeBooking(name, where, report) {
  const found = await bookingSearch(name);
  if (found.error) { report.booking = `검색 실패: ${found.error}`; return null; }
  if (!/캐치테이블|테이블링/.test(found.catchtable + found.tabling)) { report.booking = "언급 없음"; return null; }
  try {
    const message = await askClaude({
      system: "너는 맛집 예약 정보를 정리하는 도우미야. 주어진 검색 결과에 근거가 있는 것만 답해.",
      content: [{ type: "text", text: bookingPrompt(name, where, found) }],
      schema: BOOKING_SCHEMA,
      jsonHint: '{"catchtable":{"mode":"예약|웨이팅|없음|모름","advance":false,"shop":""},"tabling":{"mode":"예약|웨이팅|없음|모름","advance":false},"note":""}',
    });
    if (message.stop_reason === "refusal") { report.booking = "거절"; return null; }
    const out = readJson(message);
    if (!out || !out.catchtable || !out.tabling) { report.booking = "응답 형식 오류"; return null; }
    const ct = { mode: str(out.catchtable.mode), advance: out.catchtable.advance === true, shop: str(out.catchtable.shop) };
    if (!(found.shops.some(s => s.url === ct.shop) && SHOP_URL.test(ct.shop))) ct.shop = "";
    const tb = { mode: str(out.tabling.mode), advance: out.tabling.advance === true };
    report.booking = `캐치테이블 ${ct.mode}${ct.advance ? "(미리)" : ""} · 테이블링 ${tb.mode}${tb.advance ? "(미리)" : ""}`;
    return { ct, tb, note: str(out.note).slice(0, 70) };
  } catch (err) {
    console.warn("booking:", err.message);
    report.booking = "판단 실패: " + err.message.slice(0, 80);
    return null;
  }
}

// `p` is a place as Claude returned it or as stored; `memo` is the text the links must come from.
// Returns a short report of what each lookup found.
export async function enrichPlace(p, memo) {
  const report = { naver: "건너뜀", booking: "건너뜀" };
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
    const b = await judgeBooking(name, p.gu || where, report);
    if (b) {
      // CatchTable button only for reservations (as asked); Tabling is mostly remote waiting, so either counts
      if (b.ct.mode === "예약") p.catchtable = b.ct.shop || catchtableSearchUrl(name);
      else if (b.ct.mode === "없음" || b.ct.mode === "웨이팅") p.catchtable = null;
      if (b.tb.mode === "예약" || b.tb.mode === "웨이팅") { p.tabling = tablingSearchUrl(name); p.tablingMode = b.tb.mode; }
      else if (b.tb.mode === "없음") { p.tabling = null; p.tablingMode = null; }
      const memoNow = str(p.memo);
      if (b.note && !/캐치테이블|테이블링/.test(memoNow)) p.memo = memoNow ? `${memoNow} · ${b.note}` : b.note;
    }
  }
  return report;
}
