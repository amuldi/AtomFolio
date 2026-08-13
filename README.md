# AtomFolio

[한국어](README.md) · [English](README.en.md)

투자 CSV, 직접 입력한 보유 종목, 실시간 시세, 뉴스, 투자 시뮬레이션을 하나의 포트폴리오 화면으로 묶어 보여주는 투자 데이터 대시보드입니다.

AtomFolio는 표 형태로 흩어진 투자 데이터를 “중앙 포트폴리오와 주변 보유 종목” 구조로 바꿔 보여줍니다. 처음 구상은 노트에 직접 그린 원자형 포트폴리오 스케치에서 시작했습니다. 여러 계좌와 종목이 한눈에 안 들어오는 문제를 해결하려고, 보유 종목을 중심에서 뻗어나가는 노드로 표현했습니다.

<p align="center">
  <img src="docs/assets/atomfolio-concept-sketch.png" alt="초기 손그림 구상" width="260">
</p>

## 배포와 저장소

- 배포 주소: [https://atomfolio.vercel.app](https://atomfolio.vercel.app)
- GitHub 저장소: [https://github.com/amuldi/AtomFolio](https://github.com/amuldi/AtomFolio)
- 기획서 Markdown: [docs/proposal/AtomFolio_Proposal.md](docs/proposal/AtomFolio_Proposal.md)
- 기획서 HTML: [docs/proposal/AtomFolio_Proposal.html](docs/proposal/AtomFolio_Proposal.html)
- 기획서 PDF: [docs/proposal/AtomFolio_Proposal.pdf](docs/proposal/AtomFolio_Proposal.pdf)
- 업데이트 노트: [docs/updates/AtomFolio_Updates.md](docs/updates/AtomFolio_Updates.md) · [English](docs/updates/AtomFolio_Updates.en.md)

## 사용 기술

![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=111)
![Vite](https://img.shields.io/badge/Vite-5.4-646CFF?logo=vite&logoColor=fff)
![JavaScript](https://img.shields.io/badge/JavaScript-ESM-F7DF1E?logo=javascript&logoColor=111)
![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=fff)
![Three.js](https://img.shields.io/badge/Three.js-0.168-000000?logo=three.js&logoColor=fff)
![Vercel](https://img.shields.io/badge/Vercel-Deploy-000000?logo=vercel&logoColor=fff)
![Postgres](https://img.shields.io/badge/Postgres-Neon%20Ready-4169E1?logo=postgresql&logoColor=fff)

## 목차

1. [개발 목적](#왜-만들었나)
2. [실행 화면](#실행-화면)
3. [메뉴바 동반 앱 (macOS)](#메뉴바-동반-앱-macos)
4. [주요 기능](#주요-기능)
5. [설정 정책](#설정-정책)
6. [아키텍처](#아키텍처)
7. [데이터 흐름](#데이터-흐름)
8. [파일 구조](#파일-구조)
9. [구현하면서 애먹었던 부분](#구현하면서-애먹었던-부분)
10. [실행 방법](#실행-방법)
11. [환경 변수와 배포](#환경-변수와-배포)
12. [검증](#검증)
13. [업데이트 로그](#업데이트-로그)

## 개발 목적

투자 데이터는 생각보다 보기 어렵습니다. 증권사 CSV는 종목명, 티커, 매수가, 보유수량, 수익률, 날짜가 파일마다 다르게 들어오고, 한국 ETF나 미국 주식은 이름과 줄임말도 제각각입니다. 여러 계좌를 쓰면 같은 종목이 여러 줄로 반복되기도 합니다.

처음에는 CSV를 업로드해 차트로 보여주는 정도를 생각했지만, 실제로 필요한 것은 “내 포트폴리오가 어떤 모양인지 바로 보는 화면”이었습니다. 그래서 보유 종목을 하나씩 원자처럼 배치하고, 중심에는 전체 포트폴리오를 두는 방식으로 바꿨습니다.

AtomFolio의 목표는 세 가지입니다.

- CSV 파일을 앱 양식에 맞추게 하지 않고, 앱이 다양한 CSV를 해석한다.
- 수익률, 손실, 자산 비중, 점수, 뉴스, 시뮬레이션을 한 화면 흐름 안에서 본다.
- 저장한 포트폴리오는 다음 방문에도 이어지고, 날짜가 지나면 손익 기록이 날짜별로 쌓인다.

## 실행 화면

> 아래 스크린샷은 모두 이 README가 최근 갱신된 시점(2026-08-13) 기준 최신 화면입니다 — 예전
> 화면이 남아있으면 [업데이트 로그](#업데이트-로그)에 그 차이가 기록돼 있습니다.

### 메인 포트폴리오

보유 종목을 중앙 포트폴리오에서 뻗어나가는 노드로 배치했습니다. 수익은 빨간색, 손실은 파란색으로 통일해 한국 투자자가 익숙한 손익 색상 체계를 따릅니다. WebGL(Three.js) 3D 장면이라 드래그로 회전시킬 수 있고, 상단에는 명령 팔레트(⌘K)와 탐색/관리 탭이 있습니다.

![AtomFolio 메인 화면](docs/updates/assets/atomfolio-current-atomview.jpg)

### 명령 팔레트 (⌘K)

이름·티커로 검색하면 모든 포트폴리오를 가로질러 한 번에 결과가 뜹니다 — 같은 종목이 여러 포트폴리오에 흩어져 있어도 어디 소속인지 함께 보여줍니다.

![AtomFolio 명령 팔레트](docs/updates/assets/atomfolio-current-commandpalette.jpg)

### 요약 도구

요약 패널에서는 카테고리 필터, 날짜별 손익 히트맵, 6축 포트폴리오 점수, 자산 비중을 함께 확인합니다.

![AtomFolio 요약 도구](docs/updates/assets/atomfolio-current-summary.jpg)

### 투자 시뮬레이션

시장 충격, 스트레스 테스트, 리밸런싱 목표, 장기 적립식 투자 가정을 입력해 예상 변화를 계산합니다. 사용자가 입력하지 않은 값은 임의로 채우지 않고 placeholder로만 안내합니다.

![AtomFolio 투자 시뮬레이션](docs/updates/assets/atomfolio-current-simulation.jpg)

### 시장 뉴스

오늘 뉴스가 없으면 최신 주식 뉴스로 fallback합니다. 뉴스 카드는 제목, 출처, 시간 중심으로 빠르게 스캔할 수 있게 구성했습니다.

![AtomFolio 시장 뉴스](docs/updates/assets/atomfolio-current-news.jpg)

## 메뉴바 동반 앱 (macOS)

AtomFolio는 웹 하나가 아닙니다 — `desktop/` 아래에 별도의 Electron 프로젝트로 macOS 메뉴바
동반 앱이 있습니다. 웹/서버 코드는 건드리지 않고 기존 API(`/api/portfolio`,
`/api/market/news`)를 그대로 재사용합니다.

메뉴바에 원자 모양 트레이 아이콘이 뜨고, 클릭하면 **보유 비중 상위 종목이 포트폴리오 총액을
중심으로 도는 원자 궤도**가 항상 위에 떠 있는 작은 위젯 창으로 표시됩니다. 드래그로 궤도를
돌리거나 가만히 두면 천천히 자동으로 돌고, 종목 하나를 클릭하면 평가금액·손익·비중이
표시됩니다. 트레이 아이콘 자체도 손익 방향에 따라 빨강(수익)/파랑(손실)/중립으로 바뀝니다.

![메뉴바 원자 위젯 — 실제 macOS 캡처](docs/updates/assets/atomfolio-menubar-widget-live.jpg)

- **팝오버**: 트레이 아이콘을 클릭하면 뜨는 패널로, 종목 뉴스 검색·빠른 종목 추가·설정이
  카드 스와이프로 전환되는 페이저에 들어 있습니다.
- **원자 위젯 설정**: 카테고리 필터(자산군/지역/분야/스타일/위험)를 고르면 종목 클릭 시 같은
  카테고리 종목끼리 실선으로 연결됩니다. 테마(시스템/라이트/다크)도 웹과 별개로 설정할 수
  있습니다.
- **잠자기**: 트레이 아이콘 우클릭 메뉴에서 위젯을 완전히 비활성화해 배경화면처럼 띄워둘 수
  있습니다.
- **로그인**: 정식 OAuth는 아직 없고, 웹의 게스트/workspaceId 체계를 재사용합니다 — 웹 설정
  (설정 → Workspace)에 뜨는 Workspace ID를 붙여넣으면 연결됩니다.
- **지원 범위**: Apple Silicon(arm64) 전용 빌드입니다. 완전한 실시간은 아니며, 종목 뉴스는
  60초 폴링으로 확인합니다.

실행 방법과 더 자세한 내용은 [`desktop/README.md`](desktop/README.md)를 참고하세요. 이 앱이
만들어지고 다듬어진 과정(버그 수정 포함)은
[업데이트 로그](docs/updates/AtomFolio_Updates.md)에 날짜별로 정리돼 있습니다.

## 주요 기능

### 1. 포트폴리오 생성과 저장

- CSV, TSV, TXT 파일을 업로드해 포트폴리오를 생성합니다.
- CSV 없이도 포트폴리오 이름을 입력해 빈 포트폴리오를 만들 수 있습니다.
- 직접 종목을 추가해 현재 포트폴리오에 붙이거나 새 포트폴리오를 만들 수 있습니다.
- 브라우저 `localStorage`에 먼저 저장하고, 서버 API를 통해 저장소에도 동기화합니다.
- 저장한 뒤 날짜가 지나면 마지막 저장일 이후 지난 날짜만큼 손익 스냅샷을 자동으로 누적합니다.
- 동일한 날짜와 동일한 종목 스냅샷은 중복 생성하지 않습니다.

### 2. CSV 구조 자동 추론

- 고정 템플릿을 요구하지 않습니다.
- `종목명`, `상품명`, `ticker`, `symbol`, `매수가`, `수량`, `수익률`, `평가일`처럼 다른 컬럼명을 표준 필드로 매핑합니다.
- 구분자와 헤더 위치를 추론합니다.
- 한국어 CSV에서 자주 나오는 인코딩과 깨진 문자 케이스를 고려합니다.
- 날짜별 반복 행은 화면용 종목과 시계열 원본 데이터로 분리합니다.

### 3. 한국 투자자용 종목 검색

- 한글명, 영문명, 티커, 줄임말을 모두 검색합니다.
- 예: `삼성전자`, `삼전`, `005930`, `Samsung`을 같은 종목 후보로 다룰 수 있습니다.
- ETF 브랜드와 한국식 표현을 고려합니다.
- 예: `타이거`, `TIGER`, `KODEX`, `미국S&P500`, `QQQM`.
- 금, 현금성 자산, 리츠, 배당 ETF처럼 주식 외 자산도 포트폴리오 자산군으로 다룹니다.

### 4. 실시간 시장 정보

- Yahoo Finance 차트 API를 우선 사용합니다.
- Stooq quote API를 가격 fallback으로 사용합니다.
- 한국 종목은 `.KS`, `.KQ` 형식을 함께 고려합니다.
- 시세가 확인되면 매수가에 현재가를 적용할 수 있습니다.
- 매수가와 보유수량을 입력하면 현재 기준 수익률을 다시 계산합니다.

### 5. 날짜별 손익 히트맵

- 날짜가 있는 원본 데이터는 `timelineItems`에 유지합니다.
- 날짜가 없는 현재 보유 데이터도 저장일 이후 날짜가 지나면 일별 스냅샷으로 누적됩니다.
- 히트맵은 수익을 빨간색, 손실을 파란색으로 표시합니다.
- 날짜 위에 hover하면 해당 날짜의 손익 정보를 확인할 수 있습니다.
- 날짜와 손익 데이터가 없으면 빈 상태를 명확하게 보여줍니다.

### 6. 자산 비중 도넛

- 명시적 비중 컬럼이 있으면 우선 사용합니다.
- 비중 컬럼이 없으면 평가금액, 매수가와 수량, 균등 비중 순서로 계산합니다.
- 중앙에는 가중 평균 총 수익률을 표시합니다.
- 수익은 빨간색, 손실은 파란색으로 앱 전체 색상 규칙과 맞췄습니다.

### 7. 포트폴리오 점수

6개 축으로 포트폴리오를 평가합니다.

| 축 | 설명 |
| --- | --- |
| 수익성 | 평균 수익률, 수익 종목 비율, 하방 변동성 |
| 수익 안정성 | 손실 종목 비율, 변동성, 방어형 자산 비중 |
| 투자 타이밍 | 매수일 분산, 월별 분산, 투자 기간 |
| 포트폴리오 구성 | 자산군, 분야, 지역, 스타일의 균형 |
| 위험관리 | 고위험 집중도, 방어형 비중, 자산 집중도 |
| 분산투자 | 종목 수, 자산군 수, 지역과 분야 분산 |

### 8. 투자 시뮬레이션

- 전체 시장, 미국 자산, 기술주, 금/현금, 리츠 충격을 직접 입력합니다.
- 기술주 급락, 금리 상승, 환율 급등, 글로벌 경기침체, 방어장세 같은 스트레스 테스트를 제공합니다.
- 목표 자산 비중과 현재 비중을 비교합니다.
- 월 추가 투자, 기간, 연평균 수익률을 넣어 장기 투자 결과를 계산합니다.
- 투자 조언이 아니라 사용자가 입력한 가정에 따른 계산 도구입니다.

### 9. 시장 뉴스

- 기본 상태에서는 최신 주식 뉴스를 보여줍니다.
- 티커, 종목명, 테마, 날짜 키워드로 검색할 수 있습니다.
- Naver Finance, Naver 검색, Bing News RSS를 조합해 fallback합니다.
- 뉴스 API 키 없이 공개 엔드포인트 중심으로 동작합니다.

## 설정 정책

설정은 실제 사용에 필요한 필수 항목만 남겼습니다.

| 설정 | 옵션 | 역할 |
| --- | --- | --- |
| 언어 | 한국어, 영어 | 전체 UI 언어 |
| 기준 통화 | KRW, USD | 포트폴리오 기준 통화 표시 정책 |
| 날짜 기준 | 한국 시간, 내 기기 시간 | 일별 스냅샷과 저장 시간 표시 기준 |
| 자동 저장 | 켜짐, 꺼짐 | 브라우저 저장과 서버 동기화 동작 |
| 일별 손익 누적 | 켜짐, 꺼짐 | 마지막 저장 이후 지난 날짜만큼 손익 스냅샷 생성 |
| 저장 상태 | 마지막 저장, 서버 동기화 | 현재 저장/동기화 상태 확인 |

## 아키텍처

```mermaid
flowchart LR
  User["사용자"]
  Browser["React 웹 UI\nApp.jsx + styles.css"]
  Desktop["macOS 메뉴바 앱\nElectron (desktop/)"]
  Tools["도구 패널\n목록 / 종목 추가 / 요약 / 시뮬레이션 / 뉴스"]
  Parser["CSV 파서\nportfolioIngestionCore.js"]
  Knowledge["종목 지식\nsecurityKnowledge.js"]
  Analytics["분석 엔진\nheatmap / allocation / scoring / twin"]
  Local["localStorage\n브라우저 캐시"]
  Api["Vercel Functions\napi/*"]
  Server["Node API 공통 로직\nserver/*"]
  Auth["Clerk 인증\nworkspaceAccess.mjs"]
  Store["저장소\nPostgres 또는 JSON fallback"]
  Router["시세 라우팅\nliveQuoteRouter.mjs"]
  Breaker["서킷 브레이커 + 공급자 경쟁\nliveMarketData.js"]
  KIS["KIS (공식 API)"]
  Fallback["Naver / Mirae / Yahoo / Stooq"]
  Alert["장애 알림\nalerting.mjs → Slack 웹훅(선택)"]

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
  Router -.전면 장애.-> Alert
```

### 프런트엔드

- `src/App.jsx`: 앱 상태, 포트폴리오 저장/복원, 원자형 화면, 설정, 업로드, 도구 연결.
- `src/styles.css`: 전체 UI, 데스크톱 웹 레이아웃, 손익 색상, 도구 패널.
- `src/components/allocation/`: 자산 비중 도넛.
- `src/components/panels/`: 투자 시뮬레이션, 도구 패널.
- `src/lib/*`: 포트폴리오 분석 로직.

### 백엔드

- `api/*`: Vercel 배포에서 동작하는 서버리스 API.
- `server/index.mjs`: 로컬 개발 서버와 공통 API 라우팅.
- `server/portfolioIngestion.mjs`: 서버 측 CSV ingest.
- `server/portfolioStore.mjs`: 저장소 추상화.
- `server/postgresPortfolioStore.mjs`: Neon/Postgres 저장소 어댑터.
- `server/workspaceAccess.mjs`: Clerk 세션 토큰 검증과 workspace 접근 검사.
- `server/rateLimit.mjs`: IP 기준 슬라이딩 윈도우 레이트 리밋.
- `server/marketDataCache.mjs`: 시세 응답 서버 캐시(TTL 10초)와 stale 폴백.
- `db/schema.sql`: user, workspace, member, portfolio, import history, AI analysis, snapshot 테이블.

### 데스크톱 앱 (메뉴바)

- `desktop/src/main.js`: Electron 메인 프로세스 — 트레이, 팝오버/원자 위젯 창, IPC 핸들러.
- `desktop/src/preload.cjs`: 렌더러에 노출되는 `window.atomfolio` IPC 브릿지.
- `desktop/src/renderer/atom-view.jsx`: 원자 위젯 렌더러 — `src/components/atom`,
  `src/utils/scene.js` 등 웹과 공유하는 실제 컴포넌트/수학을 그대로 가져다 씀.
- `desktop/src/renderer/popover.js`: 팝오버(뉴스/설정) 렌더러, 순수 DOM.
- `desktop/src/lib/store.mjs`: 로컬 설정(JSON) 저장소.
- `desktop/src/lib/api.mjs`: 웹과 같은 `/api/*` 엔드포인트를 호출하는 클라이언트.
- 웹/서버(`src/`, `server/`, `api/`) 코드는 이 프로젝트가 직접 수정하지 않고 그대로 재사용한다.

### API 남용 방어

외부 API 비용과 가용성을 보호하기 위해 IP 기준 분당 요청 한도를 둔다.
초과 시 `429`와 `Retry-After` 헤더를 반환한다.

| 경로 | 한도(분당) |
| --- | --- |
| `/api/ai/portfolio-summary` | 5 |
| `/api/market/live` · `search` · `news` · `financials` | 각 30 |
| `/api/securities/enrich`, `/api/portfolio/ingest` | 10 |

시세(`/api/market/live`)는 서버 측 캐시(TTL 10초)를 거치며, 외부 제공자(KIS/Naver/Mirae/Yahoo/Stooq)가
모두 실패하면 마지막 성공 응답을 `stale: true` 플래그와 함께 반환한다. 제공자별 실패는
`recordOperationalEvent`로 기록되어 `/api/health?details=events`의 `operationalEvents.countsByCode`에
`provider-fail:<naver|mirae|yahoo|stooq|kis>` 형태로 집계된다 — 어떤 제공자가 실제로 자주
실패하는지 별도 인프라 없이 확인할 수 있다.

Naver와 Mirae Asset 프록시는 서로 독립적인 소스라 순차 대기 대신 동시에 시도하고 먼저 응답한
쪽을 쓴다(`raceQuoteAttempts`, `src/lib/liveMarketData.js`). 공급자별로 최근 연속 3회 실패하면
30초간 해당 공급자를 건너뛰는 간단한 서킷 브레이커도 같은 파일에 있다 — 죽은 공급자를 매 요청마다
타임아웃까지 기다리는 낭비를 줄인다.

모든 공급자가 동시에 실패하면(캐시된 응답이 있어 `stale` 상태로라도 버티는 경우 포함)
`server/alerting.mjs`가 별도 알림을 남긴다. `ATOMFOLIO_ALERT_WEBHOOK_URL`을 설정하면 Slack
호환 웹훅으로도 전송된다(설정하지 않아도 `/api/health?details=events`에는 항상 기록됨).

**Vercel 한계**: 레이트 리밋과 시세 캐시는 인메모리 상태라서 Vercel 서버리스에서는
인스턴스별로 따로 계산된다. 인스턴스가 여러 개 뜨면 실제 허용량이 한도보다 커질 수
있으므로 best-effort 방어로 이해해야 한다. 엄격한 전역 한도가 필요해지면 Upstash
Redis 같은 공유 저장소로 교체한다. 로컬 Node 서버(`server/index.mjs`)는 단일
프로세스라 한도가 정확히 적용된다.

### 인증

[Clerk](https://clerk.com)로 로그인을 처리한다. 커스텀 이메일/비밀번호 UI
(`src/components/auth/AuthPanel.jsx`)가 Clerk의 headless `useSignIn`/`useSignUp`
훅으로 로그인·회원가입·이메일 인증 코드 흐름을 직접 그린다.

**토큰 흐름**

1. 클라이언트가 로그인하면 Clerk 세션이 브라우저에 생성된다.
2. `src/lib/clerkAuthBridge.js`가 Clerk의 `getToken()`을 등록해두고,
   `src/utils/storage.js`의 모든 API 호출이 이 함수로 세션 토큰을 받아
   `Authorization: Bearer <JWT>` 헤더를 붙인다.
3. 서버의 `resolveAuthContext`(`server/workspaceAccess.mjs`)가 `@clerk/backend`의
   `verifyToken`으로 서명을 검증한다. 검증에 성공한 `sub` 클레임이 그대로
   workspace 소유자 `userId`가 된다.
4. Clerk 세션 토큰은 기본적으로 `sub`(사용자 ID)만 보장한다. 이메일/이름을
   워크스페이스 화면에 노출하려면 Clerk 대시보드에서 세션 토큰 커스터마이징으로
   `email`/`name` 클레임을 추가해야 한다. 없어도 인증·권한 검사에는 영향이 없다.

**게스트 승격**: 로그인 전 `src/utils/storage.js`가 `crypto.randomUUID()`로 게스트
workspace ID(`guest:<uuid>`)를 만들어 localStorage에 저장한다. 로그인에 성공하면
`AuthPanel`의 `onAuthenticated` 콜백이 기존 `/api/workspace/claim-guest` 흐름
(`handleClaimGuestWorkspace`)을 그대로 호출해 게스트 데이터를 로그인 사용자의
workspace로 옮긴다. 이 흐름 자체는 Clerk 도입 전과 동일하다.

**로컬 개발 전용 우회로**: `ATOMFOLIO_TRUSTED_AUTH_HEADERS=true`를 설정하면 Clerk
없이 `x-atomfolio-user-*` 헤더를 신뢰해 로그인 흐름을 흉내 낼 수 있다. `VERCEL=1`
환경에서는 이 플래그 값과 무관하게 항상 비활성화되므로, 프로덕션에서는 헤더
스푸핑으로 다른 사용자를 사칭할 수 없다.

**환경 변수**: `CLERK_SECRET_KEY`(서버), `VITE_CLERK_PUBLISHABLE_KEY`(클라이언트).
`VITE_CLERK_PUBLISHABLE_KEY`가 없으면 `src/main.jsx`가 `<ClerkProvider>`로 감싸지
않고, `AuthPanel`도 렌더링하지 않는다 — 게스트 전용 모드로 그대로 동작한다.

## 데이터 흐름

```mermaid
flowchart TD
  A["CSV 업로드 또는 직접 입력"]
  B["텍스트 읽기\n인코딩/구분자 처리"]
  C["헤더와 값 패턴 분석"]
  D["표준 필드 매핑\n종목명, 티커, 날짜, 매수가, 수량, 수익률"]
  E["종목 정보 보강\n별칭, 자산군, 지역, 분야, 위험"]
  F["화면용 종목 병합\n동일 종목 중복 축약"]
  G["시계열 원본 유지\ntimelineItems"]
  H["저장\nlocalStorage + API 저장소"]
  I["일별 손익 누적\n마지막 저장일 이후 날짜 생성"]
  J["분석 계산\n점수, 히트맵, 비중, 시뮬레이션"]
  K["원자형 UI와 도구 패널 렌더링"]

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

### 저장 흐름

```mermaid
sequenceDiagram
  participant U as 사용자
  participant UI as React UI
  participant LS as localStorage
  participant API as /api/portfolio
  participant DB as Postgres 또는 JSON store

  U->>UI: CSV 업로드 또는 직접 입력
  UI->>UI: 포트폴리오 항목 생성
  UI->>LS: 즉시 저장
  UI->>API: debounce 후 서버 저장
  API->>DB: workspace 기준 upsert
  DB-->>API: 저장 결과
  API-->>UI: 동기화 완료
  UI->>UI: 마지막 저장 시간과 상태 표시
```

## 파일 구조

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
│   ├── finnhubNews.mjs
│   ├── marketData/
│   │   ├── liveQuoteRouter.mjs
│   │   └── kisProvider.mjs
│   └── agents/
│       ├── contracts.mjs
│       ├── explanationAgent.mjs
│       ├── orchestrator.mjs
│       ├── qualityGuard.mjs
│       └── schemaMapper.mjs
├── src/
│   ├── App.jsx
│   ├── main.jsx
│   ├── styles.css
│   ├── components/
│   │   ├── atom/
│   │   ├── allocation/
│   │   └── panels/
│   ├── constants/
│   ├── hooks/
│   ├── lib/
│   │   ├── digitalTwin.js
│   │   ├── liveMarketData.js
│   │   ├── marketNews.js
│   │   ├── portfolioAllocation.js
│   │   ├── portfolioAnalyticsSummary.js
│   │   ├── portfolioHeatmap.js
│   │   ├── portfolioIngestionCore.js
│   │   ├── portfolioScoring.js
│   │   └── securityKnowledge.js
│   └── utils/
│       ├── format.js
│       ├── layout.js
│       ├── math.js
│       ├── motion.js
│       ├── portfolio.js
│       ├── scene.js
│       └── storage.js
├── desktop/                      # macOS 메뉴바 앱 (Electron, 별도 프로젝트)
│   ├── package.json
│   ├── README.md
│   ├── assets/                   # 트레이 아이콘
│   └── src/
│       ├── main.js
│       ├── preload.cjs
│       ├── lib/                  # 설정 저장소, API 클라이언트, 인사이트 로직
│       └── renderer/             # 원자 위젯 / 팝오버 렌더러
├── samples/portfolio/
└── docs/
    ├── assets/
    ├── proposal/
    └── updates/                  # 업데이트 로그(changelog) + 스크린샷 + README 아카이브
```

## 구현하면서 애먹었던 부분

### CSV가 일정하지 않았다

처음에는 컬럼명만 맞추면 될 것처럼 보였지만, 실제 투자 CSV는 종목명과 계좌명, 날짜, 평가금액, 수익률이 섞여 있었습니다. 그래서 컬럼명만 보는 방식에서 값 패턴까지 함께 보는 방식으로 바꿨습니다.

### 종목명과 분류값을 구분하기 어려웠다

`미국`, `기술`, `대형주`, `고위험` 같은 값은 종목명이 아니라 메타데이터입니다. 반대로 `TIGER 미국S&P500`은 종목명입니다. 단순 문자열 필터로는 틀리는 경우가 많아서 ETF 브랜드, 한국식 별칭, 티커 패턴을 별도로 관리했습니다.

### 같은 종목이 여러 줄로 반복됐다

거래 내역이나 날짜별 평가 데이터는 같은 종목이 수십 번 반복됩니다. 그대로 노드로 만들면 화면이 깨져서, 화면용 종목은 합치고 날짜별 원본은 `timelineItems`로 유지하는 구조로 분리했습니다.

### 저장과 시계열 누적을 같이 맞춰야 했다

포트폴리오를 마지막으로 저장한 뒤 하루 이상 지나면, 지난 날짜만큼 손익 데이터가 쌓여야 했습니다. 단순히 오늘 데이터만 추가하면 중간 날짜가 비기 때문에 마지막 저장일과 오늘 사이의 모든 날짜를 계산하고, 이미 있는 스냅샷은 중복 생성하지 않도록 했습니다.

### 수익/손실 색상 규칙을 통일해야 했다

처음에는 화면마다 색이 다르게 보일 수 있었습니다. 현재는 앱 전체에서 수익은 빨간색, 손실은 파란색으로 통일했습니다. 히트맵, hover 카드, 도넛 중앙 수익률, 보유 종목 지표, 시장 시세, 투자 시뮬레이션 결과까지 같은 규칙을 따릅니다.

### 설정 화면이 기능보다 복잡했다

처음 설정에는 분석 옵션이 많았지만, 실제 사용자가 자주 봐야 하는 것은 저장, 날짜, 통화, 언어였습니다. 그래서 설정을 필수 항목 중심으로 줄이고, 자동 저장과 일별 손익 누적 상태를 직접 켜고 끌 수 있게 바꿨습니다.

### 배포 환경과 로컬 환경이 달랐다

로컬에서는 Node 서버가 파일 기반 fallback 저장소를 사용할 수 있지만, Vercel 배포에서는 서버리스 함수와 외부 DB가 필요합니다. 그래서 `portfolioStore`를 추상화하고, `DATABASE_URL`이 있으면 Postgres를 쓰고 없으면 JSON 파일 저장소로 동작하게 나눴습니다.

## 실행 방법

### 요구 환경

- Node.js 20 이상
- npm

### 설치

```bash
npm install
```

### 로컬 개발 서버

```bash
npm run dev
```

실행 후 브라우저에서 아래 주소를 엽니다.

```text
http://localhost:5173
```

`localhost`는 개발용 주소입니다. 실제 배포 사이트는 [https://atomfolio.vercel.app](https://atomfolio.vercel.app)입니다.

### 빌드

```bash
npm run build
```

### 프로덕션 미리보기

```bash
npm run preview
```

## 환경 변수와 배포

Postgres 저장소를 사용하려면 Vercel 환경 변수에 아래 값을 설정합니다.

```bash
DATABASE_URL="postgres://user:password@host.neon.tech/neondb?sslmode=require"
ATOMFOLIO_STORE_DRIVER="postgres"
ATOMFOLIO_DB_AUTO_MIGRATE="true"
```

`DATABASE_URL`이 없으면 로컬 개발에서는 JSON 파일 fallback 저장소를 사용합니다.

로그인은 Clerk로 처리합니다. 아래 값을 설정하지 않으면 앱은 `guest:<uuid>`
workspace로 저장/복원만 하는 게스트 전용 모드로 동작합니다 (자세한 흐름은
[인증](#인증) 절 참고).

```bash
CLERK_SECRET_KEY="sk_test_..."
VITE_CLERK_PUBLISHABLE_KEY="pk_test_..."
```

로컬 개발에서 Clerk 없이 인증을 흉내 내려면 아래 값을 켤 수 있습니다. 클라이언트가
보낸 `x-atomfolio-user-*` 헤더를 그대로 신뢰하므로, 신뢰할 수 있는 로컬 환경에서만
켭니다. `VERCEL=1`인 프로덕션에서는 이 값이 무엇이든 항상 비활성화됩니다.

```bash
ATOMFOLIO_TRUSTED_AUTH_HEADERS="true"
```

Vercel 설정은 [vercel.json](vercel.json)에 있습니다.

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

## API 요약

| API | 역할 |
| --- | --- |
| `GET /api/health` | 서버와 저장소 상태 확인 |
| `GET /api/market/live` | 현재가, 변동률, 차트 데이터 조회 |
| `GET /api/market/search` | 종목 후보 검색 |
| `GET /api/market/news` | 시장 뉴스 조회 |
| `GET /api/workspace/session` | 현재 요청의 로그인 감지 상태와 workspace 확인 |
| `POST /api/workspace/claim-guest` | 로그인 사용자 workspace로 게스트 데이터 병합 |
| `POST /api/portfolio/ingest` | CSV 텍스트를 포트폴리오로 변환 |
| `GET /api/portfolio` | 저장된 포트폴리오 목록 |
| `POST /api/portfolio` | 포트폴리오 저장 |
| `PUT /api/portfolio/:id` | 포트폴리오 수정 |
| `DELETE /api/portfolio/:id` | 포트폴리오 삭제 |
| `GET /api/portfolio/imports` | 업로드 이력 조회 |
| `POST /api/securities/enrich` | 종목 메타데이터 보강 |

## 검증

최근 확인한 항목입니다.

- `npm run build`
- 배포 주소 `https://atomfolio.vercel.app` HTTP 200 확인
- 설정 패널 렌더링 확인
- 설정 패널 콘솔 에러 없음
- 수익/손실 색상 규칙 적용 확인
- 일별 손익 누적 로직 빌드 통과 확인

## 주의사항

AtomFolio는 투자 데이터를 정리하고 가정을 계산하는 도구입니다. 투자 조언이나 매수/매도 추천 서비스가 아닙니다. 외부 시세와 뉴스는 공개 엔드포인트를 사용하므로 네트워크 상태나 제공자 정책에 따라 응답이 제한될 수 있습니다.

## 업데이트 로그

원래 AtomFolio는 손그림에서 출발한 2D SVG 스케치 하나에, 로그인도 없이 브라우저
localStorage만 쓰는 웹 하나였습니다. 지금은 여기서 훨씬 더 나아갔습니다 — 아래는 그 변화를
실제로 로컬에서 실행하고 캡처한 화면으로 정리한 것입니다. 전체 기록은 날짜별 changelog인
[docs/updates/AtomFolio_Updates.md](docs/updates/AtomFolio_Updates.md)(영문:
[AtomFolio_Updates.en.md](docs/updates/AtomFolio_Updates.en.md))에서 확인할 수 있습니다 — 이
문서로 재작성되기 직전 README 원문은 [docs/updates/archive/](docs/updates/archive/)에 그대로
보존해 두었습니다.

**원자 화면 — 그때와 지금**

| 그때 (초기 커밋) | 지금 |
| --- | --- |
| ![초기 원자 화면](docs/assets/atomfolio-dashboard.png) | ![지금의 원자 화면](docs/updates/assets/atomfolio-current-atomview.jpg) |
| 손그림에서 출발한 2D SVG 스케치. 왼쪽에 아이콘이 세로로 고정. | WebGL(Three.js) 3D 장면. 상단 탐색/관리 탭 + 명령 팔레트(⌘K), 왼쪽 아이콘은 포트폴리오·검색·요약·비교·시뮬레이션·뉴스·설정으로 재구성. |

**무엇이 더 좋아졌나**

| 구분 | 그때 | 지금 |
| --- | --- | --- |
| 로그인/저장 | 없음 — localStorage만 | Clerk 로그인 + Postgres/JSON 저장소, workspace 단위 격리 |
| 시세 안정성 | Yahoo → Stooq 2단 fallback | KIS(공식) → Naver/Mirae 동시 경쟁 → Yahoo → Stooq, 서킷 브레이커 + 실패 추적 + 장애 알림 |
| 탐색 | 사이드 아이콘 고정 노출 | 명령 팔레트(⌘K)로 모든 포트폴리오 통합 검색, 관리 테이블 뷰 |
| 플랫폼 | 웹 하나 | 웹 + macOS 메뉴바 동반 앱(Electron) |
| 테스트 | 거의 없음 | `node --test` 78개 (인증 격리·레이트리밋·KIS 라우팅 등) |

macOS 메뉴바 앱에 대한 스크린샷과 소개는 위 [메뉴바 동반 앱](#메뉴바-동반-앱-macos) 절을
참고하세요. 더 자세한 기능별 스크린샷, 아키텍처 다이어그램, 시세 복원력(서킷 브레이커, 공급자
경쟁, 장애 알림, KIS 이름 검색 라우팅)의 구체적인 변경 내용, 그리고 오늘 이후로 쌓일 새 항목은
업데이트 로그에서 계속 확인할 수 있습니다.
