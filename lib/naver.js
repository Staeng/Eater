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

// Naver's categories for things that are not somewhere to eat or drink (roads, stations, areas…)
const NOT_EATERY = /도로|지하철|전철|버스|기차|정류장|터미널|행정|지명|아파트|빌딩|오피스|주차|공원|은행|병원|의원|약국|학교|학원|교회|성당|관공서|주민센터|호텔|모텔|숙박|마트|편의점|의류|패션|가방|헬스|미용|사진|부동산/;
const isEatery = pl => Boolean(pl && pl.ctg) && !NOT_EATERY.test(pl.ctg);
// "골수 여의도점" → "골수": the brand part of a branch's title
const core = title => squash(String(title).replace(/\s+\S*점$/, "")) || squash(title);
const addressOf = pl => `${pl.roadAddress || ""} ${pl.jibunAddress || ""}`;

// Find a place by name, as { id, how }. how is "exact" when the typed name is the place's name and
// "fuzzy" when it was found from parts of it. Typed names mix in area words and dishes ("을지로 골수
// 수제비" is the place 골수 in 을지로 and its 수제비), so when the whole name finds nothing, the words
// without the area ones are searched too, keeping eateries whose name is part of what was typed (and
// in the memo's area when known). Several of those left → `choose` (Claude) picks one or none.
// `confirm` is for words that may be a dish rather than a place: every candidate in the area, even a
// single exact one, goes to `choose`, which may say none.
async function findPlace(name, where, choose, confirm = false) {
  const want = squash(name);
  const tokens = String(where || "").split(/\s+/).filter(t => t.length >= 2);
  const inArea = pl => tokens.some(t => addressOf(pl).includes(t));

  const named = (await searchPlaces(name)).filter(isEatery).filter(pl => {
    const t = squash(pl.title), c = core(pl.title);
    return t === want || c === want || t.includes(want) || (c.length >= 2 && want.includes(c));
  });
  const hit = named.find(inArea) || named.find(pl => squash(pl.title) === want || core(pl.title) === want) || named[0];
  if (hit && !confirm) return { id: String(hit.id), how: "exact" };

  const isAreaWord = w => tokens.some(t => t.includes(w) || w.includes(t.replace(/(동|구|시|군)$/, ""))) || /^.{1,4}(동|구|로|길|역)$/.test(w);
  const words = [...new Set(String(name).split(/\s+/).filter(w => w.length >= 2 && !isAreaWord(w)))].sort((a, b) => b.length - a.length);
  const queries = [...new Set([words.join(" "), ...words.slice(0, 3)])].filter(q => q && q !== name);
  if (!queries.length && !confirm) return null;
  const seen = new Map();
  for (const list of await Promise.all(queries.map(searchPlaces))) for (const pl of list) if (!seen.has(pl.id)) seen.set(pl.id, pl);
  const pool = [...seen.values()].filter(isEatery).filter(pl => { const c = core(pl.title); return c.length >= 2 && want.includes(c); });
  const local = tokens.length ? pool.filter(inArea) : pool;
  const asked = confirm ? [...new Map([...named.filter(inArea), ...local].map(pl => [pl.id, pl])).values()] : local;
  if (asked.length === 1 && !confirm) return { id: String(asked[0].id), how: "fuzzy" };
  if (asked.length && choose && (asked.length > 1 || confirm)) {
    const id = await choose(asked.slice(0, 8).map(pl => ({ id: String(pl.id), title: pl.title, category: pl.ctg, address: (pl.roadAddress || pl.jibunAddress || "").trim() })));
    if (id) return { id: String(id), how: "fuzzy" };
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

// Places also use menu entries as notice boards ("라인업은 매일 변동됩니다" priced 무료, sometimes even
// marked 대표, "~아래부터는 시즌아웃된 메뉴입니다~") or as headings ("한식", "예약메뉴"). Those are not dishes.
const NOTICE_WORDS = /니다|세요|해요|이에요|예요|안내|공지|변동|문의|참고|필독|주의|휴무|영업|운영|예약|주문|배달|포장|가능|불가|이벤트|리뷰|품절|시즌아웃|인스타|카톡|라인업|(어서|아서|해서)$/;
const GENERIC = /^(메뉴|대표메뉴|추천메뉴|한식|양식|중식|일식|분식|음료|주류|사이드|기타|추가|토핑|세트|코스)$/;
export const isNoticeName = name => {
  const n = String(name || "").trim();
  return !n || NOTICE_WORDS.test(n) || /^[~\-=*·•※★☆♥♡<>\[(]/.test(n) || GENERIC.test(n.replace(/\s+/g, "")) || n.length > 22;
};

// Naver's own menu board first, then the Baemin menu, as { name, repr, image }
function menuItems(state) {
  const of = prefix => Object.entries(state).filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
  const naver = of("PlaceMenuItem:")
    .filter(v => !(v.price && v.price.priceType === "free") && !isNoticeName(v.name))
    .map(v => ({
      name: v.name,
      repr: (v.badges || []).includes("repr"),
      image: (v.images && v.images[0] && v.images[0].url) || v.thumbnailUrl || "",
    }));
  const baemin = of("PlaceDetail_BaeminMenu:")
    .filter(v => !isNoticeName(v.name))
    .map(v => ({
      name: v.name,
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

// Photos in the place page's top strip: "business" ones the owner posted (often polished food
// shots, sometimes the storefront) and "visitor" ones from reviews (mostly food). Clips are skipped.
const topPhotos = (state, kind) => Object.entries(state)
  .filter(([k, v]) => k.startsWith("PlaceDetailTopPhotoItem:") && new RegExp(`_${kind}_\\d+$`).test(v.id || k) && /^https:\/\//.test(v.originalUrl || ""))
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

// "서울 강남구 삼성로 212-2" + "서울 강남구 대치동 316" → { city: "서울", gu: "강남구", dong: "대치동" };
// "경기 고양시 일산동구 …" → gu "고양시 일산동구" (cities with 구 keep both, as the cards do)
export function regionOf(road, jibun) {
  const t = String(road || jibun || "").trim().split(/\s+/);
  const city = (t[0] || "").replace(/(특별시|광역시|특별자치시|특별자치도)$/, "");
  let gu = "";
  if (/(시|군|구)$/.test(t[1] || "")) gu = /시$/.test(t[1]) && /구$/.test(t[2] || "") ? `${t[1]} ${t[2]}` : t[1];
  const dong = (String(jibun || "").split(/\s+/).find(w => /^[가-힣0-9]+(동|가|읍|면)$/.test(w) && w !== gu) || "");
  return { city, gu, dong };
}

// "우대갈비 280g" → "우대갈비", "[치즈듬뿍]반반 프리미엄 피자(R)" → "반반 프리미엄 피자",
// "가브리살 수육전골 소" → "가브리살 수육전골" (a trailing size)
export const menuLabel = name => name.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/\s*\d+(\.\d+)?\s*(g|kg|ml|l|p|pcs|인분|인|접시|그릇|마리|개|판)(?![a-z]).*$/i, "")
  .replace(/\s+/g, " ").trim().replace(/\s+(소|중|대|특|[SMLR])$/i, "");

// 320×320 crop from Naver's image resizer (~50KB instead of a ~1MB original). Baemin photos load
// only in exactly this form (quality=95, f320_320), the one Naver's own pages use; Naver's do too.
const thumb = url => "https://search.pstatic.net/common/?autoRotate=true&quality=95&type=f320_320&src=" + encodeURIComponent(url);

async function blogSearch(q) {
  const res = await get("https://section.blog.naver.com/ajax/SearchList.naver?countPerPage=20&currentPage=1&orderBy=sim&type=post&keyword=" + encodeURIComponent(q), "follow", { Referer: "https://section.blog.naver.com/" });
  if (!res.ok) return [];
  const data = JSON.parse((await res.text()).replace(/^\)\]\}',\s*/, ""));
  return (data.result && data.result.searchList) || [];
}
const plain = s => String(s || "").replace(/<[^>]+>/g, "").replace(/&[a-z]+;|&#\d+;/g, " ").replace(/\s+/g, " ").trim();

// The pictures right next to what a blog post says about the dish. A search result only carries a
// post's first few pictures (often the storefront), so the post itself is read: SmartEditor posts
// are a run of text and image blocks, and images within two blocks of a mention of the dish count,
// those amid the most talk about it first (the 수제비 part of a 수육 review, not its intro).
async function dishShots(post, dish) {
  try {
    const res = await get(`https://m.blog.naver.com/PostView.naver?blogId=${encodeURIComponent(post.domainIdOrBlogId)}&logNo=${encodeURIComponent(post.logNo)}`);
    if (!res.ok) return [];
    const blocks = (await res.text()).split('<div class="se-component se-').slice(1).map(b => b.startsWith("image")
      ? { imgs: [...b.matchAll(/data-lazy-src="(https:\/\/[a-z0-9.-]+\.pstatic\.net\/[^"?]+)/g)].map(m => m[1]) }
      : b.startsWith("text") ? { text: squash(plain(b.slice(b.indexOf(">") + 1))) } : {});
    const food = squash(dish), score = new Map();
    blocks.forEach((b, i) => {
      if (!(b.text && b.text.includes(food))) return;
      for (const [j, w] of [[i - 1, 2], [i + 1, 2], [i - 2, 1], [i + 2, 1]]) if (blocks[j] && blocks[j].imgs) score.set(j, (score.get(j) || 0) + w);
    });
    return [...score].sort((a, b) => b[1] - a[1] || a[0] - b[0]).flatMap(([j]) => blocks[j].imgs);
  } catch {
    return [];
  }
}

// Photos from Naver blog posts about the place, searched by name and area and, when the memo names
// a dish, by name and dish ("띵하우 군만두"). Only posts that name the place are used, and those
// naming it in the title (and the dish) come first: a post that mentions it in passing may show
// another place's food. A few per post keeps one post from filling the list. With a dish, the top
// posts are also read for the pictures next to the dish ("골수 수제비"). Claude still decides.
export async function blogPhotos(name, where, dish = "") {
  const want = squash(name), food = squash(dish);
  if (!want) return [];
  try {
    const queries = [[name, where], food ? [name, dish] : null].filter(Boolean).map(q => q.filter(Boolean).join(" "));
    const lists = await Promise.all(queries.map(q => blogSearch(q).catch(() => [])));
    const posts = [], seenPost = new Set();
    for (const post of lists.flat()) {
      const key = `${post.domainIdOrBlogId}/${post.logNo}`, title = plain(post.title);
      const text = squash(`${title} ${plain(post.contents)}`);
      if (seenPost.has(key) || !text.includes(want)) continue;
      seenPost.add(key);
      posts.push({ post, title, rank: (squash(title).includes(want) ? 2 : 0) + (food && text.includes(food) ? 1 : 0) });
    }
    posts.sort((a, b) => b.rank - a.rank);
    // the same picture comes from blogthumb and mblogthumb-phinf hosts, its file name encoded differently
    const seen = new Set(), key = u => u.replace(/^https:\/\/[^/]+/, "").replace(/\/[^/]*$/, "");
    const fresh = u => !seen.has(key(u)) && seen.add(key(u));
    const deep = food ? posts.filter(p => p.rank >= 2).slice(0, 3) : [];
    const near = [];
    for (const [i, urls] of (await Promise.all(deep.map(p => dishShots(p.post, dish)))).entries()) {
      for (const u of urls.filter(fresh).slice(0, 3)) near.push({ url: thumb(u), menu: dish, from: "blog", title: deep[i].title.slice(0, 40) });
    }
    const thumbs = [];
    for (const { post, title } of posts) {
      let taken = 0;
      for (const t of post.thumbnails || []) {
        const u = String(t.url || "").split("?")[0];
        if (t.videoThumbnail || !/^https:\/\//.test(u) || !fresh(u)) continue;
        thumbs.push({ url: thumb(u), menu: "", from: "blog", title: title.slice(0, 40) });
        if (++taken === 3) break;
      }
    }
    return [...near.slice(0, 8), ...thumbs.slice(0, near.length ? 8 : 10)];
  } catch {
    return [];
  }
}

export async function naverMenuPhoto({ link, name, where, menus, choose, confirm }) {
  try {
    let id = link && isNaverLink(link) ? await placeIdFromLink(link) : null;
    let how = id ? "link" : "";
    if (!id && name) {
      const found = await findPlace(name, where, choose, confirm);
      if (found) ({ id, how } = found);
    }
    if (!id) return null;
    const viaSearch = how !== "link";
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
    const repr = [...new Set((reprItems.length ? reprItems : items.slice(0, 2)).map(i => menuLabel(i.name)).filter(Boolean))].slice(0, 2);
    const base = state[`PlaceDetailBase:${id}`] || {};
    const lat = Number(base.coordinate && base.coordinate.y), lng = Number(base.coordinate && base.coordinate.x);
    return {
      placeId: id,
      name: base.name || meta(html, "title").replace(/\s*[:|-]\s*네이버.*$/, "").trim(),
      address: base.roadAddress || base.address || "",
      ...regionOf(base.roadAddress, base.address),
      link: viaSearch ? `https://map.naver.com/p/entry/place/${id}` : "",
      how,
      menu: menu ? menuLabel(menu.name) : "",
      menus: repr,
      category: mapCategory(base.category),
      image: menu ? thumb(menu.image) : "",
      // candidates for choosing the most appetizing dish photo: menu photos, the owner's, visitors'
      photos: [
        ...ranked.slice(0, 4).map(i => ({ url: thumb(i.image), menu: menuLabel(i.name), from: "menu" })),
        ...topPhotos(state, "business").slice(0, 3).map(u => ({ url: thumb(u), menu: "", from: "owner" })),
        ...topPhotos(state, "visitor").slice(0, 6).map(u => ({ url: thumb(u), menu: "", from: "visitor" })),
      ],
      ...(lat > 33 && lat < 39 && lng > 124 && lng < 132 ? { lat, lng } : {}),
    };
  } catch {
    return null;
  }
}
