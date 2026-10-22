// Fill a card in from the web: Naver Place (menu photo, 대표 메뉴, category, coordinates) and
// what blogs say about booking it on CatchTable. Every step is best effort; failures leave the card as is.
// Naver's menu photos are sometimes a logo or a poster, so Claude looks at a few candidates
// (menu and visitors' photos) and picks one that actually shows a dish.
import { naverMenuPhoto } from "./naver.js";
import { bookingSearch, bookingPrompt, BOOKING_SCHEMA, SHOP_URL, catchtableSearchUrl, tablingSearchUrl } from "./catchtable.js";
import { askClaude, readJson } from "./claude.js";

const str = v => (typeof v === "string" ? v.trim() : "");
const same = (a, b) => { const x = a.replace(/\s/g, ""), y = b.replace(/\s/g, ""); return x.includes(y) || y.includes(x); };

const PHOTO_SCHEMA = {
  type: "object",
  properties: { pick: { type: "integer" } },
  required: ["pick"],
  additionalProperties: false,
};

async function asImage(photo) {
  try {
    const res = await fetch(photo.url, { signal: AbortSignal.timeout(6000) });
    const type = (res.headers.get("content-type") || "").split(";")[0].trim();
    if (!res.ok || !/^image\/(jpeg|png|gif|webp)$/.test(type)) return null;
    return { ...photo, type, data: Buffer.from(await res.arrayBuffer()).toString("base64") };
  } catch { return null; }
}

// Returns the URL of the candidate that shows a dish, "" when none does, or `fallback` when
// Claude can't be asked (no key, error), which keeps the old behaviour of the first menu photo.
async function pickDishPhoto(photos, menus, fallback, report) {
  const shots = (await Promise.all(photos.map(asImage))).filter(Boolean);
  if (!shots.length) { report.photo = "후보 없음"; return fallback; }
  try {
    const message = await askClaude({
      system: "너는 맛집 카드에 붙일 대표 사진을 고르는 도우미야.",
      content: [
        { type: "text", text: [
          `이 식당의 사진 ${shots.length}장이야.${menus.length ? ` 먹고 싶은 메뉴: ${menus.join(", ")}.` : ""}`,
          "음식(요리)이 화면 대부분을 차지하는 실제 사진 중 메뉴를 가장 잘 보여주는 것 하나의 번호를 골라.",
          "로고, 그림·일러스트, 글자가 크게 들어간 메뉴판·홍보 이미지, 가게 외관, 실내, 사람이 주인공인 사진은 안 돼. 맞는 게 없으면 0.",
        ].join("\n") },
        ...shots.flatMap((s, i) => [
          { type: "text", text: `${i + 1}번 ${s.menu ? `(메뉴판 사진: ${s.menu})` : "(손님 리뷰 사진)"}` },
          { type: "image", source: { type: "base64", media_type: s.type, data: s.data } },
        ]),
      ],
      schema: PHOTO_SCHEMA,
      jsonHint: '{"pick":0}',
    });
    const n = Number((readJson(message) || {}).pick);
    if (message.stop_reason !== "refusal" && Number.isInteger(n) && n >= 0 && n <= shots.length) {
      report.photo = n ? `${n}번 사진 (${shots[n - 1].menu ? "메뉴판" : "손님"})` : "음식 사진 없음";
      return n ? shots[n - 1].url : "";
    }
  } catch (err) {
    console.warn("photo:", err.message);
  }
  report.photo = "판단 실패, 첫 메뉴 사진";
  return fallback;
}

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
  const report = { naver: "건너뜀", photo: "건너뜀", booking: "건너뜀" };
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
    // memo's menus first, then the place's 대표 메뉴 (skipping near-duplicates like 곰탕 / 나주곰탕)
    const merged = [...menus];
    for (const m of [...(info.menus || []), info.menu].filter(Boolean)) if (!merged.some(x => same(x, m))) merged.push(m);
    p.menus = merged.slice(0, 4);
    // Naver's category wins, except that a generic 한식 doesn't undo a more specific pick
    if (info.category && !(info.category === "한식" && ["소고기", "돼지고기", "닭·오리", "해산물", "면요리"].includes(p.category))) p.category = info.category;
  }

  // the photo check and the booking lookup are independent, so they run together
  const [photo, b] = await Promise.all([
    info ? pickDishPhoto(info.photos || [], p.menus || [], info.image || "", report) : null,
    name ? judgeBooking(name, p.gu || where, report) : null,
  ]);
  // only a dish photo; a storefront/interior picture from earlier versions is dropped
  if (info) p.photoUrl = photo || "";
  if (b) {
    // CatchTable button only for reservations (as asked); Tabling is mostly remote waiting, so either counts
    if (b.ct.mode === "예약") p.catchtable = b.ct.shop || catchtableSearchUrl(name);
    else if (b.ct.mode === "없음" || b.ct.mode === "웨이팅") p.catchtable = null;
    if (b.tb.mode === "예약" || b.tb.mode === "웨이팅") { p.tabling = tablingSearchUrl(name); p.tablingMode = b.tb.mode; }
    else if (b.tb.mode === "없음") { p.tabling = null; p.tablingMode = null; }
    const memoNow = str(p.memo);
    if (b.note && !/캐치테이블|테이블링/.test(memoNow)) p.memo = memoNow ? `${memoNow} · ${b.note}` : b.note;
  }
  return report;
}
