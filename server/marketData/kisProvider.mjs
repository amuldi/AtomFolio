// 한국투자증권(KIS, Korea Investment & Securities) Open API — server-only domestic-stock quote
// provider. KIS_APP_KEY/KIS_APP_SECRET never leave this process: read straight from process.env,
// only ever used to build outbound requests to KIS's own domain, never echoed into any response
// body or passed to a client-facing module — same boundary finnhubNews.mjs already holds for its
// own API key.
//
// Scope: REST current-price quotes only. KIS also offers a WebSocket push feed for real-time
// ticks, deliberately left out of this pass — polling via the cached REST endpoint (see
// server/marketDataCache.mjs, now a 5-15s TTL) gets accuracy to "good enough for a portfolio app
// refreshing every few seconds" without the much larger surface area of a persistent authenticated
// socket connection (reconnect/backoff handling, per-session subscription management, a process
// that has to stay alive between requests instead of this module's plain call-and-return shape).
// If real-time streaming ever becomes a real requirement, that's a separate module built on top of
// this one's token handling, not a rewrite of it.
//
// Endpoint paths, header names, and field names below are implemented from KIS's publicly
// documented Open API (apiportal.koreainvestment.com) as of this codebase's knowledge cutoff.
// Anywhere a specific value couldn't be confirmed with certainty is marked "문서 확인 필요" in a
// comment right next to it — implemented with the most commonly cited value so the code path is
// complete and testable, but flagged so whoever adds a real KIS_APP_KEY can verify against the
// live docs before depending on it in production.

const DEFAULT_BASE_URL = 'https://openapi.koreainvestment.com:9443';
const REQUEST_TIMEOUT_MS = 8000;
// KIS documents access tokens as valid for roughly 24 hours. Refreshing at 23h (not the full 24)
// leaves an hour of headroom so a token never expires mid-request on a server instance that's
// been running a while — same "don't cut it exactly at the deadline" reasoning as any token-cache
// pattern.
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_REFRESH_MARGIN_MS = 60 * 60 * 1000;

// Module-level, process-lifetime cache — one token shared by every request this server instance
// handles, not fetched per-call. globalThis-backed the same way marketDataCache.mjs and
// rateLimit.mjs already do it, so a dev-server hot-reload doesn't orphan a still-valid token and
// silently re-issue a fresh one for no reason.
const tokenState = globalThis.__ATOMFOLIO_KIS_TOKEN__ ?? { accessToken: '', issuedAt: 0 };
globalThis.__ATOMFOLIO_KIS_TOKEN__ = tokenState;

function getAppKey() {
  return String(process.env.KIS_APP_KEY ?? '').trim();
}

function getAppSecret() {
  return String(process.env.KIS_APP_SECRET ?? '').trim();
}

function getBaseUrl() {
  return String(process.env.KIS_APP_BASE_URL ?? '').trim() || DEFAULT_BASE_URL;
}

export function isKisConfigured() {
  return Boolean(getAppKey() && getAppSecret());
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortFromParent = () => controller.abort();
  options.signal?.addEventListener?.('abort', abortFromParent, { once: true });

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener?.('abort', abortFromParent);
  }
}

// POST /oauth2/tokenP — client-credentials style app-level token (not a per-user OAuth flow;
// appkey/appsecret alone are the credential, per KIS's own "앱 단위 발급" model). Endpoint path
// and request/response shape (grant_type/appkey/appsecret in, access_token/expires_in out) match
// KIS's documented "접근토큰발급" call. 문서 확인 필요: KIS's docs describe a same-day
// one-token-per-appkey issuance limit (re-requesting before expiry can return the same token
// rather than errouring) — not verified here since it doesn't change this function's behavior
// either way, just noted in case a real key ever surfaces unexpected 403s on rapid re-issuance
// during testing.
async function issueAccessToken(signal) {
  const appKey = getAppKey();
  const appSecret = getAppSecret();

  if (!appKey || !appSecret) {
    throw new Error('kis-not-configured');
  }

  const url = new URL('/oauth2/tokenP', getBaseUrl());
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: appKey,
      appsecret: appSecret,
    }),
  });

  if (!response.ok) {
    throw new Error(`kis-token-failed:${response.status}`);
  }

  const payload = await response.json();
  const accessToken = String(payload?.access_token ?? '').trim();

  if (!accessToken) {
    throw new Error('kis-token-empty');
  }

  tokenState.accessToken = accessToken;
  tokenState.issuedAt = Date.now();

  return accessToken;
}

async function getAccessToken(signal) {
  const age = Date.now() - tokenState.issuedAt;

  if (tokenState.accessToken && age < TOKEN_TTL_MS - TOKEN_REFRESH_MARGIN_MS) {
    return tokenState.accessToken;
  }

  return issueAccessToken(signal);
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

// Accepts either a bare 6-digit code or one already suffixed with .KS/.KQ (the same shape
// src/lib/liveMarketData.js's own candidates arrive in) — KIS's own FID_INPUT_ISCD wants just the
// 6-digit code, market/exchange isn't part of this call at all (KRX domestic covers both KOSPI and
// KOSDAQ under the same endpoint, distinguished by the code itself, not a query param).
function toKisStockCode(symbol) {
  const match = String(symbol ?? '')
    .trim()
    .toUpperCase()
    .match(/^(\d{6})(?:\.(?:KS|KQ))?$/);

  return match?.[1] ?? '';
}

// GET /uapi/domestic-stock/v1/quotations/inquire-price — "주식현재가 시세" (current price quote).
// FID_COND_MRKT_DIV_CODE=J selects the domestic-stock market division (KIS's docs use "J" for
// 주식/ETF/ETN under this endpoint, as opposed to other division codes this endpoint's siblings use
// for indices/futures). tr_id FHKST01010100 is the documented transaction id for this exact
// endpoint on 실전투자(production); 문서 확인 필요: 모의투자(paper-trading, KIS_APP_BASE_URL
// pointed at openapivts) commonly reuses the same tr_id for read-only quote lookups since they
// aren't account/order actions, but that specific claim isn't independently confirmed here — if a
// real paper-trading key ever gets 403s specifically on this call, that's the first thing to check
// against the live docs.
const DOMESTIC_QUOTE_TR_ID = 'FHKST01010100';

export async function fetchKisDomesticQuote(symbol, { signal } = {}) {
  if (!isKisConfigured()) {
    throw new Error('kis-not-configured');
  }

  const code = toKisStockCode(symbol);

  if (!code) {
    throw new Error('kis-symbol-not-domestic');
  }

  const accessToken = await getAccessToken(signal);
  const url = new URL('/uapi/domestic-stock/v1/quotations/inquire-price', getBaseUrl());
  url.searchParams.set('FID_COND_MRKT_DIV_CODE', 'J');
  url.searchParams.set('FID_INPUT_ISCD', code);

  const response = await fetchWithTimeout(url, {
    method: 'GET',
    signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
      appkey: getAppKey(),
      appsecret: getAppSecret(),
      tr_id: DOMESTIC_QUOTE_TR_ID,
      // 문서 확인 필요: KIS's docs list custtype (개인 P / 법인 B) as a header some endpoints
      // expect. Included as 'P' (individual) since every other header this call needs is
      // app-level, not account-level, and 'P' is the value every public sample request uses for
      // read-only market-data calls — but not independently confirmed against the current docs.
      custtype: 'P',
    },
  });

  if (!response.ok) {
    throw new Error(`kis-quote-failed:${response.status}`);
  }

  const payload = await response.json();

  // rt_cd '0' is KIS's documented "success" return code across all Open API endpoints, not just
  // this one — non-'0' means the HTTP call itself succeeded but the request was rejected
  // (bad code, market closed in a way that blocks the field, token issue, etc.).
  if (String(payload?.rt_cd ?? '') !== '0') {
    throw new Error(`kis-quote-rejected:${payload?.msg1 || payload?.msg_cd || 'unknown'}`);
  }

  const output = payload?.output ?? {};
  const latestPrice = toFiniteNumber(output.stck_prpr);

  if (!Number.isFinite(latestPrice)) {
    throw new Error('kis-quote-empty');
  }

  const change = toFiniteNumber(output.prdy_vrss);
  const changePercent = toFiniteNumber(output.prdy_ctrt);
  const previousClose =
    Number.isFinite(latestPrice) && Number.isFinite(change) ? latestPrice - change : null;

  return {
    symbol: code,
    // KIS's quote endpoint doesn't return the stock's display name in this particular response —
    // the caller (src/lib/liveMarketData.js) already has one from its own local security universe
    // / search-suggestion candidate, so name resolution stays there rather than being duplicated
    // here with a second, KIS-specific lookup call.
    latestPrice,
    previousClose,
    change,
    changePercent,
    currency: 'KRW',
    updatedAt: Date.now(),
    source: '한국투자증권',
  };
}

// Exposed for tests: lets a test reset the module-level token cache between cases instead of it
// leaking state across unrelated test files (the same globalThis-backed pattern
// resetMarketDataCache/resetRateLimitState already expose for their own module state).
export function resetKisTokenState() {
  tokenState.accessToken = '';
  tokenState.issuedAt = 0;
}
