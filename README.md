# AtomFolio

투자 CSV, 직접 입력한 보유 종목, 실시간 시세, 뉴스, 투자 시뮬레이션을 하나의 포트폴리오 화면으로 묶어 보여주는 투자 데이터 대시보드입니다.

AtomFolio는 표 형태로 흩어진 투자 데이터를 “중앙 포트폴리오와 주변 보유 종목” 구조로 바꿔 보여줍니다. 처음 구상은 노트에 직접 그린 원자형 포트폴리오 스케치에서 시작했습니다. 여러 계좌와 종목이 한눈에 안 들어오는 문제를 해결하려고, 보유 종목을 중심에서 뻗어나가는 노드로 표현했습니다.

![초기 손그림 구상](docs/assets/atomfolio-concept-sketch.png)

## 배포와 저장소

- 배포 주소: [https://atomfolio.vercel.app](https://atomfolio.vercel.app)
- GitHub 저장소: [https://github.com/amuldi/AtomFolio](https://github.com/amuldi/AtomFolio)
- 기획서 Markdown: [docs/proposal/AtomFolio_Proposal.md](docs/proposal/AtomFolio_Proposal.md)
- 기획서 HTML: [docs/proposal/AtomFolio_Proposal.html](docs/proposal/AtomFolio_Proposal.html)
- 기획서 PDF: [docs/proposal/AtomFolio_Proposal.pdf](docs/proposal/AtomFolio_Proposal.pdf)

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
3. [주요 기능](#주요-기능)
4. [설정 정책](#설정-정책)
5. [아키텍처](#아키텍처)
6. [데이터 흐름](#데이터-흐름)
7. [파일 구조](#파일-구조)
8. [구현하면서 애먹었던 부분](#구현하면서-애먹었던-부분)
9. [실행 방법](#실행-방법)
10. [환경 변수와 배포](#환경-변수와-배포)
11. [검증](#검증)

## 개발 목적

투자 데이터는 생각보다 보기 어렵습니다. 증권사 CSV는 종목명, 티커, 매수가, 보유수량, 수익률, 날짜가 파일마다 다르게 들어오고, 한국 ETF나 미국 주식은 이름과 줄임말도 제각각입니다. 여러 계좌를 쓰면 같은 종목이 여러 줄로 반복되기도 합니다.

처음에는 CSV를 업로드해 차트로 보여주는 정도를 생각했지만, 실제로 필요한 것은 “내 포트폴리오가 어떤 모양인지 바로 보는 화면”이었습니다. 그래서 보유 종목을 하나씩 원자처럼 배치하고, 중심에는 전체 포트폴리오를 두는 방식으로 바꿨습니다.

AtomFolio의 목표는 세 가지입니다.

- CSV 파일을 앱 양식에 맞추게 하지 않고, 앱이 다양한 CSV를 해석한다.
- 수익률, 손실, 자산 비중, 점수, 뉴스, 시뮬레이션을 한 화면 흐름 안에서 본다.
- 저장한 포트폴리오는 다음 방문에도 이어지고, 날짜가 지나면 손익 기록이 날짜별로 쌓인다.

## 실행 화면

### 메인 포트폴리오

보유 종목을 중앙 포트폴리오에서 뻗어나가는 노드로 배치했습니다. 수익은 빨간색, 손실은 파란색으로 통일해 한국 투자자가 익숙한 손익 색상 체계를 따릅니다.

![AtomFolio 메인 화면](docs/assets/atomfolio-main-current.png)

### 요약 도구

요약 패널에서는 그룹 필터, 날짜별 손익 히트맵, 포트폴리오 점수, 자산 비중을 함께 확인합니다.

![AtomFolio 요약 도구](docs/assets/atomfolio-overview-current.png)

### 투자 시뮬레이션

시장 충격, 스트레스 테스트, 리밸런싱 목표, 장기 적립식 투자 가정을 입력해 예상 변화를 계산합니다. 사용자가 입력하지 않은 값은 임의로 채우지 않고 placeholder로만 안내합니다.

![AtomFolio 투자 시뮬레이션](docs/assets/atomfolio-simulation-current.png)

### 시장 뉴스

오늘 뉴스가 없으면 최신 주식 뉴스로 fallback합니다. 뉴스 카드는 제목, 출처, 시간 중심으로 빠르게 스캔할 수 있게 구성했습니다.

![AtomFolio 시장 뉴스](docs/assets/atomfolio-news-current.png)

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
  Browser["React UI\nApp.jsx + styles.css"]
  Tools["도구 패널\n목록 / 종목 추가 / 요약 / 시뮬레이션 / 뉴스"]
  Parser["CSV 파서\nportfolioIngestionCore.js"]
  Knowledge["종목 지식\nsecurityKnowledge.js"]
  Market["시세/뉴스 모듈\nliveMarketData.js / marketNews.js"]
  Analytics["분석 엔진\nheatmap / allocation / scoring / twin"]
  Local["localStorage\n브라우저 캐시"]
  Api["Vercel Functions\napi/*"]
  Server["Node API 공통 로직\nserver/*"]
  Store["저장소\nPostgres 또는 JSON fallback"]
  External["외부 공개 데이터\nYahoo / Stooq / Naver / Bing"]

  User --> Browser
  Browser --> Tools
  Browser --> Parser
  Parser --> Knowledge
  Browser --> Analytics
  Tools --> Analytics
  Browser --> Local
  Browser --> Api
  Api --> Server
  Server --> Parser
  Server --> Knowledge
  Server --> Store
  Server --> External
  Market --> External
  Browser --> Market
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
- `db/schema.sql`: workspace, portfolio, import history 테이블.

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
├── README.md
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
│   ├── portfolioIngestion.mjs
│   ├── portfolioStore.mjs
│   ├── postgresPortfolioStore.mjs
│   ├── securityEnrichment.mjs
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
├── samples/portfolio/
└── docs/
    ├── assets/
    └── proposal/
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
