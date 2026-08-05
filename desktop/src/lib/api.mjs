// Reuses the existing AtomFolio HTTP API exactly as the web client does — same header-based
// workspace resolution as server/workspaceAccess.mjs's resolveWorkspaceId (x-atomfolio-workspace-id).
// No new auth: the desktop app operates as a guest-workspace client (see README's "connect" flow).
const WORKSPACE_HEADER = 'x-atomfolio-workspace-id';
const REQUEST_TIMEOUT_MS = 10000;

async function requestJson(baseUrl, pathname, { workspaceId, searchParams } = {}) {
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
      signal: controller.signal,
      headers: workspaceId ? { [WORKSPACE_HEADER]: workspaceId } : {},
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
    fetchHoldingNews: (tickers = []) =>
      requestJson(apiBaseUrl, '/api/market/news', {
        workspaceId,
        searchParams: {
          mode: 'today',
          tickers: tickers.slice(0, 5).join(','),
        },
      }),
  };
}
