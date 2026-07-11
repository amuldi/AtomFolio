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
export const GUEST_WORKSPACE_PREFIX = 'guest:';

const PORTFOLIO_WORKSPACE_STORAGE_KEY = 'atomfolio-workspace-id';

function cleanWorkspaceId(value) {
  return String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]/g, '-')
    .slice(0, 80);
}

function createWorkspaceId() {
  const randomId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  return cleanWorkspaceId(`guest:${randomId}`);
}

export function getPortfolioWorkspaceId() {
  if (typeof window === 'undefined') {
    return ANONYMOUS_WORKSPACE_ID;
  }

  try {
    const storedWorkspaceId = cleanWorkspaceId(
      window.localStorage.getItem(PORTFOLIO_WORKSPACE_STORAGE_KEY),
    );

    if (storedWorkspaceId) {
      return storedWorkspaceId;
    }

    const nextWorkspaceId = createWorkspaceId();
    window.localStorage.setItem(PORTFOLIO_WORKSPACE_STORAGE_KEY, nextWorkspaceId);
    return nextWorkspaceId;
  } catch {
    return ANONYMOUS_WORKSPACE_ID;
  }
}

export function setPortfolioWorkspaceId(workspaceId) {
  if (typeof window === 'undefined') {
    return ANONYMOUS_WORKSPACE_ID;
  }

  const nextWorkspaceId = cleanWorkspaceId(workspaceId) || ANONYMOUS_WORKSPACE_ID;

  try {
    window.localStorage.setItem(PORTFOLIO_WORKSPACE_STORAGE_KEY, nextWorkspaceId);
  } catch {
    return ANONYMOUS_WORKSPACE_ID;
  }

  return nextWorkspaceId;
}

export function isGuestPortfolioWorkspaceId(workspaceId) {
  const safeWorkspaceId = cleanWorkspaceId(workspaceId);
  return safeWorkspaceId === ANONYMOUS_WORKSPACE_ID || safeWorkspaceId.startsWith(GUEST_WORKSPACE_PREFIX);
}

async function fetchJson(url, options = {}) {
  const workspaceId = options.workspaceId ?? getPortfolioWorkspaceId();
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-atomfolio-workspace-id': workspaceId,
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error ?? `Request failed with status ${response.status}.`);
  }

  return payload;
}

export async function listServerPortfolios(workspaceId = getPortfolioWorkspaceId()) {
  return fetchJson('/api/portfolio', { workspaceId });
}

export async function createServerPortfolio(portfolio, workspaceId = getPortfolioWorkspaceId()) {
  return fetchJson('/api/portfolio', {
    method: 'POST',
    workspaceId,
    body: JSON.stringify(portfolio ?? {}),
  });
}

export async function getServerPortfolio(portfolioId, workspaceId = getPortfolioWorkspaceId()) {
  return fetchJson(`/api/portfolio/${encodeURIComponent(portfolioId)}`, { workspaceId });
}

export async function updateServerPortfolio(portfolioId, portfolio, workspaceId = getPortfolioWorkspaceId()) {
  return fetchJson(`/api/portfolio/${encodeURIComponent(portfolioId)}`, {
    method: 'PUT',
    workspaceId,
    body: JSON.stringify(portfolio ?? {}),
  });
}

export async function deleteServerPortfolio(portfolioId, workspaceId = getPortfolioWorkspaceId()) {
  return fetchJson(`/api/portfolio/${encodeURIComponent(portfolioId)}`, {
    method: 'DELETE',
    workspaceId,
  });
}

export async function listServerImportHistory(workspaceId = getPortfolioWorkspaceId()) {
  return fetchJson('/api/portfolio/imports', { workspaceId });
}

export async function saveServerImportHistory(importRecord, workspaceId = getPortfolioWorkspaceId()) {
  return fetchJson('/api/portfolio/imports', {
    method: 'POST',
    workspaceId,
    body: JSON.stringify(importRecord ?? {}),
  });
}

export async function fetchWorkspaceSession(workspaceId = getPortfolioWorkspaceId()) {
  return fetchJson('/api/workspace/session', { workspaceId });
}

export async function claimGuestWorkspace({
  guestWorkspaceId = getPortfolioWorkspaceId(),
  targetWorkspaceId = '',
  removeGuest = false,
} = {}) {
  return fetchJson('/api/workspace/claim-guest', {
    method: 'POST',
    workspaceId: guestWorkspaceId,
    body: JSON.stringify({
      guestWorkspaceId,
      targetWorkspaceId,
      removeGuest,
    }),
  });
}
