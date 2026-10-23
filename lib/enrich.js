// Fill a card in from the web: Naver Place (menu photo, 대표 메뉴, category, coordinates) and
// what blogs say about booking it on CatchTable. Every step is best effort; failures leave the card as is.
// Naver's menu photos are sometimes a logo or a poster, so Claude looks at a dozen candidates
// (menu, owner's and visitors' photos) and picks the dish photo that looks the most delicious.
import { naverMenuPhoto } from "./naver.js";
import { reviewCard } from "./quality.js";
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
export async function pickDishPhoto(photos, menus, fallback, report) {
  const shots = (await Promise.all(photos.map(asImage))).filter(Boolean);
  if (!shots.length) { report.photo = "후보 없음"; return fallback; }
  try {
    const message = await askClaude({
      system: "너는 맛집 카드에 붙일 대표 사진을 고르는 도우미야.",
      content: [
        { type: "text", text: [
          `이 식당의 사진 ${shots.length}장이야.${menus.length ? ` 먹고 싶은 메뉴: ${menus.join(", ")}.` : ""}`,
          "맛집 카드의 대표 사진으로 쓸, 보자마자 먹고 싶어질 만큼 가장 맛있어 보이는 음식 사진 하나의 번호를 골라.",
          "좋은 사진: 음식이 화면을 꽉 채우고, 선명하고 밝고, 윤기·김·단면·소스·바삭함처럼 먹음직스러움이 잘 보이는 것. 비슷하게 맛있어 보이면 먹고 싶은 메뉴가 찍힌 쪽.",
          "안 되는 사진: 로고, 그림·일러스트, 글자가 크게 들어간 메뉴판·홍보 이미지, 가게 외관, 실내, 사람이 주인공인 사진, 흐리거나 어둡거나 먹다 남은 사진. 맞는 게 없으면 0.",
        ].join("\n") },
        ...shots.flatMap((s, i) => [
          { type: "text", text: `${i + 1}번 (${s.from === "menu" ? `메뉴판 사진: ${s.menu}` : s.from === "owner" ? "가게가 올린 사진" : s.from === "blog" ? "블로그 후기 사진" : "손님 리뷰 사진"})` },
          { type: "image", source: { type: "base64", media_type: s.type, data: s.data } },
        ]),
      ],
      schema: PHOTO_SCHEMA,
      jsonHint: '{"pick":0}',
    });
    const n = Number((readJson(message) || {}).pick);
    if (message.stop_reason !== "refusal" && Number.isInteger(n) && n >= 0 && n <= shots.length) {
      report.photo = n ? `${n}번 사진 (${{ menu: "메뉴판", owner: "가게", visitor: "손님", blog: "블로그" }[shots[n - 1].from] || "?"})` : "음식 사진 없음";
      return n ? shots[n - 1].url : "";
    }
  } catch (err) {
    console.warn("photo:", err.message);
  }
  report.photo = "판단 실패, 첫 메뉴 사진";
  return fallback;
}

// Several eateries could be the one the memo means (found from parts of a typed name): Claude picks.
const PICK_SCHEMA = PHOTO_SCHEMA;
function chooser(memo, name, where, report) {
  return async candidates => {
    try {
      const message = await askClaude({
        system: "너는 사용자가 말한 식당을 네이버 지도 검색 결과에서 찾아 주는 도우미야.",
        content: [{ type: "text", text: [
          `사용자가 적은 글: ${memo}`,
          `식당 이름으로 보이는 말: ${name}${where ? ` (지역: ${where})` : ""}`,
          "",
          "네이버 지도 후보:",
          ...candidates.map((c, i) => `${i + 1}. ${c.title} (${c.category}, ${c.address})`),
          "",
          "사용자가 말한 식당이 확실한 후보 번호 하나. 메뉴 이름과 가게 이름이 섞여 있을 수 있어. 확실하지 않으면 0.",
        ].join("\n") }],
        schema: PICK_SCHEMA,
        jsonHint: '{"pick":0}',
      });
      const n = Number((readJson(message) || {}).pick);
      if (message.stop_reason !== "refusal" && Number.isInteger(n) && n >= 1 && n <= candidates.length) {
        report.search = `후보 ${candidates.length}곳 중 ${candidates[n - 1].title}`;
        return candidates[n - 1].id;
      }
      report.search = `후보 ${candidates.length}곳, 고르지 못함`;
    } catch (err) {
      console.warn("choose:", err.message);
      report.search = "후보 고르기 실패";
    }
    return null;
  };
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
// The same picture can come back under different resizer URLs (older cards used f300_300), so photos
// are compared by the original image address inside the thumbnail URL.
const imageKey = url => { try { return new URL(url).searchParams.get("src") || url; } catch { return String(url || ""); } };
export function unseenPhotos(photos, seen) {
  const skip = new Set((seen || []).filter(Boolean).map(imageKey));
  return (photos || []).filter(ph => !skip.has(imageKey(ph.url)));
}

export async function enrichPlace(p, memo) {
  const report = { naver: "건너뜀", photo: "건너뜀", booking: "건너뜀" };
  const raw = str(p.link);
  const link = raw && memo.includes(raw) ? raw : "";
  let name = str(p.name);
  if (!link && !name) return report;
  const where = [p.gu, p.dong].filter(v => typeof v === "string").join(" ");
  const menus = Array.isArray(p.menus) ? p.menus.filter(m => typeof m === "string" && m.trim()) : [];

  const info = await naverMenuPhoto({ link, name, where, menus, choose: chooser(memo, name, where, report) });
  report.naver = info ? (info.image ? "메뉴 사진 찾음" : "메뉴 사진 없음") : "못 찾음";
  // a place typed by name that Naver doesn't know is not added (the page asks to type it again),
  // so skip the rest; with a link the card is kept as before
  if (!info && name && !link) { report.missing = true; return report; }
  if (info) {
    // found from parts of the typed name: use Naver's own name ("을지로 골수 수제비" → "골수")
    if ((!name || info.how === "fuzzy") && info.name) name = p.name = info.name;
    // "골수 수제비" on the place 골수 is its 수제비
    const brand = name.replace(/\s+\S*점$/, "").trim();
    for (let i = 0; i < menus.length; i++) {
      if (brand && menus[i].startsWith(brand + " ")) menus[i] = menus[i].slice(brand.length).trim();
    }
    if (!p.address && info.address) p.address = info.address;
    // where the memo didn't say: take 시·구·동 from Naver's address (the page derives 권역 from them)
    if (!str(p.gu) && info.gu) {
      p.gu = info.gu;
      if (!str(p.city) && info.city) p.city = info.city;
      if (!str(p.dong) && info.dong) p.dong = info.dong;
    }
    if (info.lat) { p.lat = info.lat; p.lng = info.lng; }
    p.placeId = info.placeId;
    if (info.link) p.naverLink = info.link;
    // memo's menus first, then the place's 대표 메뉴 (skipping near-duplicates like 곰탕 / 나주곰탕)
    const merged = [...menus];
    for (const m of [...(info.menus || []), info.menu].filter(Boolean)) if (!merged.some(x => same(x, m))) merged.push(m);
    p.menus = merged.slice(0, 2);
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
  report.issues = reviewCard(p);
  return report;
}
