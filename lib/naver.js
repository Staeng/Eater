// Best effort: find the Naver Place for a card and take a photo of one of its menu items
// (the menu the memo named, else the one Naver marks 대표, else the first with a photo).
// The place comes from the memo's naver.me / map.naver.com link, or from a search by name and
// neighbourhood. Any failure (blocked, layout change, timeout) just returns null.

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

function get(url, redirect = "follow") {
  return fetch(url, {
    redirect,
    headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" },
    signal: AbortSignal.timeout(5000),
  });
}

const placeIdIn = u => {
  const m = u.match(/\/(?:place|restaurant|cafe|food|hairshop|accommodation)\/(\d{5,})/) || u.match(/[?&](?:id|placeId|pinId)=(\d{5,})/);
  return m ? m[1] : null;
};

export const isNaverLink = u => /^https:\/\/(naver\.me|(m\.)?map\.naver\.com|(m\.|pcmap\.)?place\.naver\.com)\//.test(u);

async function placeIdFromLink(link) {
  let url = link;
  for (let hop = 0; hop < 4; hop++) {
    const id = placeIdIn(url);
    if (id) return id;
    const res = await get(url, "manual");
    const next = res.headers.get("location");
    if (!next) return placeIdIn(await res.text());
    url = new URL(next, url).href;
    if (!/naver\.(me|com)$/.test(new URL(url).hostname)) return null;
  }
  return null;
}

const squash = s => String(s || "").replace(/\s+/g, "").toLowerCase();

// Naver's mobile search page lists places as {"id":"…","name":"…"}; take the one whose name matches.
async function placeIdFromSearch(name, where) {
  const res = await get("https://m.search.naver.com/search.naver?query=" + encodeURIComponent(`${name} ${where}`.trim()));
  if (!res.ok) return null;
  const html = await res.text();
  const want = squash(name);
  const found = [...html.matchAll(/"id":"(\d{5,})","name":"([^"]{1,60})"/g)].map(m => ({ id: m[1], name: squash(m[2]) }));
  // exact name first, then a branch-name difference ("니얼더파크 밤리단길" ↔ "니얼더파크 밤리단길점")
  const hit = found.find(f => f.name === want) || found.find(f => f.name.length >= 2 && (f.name.includes(want) || want.includes(f.name)));
  return hit ? hit.id : null;
}

function apolloState(html) {
  const m = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{.*?\});\s*\n/s);
  try { return m ? JSON.parse(m[1]) : {}; } catch { return {}; }
}

function meta(html, prop) {
  const a = html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]*content=["']([^"']+)["']`, "i"));
  const b = a || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:${prop}["']`, "i"));
  return b ? b[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'") : "";
}

const imageOf = item => (item.images && item.images[0] && item.images[0].url) || item.thumbnailUrl || "";

function pickMenu(items, wanted) {
  const withPhoto = items.filter(i => i.name && /^https:\/\//.test(imageOf(i)));
  for (const w of wanted.map(squash).filter(Boolean)) {
    const hit = withPhoto.find(i => squash(i.name).includes(w) || w.includes(squash(i.name)));
    if (hit) return hit;
  }
  return withPhoto.find(i => (i.badges || []).includes("repr")) || withPhoto[0] || null;
}

// Naver's own category text ("이탈리아음식", "곰탕,설렁탕", "육류,고기요리" …) → our 식사종류.
// Order matters; vague ones like "육류,고기요리" map to nothing and Claude's pick stays.
const NAVER_CATEGORY = [
  [/이자카야|요리주점|술집|호프|맥주|와인|칵테일|포장마차|전통주|바\(BAR\)/, "술집"],
  [/이탈리아|파스타|피자/, "이탈리안"],
  [/프랑스/, "프렌치"],
  [/스페인/, "스페인"],
  [/멕시코|남미/, "멕시칸"],
  [/태국/, "태국"],
  [/베트남/, "베트남"],
  [/인도|네팔/, "인도·네팔"],
  [/터키|튀르키예|그리스|중동|지중해|아랍/, "중동·지중해"],
  [/햄버거|스테이크|바비큐|바베큐|미국/, "아메리칸"],
  [/브런치/, "브런치"],
  [/베이커리|제과|빵/, "베이커리"],
  [/카페|디저트|케이크|빙수|아이스크림|도넛|와플/, "카페·디저트"],
  [/일식|초밥|스시|라멘|돈가스|돈까스|우동|소바|오마카세|일본/, "일식"],
  [/중식|중국|마라|양꼬치|딤섬|훠궈/, "중식"],
  [/소고기|한우|곱창|막창|대창/, "소고기"],
  [/돼지고기|삼겹살|족발|보쌈/, "돼지고기"],
  [/닭|치킨|오리|삼계탕/, "닭·오리"],
  [/해물|생선|회|조개|게요리|장어|복어|아귀|해산물|굴/, "해산물"],
  [/분식|떡볶이|김밥/, "분식"],
  [/국수|냉면|칼국수|막국수|쌀국수|밀면/, "면요리"],
  [/한식|곰탕|설렁탕|국밥|백반|한정식|찌개|감자탕|해장국|순대|두부/, "한식"],
];
const mapCategory = text => { for (const [re, key] of NAVER_CATEGORY) if (re.test(text || "")) return key; return ""; };

// "우대갈비 280g" → "우대갈비"
const menuLabel = name => name.replace(/\([^)]*\)/g, " ").replace(/\s*\d+(\.\d+)?\s*(g|kg|ml|l|인분|인|p|pcs)\b.*$/i, "").trim();

// 300×300 crop from Naver's image resizer: ~35KB instead of the ~1MB original
const thumb = url => "https://search.pstatic.net/common/?autoRotate=true&type=f300_300&src=" + encodeURIComponent(url);

export async function naverMenuPhoto({ link, name, where, menus }) {
  try {
    let id = link && isNaverLink(link) ? await placeIdFromLink(link) : null;
    let viaSearch = false;
    if (!id && name) { id = await placeIdFromSearch(name, where); viaSearch = Boolean(id); }
    if (!id) return null;
    const res = await get(`https://m.place.naver.com/place/${id}/menu/list`);
    if (!res.ok) return null;
    const html = await res.text();
    const state = apolloState(html);
    const items = Object.entries(state).filter(([k]) => k.startsWith("PlaceMenuItem:")).map(([, v]) => v);
    const menu = pickMenu(items, menus || []);
    // 대표 메뉴 (Naver's "repr" badge), else the first couple on the menu
    const reprItems = items.filter(i => i.name && (i.badges || []).includes("repr"));
    const repr = (reprItems.length ? reprItems : items.filter(i => i.name).slice(0, 2)).map(i => menuLabel(i.name)).filter(Boolean).slice(0, 3);
    const base = state[`PlaceDetailBase:${id}`] || {};
    const lat = Number(base.coordinate && base.coordinate.y), lng = Number(base.coordinate && base.coordinate.x);
    return {
      placeId: id,
      name: base.name || meta(html, "title").replace(/\s*[:|-]\s*네이버.*$/, "").trim(),
      address: base.roadAddress || base.address || "",
      link: viaSearch ? `https://map.naver.com/p/entry/place/${id}` : "",
      menu: menu ? menuLabel(menu.name) : "",
      menus: repr,
      category: mapCategory(base.category),
      image: menu ? thumb(imageOf(menu)) : "",
      ...(lat > 33 && lat < 39 && lng > 124 && lng < 132 ? { lat, lng } : {}),
    };
  } catch {
    return null;
  }
}
