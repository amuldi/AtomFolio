# AtomFolio

[한국어](README.md) · [English](README.en.md)

An investment data dashboard that pulls investment CSVs, manually entered holdings, live quotes, news, and investment simulation into a single portfolio screen.

AtomFolio turns investment data that's normally scattered across tables into a "central portfolio with holdings radiating outward" structure. The concept started from a hand-drawn atomic-portfolio sketch in a notebook. To solve the problem of several accounts and holdings never fitting into one clear picture, holdings are drawn as nodes branching out from a center.

<p align="center">
  <img src="docs/assets/atomfolio-concept-sketch.png" alt="Early hand-drawn concept sketch" width="260">
</p>

## Deployment & repository

- Live deployment: [https://atomfolio.vercel.app](https://atomfolio.vercel.app)
- GitHub repository: [https://github.com/amuldi/AtomFolio](https://github.com/amuldi/AtomFolio)
- Proposal (Markdown): [docs/proposal/AtomFolio_Proposal.md](docs/proposal/AtomFolio_Proposal.md)
- Proposal (HTML): [docs/proposal/AtomFolio_Proposal.html](docs/proposal/AtomFolio_Proposal.html)
- Proposal (PDF): [docs/proposal/AtomFolio_Proposal.pdf](docs/proposal/AtomFolio_Proposal.pdf)
- Update log (dated changelog with real screenshots): [docs/updates/AtomFolio_Updates.en.md](docs/updates/AtomFolio_Updates.en.md) · [한국어](docs/updates/AtomFolio_Updates.md)
- Bug/issue log: [docs/updates/AtomFolio_Bugs.en.md](docs/updates/AtomFolio_Bugs.en.md) · [한국어](docs/updates/AtomFolio_Bugs.md)

## Tech stack

![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=111)
![Vite](https://img.shields.io/badge/Vite-5.4-646CFF?logo=vite&logoColor=fff)
![JavaScript](https://img.shields.io/badge/JavaScript-ESM-F7DF1E?logo=javascript&logoColor=111)
![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=fff)
![Three.js](https://img.shields.io/badge/Three.js-0.168-000000?logo=three.js&logoColor=fff)
![Vercel](https://img.shields.io/badge/Vercel-Deploy-000000?logo=vercel&logoColor=fff)
![Postgres](https://img.shields.io/badge/Postgres-Neon%20Ready-4169E1?logo=postgresql&logoColor=fff)

## Table of contents

1. [Why this exists](#why-this-exists)
2. [Screens](#screens)
3. [Menu bar companion app (macOS)](#menu-bar-companion-app-macos)
4. [Core features](#core-features)
5. [Settings policy](#settings-policy)
6. [Architecture](#architecture)
7. [Data flow](#data-flow)
8. [File structure](#file-structure)
9. [Things that were hard to build](#things-that-were-hard-to-build)
10. [Running it](#running-it)
11. [Environment variables & deployment](#environment-variables--deployment)
12. [Verification](#verification)
13. [Update log](#update-log)

## Why this exists

Investment data is harder to look at than it should be. Broker CSVs carry holding name, ticker, cost basis, quantity, return rate, and date in a different shape every time, and Korean ETFs or US stocks each come with their own naming and abbreviation conventions. Using multiple accounts often means the same holding shows up across several repeated rows.

The original idea was something as simple as "upload a CSV, get a nice chart." What turned out to actually be needed was a screen that shows, at a glance, what shape your portfolio is in. So holdings ended up placed one by one like atoms, with the whole portfolio anchored at the center.

AtomFolio has three goals:

- The app should interpret whatever CSV shape shows up, instead of forcing the file to match the app.
- Return, loss, allocation weight, score, news, and simulation should all be visible within one screen flow.
- A saved portfolio should persist across visits, and P/L history should accumulate day by day as time passes.

## Screens

> Every screenshot below is current as of this README's last refresh (2026-08-13) — if an older
> screen is ever left in place by mistake, the [update log](#update-log) has the diff.

### Main portfolio

Holdings are placed as nodes branching out from a central portfolio. Profit is always red and loss is always blue, following the color convention Korean investors are used to. It's a WebGL (Three.js) 3D scene you can drag to rotate, with a command palette (⌘K) and an Explore/Manage tab pair up top.

How one atom encodes a portfolio:

| Mark | Meaning |
| --- | --- |
| Center nucleus + hanging name tag | The whole portfolio; the tag shows total value, return, and top-holding weight |
| One electron | One holding. Click for a detail card, which can be dragged around |
| Electron size | Weight. Perspective is damped so a big holding at the back never draws smaller than a small one up front |
| Electron fill | Return vs. cost: red for gains, blue for losses, deeper for bigger moves |
| Glow around an electron | Appears past a ±3% move and grows wider and brighter with the size of the gain or loss |
| Amber dashed ring | The holding's input needs checking (see [Input checks](#12-input-checks)) |
| Handwritten label | Name and `weight · ▲/▼return`; Hangul uses the Gaegu handwriting font, overlapping labels fade |

![AtomFolio main screen](docs/updates/assets/atomfolio-current-atomview.jpg)

### Command palette (⌘K)

Searching by name or ticker returns matches across every portfolio at once — the same holding scattered across multiple portfolios shows which one each result belongs to.

![AtomFolio command palette](docs/updates/assets/atomfolio-current-commandpalette.jpg)

### Summary tools

The summary panel brings together category filters, a daily P/L heatmap, the 6-axis portfolio score, and asset allocation.

![AtomFolio summary tools](docs/updates/assets/atomfolio-current-summary.jpg)

### Investment simulation

Enter market-shock, stress-test, rebalancing-target, and long-term recurring-investment assumptions to compute projected outcomes. Any value the user hasn't entered is shown only as a placeholder — never silently filled in.

![AtomFolio investment simulation](docs/updates/assets/atomfolio-current-simulation.jpg)

### Market news

Falls back to the latest stock news if there's nothing dated today. News cards are kept to title, source, and time so they can be scanned quickly.

![AtomFolio market news](docs/updates/assets/atomfolio-current-news.jpg)

## Menu bar companion app (macOS)

AtomFolio isn't just a web app — `desktop/` holds a separate Electron project, a macOS menu bar
companion app. It reuses the existing API (`/api/portfolio`, `/api/market/news`) as-is, without
touching any web/server code.

An atom-shaped tray icon sits in the menu bar; clicking it opens an always-on-top widget showing
**your top holdings by weight orbiting the portfolio total at the center**. Drag to spin the orbit,
or leave it and it slowly auto-rotates; clicking a holding shows its market value, P/L, and weight.
The tray icon itself changes color with your overall P/L direction — profit (red), loss (blue), or
neutral.

![Menu bar atom widget — real macOS capture](docs/updates/assets/atomfolio-menubar-widget-live.jpg)

- **Popover**: opens from the tray icon — holding news search, quick-add, and settings, swipeable
  between as pager cards.
- **Atom widget settings**: pick a category filter (assetClass/region/sector/style/risk) and
  clicking a holding connects it with a solid line to every other holding sharing that value.
  Theme (system/light/dark) is configurable independently of the website's own.
- **Sleep**: the tray icon's right-click menu can make the widget fully inert — it keeps floating
  like a static desktop image instead of reacting to the cursor.
- **Login**: no full OAuth yet — reuses the web app's guest/workspaceId system. Paste the
  Workspace ID shown in the web app's Settings → Workspace screen to connect.
- **Support**: Apple Silicon (arm64) builds only. Not true real-time — holding news is polled
  every 60 seconds.

See [`desktop/README.md`](desktop/README.md) for how to run it and more detail. How this app was
built and refined (bugs included) is written up by date in the
[update log](docs/updates/AtomFolio_Updates.en.md).

## Core features

### 1. Creating and saving a portfolio

- Upload a CSV, TSV, or TXT file to create a portfolio.
- Create an empty portfolio just by naming it, with no CSV required.
- Add holdings directly, either into the current portfolio or as a new one.
- Saves to browser `localStorage` first, then syncs to server-side storage via the API.
- Once a saved portfolio ages past a day, P/L snapshots are automatically backfilled for every day since the last save.
- The same date/holding snapshot is never generated twice.

### 2. Automatic CSV structure inference

- No fixed template is required.
- Different column names — `종목명`, `상품명`, `ticker`, `symbol`, `매수가`, `수량`, `수익률`, `평가일` — are mapped onto standard fields.
- Delimiter and header position are inferred.
- Encoding quirks and garbled-character cases common in Korean CSVs are accounted for.
- Repeated date-based rows are split into display holdings and raw time-series data.

### 3. Security search built for Korean investors

- Searches Korean names, English names, tickers, and abbreviations all at once.
- Example: `삼성전자`, `삼전`, `005930`, and `Samsung` are all treated as candidates for the same security.
- ETF brand names and Korean-style phrasing are accounted for.
- Example: `타이거`, `TIGER`, `KODEX`, `미국S&P500`, `QQQM`.
- Non-equity assets — gold, cash-equivalents, REITs, dividend ETFs — are treated as portfolio asset classes too.

### 4. Live market data

- Prefers the Yahoo Finance chart API.
- Falls back to the Stooq quote API for price.
- Korean tickers are matched against both `.KS` and `.KQ` suffixes.
- Once a quote resolves, the current price can be applied as the cost basis.
- Entering cost basis and quantity recomputes the current return.

### 5. Daily P/L heatmap

- Dated raw data is kept in `timelineItems`.
- Current holdings with no date also accumulate daily snapshots once time passes the save date.
- The heatmap shows profit in red and loss in blue.
- Hovering a date surfaces that day's P/L detail.
- A clear empty state is shown when there's no date/P&L data yet.

### 6. Asset allocation donut

- An explicit weight column, if present, is used first.
- Otherwise, weight is computed in this order: market value, cost basis × quantity, then equal weighting.
- The center shows the weighted-average total return.
- Profit/loss colors match the app-wide red/blue convention.

### 7. Portfolio score

Evaluates a portfolio along six axes.

| Axis | What it measures |
| --- | --- |
| Profitability | Average return, share of profitable holdings, downside volatility |
| Return stability | Share of losing holdings, volatility, defensive-asset weight |
| Investment timing | Spread of purchase dates, monthly spread, holding period |
| Portfolio composition | Balance across asset class, sector, region, and style |
| Risk management | High-risk concentration, defensive weight, asset concentration |
| Diversification | Number of holdings, number of asset classes, regional/sector spread |

The six axis scores don't depend on investing style; a style only changes the weights used for the overall score. So the four style buttons (Balanced, Growth, Stable, Aggressive) each show their own overall score at once, with a one-line note on what the selected style emphasizes. There is a single radar: with more than one portfolio, a dashed outline (all portfolios combined) is drawn over the solid one (current portfolio).

### 8. Investment simulation

- Enter shocks directly for overall market, US assets, tech stocks, gold/cash, and REITs.
- Stress tests are provided for a tech-stock crash, rate hikes, a currency spike, a global recession, and a defensive market.
- Compares target allocation against current allocation.
- Computes long-term outcomes from monthly contribution, duration, and expected annual return.
- This is a calculation tool over assumptions the user enters — not investment advice.

### 9. Market news

- Shows the latest stock news by default.
- Searchable by ticker, holding name, theme, or date keyword.
- Falls back across a combination of Naver Finance, Naver search, and Bing News RSS.
- Runs on public endpoints — no news API key required.
- If every provider fails, previously collected articles (the news archive) are shown instead.

### 10. Portfolio comparison

- The Compare tab puts every portfolio in one table: return, score, largest holding, and concentration (effective number of holdings).
- Clicking a row switches to that portfolio.

### 11. This month

The monthly card in the Summary tab no longer repeats the summary numbers; it shows **what changed since last month** (`src/lib/monthlyDigest.js`).

- Change in market value and P/L, and return change in percentage points
- Month-end return bars for the last six months
- Biggest gainers / losers this month (only holdings held in both months are compared)
- With only one recorded month, it says there is nothing to compare yet and falls back to cumulative P/L.

### 12. Input checks

So one mistyped value can't silently distort the portfolio total, suspicious holdings get an amber dashed ring and a `⚠` label, and the name tag shows "N holdings need checking" (`src/lib/holdingIssues.js`). Red already means "up", so it is never used for warnings.

- Quantity is missing
- Buy price is far from the current price (beyond 5x on the loss side, 10x on the gain side — catches another security's price pasted in)
- Return alone exceeds ±1000% when prices aren't available

### 13. Conveniences

- Deleting a holding or portfolio can be undone for a few seconds.
- A reload reopens the last portfolio you were viewing.
- Terms of service and privacy policy pages; installable as a PWA.

### 14. Demo data

`samples/demo/` holds eight demo portfolio CSVs. Every holding has a ticker, buy price, quantity, and currency, so they load with no warnings, and month-end records from June 2026 on let "This month" and the daily P/L view show real changes. See [samples/demo/README.md](samples/demo/README.md).

## Settings policy

Settings are kept down to only what's actually needed in real use.

| Setting | Options | Role |
| --- | --- | --- |
| Language | Korean, English | Overall UI language |
| Base currency | KRW, USD | Currency the portfolio is displayed in |
| Date basis | Korea time, device time | Basis for daily snapshots and save-time display |
| Auto-save | On, off | Whether browser save + server sync run automatically |
| Daily P/L accrual | On, off | Whether P/L snapshots backfill for days since the last save |
| Save status | Last saved, server sync | Current save/sync status |

## Architecture

```mermaid
flowchart LR
  User["User"]
  Browser["React web UI\nApp.jsx + styles.css"]
  Desktop["macOS menu bar app\nElectron (desktop/)"]
  Tools["Tool panels\nlist / add holding / summary / simulation / news"]
  Parser["CSV parser\nportfolioIngestionCore.js"]
  Knowledge["Security knowledge\nsecurityKnowledge.js"]
  Analytics["Analytics engine\nheatmap / allocation / scoring / twin"]
  Local["localStorage\nbrowser cache"]
  Api["Vercel Functions\napi/*"]
  Server["Shared Node API logic\nserver/*"]
  Auth["Clerk auth\nworkspaceAccess.mjs"]
  Store["Storage\nPostgres or JSON fallback"]
  Router["Quote routing\nliveQuoteRouter.mjs"]
  Breaker["Circuit breaker + provider race\nliveMarketData.js"]
  KIS["KIS (official API)"]
  Fallback["Naver / Mirae / Yahoo / Stooq"]
  Alert["Outage alerting\nalerting.mjs -> Slack webhook (opt-in)"]

  User --> Browser
  User --> Desktop
  Browser --> Tools
  Browser --> Parser
  Parser --> Knowledge
  Browser --> Analytics
  Tools --> Analytics
  Browser --> Local
  Browser --> Api
  Desktop --> Api
  Api --> Server
  Server --> Parser
  Server --> Knowledge
  Server --> Auth
  Server --> Store
  Server --> Router
  Router --> KIS
  Router --> Breaker
  Breaker --> Fallback
  Router -.total outage.-> Alert
```

### Frontend

- `src/App.jsx`: app state, portfolio save/restore, the atomic scene, settings, upload, tool wiring.
- `src/styles.css`: overall UI, desktop web layout, P/L colors, tool panels.
- `src/components/allocation/`: the asset-allocation donut.
- `src/components/panels/`: investment simulation, tool panels.
- `src/lib/*`: portfolio analytics logic.

### Backend

- `api/*`: serverless API running on Vercel.
- `server/index.mjs`: local dev server and shared API routing.
- `server/portfolioIngestion.mjs`: server-side CSV ingest.
- `server/portfolioStore.mjs`: storage abstraction.
- `server/postgresPortfolioStore.mjs`: Neon/Postgres storage adapter.
- `server/workspaceAccess.mjs`: Clerk session-token verification and workspace access checks.
- `server/rateLimit.mjs`: IP-based sliding-window rate limiting.
- `server/marketDataCache.mjs`: server-side quote-response cache (10s TTL) with stale fallback.
- `db/schema.sql`: user, workspace, member, portfolio, import history, AI analysis, and snapshot tables.

### Desktop app (menu bar)

- `desktop/src/main.js`: Electron main process — tray, popover/atom-widget windows, IPC handlers.
- `desktop/src/preload.cjs`: the `window.atomfolio` IPC bridge exposed to the renderer.
- `desktop/src/renderer/atom-view.jsx`: the atom-widget renderer — pulls in the real shared
  components/math from `src/components/atom` and `src/utils/scene.js` as-is.
- `desktop/src/renderer/popover.js`: the popover (news/settings) renderer, plain DOM.
- `desktop/src/lib/store.mjs`: local JSON config store.
- `desktop/src/lib/api.mjs`: a client for the same `/api/*` endpoints the web app calls.
- The web/server code (`src/`, `server/`, `api/`) is reused as-is — this project never modifies it.

### API abuse protection

A per-minute, per-IP request limit protects external API cost and availability.
Exceeding it returns `429` with a `Retry-After` header.

| Route | Limit (per minute) |
| --- | --- |
| `/api/ai/portfolio-summary` | 5 |
| `/api/market/live` · `search` · `news` · `financials` | 30 each |
| `/api/securities/enrich`, `/api/portfolio/ingest` | 10 |

Quotes (`/api/market/live`) go through a server-side cache (10s TTL); if every external provider
(KIS/Naver/Mirae/Yahoo/Stooq) fails, the last successful response is returned with a `stale: true`
flag. Each provider's failures are recorded via `recordOperationalEvent` and show up at
`/api/health?details=events` under `operationalEvents.countsByCode` as
`provider-fail:<naver|mirae|yahoo|stooq|kis>` — which provider is actually flaky, and how often,
is answerable without any extra infrastructure.

Naver and the Mirae Asset proxy are independent sources, so they're raced concurrently instead of
tried one after another, using whichever answers first (`raceQuoteAttempts`,
`src/lib/liveMarketData.js`). The same file has a simple circuit breaker: a provider that's failed
3 times in a row is skipped for 30 seconds, so a dead provider doesn't cost every subsequent
request its full timeout.

If every provider fails at once — including the case where a `stale` response is only possible
because a cached one exists — `server/alerting.mjs` records a distinct alert. Setting
`ATOMFOLIO_ALERT_WEBHOOK_URL` also sends it to a Slack-compatible webhook (it's always recorded at
`/api/health?details=events` regardless of whether a webhook is configured).

**Vercel limitation**: rate limiting and the quote cache are in-memory state, so on Vercel
serverless they're computed independently per instance. With multiple instances running, actual
allowed throughput can exceed the configured limit — treat this as best-effort protection, not a
hard guarantee. Swap in a shared store like Upstash Redis if a strict global limit is ever needed.
The local Node server (`server/index.mjs`) is a single process, so its limits apply exactly.

### Authentication

Login runs through [Clerk](https://clerk.com). A custom email/password UI
(`src/components/auth/AuthPanel.jsx`) is drawn directly against Clerk's headless
`useSignIn`/`useSignUp` hooks for sign-in, sign-up, and email verification-code flows.

**Token flow**

1. Once the client signs in, a Clerk session is created in the browser.
2. `src/lib/clerkAuthBridge.js` registers Clerk's `getToken()`, and every API call in
   `src/utils/storage.js` uses it to fetch the session token and attach an
   `Authorization: Bearer <JWT>` header.
3. The server's `resolveAuthContext` (`server/workspaceAccess.mjs`) verifies the signature via
   `@clerk/backend`'s `verifyToken`. A successfully verified `sub` claim becomes the workspace
   owner's `userId` directly.
4. A Clerk session token only guarantees `sub` (the user ID) by default. Exposing email/name in the
   workspace UI requires adding `email`/`name` claims via session-token customization in the Clerk
   dashboard — their absence doesn't affect auth or authorization checks either way.

**Guest promotion**: before login, `src/utils/storage.js` generates a guest workspace ID
(`guest:<uuid>`) via `crypto.randomUUID()` and stores it in localStorage. Once login succeeds,
`AuthPanel`'s `onAuthenticated` callback calls the existing `/api/workspace/claim-guest` flow
(`handleClaimGuestWorkspace`) as-is, moving the guest data into the logged-in user's workspace.
This flow itself is unchanged from before Clerk was introduced.

**Local-development-only bypass**: setting `ATOMFOLIO_TRUSTED_AUTH_HEADERS=true` trusts
`x-atomfolio-user-*` headers instead of requiring Clerk, to simulate the login flow. Under
`VERCEL=1` this flag is always disabled regardless of its value, so header spoofing can never
impersonate another user in production.

**Environment variables**: `CLERK_SECRET_KEY` (server), `VITE_CLERK_PUBLISHABLE_KEY` (client).
Without `VITE_CLERK_PUBLISHABLE_KEY`, `src/main.jsx` doesn't wrap the app in `<ClerkProvider>` and
`AuthPanel` isn't rendered either — the app just runs in guest-only mode.

## Data flow

```mermaid
flowchart TD
  A["CSV upload or manual entry"]
  B["Read text\nencoding/delimiter handling"]
  C["Analyze header and value patterns"]
  D["Map to standard fields\nname, ticker, date, cost basis, quantity, return"]
  E["Enrich security info\naliases, asset class, region, sector, risk"]
  F["Merge display holdings\ncollapse duplicate securities"]
  G["Keep time-series raw data\ntimelineItems"]
  H["Save\nlocalStorage + API storage"]
  I["Accrue daily P/L\ngenerate days since last save"]
  J["Compute analytics\nscore, heatmap, allocation, simulation"]
  K["Render the atomic UI and tool panels"]

  A --> B --> C --> D --> E
  E --> F
  E --> G
  F --> H
  G --> H
  H --> I
  F --> J
  G --> J
  I --> J
  J --> K
```

### Save flow

```mermaid
sequenceDiagram
  participant U as User
  participant UI as React UI
  participant LS as localStorage
  participant API as /api/portfolio
  participant DB as Postgres or JSON store

  U->>UI: CSV upload or manual entry
  UI->>UI: build portfolio items
  UI->>LS: save immediately
  UI->>API: save to server after a debounce
  API->>DB: upsert, scoped to workspace
  DB-->>API: save result
  API-->>UI: sync complete
  UI->>UI: show last-saved time and status
```

## File structure

```text
.
├── README.md / README.en.md
├── package.json
├── vite.config.js
├── vercel.json
├── index.html
├── db/
│   └── schema.sql
├── api/
│   ├── _utils/http.js
│   ├── health.js
│   ├── market/
│   │   ├── live.js
│   │   ├── news.js
│   │   └── search.js
│   ├── portfolio/
│   │   ├── [id].js
│   │   ├── imports.js
│   │   ├── index.js
│   │   └── ingest.js
│   └── securities/enrich.js
├── server/
│   ├── dev.mjs
│   ├── index.mjs
│   ├── apiHandlers.mjs
│   ├── portfolioIngestion.mjs
│   ├── portfolioStore.mjs
│   ├── postgresPortfolioStore.mjs
│   ├── securityEnrichment.mjs
│   ├── workspaceAccess.mjs
│   ├── rateLimit.mjs
│   ├── marketDataCache.mjs
│   ├── alerting.mjs
│   ├── operationalEvents.mjs
│   ├── newsCache.mjs
│   ├── newsArchive.mjs           # past articles served when news providers fail
│   ├── finnhubNews.mjs
│   ├── portfolioReview.mjs       # CSV upload validation (schema/quality checks)
│   ├── deviceTokens.mjs          # menu bar app connection codes
│   ├── secretCrypto.mjs
│   ├── productionReadiness.mjs
│   └── marketData/
│       ├── liveQuoteRouter.mjs
│       └── kisProvider.mjs
├── src/
│   ├── App.jsx
│   ├── main.jsx
│   ├── styles.css
│   ├── components/
│   │   ├── atom/                 # atom scene (washTone.js: gain/loss color and glow strength)
│   │   ├── allocation/
│   │   ├── auth/
│   │   ├── cards/                # heatmap, portfolio score radar
│   │   ├── command-palette/
│   │   ├── panels/
│   │   └── tool-drawer/          # summary / compare / simulation / news panels
│   ├── legal/                    # terms of service, privacy policy
│   ├── constants/
│   ├── lib/
│   │   ├── digitalTwin.js
│   │   ├── holdingIssues.js      # input checks
│   │   ├── liveMarketData.js
│   │   ├── marketNews.js
│   │   ├── monthlyDigest.js      # "This month"
│   │   ├── portfolioAllocation.js
│   │   ├── portfolioAnalyticsSummary.js
│   │   ├── portfolioHeatmap.js
│   │   ├── portfolioIngestionCore.js
│   │   ├── portfolioScoring.js
│   │   ├── portfolioSync.js      # live quote / autosave merge
│   │   └── securityKnowledge.js
│   └── utils/
│       ├── format.js
│       ├── layout.js
│       ├── math.js
│       ├── motion.js
│       ├── portfolio.js
│       ├── scene.js
│       └── storage.js
├── desktop/                      # macOS menu bar app (Electron, a separate project)
│   ├── package.json
│   ├── README.md
│   ├── assets/                   # tray icons
│   └── src/
│       ├── main.js
│       ├── preload.cjs
│       ├── lib/                  # config store, API client, insight logic
│       └── renderer/             # atom-widget / popover renderers
├── samples/
│   ├── demo/                     # 8 demo portfolios (with quantity and buy price)
│   └── portfolio/                # CSVs for parser regression tests
└── docs/
    ├── assets/
    ├── proposal/
    └── updates/                  # dated update log + screenshots + README archive
```

## Things that were hard to build

### CSVs were never consistent

At first it seemed like matching column names would be enough, but real investment CSVs mixed holding name, account name, date, market value, and return together in different orders. So the approach shifted from reading column names alone to reading value patterns as well.

### Telling a holding name apart from a classification value was hard

Values like `미국`, `기술`, `대형주`, `고위험` are metadata, not holding names. `TIGER 미국S&P500`, on the other hand, is a holding name. Plain string filters got this wrong often enough that ETF brands, Korean-style aliases, and ticker patterns each ended up managed as their own separate concern.

### The same holding repeated across many rows

Transaction history or date-by-date valuation data repeats the same holding dozens of times. Turning every row into its own node directly would break the display, so display holdings get merged while the dated originals are kept separately as `timelineItems`.

### Saving and time-series accrual had to be reconciled

Once more than a day passed since a portfolio was last saved, P/L data needed to accrue for every day in between. Simply adding today's data alone would leave gaps for the days in between, so every date between the last save and today gets computed, while snapshots that already exist are never duplicated.

### The profit/loss color convention needed to be unified

Early on, colors could differ from screen to screen. Now profit is red and loss is blue everywhere in the app — the heatmap, hover cards, the donut's center return figure, holding metrics, market quotes, and investment simulation results all follow the same rule.

### The settings screen was more complex than the feature warranted

Early settings had a lot of analysis options, but what users actually needed to see often was just save, date, currency, and language. So settings were trimmed down to the essentials, with auto-save and daily P/L accrual made directly toggleable.

### Deployment and local environments diverged

Locally, the Node server can use a file-based fallback store, but the Vercel deployment needs serverless functions and an external DB. So `portfolioStore` was abstracted: Postgres is used when `DATABASE_URL` is present, and a JSON file store otherwise.

## Running it

### Requirements

- Node.js 20+
- npm

### Install

```bash
npm install
```

### Local dev server

```bash
npm run dev
```

Then open this in your browser:

```text
http://localhost:5173
```

`localhost` is the dev address. The live deployment is
[https://atomfolio.vercel.app](https://atomfolio.vercel.app).

### Build

```bash
npm run build
```

### Production preview

```bash
npm run preview
```

## Environment variables & deployment

To use Postgres storage, set these in Vercel's environment variables:

```bash
DATABASE_URL="postgres://user:password@host.neon.tech/neondb?sslmode=require"
ATOMFOLIO_STORE_DRIVER="postgres"
ATOMFOLIO_DB_AUTO_MIGRATE="true"
```

Without `DATABASE_URL`, local development uses the JSON-file fallback store.

Login runs through Clerk. Without the values below, the app runs in guest-only mode, saving and
restoring only through a `guest:<uuid>` workspace (see [Authentication](#authentication) for the
full flow).

```bash
CLERK_SECRET_KEY="sk_test_..."
VITE_CLERK_PUBLISHABLE_KEY="pk_test_..."
```

To simulate auth without Clerk in local development, this can be turned on. It trusts whatever
`x-atomfolio-user-*` headers the client sends, so only turn it on in an environment you trust.
Under production's `VERCEL=1`, this value is always disabled no matter what it's set to.

```bash
ATOMFOLIO_TRUSTED_AUTH_HEADERS="true"
```

Vercel configuration lives in [vercel.json](vercel.json).

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [
    {
      "source": "/((?!api/).*)",
      "destination": "/index.html"
    }
  ]
}
```

## API summary

| API | Role |
| --- | --- |
| `GET /api/health` | Check server and storage status |
| `GET /api/market/live` | Current price, change, and chart data |
| `GET /api/market/search` | Search for candidate securities |
| `GET /api/market/news` | Market news |
| `GET /api/workspace/session` | Login-detection status and workspace for the current request |
| `POST /api/workspace/claim-guest` | Merge guest data into the logged-in user's workspace |
| `POST /api/portfolio/ingest` | Convert CSV text into a portfolio |
| `GET /api/portfolio` | List saved portfolios |
| `POST /api/portfolio` | Save a portfolio |
| `PUT /api/portfolio/:id` | Update a portfolio |
| `DELETE /api/portfolio/:id` | Delete a portfolio |
| `GET /api/portfolio/imports` | Upload history |
| `POST /api/securities/enrich` | Enrich security metadata |

## Verification

Recently confirmed:

- `npm test` (`node --test`, 150 tests — parser, scoring, "This month", input checks, quote merging, auth isolation, and more)
- `npm run lint`, `npm run build`
- On `https://atomfolio.vercel.app`: score styles, "This month", and electron glow checked live
- All eight `samples/demo/` CSVs load with no warnings

## Disclaimer

AtomFolio is a tool for organizing investment data and computing outcomes from stated assumptions. It is not investment advice or a buy/sell recommendation service. External quotes and news use public endpoints, so responses may be rate-limited or restricted depending on network conditions or provider policy.

## Update log

AtomFolio started as a single 2D SVG sketch drawn from a hand-drawn concept, with no login at all
— just a web app running on browser localStorage. It's moved well past that since. Below is that
change, summarized with screenshots actually captured from a local run. The full record is a dated
changelog going back to the **very first commit on 2026-04-27**, at
[docs/updates/AtomFolio_Updates.en.md](docs/updates/AtomFolio_Updates.en.md) (Korean:
[AtomFolio_Updates.md](docs/updates/AtomFolio_Updates.md)) — the README as it stood right before
this rewrite is preserved as-is under
[docs/updates/archive/](docs/updates/archive/). Bugs found along the way are tracked on their own
in [docs/updates/AtomFolio_Bugs.en.md](docs/updates/AtomFolio_Bugs.en.md) (Korean:
[AtomFolio_Bugs.md](docs/updates/AtomFolio_Bugs.md)), and kept up to date going forward.

**The atom scene — compared to the initial version**

| Earliest commits | Current |
| --- | --- |
| ![Original atom scene](docs/assets/atomfolio-dashboard.png) | ![Current atom scene](docs/updates/assets/atomfolio-current-atomview.jpg) |
| A 2D SVG sketch drawn from a hand-drawn concept, with a fixed vertical icon rail on the left. | A WebGL (Three.js) 3D scene. An Explore/Manage tab pair and a command palette (⌘K) up top; the left icon rail reorganized into Portfolios / Search / Summary / Compare / Simulation / News / Settings. |

**What actually got better**

| Area | Initial | Current |
| --- | --- | --- |
| Auth / storage | None — localStorage only | Clerk login + Postgres/JSON storage, isolated per workspace |
| Quote reliability | Yahoo → Stooq, two-step fallback | KIS (official) → Naver/Mirae raced concurrently → Yahoo → Stooq, with a circuit breaker, failure tracking, and outage alerting |
| Navigation | Fixed sidebar icons | Command palette (⌘K) searching across every portfolio, a separate management table view |
| Platforms | Web only | Web + a macOS menu bar companion app (Electron) |
| Tests | Almost none | 150 (`node --test`) — auth isolation, rate limiting, KIS routing, scoring, "This month", and more |
| Atom scene | Nodes only | Electron size = weight, color and glow by gain/loss, input-check rings, handwritten name tag |

See the [menu bar companion app](#menu-bar-companion-app-macos) section above for screenshots and
an introduction to the macOS app. More detailed per-feature screenshots, architecture diagrams, the
specifics of the market-data resilience work (circuit breaker, provider racing, outage alerting,
KIS name-based routing), and every new entry added from here on are in the update log.
