// Regression checks for the place lookup, run before every deploy: `npm run check`.
// Each case is a mistake that reached a real card once. Naver only — no Claude call, no credits.
import { isNoticeName, menuLabel, regionOf, naverMenuPhoto, blogPhotos } from "../lib/naver.js";
import { reviewCard } from "../lib/quality.js";
import { unseenPhotos } from "../lib/enrich.js";

let failed = 0;
const check = (label, ok, got) => {
  console.log(`${ok ? "✅" : "❌"} ${label}${ok ? "" : `  (받은 값: ${JSON.stringify(got)})`}`);
  if (!ok) failed++;
};

// menu names that are notices, headings or verbs (꼬내과자점, 황금콩밭, 광계토, 산월수제비)
for (const n of ["라인업은 매일 변동됩니다", "~아래부터는 시즌아웃된 메뉴입니다~", "예약메뉴", "한식", "섞어서", "포장 가능", "※ 주말 한정"]) check(`메뉴 아님: ${n}`, isNoticeName(n), false);
for (const n of ["수제비", "치즈케이크", "두바이 쫀득쿠키", "가브리살 수육전골", "해물파전", "Margherita", "비리아 타코"]) check(`메뉴 맞음: ${n}`, !isNoticeName(n), true);

// menu labels lose sizes, counts and bracket notes
for (const [raw, want] of [["가브리살 수육전골 소", "가브리살 수육전골"], ["[치즈듬뿍]반반 프리미엄 피자(R)", "반반 프리미엄 피자"], ["샤브소고기 1접시", "샤브소고기"], ["우대갈비 280g", "우대갈비"]]) {
  const got = menuLabel(raw); check(`메뉴 이름 정리: ${raw} → ${want}`, got === want, got);
}

// neighbourhood from Naver's address (산월수제비 had none)
{
  const r = regionOf("서울 강남구 삼성로 212-2 은마상가", "서울 강남구 대치동 316");
  check("주소 → 서울 강남구 대치동", r.city === "서울" && r.gu === "강남구" && r.dong === "대치동", r);
  const g = regionOf("경기 고양시 일산동구 무궁화로187번길 42", "");
  check("주소 → 경기 고양시 일산동구", g.city === "경기" && g.gu === "고양시 일산동구", g);
}

// the last check before saving fixes what it can and names the rest
{
  const p = { name: "산월수제비", address: "서울 강남구 삼성로 212-2", menus: ["섞어서", "수제비", "수제비", "산월수제비"], photoUrl: "https://x", placeId: "11885058" };
  const issues = reviewCard(p);
  check("저장 전 점검: 동네 채움, 메뉴 정리, 문제 없음", p.gu === "강남구" && JSON.stringify(p.menus) === '["수제비"]' && issues.length === 0, { gu: p.gu, menus: p.menus, issues });
  const q = { name: "어딘가", menus: [] };
  const qi = reviewCard(q);
  check("저장 전 점검: 빠진 정보 알림", ["네이버 장소 연결 없음", "동네 정보 없음", "음식 사진 없음", "메뉴 없음"].every(x => qi.includes(x)), qi);
}

// "맛있어 보이는 사진으로 교체" never offers a photo already shown, even under an older thumbnail URL
{
  const img = "https://ldb-phinf.pstatic.net/a/b.jpg";
  const thumbOld = "https://search.pstatic.net/common/?autoRotate=true&type=f300_300&src=" + encodeURIComponent(img);
  const thumbNew = "https://search.pstatic.net/common/?autoRotate=true&quality=95&type=f320_320&src=" + encodeURIComponent(img);
  const left = unseenPhotos([{ url: thumbNew }, { url: thumbNew.replace("b.jpg", "c.jpg") }], [thumbOld]);
  check("사진 교체: 이미 본 사진은 다시 안 나옴", left.length === 1 && left[0].url.includes("c.jpg"), left.map(x => x.url));
}

// finding places from a typed name (Naver)
const find = (name, where, menus = []) => naverMenuPhoto({ link: "", name, where, menus });
const cases = [
  ["을지로 골수 수제비", "중구 을지로동", "1724618660", "가게 이름+메뉴가 섞인 글 (도로 ‘을지로’를 붙이면 안 됨)"],
  ["루이지 피자", "서대문구 연희동", "2059565192", "네이버 이름에 없는 ‘피자’가 붙은 이름"],
  ["연남동 꼬내과자점", "마포구 연남동", "2028226652", "동네가 앞에 붙은 이름"],
  ["산월수제비", "", "11885058", "동네 없이 이름만"],
  ["감탄쪽갈비", "광진구 자양동", "1944437708", "정확한 이름"],
  ["없는가게 피자", "마포구", null, "없는 가게는 못 찾아야 함"],
];
for (const [name, where, want, why] of cases) {
  const r = await find(name, where);
  const got = r ? r.placeId : null;
  check(`가게 찾기: ${name} (${why})`, got === want, got && `${r.name} ${got}`);
  if (r && got === want) {
    check(`  └ ${r.name}: 메뉴에 안내 문구 없음`, !(r.menus || []).some(isNoticeName), r.menus);
    check(`  └ ${r.name}: 주소에서 구를 읽음`, Boolean(r.gu), r.gu);
    check(`  └ ${r.name}: 사진 후보 있음`, (r.photos || []).length > 0, (r.photos || []).length);
  }
}

// when a place's own photos run out, blog review photos are the next candidates (한우촌)
{
  const ph = await blogPhotos("골수", "중구");
  check("사진 교체: 블로그 후기 사진도 후보로 찾음", ph.length >= 3 && ph.every(x => x.from === "blog" && x.url.startsWith("https://search.pstatic.net/")), ph.length);
}

// adding a card also looks at blog photos of the memo's dish, from posts about that place first
// (띵하우 got a 군만두 photo only by hand)
{
  const ph = await blogPhotos("띵하우", "연남동", "군만두");
  const titled = ph.slice(0, 3).every(x => (x.title || "").replace(/\s/g, "").includes("띵하우"));
  check("담기: 메모의 메뉴로 블로그 사진도 찾고, 가게 이름이 제목에 있는 글이 먼저", ph.length >= 6 && titled, ph.map(x => x.title));
}

console.log(failed ? `\n❌ ${failed}개 실패 — 배포하지 마세요.` : "\n✅ 모두 통과");
process.exit(failed ? 1 : 0);
