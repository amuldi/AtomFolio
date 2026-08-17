// Privacy-friendly usage analytics — Plausible (https://plausible.io) specifically, since it's
// cookie-free and doesn't collect personally identifying information, matching what
// src/legal/PrivacyPolicy.jsx already tells users ("쿠키 없이 동작하는 분석 도구"). A
// self-hosted Plausible instance works too via VITE_PLAUSIBLE_SCRIPT_SRC.
//
// Purely opt-in: unset VITE_PLAUSIBLE_DOMAIN in dev/tests/preview by default, so this never fires
// without someone deliberately pointing it at a real domain — same fail-closed-by-missing-env-var
// pattern as CLERK_SECRET_KEY/DATABASE_URL in docs/production-readiness.md.
const PLAUSIBLE_DOMAIN = String(import.meta.env.VITE_PLAUSIBLE_DOMAIN ?? '').trim();
// A blank VITE_PLAUSIBLE_SCRIPT_SRC (the .env.example default) is a real empty string, not
// undefined — `||` here (not `??`) is what actually falls through to the plausible.io default.
const PLAUSIBLE_SCRIPT_SRC =
  String(import.meta.env.VITE_PLAUSIBLE_SCRIPT_SRC ?? '').trim() || 'https://plausible.io/js/script.js';

export function initAnalytics() {
  if (!PLAUSIBLE_DOMAIN || typeof document === 'undefined') {
    return;
  }

  // Guards against React StrictMode's double-invoked effects (or main.jsx re-running under Vite
  // HMR) injecting the same script tag twice.
  if (document.querySelector(`script[data-domain="${PLAUSIBLE_DOMAIN}"]`)) {
    return;
  }

  const script = document.createElement('script');
  script.defer = true;
  script.dataset.domain = PLAUSIBLE_DOMAIN;
  script.src = PLAUSIBLE_SCRIPT_SRC;
  document.head.appendChild(script);
}
