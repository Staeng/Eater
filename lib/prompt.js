// Prompt and output schema for turning a free-form 먹킷리스트 memo into place cards.
// Keep CATEGORIES in sync with CATS in eater.html.

export const CATEGORIES = [
  "소고기", "돼지고기", "닭·오리", "해산물", "초밥·일식", "중식", "양식",
  "한식", "면요리", "분식", "아시안", "카페·디저트", "술집", "기타",
];

const WD = ["일", "월", "화", "수", "목", "금", "토"];

export const SYSTEM = `너는 '먹킷리스트' 정리 도우미야. 사용자가 가고 싶은 식당, 먹고 싶은 메뉴를 두서없이 적은 메모를 받아서 식당(또는 아직 식당이 정해지지 않은 메뉴)을 하나씩 뽑아 정해진 JSON 형식으로 정리해.

[규칙]
- name: 식당 이름. 네이버 지도 공유 글이면 '[네이버 지도]' 다음 줄이 식당 이름이야. 식당이 정해지지 않았으면 "".
- link: 메모에 있는 지도 URL(naver.me, map.naver.com, place.naver.com 등)을 글자 그대로. 없으면 "". 절대 지어내지 마.
- reel: 그 식당을 보고 저장한 인스타그램 릴스·게시물, 유튜브 쇼츠, 틱톡 URL을 글자 그대로. 없으면 "". 절대 지어내지 마.
- 링크가 여러 개고 식당도 여러 곳이면, 링크가 적힌 위치를 보고 어느 식당 것인지 맞춰서 넣어.
- address: 메모에 주소가 있으면 그대로, 없으면 "".
- city: 시·도 짧은 이름(서울, 경기, 인천, 부산 …). gu: 서울은 '용산구'처럼 구, 경기 등은 '성남시 분당구'처럼 시·구. dong: '한강로동'처럼 동.
- 주소가 없으면 동네 이름으로 추정해(성수→성동구 성수동, 을지로→중구 을지로동, 홍대→마포구 서교동, 연남→마포구 연남동, 이태원→용산구 이태원동, 강남역→강남구 역삼동, 잠실→송파구 잠실동, 판교→경기 성남시 분당구).
- 동네 정보가 전혀 없으면, 이름만으로 위치를 확실히 아는 유명한 곳일 때만 채우고 아니면 빈칸으로 둬.
- menus: 먹고 싶은 메뉴 이름 배열. 짧게(예: ["우대갈비", "된장밥"]). 메뉴 언급이 없으면 그 식당의 대표 메뉴를 확실히 알 때만 1개.
- category: 식사종류 목록 중 정확히 하나. 고기 메뉴는 고기 종류(소고기, 돼지고기, 닭·오리)를 우선해.
- budget: 1인 기준 예산, 원 단위 정수. '둘이 10만원'이면 50000, '1인 3만'이면 30000. 언급이 없으면 null.
- budgetLabel: 사용자가 말한 예산 표현 그대로 짧게(예: "둘이 10만원"). 없으면 "".
- wantDate: 메시지에 있는 달력으로 날짜를 정할 수 있으면 YYYY-MM-DD. '이번 주말'처럼 범위면 첫날(토요일). 못 정하면 null.
- wantWhen: 시기 표현 짧게(예: "다음주 금요일 저녁", "12월 중", "생일"). 없으면 "".
- memo: 위 칸에 안 들어간 짧은 메모(웨이팅, 예약, 같이 갈 사람 등). 없으면 "".
- 여러 곳이면 places에 하나씩. 같은 날짜·예산이 여러 곳에 걸리면 각각에 넣어.
- 사진이 함께 오면 사용자가 고른 음식 사진이야. 메뉴와 식사종류를 고르는 데 참고하고, 간판·메뉴판 글씨가 보이면 식당 이름에도 참고해.`;

const PLACE_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    link: { type: "string" },
    reel: { type: "string" },
    address: { type: "string" },
    city: { type: "string" },
    gu: { type: "string" },
    dong: { type: "string" },
    menus: { type: "array", items: { type: "string" } },
    category: { type: "string", enum: CATEGORIES },
    budget: { anyOf: [{ type: "integer" }, { type: "null" }] },
    budgetLabel: { type: "string" },
    wantDate: { anyOf: [{ type: "string" }, { type: "null" }] },
    wantWhen: { type: "string" },
    memo: { type: "string" },
  },
  required: ["name", "link", "reel", "address", "city", "gu", "dong", "menus", "category", "budget", "budgetLabel", "wantDate", "wantWhen", "memo"],
  additionalProperties: false,
};

export const OUTPUT_SCHEMA = {
  type: "object",
  properties: { places: { type: "array", items: PLACE_SCHEMA } },
  required: ["places"],
  additionalProperties: false,
};

const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const label = d => `${ymd(d)}(${WD[d.getUTCDay()]})`;
const addDays = (d, n) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));

// Today in Korea, unless the phone sent a valid local date.
export function resolveToday(sent) {
  if (typeof sent === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sent)) {
    const [y, m, d] = sent.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    if (!isNaN(t) && Math.abs(t - Date.now()) < 3 * 86400000) return t;
  }
  const seoul = new Date(Date.now() + 9 * 3600000);
  return new Date(Date.UTC(seoul.getUTCFullYear(), seoul.getUTCMonth(), seoul.getUTCDate()));
}

export function buildUserText(memo, today) {
  const dow = (today.getUTCDay() + 6) % 7; // 월=0
  const mon = addDays(today, -dow);
  const cal = [];
  for (let i = 0; i < 70; i++) cal.push(label(addDays(today, i)));
  return [
    `[오늘] ${label(today)}`,
    `[이번 주] ${label(mon)} ~ ${label(addDays(mon, 6))}   [다음 주] ${label(addDays(mon, 7))} ~ ${label(addDays(mon, 13))}`,
    `[달력] ${cal.join(" ")}`,
    `[식사종류 목록] ${CATEGORIES.join(", ")}`,
    "",
    "[메모]",
    '"""',
    memo || "(글 없음, 사진만 보고 정리)",
    '"""',
  ].join("\n");
}
