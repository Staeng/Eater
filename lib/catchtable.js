// CatchTable and Tabling have no public lookup, so we read what people write about the place on
// Naver blogs ("<name> 캐치테이블", "<name> 테이블링") and let Claude decide, for each app, whether the
// place takes reservations or only waiting and whether you need to book ahead.
// CatchTable shop links are used only when they appear in those posts.

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const plain = html => String(html || "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&[a-z#0-9]+;/gi, " ")
  .replace(/\s+/g, " ")
  .trim();

export const SHOP_URL = /^https:\/\/app\.catchtable\.co\.kr\/ct\/shop\/[A-Za-z0-9_-]+$/;
export const catchtableSearchUrl = name => "https://app.catchtable.co.kr/ct/search/total?keyword=" + encodeURIComponent(name);
export const tablingSearchUrl = name => "https://www.tabling.co.kr/search?keyword=" + encodeURIComponent(name);

// Naver blog search's JSON endpoint (the search result pages refuse requests from Vercel).
async function blogPosts(keyword) {
  const res = await fetch("https://section.blog.naver.com/ajax/SearchList.naver?countPerPage=10&currentPage=1&orderBy=sim&type=post&keyword=" + encodeURIComponent(keyword), {
    headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9", Referer: "https://section.blog.naver.com/" },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.text()).replace(/^\)\]\}',\s*/, "");
  return ((JSON.parse(body).result || {}).searchList || []).map(x => ({ title: plain(x.title), text: plain(x.contents) }));
}

const asText = posts => posts.map((x, i) => `${i + 1}. ${x.title} — ${x.text}`).join("\n").slice(0, 3500);

export async function bookingSearch(name) {
  try {
    const [ct, tb] = await Promise.all([blogPosts(`${name} 캐치테이블`), blogPosts(`${name} 테이블링`)]);
    const shops = [];
    for (const post of ct) {
      for (const m of `${post.title} ${post.text}`.matchAll(/https?:\/\/app\.catchtable\.co\.kr\/ct\/shop\/[A-Za-z0-9_-]+/g)) {
        const url = m[0].replace(/^http:/, "https:");
        if (!shops.some(s => s.url === url)) shops.push({ url, around: post.title.slice(0, 80) });
      }
    }
    return { catchtable: asText(ct), tabling: asText(tb), shops: shops.slice(0, 5) };
  } catch (err) {
    return { error: err.name === "TimeoutError" ? "시간 초과" : err.message.slice(0, 60) };
  }
}

const MODE = { type: "string", enum: ["예약", "웨이팅", "없음", "모름"] };
export const BOOKING_SCHEMA = {
  type: "object",
  properties: {
    catchtable: {
      type: "object",
      properties: { mode: MODE, advance: { type: "boolean" }, shop: { type: "string" } },
      required: ["mode", "advance", "shop"],
      additionalProperties: false,
    },
    tabling: {
      type: "object",
      properties: { mode: MODE, advance: { type: "boolean" } },
      required: ["mode", "advance"],
      additionalProperties: false,
    },
    note: { type: "string" },
  },
  required: ["catchtable", "tabling", "note"],
  additionalProperties: false,
};

export function bookingPrompt(name, where, found) {
  return [
    `식당: ${name} (${where || "지역 모름"})`,
    "",
    "아래는 네이버 블로그에서 이 식당 이름과 '캐치테이블', '테이블링'으로 각각 검색한 글 목록(제목 — 본문 일부)이야.",
    "이름이 같은 다른 지역 식당, 다른 식당 얘기, 광고는 무시하고 이 식당에 대한 내용만 보고 앱마다 판단해.",
    "- mode: 그 앱으로 좌석 예약을 받으면 \"예약\", 그 앱으로 웨이팅(줄서기, 현장 기기·원격 줄서기)만 하면 \"웨이팅\", 그 앱을 안 쓰면 \"없음\", 근거가 부족하면 \"모름\".",
    "- advance: 예약이 빨리 차서 미리(며칠~몇 주 전) 예약해야 하면 true.",
    "- catchtable.shop: [캐치테이블 주소 후보] 중 이 식당 주소가 확실하면 글자 그대로, 아니면 \"\". 후보에 없는 주소는 쓰지 마.",
    "- note: 메모에 붙일 한 줄. 예: \"캐치테이블 예약 필수 (2주 전 오픈)\", \"테이블링 원격 줄서기 가능\". 두 앱 모두 없음/모름이면 \"\".",
    "",
    "[캐치테이블 주소 후보]",
    ...(found.shops.length ? found.shops.map(s => `${s.url}  (글 제목: ${s.around})`) : ["(없음)"]),
    "",
    "[캐치테이블 검색 결과]",
    found.catchtable || "(없음)",
    "",
    "[테이블링 검색 결과]",
    found.tabling || "(없음)",
  ].join("\n");
}
