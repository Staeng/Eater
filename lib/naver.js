// Best effort: follow a naver.me / map.naver.com link to the place page and read its
// og:title and og:image, so a card gets the restaurant's name and photo without uploading one.
// Any failure (blocked, layout change, timeout) just returns null.

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

function get(url, redirect = "follow") {
  return fetch(url, {
    redirect,
    headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" },
    signal: AbortSignal.timeout(4000),
  });
}

const placeIdIn = u => {
  const m = u.match(/\/(?:place|restaurant|cafe|food|hairshop|accommodation)\/(\d{5,})/) || u.match(/[?&](?:id|placeId|pinId)=(\d{5,})/);
  return m ? m[1] : null;
};

export const isNaverLink = u => /^https:\/\/(naver\.me|(m\.)?map\.naver\.com|(m\.|pcmap\.)?place\.naver\.com)\//.test(u);

async function placeId(link) {
  let url = link;
  for (let hop = 0; hop < 4; hop++) {
    const id = placeIdIn(url);
    if (id) return id;
    const res = await get(url, "manual");
    const next = res.headers.get("location");
    if (!next) {
      const html = await res.text();
      return placeIdIn(html);
    }
    url = new URL(next, url).href;
    if (!/naver\.(me|com)/.test(new URL(url).hostname)) return null;
  }
  return null;
}

function meta(html, prop) {
  const a = html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]*content=["']([^"']+)["']`, "i"));
  const b = a || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:${prop}["']`, "i"));
  return b ? b[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'") : "";
}

export async function naverPlace(link) {
  try {
    if (!isNaverLink(link)) return null;
    const id = await placeId(link);
    if (!id) return null;
    const res = await get(`https://m.place.naver.com/restaurant/${id}/home`);
    if (!res.ok) return null;
    const html = await res.text();
    const name = meta(html, "title").replace(/\s*[:|-]\s*네이버.*$/, "").trim();
    const image = meta(html, "image");
    return { name, image: image.startsWith("https://") ? image : "" };
  } catch {
    return null;
  }
}
