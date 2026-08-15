// Reuses the existing AtomFolio HTTP API exactly as the web client does — same header-based
// workspace resolution as server/workspaceAccess.mjs's resolveWorkspaceId (x-atomfolio-workspace-id).
//
// Two ways to connect, both reusing existing server-side auth exactly as-is (no new backend
// concept beyond server/deviceTokens.mjs's already-generic Bearer-token handling):
//   - A plain guest:<uuid> workspace ID — no auth, works with just the header, same as always.
//   - A device connection code (atomfolio_dt_...) generated from the web app's settings panel
//     while signed in — sent as `Authorization: Bearer <token>`, resolves server-side to that
//     account's own user:<id> workspace. This is what lets the desktop app follow a signed-in
///    account's data instead of only ever seeing a local/guest workspace.
const WORKSPACE_HEADER = 'x-atomfolio-workspace-id';
const REQUEST_TIMEOUT_MS = 10000;

async function requestJson(baseUrl, pathname, { workspaceId, deviceToken, searchParams, method = 'GET', body } = {}) {
  const url = new URL(pathname, baseUrl);

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        ...(workspaceId ? { [WORKSPACE_HEADER]: workspaceId } : {}),
        ...(deviceToken ? { Authorization: `Bearer ${deviceToken}` } : {}),
        // Only PUT/POST callers below pass a body — a plain GET (the common case) sends none of
        // this, matching what requestJson always sent before body support existed.
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`atomfolio-api-failed:${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

export function createApiClient({ apiBaseUrl, workspaceId, deviceToken }) {
  return {
    fetchPortfolios: () => requestJson(apiBaseUrl, '/api/portfolio', { workspaceId, deviceToken }),
    // Cheap poll target for the fast version-check loop (see main.js's startVersionPolling) — a
    // single indexed row lookup server-side (server/apiHandlers.mjs's handleWorkspaceVersionRequest),
    // not the full portfolio fetch above. `?version=1` (not a separate path) because
    // api/portfolio/[id].js already dynamically owns every other path under /api/portfolio/* —
    // see that file's own comment for why a query param was the only option here.
    fetchWorkspaceVersion: () =>
      requestJson(apiBaseUrl, '/api/portfolio', { workspaceId, deviceToken, searchParams: { version: '1' } }),
    fetchPortfolio: (portfolioId) =>
      requestJson(apiBaseUrl, `/api/portfolio/${encodeURIComponent(portfolioId)}`, { workspaceId, deviceToken }),
    // PUT with the full portfolio document — the same call the web app's own edit flows make
    // (src/utils/storage.js's updateServerPortfolio) against this same
    // handlePortfolioItemRequest endpoint (server/apiHandlers.mjs). There's no narrower
    // single-item-create endpoint on the server; adding one is out of scope here (no new backend
    // work), so the quick-add flow that calls this (main.js) fetches the portfolio, appends the
    // new item client-side, and PUTs the whole thing back, exactly as the web does.
    updatePortfolio: (portfolioId, portfolio) =>
      requestJson(apiBaseUrl, `/api/portfolio/${encodeURIComponent(portfolioId)}`, {
        workspaceId,
        deviceToken,
        method: 'PUT',
        body: portfolio,
      }),
    fetchHoldingNews: (tickers = []) =>
      requestJson(apiBaseUrl, '/api/market/news', {
        workspaceId,
        deviceToken,
        searchParams: {
          mode: 'today',
          tickers: tickers.slice(0, 5).join(','),
        },
      }),
    // mode: 'search' (vs. fetchHoldingNews's 'today') — free-text query instead of the connected
    // portfolio's own tickers. Same /api/market/news endpoint and mode param the web's news
    // search box sends (src/lib/marketNews.js's fetchMarketNews).
    searchNews: (query) =>
      requestJson(apiBaseUrl, '/api/market/news', {
        workspaceId,
        deviceToken,
        searchParams: { mode: 'search', query },
      }),
    // Only meaningful with a deviceToken — resolves it to the signed-in account's own workspace
    // id server-side (handleWorkspaceSessionRequest), so the caller never has to know/guess the
    // user:<id> shape itself.
    fetchWorkspaceSession: () => requestJson(apiBaseUrl, '/api/workspace/session', { workspaceId, deviceToken }),
  };
}
