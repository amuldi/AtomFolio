// Reuses the existing AtomFolio HTTP API exactly as the web client does — same header-based
// workspace resolution as server/workspaceAccess.mjs's resolveWorkspaceId (x-atomfolio-workspace-id).
// No new auth: the desktop app operates as a guest-workspace client (see README's "connect" flow).
const WORKSPACE_HEADER = 'x-atomfolio-workspace-id';
const REQUEST_TIMEOUT_MS = 10000;

async function requestJson(baseUrl, pathname, { workspaceId, searchParams, method = 'GET', body } = {}) {
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

export function createApiClient({ apiBaseUrl, workspaceId }) {
  return {
    fetchPortfolios: () => requestJson(apiBaseUrl, '/api/portfolio', { workspaceId }),
    fetchPortfolio: (portfolioId) =>
      requestJson(apiBaseUrl, `/api/portfolio/${encodeURIComponent(portfolioId)}`, { workspaceId }),
    // PUT with the full portfolio document — the same call the web app's own edit flows make
    // (src/utils/storage.js's updateServerPortfolio) against this same
    // handlePortfolioItemRequest endpoint (server/apiHandlers.mjs). There's no narrower
    // single-item-create endpoint on the server; adding one is out of scope here (no new backend
    // work), so the quick-add flow that calls this (main.js) fetches the portfolio, appends the
    // new item client-side, and PUTs the whole thing back, exactly as the web does.
    updatePortfolio: (portfolioId, portfolio) =>
      requestJson(apiBaseUrl, `/api/portfolio/${encodeURIComponent(portfolioId)}`, {
        workspaceId,
        method: 'PUT',
        body: portfolio,
      }),
    fetchHoldingNews: (tickers = []) =>
      requestJson(apiBaseUrl, '/api/market/news', {
        workspaceId,
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
        searchParams: { mode: 'search', query },
      }),
  };
}
