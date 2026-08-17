// Shared shell for the standalone legal pages (TermsOfService/PrivacyPolicy) — rendered by
// main.jsx based on window.location.pathname, not through a router (this app has none, and
// adding react-router for two static pages would be a heavier dependency than the problem calls
// for). Deliberately plain — no atom mark, no amber accent, no glow-title treatment. Both were
// tried here and asked to come back out; keep this page reading as plain cream-on-black prose in
// the app's own card style, not a re-skinned version of the atom stage itself.
import './legal.css';

export function LegalLayout({ title, updated, children }) {
  return (
    <div className="legal-page">
      <div className="legal-page__inner">
        <header className="legal-page__header">
          <a className="legal-page__back" href="/">
            <span className="legal-page__back-arrow" aria-hidden="true">
              ←
            </span>
            AtomFolio로 돌아가기
          </a>
          <h1 className="legal-page__title">{title}</h1>
          <p className="legal-page__updated">시행일 {updated}</p>
        </header>

        <div className="legal-page__card">
          <div className="legal-page__body">{children}</div>
        </div>
      </div>
    </div>
  );
}
