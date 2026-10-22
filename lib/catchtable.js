// CatchTable has no public lookup, so we read what people write about the place on Naver blogs
// ("<name> 캐치테이블") and let Claude decide whether it takes reservations or only waiting,
// and whether you need to book ahead. Shop links come only from those search results.

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const plain = html => html
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&[a-z#0-9]+;/gi, " ")
  .replace(/\s+/g, " ");

export const SHOP_URL = /^https:\/\/app\.catchtable\.co\.kr\/ct\/shop\/[A-Za-z0-9_-]+$/;

export async function catchtableSearch(name, where) {
  try {
    const res = await fetch("https://m.search.naver.com/search.naver?where=m_blog&query=" + encodeURIComponent(`${name} ${where} 캐치테이블`.replace(/\s+/g, " ").trim()), {
      headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const shops = [];
    for (const m of html.matchAll(/https?:\/\/app\.catchtable\.co\.kr\/ct\/shop\/[A-Za-z0-9_-]+/g)) {
      const url = m[0].replace(/^http:/, "https:");
      if (shops.some(s => s.url === url)) continue;
      shops.push({ url, around: plain(html.slice(Math.max(0, m.index - 600), m.index + 200)).slice(-260) });
      if (shops.length >= 5) break;
    }
    const text = plain(html);
    const start = Math.max(0, text.indexOf(name.slice(0, 2)) - 200);
    return { text: text.slice(start, start + 4500), shops };
  } catch {
    return null;
  }
}

export const CATCHTABLE_SCHEMA = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["예약", "웨이팅", "없음", "모름"] },
    advance: { type: "boolean" },
    shop: { type: "string" },
    note: { type: "string" },
  },
  required: ["mode", "advance", "shop", "note"],
  additionalProperties: false,
};

export function catchtablePrompt(name, where, found) {
  return [
    `식당: ${name} (${where || "지역 모름"})`,
    "",
    "아래는 네이버 블로그에서 이 식당을 '캐치테이블'과 함께 검색한 결과 일부야. 다른 식당 얘기나 광고는 무시하고, 이 식당에 대한 내용만 보고 판단해.",
    "- mode: 캐치테이블로 좌석 예약을 받으면 \"예약\", 캐치테이블로는 웨이팅(줄서기)만 하면 \"웨이팅\", 캐치테이블을 안 쓰면 \"없음\", 판단할 근거가 부족하면 \"모름\".",
    "- advance: 예약이 빨리 차서 미리(며칠~몇 주 전) 예약해야 하면 true.",
    "- shop: 아래 [캐치테이블 주소 후보] 중 이 식당의 주소가 확실하면 그 주소를 글자 그대로, 아니면 \"\". 후보에 없는 주소는 쓰지 마.",
    "- note: 메모에 붙일 한 줄. 예: \"캐치테이블 예약 필수 (2주 전 오픈)\", \"캐치테이블 원격 웨이팅 가능\". mode가 없음/모름이면 \"\".",
    "",
    "[캐치테이블 주소 후보]",
    ...(found.shops.length ? found.shops.map(s => `${s.url}  (주변 글: ${s.around})`) : ["(없음)"]),
    "",
    "[검색 결과]",
    found.text,
  ].join("\n");
}
