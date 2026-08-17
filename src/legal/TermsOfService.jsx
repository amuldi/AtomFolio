import { LegalLayout } from './LegalLayout.jsx';

const SUPPORT_EMAIL = String(import.meta.env.VITE_ATOMFOLIO_SUPPORT_EMAIL ?? '').trim();

// Starter draft, not a lawyer-reviewed final document — this used to show a visible "draft,
// needs legal review" notice on the page itself; removed on request (the owner is taking on that
// risk knowingly, not because the underlying gap actually closed — business-registration,
// governing-law, and dispute-forum terms still aren't filled in anywhere below). If those get
// filled in for real, this comment (and the "(초안)" in the updated= prop below) should come out
// too.
export function TermsOfService() {
  return (
    <LegalLayout title="이용약관" updated="2026-08-17 (초안)">
      <h2>1. 서비스 소개</h2>
      <p>
        AtomFolio(이하 "서비스")는 이용자가 업로드하거나 직접 입력한 투자 데이터(보유 종목,
        매수가, 수량 등)를 계산·시각화해서 보여주는 개인용 포트폴리오 대시보드입니다.
        서비스는 로그인 없이 게스트로도 이용할 수 있으며, 로그인 시 데이터가 계정에 저장됩니다.
      </p>

      <h2>2. 투자 자문이 아닙니다</h2>
      <p>
        서비스가 표시하는 수익률, 자산 배분, 포트폴리오 점수, 투자 시뮬레이션 결과는 모두
        <strong>이용자가 입력하거나 업로드한 데이터를 기계적으로 계산한 결과</strong>이며,
        특정 종목의 매수·매도를 권유하거나 추천하지 않습니다. AtomFolio는 투자자문업으로
        등록된 서비스가 아니며, 서비스에서 제공하는 어떤 정보도 투자 자문·매매 추천으로
        해석되어서는 안 됩니다. 투자 판단과 그 결과에 대한 책임은 전적으로 이용자 본인에게
        있습니다.
      </p>

      <h2>3. 시세 데이터의 한계</h2>
      <p>
        실시간 시세·뉴스는 여러 외부 제공자(증권사 오픈API, 포털, 해외 데이터 제공자 등)로부터
        가져오며, 지연되거나 일시적으로 최신이 아닐 수 있습니다. 여러 제공자가 동시에 실패하면
        서비스는 마지막으로 성공한 응답을 표시할 수 있습니다. 실제 매매 판단에는 반드시
        증권사의 정식 거래 화면을 확인하시기 바랍니다.
      </p>

      <h2>4. 이용자의 의무</h2>
      <ul>
        <li>본인의 실제 투자 데이터가 아닌 정보를 업로드해 타인에게 피해를 주지 않습니다.</li>
        <li>게스트 워크스페이스 ID, 계정 정보를 타인과 공유하지 않습니다.</li>
        <li>서비스의 정상적인 운영을 방해하는 방식(과도한 자동 요청 등)으로 이용하지 않습니다.</li>
      </ul>

      <h2>5. 데이터 저장과 삭제</h2>
      <p>
        게스트로 이용할 경우 데이터는 브라우저에 저장되며, 로그인하면 서버에도 저장됩니다.
        계정 및 데이터 삭제는 설정 화면의 "계정 및 데이터 삭제" 메뉴에서 요청할 수 있습니다.
        자세한 내용은 <a href="/privacy">개인정보처리방침</a>을 참고하세요.
      </p>

      <h2>6. 책임 제한</h2>
      <p>
        서비스는 "있는 그대로" 제공되며, 계산 결과의 정확성이나 서비스의 무중단 운영을
        보장하지 않습니다. 서비스 이용 또는 이용 불가로 발생한 손해에 대해 법이 허용하는
        범위에서 책임을 제한합니다.
      </p>

      <h2>7. 약관의 변경</h2>
      <p>
        서비스 개선에 따라 이 약관은 변경될 수 있으며, 변경 시 이 페이지의 "시행일"을
        갱신합니다. 중대한 변경은 서비스 내에서 별도로 고지합니다.
      </p>

      <h2>8. 문의</h2>
      <p>
        {SUPPORT_EMAIL ? (
          <>
            이 약관에 대한 문의는 <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>로
            연락해 주세요.
          </>
        ) : (
          '문의처가 아직 설정되지 않았습니다.'
        )}
      </p>
    </LegalLayout>
  );
}
