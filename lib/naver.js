// Best effort: find the Naver Place for a card and take a photo of one of its menu items
// (the menu the memo named, else the one Naver marks 대표, else the first with a photo), plus
// candidate photos (menu and visitors') for enrich.js to check which one really shows a dish.
// Places without a Naver menu board often show their Baemin delivery menu instead; we use that then.
// The place comes from the memo's naver.me / map.naver.com link, or from a search by name and
// neighbourhood. Any failure (blocked, layout change, timeout) just returns null.

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

// Naver's search pages are large and slow from Vercel's servers, so allow up to 9s
function get(url, redirect = "follow", headers = {}) {
  return fetch(url, {
    redirect,
    headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9", ...headers },
    signal: AbortSignal.timeout(9000),
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

// Naver Map's autocomplete: small JSON, and unlike the search pages it answers requests from Vercel
async function searchPlaces(query) {
  const res = await get("https://map.naver.com/p/api/search/instant-search?coords=37.5665,126.978&query=" + encodeURIComponent(query), "follow", { Referer: "https://map.naver.com/" });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return (data.all || []).map(a => a && a.place).filter(Boolean);
}

// Find a place by name. Several branches can share a name; prefer the one in the memo's 구.
// Typed names often carry a food word Naver's title lacks ("루이지 피자" is listed as "루이지"), so when
// the whole name finds nothing each word is tried, keeping only places whose whole title is part of
// the typed name (and, when we know the area, that are in it).
async function placeIdFromSearch(name, where) {
  const want = squash(name);
  const tokens = String(where || "").split(/\s+/).filter(t => t.length >= 2);
  const inArea = pl => tokens.some(t => `${pl.roadAddress} ${pl.jibunAddress}`.includes(t));
  const named = (await searchPlaces(name)).filter(pl => { const t = squash(pl.title); return t === want || (t.length >= 2 && (t.includes(want) || want.includes(t))); });
  const hit = named.find(inArea) || named.find(pl => squash(pl.title) === want) || named[0];
  if (hit) return String(hit.id);

  const words = [...new Set(String(name).split(/\s+/).filter(w => w.length >= 2))].sort((a, b) => b.length - a.length);
  if (words.length < 2) return null;
  for (const word of words.slice(0, 2)) {
    const part = (await searchPlaces(word)).filter(pl => { const t = squash(pl.title); return t.length >= 2 && want.includes(t); });
    const found = tokens.length ? part.find(inArea) : part.find(pl => squash(pl.title) === squash(word));
    if (found) return String(found.id);
  }
  return null;
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

// "[가성비 두판세트]피자R+피자R+음료1" is a combo, not a dish
const isCombo = name => /세트|\+|set\b/i.test(name);

// Naver's own menu board first, then the Baemin menu, as { name, repr, image }
function menuItems(state) {
  const of = prefix => Object.entries(state).filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
  const naver = of("PlaceMenuItem:").map(v => ({
    name: v.name || "",
    repr: (v.badges || []).includes("repr"),
    image: (v.images && v.images[0] && v.images[0].url) || v.thumbnailUrl || "",
  }));
  const baemin = of("PlaceDetail_BaeminMenu:").map(v => ({
    name: v.name || "",
    repr: v.isRepresentative === true,
    image: (Array.isArray(v.images) && typeof v.images[0] === "string" && v.images[0]) || "",
  }));
  return { naver, baemin };
}

// Menu items with a photo, best first: the menus the memo named, then 대표, then the rest;
// single dishes before combo sets at each step
function rankMenus(items, wanted) {
  const withPhoto = items.filter(i => i.name && /^https?:\/\//.test(i.image));
  const dishes = withPhoto.filter(i => !isCombo(i.name));
  const ws = wanted.map(squash).filter(Boolean);
  const named = i => ws.some(w => squash(i.name).includes(w) || w.includes(squash(i.name)));
  return [...new Set([
    ...dishes.filter(named), ...withPhoto.filter(named),
    ...dishes.filter(i => i.repr), ...withPhoto.filter(i => i.repr),
    ...dishes, ...withPhoto,
  ])];
}

// Photos visitors attached to reviews (the place page's top strip). Mostly food, sometimes not.
const visitorPhotos = state => Object.entries(state)
  .filter(([k, v]) => k.startsWith("PlaceDetailTopPhotoItem:") && /_visitor_\d+$/.test(v.id || k) && /^https:\/\//.test(v.originalUrl || ""))
  .map(([, v]) => v.originalUrl);

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

// "우대갈비 280g" → "우대갈비", "[치즈듬뿍]반반 프리미엄 피자(R)" → "반반 프리미엄 피자"
const menuLabel = name => name.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/\s*\d+(\.\d+)?\s*(g|kg|ml|l|p|pcs|인분|인|접시|그릇|마리|개|판)(?![a-z]).*$/i, "").replace(/\s+/g, " ").trim();

// 320×320 crop from Naver's image resizer (~50KB instead of a ~1MB original). Baemin photos load
// only in exactly this form (quality=95, f320_320), the one Naver's own pages use; Naver's do too.
const thumb = url => "https://search.pstatic.net/common/?autoRotate=true&quality=95&type=f320_320&src=" + encodeURIComponent(url);

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
    const { naver, baemin } = menuItems(state);
    const ranked = rankMenus([...naver, ...baemin], menus || []);
    const menu = ranked[0] || null;
    // 대표 메뉴 (Naver's "repr" badge or Baemin's 대표), else the first couple on the menu
    const items = (naver.length ? naver : baemin).filter(i => i.name && !isCombo(i.name));
    const reprItems = items.filter(i => i.repr);
    const repr = [...new Set((reprItems.length ? reprItems : items.slice(0, 2)).map(i => menuLabel(i.name)).filter(Boolean))].slice(0, 3);
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
      image: menu ? thumb(menu.image) : "",
      // candidates for choosing a real dish photo: a few menu photos, then visitors' review photos
      photos: [
        ...ranked.slice(0, 3).map(i => ({ url: thumb(i.image), menu: menuLabel(i.name) })),
        ...visitorPhotos(state).slice(0, 4).map(u => ({ url: thumb(u), menu: "" })),
      ],
      ...(lat > 33 && lat < 39 && lng > 124 && lng < 132 ? { lat, lng } : {}),
    };
  } catch {
    return null;
  }
}
