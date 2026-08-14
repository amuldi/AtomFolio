# AtomFolio 상용화 준비도 (Production Readiness)

이 문서는 AtomFolio를 "진짜 사용자의 금융 데이터를 다루는 서비스"로 운영할 때 필요한 설정과
알려진 한계를 정리한다. 코드 변경 없이도 이 문서만 보고 배포 전 체크리스트로 쓸 수 있게
작성했다. 실시간 상태는 `GET /api/health`의 `readiness` 필드에서 확인할 수 있다
(`server/productionReadiness.mjs`).

## 한눈에 보기 — 배포 전 체크리스트

- [ ] `DATABASE_URL` (Neon Postgres) 설정 — 없으면 데이터가 서버리스 인스턴스 메모리에만
      존재해서 콜드 스타트/재배포마다 사라질 수 있다. **가장 중요한 항목.**
- [ ] `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` 설정 — 없으면 로그인 UI가 아예
      렌더링되지 않거나, 토큰 검증이 안 돼 모든 요청이 게스트로 취급된다.
- [ ] `ATOMFOLIO_BROKER_ENCRYPTION_KEY` 설정 — 없으면 증권사 연동 자격증명을 암호화할 수
      없어 해당 기능이 실패로 닫힌다(설계상 의도된 동작 — 평문 저장 대신 기능을 막는다).
- [ ] `npm test`, `npm run lint`, `npm run build` 통과 확인.
- [ ] 배포 후 `GET /api/health`에서 `readiness.level`이 `ready`인지 확인. `blocked`이면
      `readiness.errors`를 먼저 해결한다.
- [ ] 레이트 리밋은 기본값(in-memory)이 다중 서버리스 인스턴스에서 best-effort라는 점을
      인지 — 아래 "레이트 리밋" 절 참고.

## 1. 필수 환경 변수

`.env.example`에 전체 목록과 각 변수의 설명이 있다. 여기서는 "프로덕션에 없으면 무슨 일이
생기는가"만 요약한다.

| 변수 | 없을 때 실제로 벌어지는 일 | `/api/health` 신호 |
| --- | --- | --- |
| `DATABASE_URL` | 포트폴리오 저장소가 `memory`(Vercel) 또는 `file`(그 외) 드라이버로 조용히 폴백. 재배포/콜드 스타트마다 데이터 유실 가능 | `readiness.errors`에 `store-driver-not-durable` |
| `CLERK_SECRET_KEY` | 서버가 Bearer 토큰을 검증할 수 없음 — 로그인해도 모든 API 요청이 미인증으로 처리됨 | `readiness.errors`에 `clerk-secret-missing` |
| `VITE_CLERK_PUBLISHABLE_KEY` | 클라이언트가 `<ClerkProvider>`로 감싸지지 않아 로그인 UI 자체가 렌더링되지 않음 | `readiness.warnings`에 `clerk-publishable-missing` |
| `ATOMFOLIO_BROKER_ENCRYPTION_KEY` | 증권사 연동 자격증명 암호화/복호화가 항상 실패(의도된 fail-closed) | `readiness.warnings`에 `broker-encryption-missing` |
| `ATOMFOLIO_RATE_LIMIT_DRIVER` | 미설정 시 기본값 `memory` — 다중 인스턴스에서 best-effort | `readiness.warnings`에 `rate-limit-not-durable` |

개발/테스트 환경(로컬, `npm test`)에서는 이 중 아무것도 필수가 아니다 — 게스트 전용,
메모리 저장소로 정상 동작한다. **"프로덕션"의 정의**는 `VERCEL=1` 또는
`NODE_ENV=production`이며, Vercel의 프리뷰 배포도 `VERCEL=1`이 항상 설정되므로 동일한
가드레일이 적용된다 — 프리뷰도 공개 인터넷에서 실제 로그인 흐름이 동작하는 만큼 검사를
느슨하게 할 이유가 없다.

## 2. Clerk 설정

1. [Clerk 대시보드](https://dashboard.clerk.com)에서 애플리케이션을 만들고
   Email/Password 인증 방식을 켠다.
2. `CLERK_SECRET_KEY`(서버), `VITE_CLERK_PUBLISHABLE_KEY`(클라이언트)를 Vercel 프로젝트
   환경 변수에 등록한다. Preview와 Production 각각 등록해야 한다.
3. (선택) 세션 토큰에 `email`/`name` 클레임을 포함하려면 Clerk 대시보드 → Sessions →
   Customize session token에서 추가한다. 없어도 인증/권한 검사에는 영향이 없다 —
   워크스페이스 화면에 표시되는 사용자 식별자가 이메일 대신 내부 ID로 보일 뿐이다.
4. 비밀번호 재설정은 Clerk의 headless `reset_password_email_code` 전략으로 이미 구현되어
   있다(`src/components/auth/AuthPanel.jsx`) — 추가 설정 없이 Email/Password 인증을 켜면
   같이 동작한다.
5. 소셜 로그인(Google 등)을 추가하려면 Clerk 대시보드에서 provider를 켜고, `AuthPanel`에
   해당 provider의 `authenticateWithRedirect` 호출을 추가해야 한다 — 현재는 이메일/비밀번호
   방식만 구현되어 있다.

## 3. Postgres(Neon) 설정

1. Vercel 프로젝트 → Storage → Neon Postgres를 연결하거나, [neon.tech](https://neon.tech)에서
   직접 데이터베이스를 만든다.
2. 연결 문자열을 `DATABASE_URL`로 등록한다(`POSTGRES_URL`/`POSTGRES_PRISMA_URL`/
   `POSTGRES_URL_NON_POOLING`도 인식되지만 `DATABASE_URL`을 우선 사용한다).
3. `ATOMFOLIO_DB_AUTO_MIGRATE`는 기본값 `true` — 첫 배포 때는 켜 둔 채로 두면 앱이 시작할 때
   `db/schema.sql`에 대응하는 테이블을 `CREATE TABLE IF NOT EXISTS`로 자동 생성한다. 이후
   마이그레이션을 직접 관리하고 싶으면 `false`로 바꾼다.
4. `db/schema.sql`은 `server/postgresPortfolioStore.mjs`의 `SCHEMA_STATEMENTS`와 같은
   내용을 사람이 읽기 좋은 형태로 보관한 참고용 사본이다 — 실제 마이그레이션은
   `SCHEMA_STATEMENTS`가 기준이다. 스키마를 변경할 때는 두 곳을 함께 수정한다.

## 4. 게스트 워크스페이스 정책

로그인 없이도 앱을 바로 쓸 수 있게 하는 것은 의도된 제품 결정이다 — 이 흐름 자체를 없애지
않았다. 다만 게스트 워크스페이스 ID(`guest:<uuid>`)는 서명되지 않은 값이라서, **그 ID를
아는 사람은 누구나 해당 워크스페이스에 owner 권한으로 접근할 수 있다.** 즉 ID 자체가
유일한 자격증명이다.

프로덕션에서 적용되는 추가 방어(`server/portfolioStore.mjs`의
`isAcceptableGuestWorkspaceId`):

- `guest:<id>`의 `<id>`가 실제 UUID 형식이 아니면 거부한다 — 클라이언트는 항상
  `crypto.randomUUID()`로 생성하므로(`src/utils/storage.js`), 정상적으로 생긴 게스트는 전혀
  영향받지 않는다. `guest:test`처럼 짧고 추측 가능한 값만 막힌다.
- 공유 단일 버킷인 `anonymous`(워크스페이스 ID를 아예 안 보낸 요청의 기본값)를 프로덕션에서
  거부한다 — 로그인 없이 접근 가능한 첫날부터 누구나 알 수 있는 값이라 자격증명으로서
  의미가 없다.

**아직 남아있는 한계 (알려진 리스크, 의도적으로 이번 범위에서 제외):**

- 게스트 ID는 여전히 서명되지 않은 평문 값이다. URL이나 스크린샷 등으로 다른 사람에게 노출되면
  그 사람이 동일한 워크스페이스에 접근할 수 있다. 완전한 해결은 서명된 쿠키/세션 발급
  API(예: `/api/workspace/guest-session`이 HttpOnly 쿠키를 내려주고, 서버가 그 쿠키와
  워크스페이스 ID의 매칭을 검사)가 필요하며, 이는 이번 변경 범위에 포함되지 않았다 —
  기존 게스트 흐름(순수 localStorage 기반)을 깨지 않는 선에서 가능한 것만 적용했다.
- 로그인한 사용자가 `/api/workspace/claim-guest`에 다른 사람의(유출된) 게스트 워크스페이스
  ID를 넣으면 그 데이터를 자기 계정으로 병합할 수 있다 — 게스트 ID 자체가 자격증명이라는
  근본 한계에서 파생되는 문제로, 위 서명된 세션이 도입되기 전까지는 구조적으로 남아있다.

## 5. 레이트 리밋

`server/rateLimit.mjs`는 드라이버 아키텍처로 되어 있다 — `ATOMFOLIO_RATE_LIMIT_DRIVER`로
드라이버를 고른다.

- `memory`(기본값): 프로세스 메모리에 슬라이딩 윈도우 카운터를 둔다. 로컬 Node 서버
  (`server/index.mjs`)처럼 단일 프로세스에서는 정확하지만, **Vercel 서버리스에서는
  인스턴스별로 따로 계산된다** — 인스턴스가 여러 개 뜨면 실제 허용량이 설정값보다 커질 수
  있다. 남용 억제용 best-effort 방어로만 취급해야 한다.
- `redis`: 이 저장소는 실제 Redis/Upstash 클라이언트를 포함하지 않는다(외부 의존성을
  추가하지 않기로 한 결정). `ATOMFOLIO_RATE_LIMIT_DRIVER=redis`만 설정하고
  `ATOMFOLIO_REDIS_URL`(또는 `UPSTASH_REDIS_REST_URL`+`UPSTASH_REDIS_REST_TOKEN`)을 설정하지
  않으면 경고 로그만 남기고 `memory` 드라이버와 동일하게 동작한다. 진짜 Redis 기반 제한이
  필요하면 `server/rateLimit.mjs`의 `createRedisDriver`에 Upstash REST API 호출(INCR +
  PEXPIRE, 또는 슬라이딩 윈도우 Lua 스크립트)을 구현하면 된다 — 나머지 코드(호출부)는 이미
  드라이버에 무관하게 작성되어 있어 손댈 필요가 없다.

**권장 프로덕션 값**: 현재 버킷별 한도(`server/apiHandlers.mjs`의 `RATE_LIMITS`)는 IP당
분당 10~30건이다. 정말 엄격한 전역 한도가 필요해지는 시점(예: 과금이 붙는 외부 API 호출량
제어)이 오면 `memory` 드라이버로는 부족하다 — 그 전에는 이 정도로 충분하다.

## 6. 프라이버시 / 면책 고지

AtomFolio는 투자자문업 등록 서비스가 아니다. 앱 내 표시되는 수익률, 자산 배분, 시뮬레이션은
모두 사용자가 입력하거나 업로드한 데이터를 기계적으로 계산한 결과이며, **투자 자문이나
매매 추천이 아니다.** 실제 서비스로 공개할 때는 다음을 반영해야 한다:

- 최초 로그인/최초 업로드 시점에 "투자 자문이 아님" 고지를 눈에 띄게 보여줄 것.
- 시세 데이터 출처(KIS/네이버/미래에셋/야후/Stooq, `README.md`의 "시세 소스" 절 참고)와
  지연 가능성을 고지할 것 — 여러 소스가 동시에 실패하면 마지막 성공 응답을 `stale: true`로
  반환하는데, 이 상태를 사용자에게도 시각적으로 표시하는 것을 권장한다(현재는 API 응답에만
  있고 UI에 명시적 배지는 없다).
- 개인정보처리방침/이용약관 페이지 — 현재 저장소에는 없다. 만드는 시점에 아래 "데이터
  삭제/내보내기" 절과 연결한다.

## 7. 데이터 삭제 / 내보내기 정책

- **삭제 요청 진입점**은 구현되어 있다 — 로그인 상태에서 설정 패널의 AuthPanel에 "계정 및
  데이터 삭제" 섹션이 표시된다. `VITE_ATOMFOLIO_SUPPORT_EMAIL`이 설정되어 있으면 워크스페이스
  ID와 계정 식별자를 본문에 채운 `mailto:` 링크를 보여주고, 없으면 비활성화된 버튼과 함께
  "문의처가 아직 설정되지 않았습니다"를 표시한다. **실제 자동 삭제 파이프라인은 아직 없다**
  — 사람이 이메일을 받아 수동으로 처리하는 것을 전제로 한 최소 구현이다.
- **자동화하려면**: `DELETE /api/account`류 엔드포인트를 추가해 (1) Postgres의
  `atomfolio_workspaces`/`atomfolio_users` 및 연쇄 삭제되는 하위 테이블(각 테이블이
  `ON DELETE CASCADE`로 걸려 있다, `db/schema.sql` 참고)을 지우고 (2) Clerk 계정도
  `@clerk/backend`의 사용자 삭제 API로 같이 지우면 된다 — 스키마 설계상 캐스케이드 삭제가
  이미 준비되어 있어 어렵지 않다.
- **내보내기**: 별도 엔드포인트는 없지만, 이미 존재하는 `GET /api/portfolio`가 워크스페이스의
  모든 포트폴리오를 JSON으로 반환하므로 최소 기능은 이미 충족한다 — 사람이 읽기 좋은 내보내기
  (CSV 등) UI만 추가하면 된다.

## 8. 모니터링 / 알림

- `GET /api/health`: 기본 liveness(`ok`), 저장소/캐시 상태, 그리고 이번에 추가된
  `readiness`(Clerk/DB/레이트리밋 설정 여부와 경고/에러 목록)를 반환한다.
  `?details=events`를 붙이면 최근 운영 이벤트(`recordOperationalEvent`로 기록된 provider
  실패, rate-limit 초과 등)도 함께 반환한다.
- `ATOMFOLIO_ALERT_WEBHOOK_URL`을 설정하면 모든 시세 제공자가 동시에 실패할 때
  Slack 호환 웹훅으로 알림을 보낸다(`server/alerting.mjs`). 설정하지 않아도
  `/api/health?details=events`에는 항상 기록된다.
- `readiness`는 현재 별도 알림 채널이 없다 — 배포 파이프라인에 "배포 후
  `/api/health`를 호출해 `readiness.level !== 'blocked'`인지 확인" 단계를 추가하는 것을
  권장한다(예: GitHub Actions 배포 후 스텝, 또는 Vercel 배포 후 훅).

## 9. 백업 / 복구

- Neon Postgres는 자체 point-in-time recovery를 제공한다(플랜에 따라 보관 기간 상이) —
  별도로 이 저장소에서 백업을 구현하지 않는다. Neon 콘솔에서 PITR 보관 기간을 확인하고,
  필요하면 상위 플랜으로 조정한다.
- 로컬/파일 저장소(`data/portfolio-store.json`)는 백업 대상이 아니다 — 프로덕션에서 사용하지
  않는 것을 전제로 한다(이 문서 1절 참고).

## 10. 배포 전 실행 명령

```bash
npm test        # node --test — 서버 로직/워크스페이스 접근 제어/레이트리밋/암호화 등
npm run lint     # eslint .
npm run build    # vite build — 프런트엔드 번들이 실제로 컴파일되는지 확인
```

세 명령 모두 이 문서를 작성한 시점 기준으로 통과하는 상태다. `npm test`는 Postgres 연결
없이도(메모리 저장소로 폴백해서) 전부 실행된다 — CI에 `DATABASE_URL`을 넣지 않아도 된다.
