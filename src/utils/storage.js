export function readStoredOption(key, allowed, fallback) {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const value = window.localStorage.getItem(key);
  return allowed.includes(value) ? value : fallback;
}

export function readStoredPosition(key) {
  if (!key || typeof window === 'undefined') {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(key);
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue);
    if (!Number.isFinite(parsed?.x) || !Number.isFinite(parsed?.y)) {
      return null;
    }

    return {
      x: parsed.x,
      y: parsed.y,
    };
  } catch {
    return null;
  }
}

export function writeStoredPosition(key, position) {
  if (!key || typeof window === 'undefined') {
    return;
  }

  if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) {
    return;
  }

  window.localStorage.setItem(
    key,
    JSON.stringify({
      x: Math.round(position.x),
      y: Math.round(position.y),
    }),
  );
}

export function clearStoredPosition(key) {
  if (!key || typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(key);
}

export const ANONYMOUS_WORKSPACE_ID = 'anonymous';

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-atomfolio-workspace-id': options.workspaceId ?? ANONYMOUS_WORKSPACE_ID,
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error ?? `Request failed with status ${response.status}.`);
  }

  return payload;
}

export function getPortfolioWorkspaceId() {
  return ANONYMOUS_WORKSPACE_ID;
}

export async function listServerPortfolios(workspaceId = ANONYMOUS_WORKSPACE_ID) {
  return fetchJson('/api/portfolio', { workspaceId });
}

export async function createServerPortfolio(portfolio, workspaceId = ANONYMOUS_WORKSPACE_ID) {
  return fetchJson('/api/portfolio', {
    method: 'POST',
    workspaceId,
    body: JSON.stringify(portfolio ?? {}),
  });
}

export async function getServerPortfolio(portfolioId, workspaceId = ANONYMOUS_WORKSPACE_ID) {
  return fetchJson(`/api/portfolio/${encodeURIComponent(portfolioId)}`, { workspaceId });
}

export async function updateServerPortfolio(portfolioId, portfolio, workspaceId = ANONYMOUS_WORKSPACE_ID) {
  return fetchJson(`/api/portfolio/${encodeURIComponent(portfolioId)}`, {
    method: 'PUT',
    workspaceId,
    body: JSON.stringify(portfolio ?? {}),
  });
}

export async function deleteServerPortfolio(portfolioId, workspaceId = ANONYMOUS_WORKSPACE_ID) {
  return fetchJson(`/api/portfolio/${encodeURIComponent(portfolioId)}`, {
    method: 'DELETE',
    workspaceId,
  });
}

export async function listServerImportHistory(workspaceId = ANONYMOUS_WORKSPACE_ID) {
  return fetchJson('/api/portfolio/imports', { workspaceId });
}

export async function saveServerImportHistory(importRecord, workspaceId = ANONYMOUS_WORKSPACE_ID) {
  return fetchJson('/api/portfolio/imports', {
    method: 'POST',
    workspaceId,
    body: JSON.stringify(importRecord ?? {}),
  });
}
