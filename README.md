<div align="center">

# AtomFolio

**내 주식을 원자 하나로, 한눈에.**

투자 CSV, 직접 입력한 보유 종목, 실시간 시세, 뉴스, 투자 시뮬레이션을<br>
가운데 포트폴리오에서 뻗어 나가는 원자 그림 하나로 묶어 보여주는 투자 데이터 대시보드입니다.

[한국어](README.md) · [English](README.en.md)

[![Live](https://img.shields.io/badge/Live-atomfolio.vercel.app-111111?logo=vercel&logoColor=fff)](https://atomfolio.vercel.app)
![Tests](https://img.shields.io/badge/tests-152%20passing-2F7A55)
![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=111)
![Three.js](https://img.shields.io/badge/Three.js-0.168-000000?logo=three.js&logoColor=fff)
![Postgres](https://img.shields.io/badge/Postgres-Neon-4169E1?logo=postgresql&logoColor=fff)

**[배포 사이트](https://atomfolio.vercel.app)** · [예시 데이터](samples/demo/) · [업데이트 로그](docs/updates/AtomFolio_Updates.md) · [기획서](docs/proposal/AtomFolio_Proposal.md)

<img src="docs/updates/assets/atomfolio-current-atomview.jpg" alt="AtomFolio 메인 화면: 가운데 포트폴리오에서 종목 전자들이 뻗어 나가고, 손익이 큰 종목이 빨강·파랑으로 빛나는 모습" width="100%">

</div>

<br>

| | |
| --- | --- |
| **원자 하나 = 포트폴리오 하나** | 가운데가 내 돈 전체, 전자 하나가 종목 하나, 전자 크기가 보유 수량 |
| **색과 빛으로 손익** | 수익은 빨강, 손실은 파랑. 많이 벌거나 잃을수록 더 밝게 빛남 |
| **CSV 그대로** | 증권사마다 다른 CSV 양식을 앱이 알아서 해석 |
| **요약·비교·모의 투자·뉴스** | 점수, 이번 달 변화, 포트폴리오 비교, 시장 충격 계산, 시장 뉴스를 한 화면 흐름에서 |

## 목차

1. [배포와 저장소](#배포와-저장소)
2. [사용 기술](#사용-기술)
3. [개발 목적](#개발-목적)
4. [실행 화면](#실행-화면)
5. [메뉴바 동반 앱 (macOS)](#메뉴바-동반-앱-macos)
6. [주요 기능](#주요-기능)
7. [오픈소스와 데이터 출처](#오픈소스와-데이터-출처)
8. [계산식](#계산식)
9. [설정 정책](#설정-정책)
10. [아키텍처](#아키텍처)
11. [데이터 흐름](#데이터-흐름)
12. [파일 구조](#파일-구조)
13. [구현하면서 애먹었던 부분](#구현하면서-애먹었던-부분)
14. [실행 방법](#실행-방법)
15. [환경 변수와 배포](#환경-변수와-배포)
16. [검증](#검증)
17. [업데이트 로그](#업데이트-로그)

## 배포와 저장소

- 배포 주소: [https://atomfolio.vercel.app](https://atomfolio.vercel.app)
- GitHub 저장소: [https://github.com/amuldi/AtomFolio](https://github.com/amuldi/AtomFolio)
- 기획서 Markdown: [docs/proposal/AtomFolio_Proposal.md](docs/proposal/AtomFolio_Proposal.md)
- 기획서 HTML: [docs/proposal/AtomFolio_Proposal.html](docs/proposal/AtomFolio_Proposal.html)
- 기획서 PDF: [docs/proposal/AtomFolio_Proposal.pdf](docs/proposal/AtomFolio_Proposal.pdf)
- 업데이트 노트: [docs/updates/AtomFolio_Updates.md](docs/updates/AtomFolio_Updates.md) · [English](docs/updates/AtomFolio_Updates.en.md)
- 버그/오류 기록: [docs/updates/AtomFolio_Bugs.md](docs/updates/AtomFolio_Bugs.md) · [English](docs/updates/AtomFolio_Bugs.en.md)

## 사용 기술

| 영역 | 기술 |
| --- | --- |
| 화면 | ![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=111) ![Vite](https://img.shields.io/badge/Vite-5.4-646CFF?logo=vite&logoColor=fff) ![JavaScript](https://img.shields.io/badge/JavaScript-ESM-F7DF1E?logo=javascript&logoColor=111) |
| 원자 3D 장면 | ![Three.js](https://img.shields.io/badge/Three.js-0.168-000000?logo=three.js&logoColor=fff) |
| 서버 | ![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=fff) ![Vercel](https://img.shields.io/badge/Vercel-Functions-000000?logo=vercel&logoColor=fff) |
| 로그인·저장 | ![Clerk](https://img.shields.io/badge/Clerk-Auth-6C47FF?logo=clerk&logoColor=fff) ![Postgres](https://img.shields.io/badge/Postgres-Neon%20Ready-4169E1?logo=postgresql&logoColor=fff) |
| 메뉴바 앱 | ![Electron](https://img.shields.io/badge/Electron-32-47848F?logo=electron&logoColor=fff) |
| 테스트·품질 | `node --test` · ESLint · Prettier |

## 개발 목적

투자 데이터는 생각보다 보기 어렵습니다. 증권사 CSV는 종목명, 티커, 매수가, 보유수량, 수익률, 날짜가 파일마다 다르게 들어오고, 한국 ETF나 미국 주식은 이름과 줄임말도 제각각입니다. 여러 계좌를 쓰면 같은 종목이 여러 줄로 반복되기도 합니다.

처음에는 CSV를 업로드해 차트로 보여주는 정도를 생각했지만, 실제로 필요한 것은 “내 포트폴리오가 어떤 모양인지 바로 보는 화면”이었습니다. 그래서 보유 종목을 하나씩 원자처럼 배치하고, 중심에는 전체 포트폴리오를 두는 방식으로 바꿨습니다. 처음 구상은 노트에 직접 그린 원자형 포트폴리오 스케치에서 시작했습니다.

<table>
  <tr>
    <th width="50%">노트에 그린 첫 구상</th>
    <th width="50%">지금의 원자 화면</th>
  </tr>
  <tr>
    <td align="center"><img src="docs/assets/atomfolio-concept-sketch.png" alt="초기 손그림 구상" width="260"></td>
    <td align="center"><img src="docs/updates/assets/atomfolio-current-glow.jpg" alt="현재 원자 화면 확대: 손익이 큰 종목이 빛나는 모습" width="100%"></td>
  </tr>
</table>

AtomFolio의 목표는 세 가지입니다.

- CSV 파일을 앱 양식에 맞추게 하지 않고, 앱이 다양한 CSV를 해석한다.
- 수익률, 손실, 자산 비중, 점수, 뉴스, 시뮬레이션을 한 화면 흐름 안에서 본다.
- 저장한 포트폴리오는 다음 방문에도 이어지고, 날짜가 지나면 손익 기록이 날짜별로 쌓인다.

## 실행 화면

> [!NOTE]
> 아래 스크린샷은 2026-11-15에 [`samples/demo/`](samples/demo/)의 예시 포트폴리오 8개를 올려 다시 찍은 화면입니다. 실제 계좌 데이터가 아닙니다. 예전 화면은 [업데이트 로그](#업데이트-로그)에 남아 있습니다.

### 메인 포트폴리오

보유 종목을 중앙 포트폴리오에서 뻗어나가는 노드로 배치했습니다. 수익은 빨간색, 손실은 파란색으로 통일해 한국 투자자가 익숙한 손익 색상 체계를 따릅니다. WebGL(Three.js) 3D 장면이라 드래그로 회전시킬 수 있고, 오른쪽 위에는 빠른 검색(⌘K)이 있습니다.

원자 하나에 이렇게 정보를 담습니다.

| 표시 | 뜻 |
| --- | --- |
| 가운데 핵 + 위에 걸린 이름표 | 포트폴리오 전체. 이름표에 총 평가금액·수익률·상위 종목 비중 |
| 전자 하나 | 보유 종목 하나. 클릭하면 상세 카드가 열리고, 카드는 끌어서 옮길 수 있음 |
| 전자 크기 | 보유 수량. 적게 가진 종목일수록 작게 그려짐 (비중은 라벨의 % 숫자로 표시). 수량이 없는 CSV는 비중 기준으로 크기를 정하고, 원근 때문에 크기가 뒤바뀌지 않도록 깊이에 따른 크기 변화를 줄임 |
| 전자 안쪽 색 | 매수가 대비 수익률. 수익 빨강, 손실 파랑, 클수록 진하게 |
| 전자 주변 빛 | ±3%를 넘는 종목부터 빨강/파랑 빛이 번지고, 손익이 클수록 넓고 밝게 빛남 |
| 주황 점선 테 | 입력값 확인 필요 (아래 [입력 오류 표시](#12-입력-오류-표시) 참고) |
| 손글씨 라벨 | 종목명과 `비중 · ▲/▼수익률`. 한글은 Gaegu 손글씨 폰트, 겹치는 라벨은 흐리게 처리 |

### 도구 패널

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/updates/assets/atomfolio-current-summary.jpg" alt="AtomFolio 요약 도구"><br>
      <b>요약</b> · 카테고리 필터, 날짜별 손익 히트맵, 성향별 포트폴리오 점수, 자산 비중, 이번 달 변화를 함께 확인합니다.
    </td>
    <td width="50%" valign="top">
      <img src="docs/updates/assets/atomfolio-current-compare.jpg" alt="AtomFolio 포트폴리오 비교"><br>
      <b>비교</b> · 모든 포트폴리오의 수익률, 점수, 최대 비중 종목, 집중도를 한 표에서 나란히 봅니다.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/updates/assets/atomfolio-current-simulation.jpg" alt="AtomFolio 투자 시뮬레이션"><br>
      <b>투자 시뮬레이션</b> · 시장 충격, 스트레스 테스트, 리밸런싱 목표, 장기 적립식 투자 가정을 입력해 예상 변화를 계산합니다. 사용자가 입력하지 않은 값은 임의로 채우지 않고 placeholder로만 안내합니다.
    </td>
    <td width="50%" valign="top">
      <img src="docs/updates/assets/atomfolio-current-news.jpg" alt="AtomFolio 시장 뉴스"><br>
      <b>시장 뉴스</b> · 오늘 뉴스가 없으면 최신 주식 뉴스로 fallback합니다. 뉴스 카드는 제목, 출처, 시간 중심으로 빠르게 스캔할 수 있게 구성했습니다.
    </td>
  </tr>
</table>

### 빠른 검색 (⌘K)

이름·티커로 검색하면 모든 포트폴리오를 가로질러 한 번에 결과가 뜹니다 — 같은 종목이 여러 포트폴리오에 흩어져 있어도 어디 소속인지 함께 보여줍니다.

<img src="docs/updates/assets/atomfolio-current-commandpalette.jpg" alt="AtomFolio 빠른 검색: 삼성으로 검색하면 두 포트폴리오의 삼성전자가 함께 표시됨" width="100%">

## 메뉴바 동반 앱 (macOS)

AtomFolio는 웹 하나가 아닙니다 — `desktop/` 아래에 별도의 Electron 프로젝트로 macOS 메뉴바
동반 앱이 있습니다. 웹/서버 코드는 건드리지 않고 기존 API(`/api/portfolio`,
`/api/market/news`)를 그대로 재사용합니다.

메뉴바에는 손익 방향에 따라 빨강(수익)/파랑(손실)/중립으로 바뀌는 작은 점 아이콘이 뜹니다 —
원자 모양은 화면에 별도로 늘 떠 있는 원자 위젯 쪽입니다. 트레이 아이콘을 클릭하면 **총
평가금액·손익·수익률이 한눈에 보이는 요약 패널**이 열리고, 그와 별개로 **보유 비중 상위
종목이 포트폴리오 총액을 중심으로 도는 원자 궤도**가 항상 위에 떠 있는 작은 위젯 창으로
표시됩니다. 원자는 항상 왼쪽으로 천천히 자동 회전하고, 드래그로 직접 돌리면 놓는 순간의
방향·속도가 관성으로 이어지다가 다시 자동 회전으로 돌아옵니다. 종목 하나를 클릭하면
평가금액·손익·비중이 표시됩니다.

![원자 위젯과 팝오버 요약 페이지 — 실제 macOS 캡처](docs/updates/assets/atomfolio-menubar-widget-and-summary-live.jpg)

- **팝오버**: 트레이 아이콘을 클릭하면 뜨는 패널로, 열 때마다 항상 요약 페이지(포트폴리오 미니
  대시보드 + 빠른 종목 추가)로 돌아옵니다. 뉴스·설정으로의 페이지 스와이프는 뺐습니다 — 팝오버는
  요약 하나에만 집중하고, 세부 설정이 필요하면 원자 위젯 자체의 우클릭 메뉴를 쓰는 쪽으로
  정리했습니다.
- **드래그로 이동**: 원자 위젯의 빈 배경(노드가 아닌 곳)을 ⌘(Command)를 누른 채 드래그하면
  위젯이 옮겨집니다. 다른 Desktop(Space)으로 화면 가장자리를 넘어가며 따라오는 기능은 한 번
  넣었다가 뺐습니다 — 위젯은 원래 떠 있던 Space 하나에 그대로 남아 있는 편이 실제 사용에는 더
  낫다고 판단했습니다.
- **원자 위젯 설정**: 카테고리 필터(자산군/지역/분야/스타일/위험)를 고르면 종목 클릭 시 같은
  카테고리 종목끼리 실선으로 연결됩니다. 테마(시스템/라이트/다크)도 웹과 별개로 설정할 수
  있습니다.
- **잠자기**: 트레이 아이콘 우클릭 메뉴에서 위젯을 완전히 비활성화해 배경화면처럼 띄워둘 수
  있습니다.
- **로그인**: 정식 OAuth는 아직 없다. 웹에 로그인한 상태로 설정 → 계정 →
  "데스크톱 연결 코드 생성"을 누르면 나오는 연결 코드(`atomfolio_dt_...`)를 붙여넣으면 로그인
  계정의 워크스페이스에 그대로 연결된다 — 서버가 그 코드를 해당 계정의 Bearer 토큰과 동등하게
  취급한다(`server/deviceTokens.mjs`). 로그인하지 않고 게스트로만 쓰던 워크스페이스 ID를 그대로
  붙여넣는 기존 방식도 여전히 된다. 코드를 재발급하면 이전 코드는 즉시 무효화되고, 계정 및
  워크스페이스 섹션의 "모든 데스크톱 연결 해제"로 언제든 전부 끊을 수 있다.
- **지원 범위**: Apple Silicon(arm64) 전용 빌드입니다. 완전한 실시간은 아니지만, 포트폴리오가
  바뀌었는지는 5초 주기로 가볍게 확인해 몇 초 안에 반영합니다 — 뉴스를 포함한 전체 새로고침
  자체는 여전히 더 긴 주기(기본 60초)로 따로 돕니다.

실행 방법과 더 자세한 내용은 [`desktop/README.md`](desktop/README.md)를 참고하세요. 이 앱이
만들어지고 다듬어진 과정(버그 수정 포함)은
[업데이트 로그](docs/updates/AtomFolio_Updates.md)에 날짜별로 정리돼 있습니다.

## 주요 기능

| | 기능 | 한 줄 요약 |
| --- | --- | --- |
| 1 | [포트폴리오 생성과 저장](#1-포트폴리오-생성과-저장) | CSV 업로드·직접 입력, 브라우저와 서버에 저장 |
| 2 | [CSV 구조 자동 추론](#2-csv-구조-자동-추론) | 증권사마다 다른 양식을 표준 필드로 해석 |
| 3 | [한국 투자자용 종목 검색](#3-한국-투자자용-종목-검색) | `삼전`, `005930`, `Samsung`을 같은 종목으로 |
| 4 | [실시간 시장 정보](#4-실시간-시장-정보) | 시세로 현재 수익률 재계산 |
| 5 | [날짜별 손익 히트맵](#5-날짜별-손익-히트맵) | 날짜마다 수익 빨강 / 손실 파랑 |
| 6 | [자산 비중 도넛](#6-자산-비중-도넛) | 종목별 비중과 가중 평균 수익률 |
| 7 | [포트폴리오 점수](#7-포트폴리오-점수) | 6개 축, 성향 4개의 종합 점수 |
| 8 | [투자 시뮬레이션](#8-투자-시뮬레이션) | 시장 충격·스트레스 테스트·적립식 계산 |
| 9 | [시장 뉴스](#9-시장-뉴스) | 공개 뉴스 모음 + 지난 기사 아카이브 |
| 10 | [포트폴리오 비교](#10-포트폴리오-비교) | 모든 포트폴리오를 한 표에서 |
| 11 | [이번 달 변화](#11-이번-달-변화) | 지난달 대비 변화와 많이 번·잃은 종목 |
| 12 | [입력 오류 표시](#12-입력-오류-표시) | 잘못 넣은 값에 주황 점선 테 |
| 13 | [편의 기능](#13-편의-기능) | 삭제 실행 취소, 마지막 화면 복원, PWA |
| 14 | [예시 데이터](#14-예시-데이터) | 바로 올려 볼 수 있는 CSV 8개 |

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

여섯 축 점수는 투자 성향과 무관하게 같고, 성향은 종합 점수를 낼 때의 가중치만 바꿉니다. 그래서 성향 버튼 네 개(균형형·성장형·안정형·공격형)에 각 성향의 종합 점수를 한꺼번에 보여주고, 고른 성향이 무엇을 크게 보는지 한 줄로 설명합니다. 레이더는 하나만 그리며, 포트폴리오가 둘 이상이면 실선(현재 포트폴리오) 위에 점선(전체 합산)을 겹쳐 비교합니다.

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
- 뉴스 제공자가 모두 실패해도 서버에 모아 둔 지난 기사(뉴스 아카이브)를 보여줍니다.

### 10. 포트폴리오 비교

- 비교 탭에서 모든 포트폴리오를 한 표에 놓고 수익률, 점수, 최대 비중 종목, 집중도(실질 종목 수)를 나란히 봅니다.
- 행을 누르면 그 포트폴리오로 바로 전환됩니다.

### 11. 이번 달 변화

요약 탭의 월간 카드는 요약 숫자를 반복하지 않고 **지난달 대비 무엇이 바뀌었는지**만 보여줍니다 (`src/lib/monthlyDigest.js`).

- 평가금액·손익 변화액과 수익률 변화(%p)
- 최근 6개월 월말 수익률 막대
- 이번 달에 많이 번 종목 / 많이 잃은 종목 (두 달 모두 보유한 종목만 비교)
- 기록된 달이 하나뿐이면 비교할 수 없다고 알리고 누적 손익 기준으로 보여줍니다.

### 12. 입력 오류 표시

잘못 입력한 값 하나가 전체 수익률을 왜곡하지 않도록, 의심스러운 종목에 주황 점선 테와 `⚠` 라벨을 붙이고 이름표에 "확인 필요 N종목"을 띄웁니다 (`src/lib/holdingIssues.js`). 빨강은 이미 "상승"이라 경고에는 쓰지 않습니다.

- 수량이 비어 있음
- 매수가가 현재가와 크게 다름 (손실 쪽 5배, 수익 쪽 10배 초과 — 다른 종목 가격을 복사한 실수를 잡기 위함)
- 가격 정보 없이 수익률만 ±1000%를 넘음

### 13. 편의 기능

- 종목·포트폴리오 삭제 직후 몇 초 동안 실행 취소할 수 있습니다.
- 새로고침해도 마지막으로 보던 포트폴리오가 다시 열립니다.
- 이용약관·개인정보처리방침 페이지가 있고, PWA로 홈 화면에 설치할 수 있습니다.

### 14. 예시 데이터

> [!TIP]
> 처음 써 본다면 [`samples/demo/`](samples/demo/)의 CSV를 그대로 올려 보세요.

`samples/demo/`에 시연용 포트폴리오 CSV 8개가 있습니다. 모든 종목에 종목코드·매수가·수량·통화가 들어 있어 경고 표시 없이 바로 보이고, 2026년 6월부터 월말 기록이 쌓여 있어 "이번 달 변화"와 날짜별 손익도 확인할 수 있습니다. 자세한 구성은 [samples/demo/README.md](samples/demo/README.md)를 참고하세요.

## 오픈소스와 데이터 출처

### 사용한 오픈소스

| 이름 | 라이선스 | 어디에 어떻게 쓰나 |
| --- | --- | --- |
| [React](https://react.dev) 18 / React DOM | MIT | 화면 전체. 원자 장면, 도구 패널(요약·비교·모의·뉴스), 빠른 검색, 설정을 컴포넌트로 나눠 그림 (`src/App.jsx`, `src/components/*`) |
| [Vite](https://vitejs.dev) 5 + `@vitejs/plugin-react` | MIT | 개발 서버(`/api` 요청을 로컬 Node 서버로 프록시)와 배포용 빌드. three.js·Clerk는 별도 청크로 나눠 캐시 효율을 높임 (`vite.config.js`) |
| [three.js](https://threejs.org) 0.168 | MIT | 원자의 3D 회전, 원근, 깊이 계산. 전자 위치를 구 위의 방향 벡터로 잡고 회전시킨 뒤 화면 좌표로 투영 (`src/scene/*`, `src/utils/scene.js`) |
| [`@clerk/clerk-react`](https://github.com/clerk/javascript) · [`@clerk/backend`](https://github.com/clerk/javascript) | MIT (SDK) | 로그인 화면(헤드리스 `useSignIn`/`useSignUp`)과 서버의 세션 토큰 검증(`verifyToken`). Clerk 서비스 자체는 클라우드 (`src/components/auth/`, `server/workspaceAccess.mjs`) |
| [`@neondatabase/serverless`](https://github.com/neondatabase/serverless) | MIT | Vercel 함수에서 Neon Postgres에 접속해 포트폴리오·업로드 이력을 저장 (`server/postgresPortfolioStore.mjs`) |
| [Electron](https://www.electronjs.org) 32 + electron-builder | MIT | macOS 메뉴바 앱과 원자 위젯, 앱 패키징 (`desktop/`) |
| [Gaegu](https://fonts.google.com/specimen/Gaegu) | OFL | 원자 라벨의 한글 손글씨 글꼴 |
| [ESLint](https://eslint.org) · [Prettier](https://prettier.io) · [knip](https://knip.dev) | MIT | 코드 검사, 자동 정리, 쓰지 않는 파일·export 찾기 |
| Node.js `node:test` | MIT | 테스트 152개 (외부 테스트 프레임워크 없음) |

로그인(Clerk), 데이터베이스(Neon), 배포·서버 함수(Vercel)는 오픈소스가 아니라 클라우드 서비스입니다. [Plausible](https://plausible.io) 방문 통계는 `VITE_PLAUSIBLE_DOMAIN`을 설정했을 때만 켜집니다.

### 데이터는 어디서 가져오나

시세·뉴스·검색 같은 시장 데이터는 브라우저가 외부 사이트를 직접 부르지 않습니다. 모두 AtomFolio 서버(`/api/*`)를 거치고, 서버가 아래 출처에서 받아와 캐시한 뒤 돌려줍니다. 분당 요청 한도가 있습니다([API 남용 방어](#api-남용-방어) 참고).

| 데이터 | 출처 (순서대로 시도) | 코드 |
| --- | --- | --- |
| **현재가·등락률·차트** | ① 한국 종목은 한국투자증권 KIS Open API 먼저 (`KIS_APP_KEY`를 설정했을 때) → ② 네이버 증권 모바일 API와 미래에셋 시세 프록시(설정했을 때)를 **동시에** 요청해 먼저 온 쪽 → ③ Yahoo Finance 차트 API → ④ Stooq | `server/marketData/liveQuoteRouter.mjs`, `kisProvider.mjs`, `src/lib/liveMarketData.js` |
| **환율** | Yahoo Finance `USDKRW=X`, `{통화}KRW=X` (예: `INRKRW=X`). 못 받으면 기본 환율로 계산 | `src/App.jsx`, `src/utils/currency.js` |
| **종목 검색·자동완성** | 네이버 증권 자동완성, Yahoo Finance 검색, 앱에 내장한 한국 ETF·별칭 사전 | `/api/market/search`, `src/lib/securityKnowledge.js` |
| **종목 정보 보강** (자산군·지역·분야) | 앱에 내장한 종목 사전, Wikidata(API·SPARQL), Yahoo Finance 검색 | `/api/securities/enrich`, `server/securityEnrichment.mjs` |
| **재무 정보** | 미국 SEC EDGAR(`company_tickers.json`, XBRL companyfacts), Yahoo Finance quoteSummary | `/api/market/financials`, `src/lib/companyFinancials.js` |
| **시장 뉴스** | 네이버 금융 뉴스, 네이버 뉴스 검색, Bing News RSS, Finnhub(`FINNHUB_API_KEY`를 설정했을 때). 모두 실패하면 서버에 모아 둔 지난 기사 | `/api/market/news`, `src/lib/marketNews.js`, `server/newsArchive.mjs` |
| **내 포트폴리오** | 사용자가 올린 CSV·직접 입력. 브라우저 `localStorage`에 먼저 저장하고 서버(Neon Postgres, 로컬은 JSON 파일)에 동기화 | `server/portfolioStore.mjs` |

- 시세 응답은 서버에서 10초 동안 캐시하고, 모든 출처가 실패하면 마지막으로 성공한 값을 `stale: true` 표시와 함께 돌려줍니다.
- 한 출처가 연속 3번 실패하면 30초 동안 그 출처를 건너뜁니다(서킷 브레이커).
- 공개 엔드포인트는 제공자 정책에 따라 언제든 막히거나 바뀔 수 있습니다.

## 계산식

모든 금액은 계산하기 전에 기준 통화(기본 원화)로 바꿉니다. 수익률은 가능하면 실제 금액으로 다시 계산하고, CSV에 적힌 수익률 문자열은 가격 정보가 전혀 없을 때만 씁니다. (`src/lib/portfolioAnalyticsSummary.js`)

### 종목 하나

| 값 | 계산 |
| --- | --- |
| 매입금액 | `매수가 × 보유수량` (CSV에 매입금액이 있으면 그 값) |
| 평가금액 | `현재가 × 보유수량` (CSV에 평가금액이 있으면 그 값) |
| 손익 | `평가금액 − 매입금액` |
| 수익률 | `손익 ÷ 매입금액 × 100` |
| 원화 환산 | `금액 × 환율` (원화·달러가 아닌 통화는 원화를 거쳐 교차 환산) |

$$
\text{수익률}(\%) = \frac{\text{현재가}\times\text{수량} - \text{매수가}\times\text{수량}}{\text{매수가}\times\text{수량}} \times 100
$$

같은 통화로 사고 거래되는 종목(달러로 산 미국 주식 등)은 환율이 분모·분자에서 지워지므로 그 통화 그대로 수익률을 계산합니다. 원화로 산 달러 종목처럼 통화가 다르면 환율 변화까지 반영된 수익률이 됩니다.

### 포트폴리오 전체

| 값 | 계산 |
| --- | --- |
| 총 평가금액·총 매입금액·총 손익 | 종목별 값을 원화로 바꿔 모두 더함 |
| 총 수익률 | `총 손익 ÷ 총 매입금액 × 100` (매입금액이 없으면 비중으로 가중 평균한 수익률) |
| 비중 | `종목 평가금액 ÷ 총 평가금액` (평가금액이 없으면 매입금액 → CSV의 비중 열 → 똑같이 나눔 순서) |
| 비중 도넛 가운데 수익률 | 각 종목 수익률을 **매입금액 비중**으로 가중 평균 (= `Σ손익 ÷ Σ매입금액`) |
| 집중도 (HHI) | `Σ 비중²` · 0.25 이상 높음, 0.12 이상 보통, 그 아래 낮음 |
| 실질 종목 수 | `1 ÷ HHI` (예: 같은 비중 5종목이면 5, 한 종목이 대부분이면 1에 가까움) |

### 이번 달 변화 (`src/lib/monthlyDigest.js`)

1. 기록(스냅샷)을 달별로 묶고, 한 달 안에서는 종목마다 **가장 마지막 기록 하나**만 남깁니다(중복 저장으로 두 번 더해지는 것 방지).
2. 달마다 `평가금액 합`, `손익 합`, `수익률 = 손익 합 ÷ 매입금액 합 × 100`을 구합니다.
3. 이번 달 − 지난달 = 평가금액 변화, 손익 변화, 수익률 변화(%p).
4. **많이 번·잃은 종목**: 두 달 모두 있는 종목만 `이번 달 손익 − 지난달 손익`으로 정렬합니다. 이번 달 새로 산 종목은 비교에서 뺍니다. 기록된 달이 하나뿐이면 누적 손익으로 대신합니다.

### 날짜별 손익 히트맵 (`src/lib/portfolioHeatmap.js`)

날짜마다 손익(또는 수익률)을 더하고, 그날 값 ÷ 기간 중 가장 큰 값으로 색 진하기를 정합니다(최소 0.12). 수익은 빨강, 손실은 파랑입니다. 최근 24주를 보여줍니다.

### 포트폴리오 점수 (`src/lib/portfolioScoring.js`)

먼저 재료 값을 구하고, 여섯 축을 각각 18~98점 범위로 계산한 뒤, 성향별 가중치로 합칩니다.

<details>
<summary>재료 값과 여섯 축 공식 펼쳐 보기</summary>

**재료 값**

| 이름 | 계산 |
| --- | --- |
| 평균 수익률, 수익률 변동성 | 종목 수익률들의 평균과 표준편차 |
| 하락 변동성 | 손실 종목 수익률만의 표준편차 |
| 수익·손실 종목 비율 | 수익률 ≥ 0 / < 0 인 종목 수 ÷ 전체 |
| 실질 종목 수 | `1 ÷ Σ 비중²` |
| 종목 분산 | `(실질 종목 수 − 1) ÷ 11`, 0~1로 자름 (12종목이면 만점) |
| 집중 벌점 | `1 − (실질 종목 수 − 1) ÷ (종목 수 − 1)` |
| 분야·지역·스타일·자산군 분산 | 그룹 개수 ÷ 6 · 4 · 4 · 3, 0~1로 자름 |
| 균형 점수 | 그룹 비중의 정규화 엔트로피 `−Σ p·ln p ÷ ln(그룹 수)` (고르게 나뉠수록 1) |
| 고·중·저위험 비중, 방어형 비중 | 위험 등급이나 채권·원자재·배당·가치·금·필수소비재에 해당하는 종목의 비중 합 |
| 매수 시점 분산 | 서로 다른 매수 월·일의 비율과 매수 기간(180일이면 만점)의 평균 |

**여섯 축** (각각 하한·상한으로 자름)

| 축 | 공식 |
| --- | --- |
| 수익성 | `40 + 평균수익률×4.6 + 수익종목비율×24 − max(0, 변동성−8)×1.4 − 하락변동성×0.6` |
| 분산투자 | `18 + 종목분산×24 + 자산군분산×18 + 분야분산×16 + 지역분산×12 + 스타일분산×8 + 평균균형×18 − 집중벌점×8` |
| 위험관리 | `24 + 분산투자×0.26 + 저위험×18 + 중위험×8 + 방어형×16 − 고위험×14 − 집중벌점×16` |
| 포트폴리오 구성 | `22 + 정보충실도×0.2 + 자산군분산×20 + 자산군균형×14 + 분야균형×12 + 지역균형×10 + 종목분산×10` |
| 투자 타이밍 | `28 + 매수시점분산×42 + 종목분산×8 + 방어형×6` (매수일이 없으면 `54 + 종목분산×6`) |
| 수익 안정성 | `70 − 변동성×4 + 수익종목비율×10 + 방어형×16 + 저위험×10 + 자산군분산×8 − 고위험×8 − 집중벌점×10 − 손실종목비율×8` |

</details>

**성향별 종합 점수** = 여섯 축 점수 × 아래 가중치의 합 (반올림)

| 축 | 균형형 | 성장형 | 안정형 | 공격형 |
| --- | ---: | ---: | ---: | ---: |
| 수익성 | 0.20 | 0.24 | 0.12 | 0.28 |
| 분산투자 | 0.22 | 0.22 | 0.18 | 0.24 |
| 위험관리 | 0.20 | 0.12 | 0.24 | 0.16 |
| 포트폴리오 구성 | 0.16 | 0.12 | 0.18 | 0.12 |
| 투자 타이밍 | 0.08 | 0.04 | 0.08 | 0.08 |
| 수익 안정성 | 0.14 | 0.26 | 0.20 | 0.12 |

### 투자 시뮬레이션 (`src/lib/digitalTwin.js`)

| 계산 | 공식 |
| --- | --- |
| 시장 충격 | 종목마다 `충격 = 전체 + (미국이면 미국) + (기술주면 기술주) + (금·현금이면 금·현금) + (리츠면 리츠)`, −95%~+200%로 자름. `예상 금액 = 평가금액 × (1 + 충격/100)` |
| 스트레스 테스트 | 미리 정한 충격값 묶음. 예: 기술주 급락 = 전체 −4%, 미국 −4%, 기술주 −18%, 금·현금 +5%, 리츠 −5% |
| 위험 점수 | `22 + 최대비중×26 + 기술주비중×22 + 미국비중×9 + 고위험비중×24 − 방어형비중×16`, 0~100 |
| 리밸런싱 | 종목을 주식·배당·금/현금·리츠·기타로 나눈 현재 비중과 목표 비중의 차이, `필요 매매 금액 = (목표 − 현재) × 총 평가금액` |
| 적립식 예상 | 월 수익률 `r = (1 + 연수익률)^(1/12) − 1`, 매달 `금액 = 금액 × (1 + r) + 월 투자금`. 연 4%(안정)·7%(중간)·10%(공격)를 나란히 비교 |

$$
\text{예상 금액}_{n} = \text{예상 금액}_{n-1}\times(1+r) + \text{월 투자금},\qquad r=(1+\text{연수익률})^{1/12}-1
$$

투자 조언이 아니라 사용자가 넣은 가정에 따른 계산입니다.

### 원자 그림 (`src/utils/scene.js`, `src/components/atom/washTone.js`)

| 표시 | 계산 |
| --- | --- |
| 전자 반지름 | `3.2 + 13 × √(보유수량 ÷ 가장 많은 보유수량)` (그려지는 **넓이**가 수량에 비례). 수량이 없으면 평가금액 비중으로 같은 식 |
| 안쪽 색 진하기 | `√(min(1, 수익률 절댓값 ÷ 40))` → 40% 이상이면 최대 |
| 주변 빛 | `((수익률 절댓값 − 3) ÷ 37)^0.75`, 0~1로 자름 → 3% 이하는 빛 없음, 40% 이상은 최대 밝기 |
| 주황 점선 테 | 수량 없음, 또는 `매수가 ÷ 현재가 > 5`(손실 쪽)·`현재가 ÷ 매수가 > 10`(수익 쪽), 또는 가격 없이 수익률이 ±1000% 초과 |

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
  Tools["도구 패널\n목록 / 종목 추가 / 요약 / 비교 / 시뮬레이션 / 뉴스"]
  Parser["CSV 파서\nportfolioIngestionCore.js"]
  Knowledge["종목 지식\nsecurityKnowledge.js"]
  Analytics["분석 엔진\nheatmap / allocation / scoring / twin\nmonthlyDigest / holdingIssues"]
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
- `desktop/src/renderer/popover.js`: 팝오버(요약/뉴스/설정) 렌더러, 순수 DOM.
- `desktop/src/lib/store.mjs`: 로컬 설정(JSON) 저장소.
- `desktop/src/lib/api.mjs`: 웹과 같은 `/api/*` 엔드포인트를 호출하는 클라이언트.
- 웹/서버(`src/`, `server/`, `api/`) 코드는 이 프로젝트가 직접 수정하지 않고 그대로 재사용한다.

### API 남용 방어

<details>
<summary>펼쳐 보기 — 레이트 리밋, 시세 캐시, 서킷 브레이커, 장애 알림</summary>

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
있으므로 best-effort 방어로 이해해야 한다. 로컬 Node 서버(`server/index.mjs`)는 단일
프로세스라 한도가 정확히 적용된다.

**드라이버 아키텍처**: `server/rateLimit.mjs`는 드라이버 기반으로 되어 있어
`ATOMFOLIO_RATE_LIMIT_DRIVER=redis` + 연결 정보(`ATOMFOLIO_REDIS_URL` 또는
`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`)를 설정하면 실제 Redis 클라이언트만
구현해 끼워 넣을 수 있는 확장 지점이 이미 준비되어 있다(이 저장소 자체는 외부 의존성을
추가하지 않기로 해서 아직 in-memory 동작으로 폴백한다). 프로덕션에서 이 값이 여전히
`memory`이면 `GET /api/health`의 `readiness.warnings`에 `rate-limit-not-durable`로 표시된다.
자세한 내용과 권장값은 [`docs/production-readiness.md`](docs/production-readiness.md) 참고.

</details>

### 인증

<details>
<summary>펼쳐 보기 — Clerk 토큰 흐름, 게스트 승격, 게스트 워크스페이스 정책</summary>

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
않고, `AuthPanel`도 렌더링하지 않는다 — 게스트 전용 모드로 그대로 동작한다. 프로덕션에서
이 값들이 비어 있으면 `GET /api/health`의 `readiness.errors`/`readiness.warnings`에 각각
`clerk-secret-missing`/`clerk-publishable-missing`으로 표시된다 — 자세한 내용은
[`docs/production-readiness.md`](docs/production-readiness.md) 참고.

**게스트 워크스페이스 정책**: 게스트 워크스페이스 ID(`guest:<uuid>`)는 서명되지 않은
값이라 그 ID를 아는 사람이 곧 owner 권한을 가진다 — ID 자체가 유일한 자격증명이다.
프로덕션에서는 이 전제를 최소한으로 방어한다(`server/portfolioStore.mjs`의
`isAcceptableGuestWorkspaceId`): `guest:<id>`의 `<id>`가 클라이언트가 실제로 생성하는
UUID 형식이 아니면 거부하고, 로그인 없이 워크스페이스 ID를 아예 안 보낸 요청이 떨어지는
공유 단일 버킷 `anonymous`도 프로덕션에서는 거부한다. 로컬 개발/테스트에서는 기존처럼
짧은 게스트 ID(`guest:test-workspace` 등)도 그대로 허용된다 — 프로덕션 전용 강화다.
서명된 게스트 세션/쿠키 발급까지는 아직 구현하지 않았다 — 남은 리스크는
[`docs/production-readiness.md`](docs/production-readiness.md)의 "게스트 워크스페이스
정책" 절에 정리했다.

</details>

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
  J["분석 계산\n점수, 히트맵, 비중, 시뮬레이션\n이번 달 변화, 입력 오류 감지"]
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

<details>
<summary>펼쳐 보기 — 저장소 폴더 구성</summary>

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
│   ├── newsArchive.mjs           # 뉴스 제공자 실패 시 보여줄 지난 기사
│   ├── finnhubNews.mjs
│   ├── portfolioReview.mjs       # CSV 업로드 검증 (스키마·품질 점검)
│   ├── deviceTokens.mjs          # 메뉴바 앱 연결 코드
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
│   │   ├── atom/                 # 원자 장면 (washTone.js: 손익 색·빛 세기)
│   │   ├── allocation/
│   │   ├── auth/
│   │   ├── cards/                # 히트맵, 포트폴리오 점수 레이더
│   │   ├── command-palette/
│   │   ├── panels/
│   │   └── tool-drawer/          # 요약·비교·시뮬레이션·뉴스 패널
│   ├── legal/                    # 이용약관, 개인정보처리방침
│   ├── constants/
│   ├── lib/
│   │   ├── digitalTwin.js
│   │   ├── holdingIssues.js      # 입력 오류 감지
│   │   ├── liveMarketData.js
│   │   ├── marketNews.js
│   │   ├── monthlyDigest.js      # 이번 달 변화
│   │   ├── portfolioAllocation.js
│   │   ├── portfolioAnalyticsSummary.js
│   │   ├── portfolioHeatmap.js
│   │   ├── portfolioIngestionCore.js
│   │   ├── portfolioScoring.js
│   │   ├── portfolioSync.js      # 실시간 시세·자동 저장 병합
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
├── samples/
│   ├── demo/                     # 시연용 포트폴리오 8개 (수량·매수가 포함)
│   └── portfolio/                # 파서 회귀 테스트용 CSV
└── docs/
    ├── assets/
    ├── proposal/
    └── updates/                  # 업데이트 로그(changelog) + 스크린샷 + README 아카이브
```

</details>

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

배포 전 체크리스트(필수 환경 변수, Clerk/Neon 설정, 게스트 워크스페이스 정책, 레이트 리밋
권장값, 개인정보/삭제 정책 등)는 [`docs/production-readiness.md`](docs/production-readiness.md)에
정리되어 있습니다.

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
| `GET /api/health` | 서버와 저장소 상태 확인 (`readiness` 필드: Clerk/DB/레이트리밋 설정 여부와 프로덕션 준비도 경고·에러) |
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

- `npm test` (`node --test`, 152개 — 파서, 점수, 이번 달 변화, 입력 오류 감지, 시세 병합, 인증 격리 등)
- `npm run lint`, `npm run build`
- 배포 주소 `https://atomfolio.vercel.app`에서 점수 성향·이번 달 변화·전자 빛 표시 실제 동작 확인
- `samples/demo/` 예시 CSV 8개 업로드 시 경고 없이 표시 확인

## 주의사항

> [!IMPORTANT]
> AtomFolio는 투자 데이터를 정리하고 가정을 계산하는 도구입니다. 투자 조언이나 매수/매도 추천 서비스가 아닙니다. 외부 시세와 뉴스는 공개 엔드포인트를 사용하므로 네트워크 상태나 제공자 정책에 따라 응답이 제한될 수 있습니다.

## 업데이트 로그

원래 AtomFolio는 손그림에서 출발한 2D SVG 스케치 하나에, 로그인도 없이 브라우저
localStorage만 쓰는 웹 하나였습니다. 지금은 여기서 훨씬 더 나아갔습니다 — 아래는 그 변화를
실제로 로컬에서 실행하고 캡처한 화면으로 정리한 것입니다. 전체 기록은 **2026년 4월 27일
최초 커밋부터** 날짜별로 정리한 changelog인
[docs/updates/AtomFolio_Updates.md](docs/updates/AtomFolio_Updates.md)(영문:
[AtomFolio_Updates.en.md](docs/updates/AtomFolio_Updates.en.md))에서 확인할 수 있습니다 — 이
문서로 재작성되기 직전 README 원문은 [docs/updates/archive/](docs/updates/archive/)에 그대로
보존해 두었습니다. 발견된 버그/오류만 따로 모은 기록은
[docs/updates/AtomFolio_Bugs.md](docs/updates/AtomFolio_Bugs.md)(영문:
[AtomFolio_Bugs.en.md](docs/updates/AtomFolio_Bugs.en.md))에서 계속 갱신됩니다.

**원자 화면 — 초기 버전 대비**

| 초기 커밋 | 현재 |
| --- | --- |
| ![초기 원자 화면](docs/assets/atomfolio-dashboard.png) | ![현재 원자 화면](docs/updates/assets/atomfolio-current-atomview.jpg) |
| 손그림에서 출발한 2D SVG 스케치. 왼쪽에 아이콘이 세로로 고정. | WebGL(Three.js) 3D 장면. 상단 탐색/관리 탭 + 명령 팔레트(⌘K), 왼쪽 아이콘은 포트폴리오·검색·요약·비교·시뮬레이션·뉴스·설정으로 재구성. |

**주요 변화**

| 구분 | 초기 | 현재 |
| --- | --- | --- |
| 로그인/저장 | 없음 — localStorage만 | Clerk 로그인 + Postgres/JSON 저장소, workspace 단위 격리 |
| 시세 안정성 | Yahoo → Stooq 2단 fallback | KIS(공식) → Naver/Mirae 동시 경쟁 → Yahoo → Stooq, 서킷 브레이커 + 실패 추적 + 장애 알림 |
| 탐색 | 사이드 아이콘 고정 노출 | 명령 팔레트(⌘K)로 모든 포트폴리오 통합 검색, 관리 테이블 뷰 |
| 플랫폼 | 웹 하나 | 웹 + macOS 메뉴바 동반 앱(Electron) |
| 테스트 | 거의 없음 | `node --test` 152개 (인증 격리·레이트리밋·KIS 라우팅·점수·이번 달 변화 등) |
| 원자 화면 | 노드만 배치 | 전자 크기 = 보유 수량, 손익에 따라 색과 빛의 세기, 입력 오류 표시, 손글씨 이름표 |

macOS 메뉴바 앱에 대한 스크린샷과 소개는 위 [메뉴바 동반 앱](#메뉴바-동반-앱-macos) 절을
참고하세요. 더 자세한 기능별 스크린샷, 아키텍처 다이어그램, 시세 복원력(서킷 브레이커, 공급자
경쟁, 장애 알림, KIS 이름 검색 라우팅)의 구체적인 변경 내용, 그리고 오늘 이후로 쌓일 새 항목은
업데이트 로그에서 계속 확인할 수 있습니다.
