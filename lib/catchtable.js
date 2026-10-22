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

// Naver blog search's JSON endpoint (the search result pages refuse requests from Vercel).
export async function catchtableSearch(name, where) {
  try {
    const res = await fetch("https://section.blog.naver.com/ajax/SearchList.naver?countPerPage=10&currentPage=1&orderBy=sim&type=post&keyword=" + encodeURIComponent(`${name} 캐치테이블`), {
      headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9", Referer: "https://section.blog.naver.com/" },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const body = (await res.text()).replace(/^\)\]\}',\s*/, "");
    const posts = ((JSON.parse(body).result || {}).searchList || []).map(x => ({
      title: plain(x.title || "").trim(),
      text: plain(x.contents || "").trim(),
    }));
    const shops = [];
    for (const post of posts) {
      for (const m of `${post.title} ${post.text}`.matchAll(/https?:\/\/app\.catchtable\.co\.kr\/ct\/shop\/[A-Za-z0-9_-]+/g)) {
        const url = m[0].replace(/^http:/, "https:");
        if (!shops.some(s => s.url === url)) shops.push({ url, around: post.title.slice(0, 80) });
      }
    }
    const text = posts.map((x, i) => `${i + 1}. ${x.title} — ${x.text}`).join("\n").slice(0, 4500);
    return { text, shops: shops.slice(0, 5) };
  } catch (err) {
    return { error: err.name === "TimeoutError" ? "시간 초과" : err.message.slice(0, 60) };
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
    "아래는 네이버 블로그에서 이 식당 이름과 '캐치테이블'로 검색한 글 목록(제목 — 본문 일부)이야. 이름이 같은 다른 지역 식당이나 다른 식당 얘기, 광고는 무시하고, 이 식당에 대한 내용만 보고 판단해.",
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
