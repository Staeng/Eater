# Eater 먹킷리스트 — working rules

Personal Korean food wishlist at https://mukkit.vercel.app (Vercel project `eater`, auto-deploys from
`claude/beautiful-cannon-e81kwp`). The page is `eater.html`; `npm run build` wraps it into `public/index.html`.
How it works: README.md. Look and components: DESIGN.md.

## Talking to the owner

- Always reply in Korean, in polite speech (존댓말). No English sentences in replies, including progress notes.
- Ask before running anything that calls Claude (a real `/api/parse` or `/api/enrich`, or a script that hits
  the Anthropic API). Naver lookups, the mock Anthropic server, and PATCHes that only fix data are free.
- The owner reads on a phone: short answers, results first, no long step lists. Do Vercel/GitHub work yourself.

## Before every push

1. `npm run check` — regression cases for every lookup mistake that reached a real card (wrong place such as
   the road 을지로, notices as menus, missing 구, sizes in menu names). Any ❌ means do not push.
   In the cloud container Node needs `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`.
2. `npm run build`, then look at the page at 390px and 360px wide (Playwright; Chromium at
   `/opt/pw-browsers/chromium`): no horizontal overflow, nothing clipped, no console errors.
3. When a lookup/enrich change could affect saved cards, run `npm run audit` afterwards and fix what it lists
   (data fixes go through `PATCH /api/places?id=`).
4. After pushing, confirm the live page or API actually carries the change before saying it is deployed.

When a new kind of mistake shows up on a real card, fix it in code **and** add it as a case to
`scripts/check.mjs`, so it can't come back.

## Card data rules (enforced in `lib/quality.js` and `lib/naver.js`)

- A place typed by name must resolve to a Naver eatery (never a road, station, area or building); otherwise
  the card is not added and the page asks for the name again or a Naver Map link.
- A place found from parts of the typed name takes Naver's official name; menus lose the place-name prefix.
- 구/시/동 come from the memo, else from Naver's address. 권역 is derived on the page.
- Menus: at most two, the memo's own first, never notices/headings/verb-like entries, no sizes or counts.
- Photo: a real dish photo, the most appetizing one (Claude picks among menu, owner and visitor photos);
  never storefronts, interiors, logos or posters with text.

## Housekeeping

- Keep scratch files (screenshots, test stores, mock servers) out of the repo; use the session scratchpad.
- The same `eater.html` is also published as a claude.ai artifact; republish it after page changes.
