# Eater 먹킷리스트

먹고 싶은 곳을 두서없이 적으면 Claude가 카드로 정리해 주는 맛집 위시리스트예요. 폰에서 보는 걸 기준으로 만들었어요.

- 앱 주소: https://mukkit.vercel.app (Vercel 프로젝트 `eater`)

- 맨 위: 먹고 싶은 걸 적는 칸, `릴스 링크도 있어요` 체크(체크하면 링크 칸이 열림), 메뉴 사진, `정리해서 담기`
- 그 아래: 식당명·메뉴 검색, 지역(권역 → 구), 식사 종류, 정렬
- 카드: 왼쪽에 종류·이름·구 동·권역·메뉴·언제·예산·메모, 오른쪽에 사진과 D-day 스티커, 아래 줄에 담은 날·릴스·지도·고치기·지우기
- 카드를 누르면 네이버지도가 열려요(링크가 없으면 식당명과 동네로 검색).

디자인 규칙은 [DESIGN.md](./DESIGN.md)에 있어요.

## Vercel로 배포하기

1. https://vercel.com/new 에서 GitHub로 로그인하고 `Staeng/Eater` 저장소를 **Import** 합니다.
   설정(빌드 명령, 출력 폴더)은 `vercel.json`에 들어 있어서 그대로 두면 돼요.
2. **Environment Variables**에 다음을 넣습니다.

   | 이름 | 값 | 필수 |
   | --- | --- | --- |
   | `ANTHROPIC_API_KEY` | https://console.anthropic.com 에서 만든 API 키 | 예 (없으면 간단 정리 모드로만 동작) |
   | `APP_PASSCODE` | 앱에 들어갈 때 쓸 비밀번호 | 강력 권장 (없으면 주소를 아는 누구나 쓰고 지울 수 있음) |
   | `EATER_MODEL` | 기본값 `claude-opus-5-5`. 더 싸게 쓰려면 `claude-haiku-5-5` | 아니요 |

3. **Deploy**를 누릅니다.
4. 프로젝트의 **Storage** 탭 → **Create Database** → **Upstash for Redis** → 이 프로젝트에 **Connect** 합니다.
   (`KV_REST_API_URL`, `KV_REST_API_TOKEN`이 자동으로 들어가요.) 그다음 **Deployments**에서 최신 배포를 **Redeploy** 합니다.
   저장소를 연결하기 전에는 카드가 그 기기 브라우저에만 저장되고, 화면 위에 안내가 떠요.
5. 폰에서 주소를 열고 비밀번호를 한 번 입력한 뒤, 공유 메뉴의 **홈 화면에 추가**를 누르면 앱처럼 쓸 수 있어요.

지금은 GitHub 기본 브랜치가 `claude/beautiful-cannon-e81kwp`라서 Vercel이 이 브랜치를 운영(Production) 배포로 씁니다.

### 비용

한 번 정리할 때 Claude에 보내는 양은 입력 약 3천 토큰, 출력 수백 토큰이에요.
`claude-opus-5-5`는 한 번에 약 30~40원, `claude-haiku-5-5`는 약 1원 정도예요(사진을 넣으면 조금 더). Upstash Redis와 Vercel은 개인 사용량이면 무료 요금제로 충분해요.

## 동작 방식

| 부분 | 파일 | 하는 일 |
| --- | --- | --- |
| 화면 | `eater.html` | 한 파일짜리 페이지. `npm run build`가 `public/index.html`로 감싸서 내보냄 |
| 정리 | `api/parse.js`, `lib/prompt.js` | 메모(와 사진)를 Claude에 보내 JSON(식당명, 지도·릴스 링크, 메뉴, 종류, 시·구·동, 1인 예산, 날짜)으로 받음. 네이버 링크가 있으면 장소 페이지에서 이름과 대표 사진을 가져오려고 시도함 |
| 저장 | `api/places.js`, `lib/store.js` | 카드 목록 (Upstash Redis) |
| 사진 | `api/photo.js` | 폰에서 줄인 JPEG을 저장하고 보여 줌 |
| 잠금 | `lib/auth.js` | `APP_PASSCODE`와 맞는지 확인 |

Claude 요청은 `claude-opus-5-5`, effort `low`, 구조화 출력(JSON 스키마)을 쓰고, 안전 분류기가 거절하면 서버에서 다른 모델로 넘기는 `fallbacks: "default"`를 켰어요. 계정이 이 기능을 받지 않으면 자동으로 빼고 다시 요청합니다.
Claude를 쓸 수 없을 때(키 없음, 사용량 초과 등)는 페이지 안의 간단 정리기(정규식)로 담고, 카드의 연필 버튼으로 고칠 수 있어요.

권역은 서울시 생활권 기준으로 계산해요.

| 권역 | 구 |
| --- | --- |
| 서울 도심 | 종로, 중, 용산 |
| 서울 동북부 | 성동, 광진, 동대문, 중랑, 성북, 강북, 도봉, 노원 |
| 서울 서북부 | 은평, 서대문, 마포 |
| 서울 서남부 | 양천, 강서, 구로, 금천, 영등포, 동작, 관악 |
| 서울 동남부 | 서초, 강남, 송파, 강동 |

경기는 북부(고양, 파주, 의정부, 남양주, 구리, 김포 등)와 남부로 나눠요.

## 내 컴퓨터에서 실행

```bash
npm install
APP_PASSCODE=1234 ANTHROPIC_API_KEY=sk-ant-... npm run dev   # http://localhost:3000
```

Redis 없이 `.data/dev-store.json`에 저장돼요.

## claude.ai 아티팩트 버전

같은 `eater.html`이 claude.ai 아티팩트로도 올라가 있어요: https://claude.ai/artifact/9DYdfrRaCP1EvmmvXB4CWe
아티팩트 안에서는 서버 대신 Claude 앱의 기능(정리: `sample`, 저장: `db`, 사진: `assets`)을 써요.

## 글꼴

페이퍼로지(Paperlogy, © 2024 PT&)를 SIL Open Font License 1.1로 씁니다. `static/fonts/OFL.txt` 참고.
