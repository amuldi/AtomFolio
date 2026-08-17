import { LegalLayout } from './LegalLayout.jsx';

const SUPPORT_EMAIL = String(import.meta.env.VITE_ATOMFOLIO_SUPPORT_EMAIL ?? '').trim();

// Starter draft, not a lawyer-reviewed final document — this used to show a visible "draft,
// needs legal review" notice on the page itself; removed on request (the owner is taking on that
// risk knowingly, not because the underlying gap actually closed — PIPA's 개인정보보호책임자
// designation still isn't filled in anywhere below, since that depends on who's actually
// operating the service). Content is grounded in what the codebase actually does today (Clerk
// auth, Neon Postgres storage, guest localStorage workspaces, third-party market-data fetches)
// rather than generic boilerplate — keep it that way if features change instead of letting this
// drift out of sync, the same divergence bug the two copies of UI_TEXT had before this session
// consolidated them.
export function PrivacyPolicy() {
  return (
    <LegalLayout title="개인정보처리방침" updated="2026-08-17 (초안)">
      <h2>1. 수집하는 정보</h2>
      <ul>
        <li>
          <strong>계정 정보</strong> — 로그인 시 이메일 주소 등 인증에 필요한 정보(Clerk를 통해
          처리되며, 비밀번호는 AtomFolio 서버에 저장되지 않습니다).
        </li>
        <li>
          <strong>포트폴리오 데이터</strong> — 업로드한 CSV 또는 직접 입력한 종목명, 티커,
          매수가, 보유수량, 계좌 구분 등. 이 정보는 이용자가 직접 제공한 것이며, 증권사 계정에
          직접 연결하지 않습니다.
        </li>
        <li>
          <strong>게스트 식별자</strong> — 로그인하지 않은 경우 브라우저에 생성되는 임의의
          워크스페이스 ID. 개인을 식별할 수 있는 정보가 아닙니다.
        </li>
        <li>
          <strong>이용 기록</strong> — 오류·남용 방지를 위한 최소한의 요청 로그(레이트 리밋 등).
        </li>
      </ul>

      <h2>2. 수집 목적</h2>
      <p>
        포트폴리오 계산·시각화 기능 제공, 계정 간 데이터 동기화, 서비스 오남용 방지 외의
        목적으로 개인정보를 이용하지 않습니다. 광고 목적의 프로파일링을 하지 않습니다.
      </p>

      <h2>3. 제3자 제공과 위탁</h2>
      <ul>
        <li>
          <strong>인증</strong> — Clerk(계정 인증 처리)
        </li>
        <li>
          <strong>저장소</strong> — Neon(Postgres 데이터베이스 호스팅)
        </li>
        <li>
          <strong>시세·뉴스 조회</strong> — 실시간 시세와 뉴스는 여러 외부 제공자의 공개
          API에서 가져옵니다. 이 조회는 서버가 대신 수행하며, 이용자의 개인정보를 해당
          제공자에게 전달하지 않습니다.
        </li>
      </ul>
      <p>위 항목 외의 제3자에게 개인정보를 판매하거나 제공하지 않습니다.</p>

      <h2>4. 보관 기간</h2>
      <p>
        로그인 계정의 데이터는 계정이 삭제되거나 삭제를 요청하기 전까지 보관됩니다. 게스트
        데이터는 브라우저 저장소(localStorage)에만 남아 있으며, 브라우저 데이터를 지우면 함께
        삭제됩니다.
      </p>

      <h2>5. 이용자의 권리</h2>
      <p>
        이용자는 언제든 자신의 데이터 열람, 수정, 삭제를 요청할 수 있습니다. 로그인 상태에서
        설정 화면의 "계정 및 데이터 삭제" 메뉴로 삭제를 요청할 수 있고, 아래 연락처로도 요청할
        수 있습니다. 삭제 요청은 접수 후 처리되며 자동 즉시 삭제는 아직 지원하지 않습니다.
      </p>

      <h2>6. 쿠키와 분석 도구</h2>
      <p>
        서비스는 개인을 추적하는 광고성 쿠키를 사용하지 않습니다. 사용성 개선을 위해
        쿠키 없이 동작하는 분석 도구를 사용할 수 있으며, 이 도구는 페이지 조회수 등 집계된
        정보만 수집하고 개인을 식별하지 않습니다.
      </p>

      <h2>7. 보안</h2>
      <p>
        증권사 연동 자격 증명 등 민감한 값은 암호화해 저장합니다. 다만 어떤 서비스도 완전한
        보안을 보장할 수는 없으며, 문제 발견 시 아래 연락처로 알려주시면 신속히 대응하겠습니다.
      </p>

      <h2>8. 문의</h2>
      <p>
        {SUPPORT_EMAIL ? (
          <>
            개인정보 관련 문의는 <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>로
            연락해 주세요.
          </>
        ) : (
          '문의처가 아직 설정되지 않았습니다.'
        )}
      </p>
    </LegalLayout>
  );
}
