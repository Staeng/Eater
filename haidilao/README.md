# 나의 하이디라오

먹킷리스트와 따로 쓰는 개인 페이지예요. claude.ai 아티팩트로 올라가 있어요.

- 주소: https://claude.ai/artifact/GLebJBLtNhSj4NSRmPDScW (비공개)
- 탭: 멤버십(등급 계산) · 재료픽(오늘 시킬 탕과 재료) · 소스 저장소 · DIY(면·탕·밥)
- 기록은 아티팩트 저장소(`db`)에 있어요: `visits`(방문), `sauces`(소스), `diy`, `picks/current`(오늘 담은 재료)

## 고치고 다시 올리기

1. `haidilao.html`을 고쳐요. 폰트 자리(`__FONT_*__`)와 사진 자리(`__IMAGES__`)는 그대로 둬요.
   재료·탕 사진은 `img/<재료 이름>.webp`(120px)이고, 만들 때 페이지 안에 들어가요.
2. `node haidilao/build.mjs`로 `dist/haidilao.html`을 만들어요(프리젠테이션 폰트를 파일 안에 넣음).
   클라우드 컨테이너에서는 `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`를 붙여요.
3. `dist/haidilao.html`을 위 주소로 다시 올려요. 저장된 기록은 그대로 남아요.

## 등급 계산

하이디라오 앱 안내(2026년 10월) 기준: 레드 0–499 · 실버 500–999 · 골드 1,000–2,599 · 프리미엄 2,600 이상.
매달 1일에 최근 12개월(전달까지) 식사 포인트 + 보너스(한 번에 5만 원 이상 결제 시 30점)를 더해 정하고,
내려갈 때는 한 단계씩 6개월에 한 번만 내려가요.
