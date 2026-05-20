import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_WORKSPACE_ID = 'anonymous';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const localDataPath = path.join(projectRoot, 'data', 'portfolio-store.json');
const useFileStore =
  process.env.ATOMFOLIO_STORE_DRIVER === 'file' ||
  (!process.env.VERCEL && process.env.NODE_ENV !== 'production');

const memoryStore = globalThis.__ATOMFOLIO_PORTFOLIO_STORE__ ?? {
  version: 1,
  workspaces: {},
};

globalThis.__ATOMFOLIO_PORTFOLIO_STORE__ = memoryStore;

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function cleanWorkspaceId(workspaceId) {
  const value = String(workspaceId ?? '').trim();
  if (!value) {
    return DEFAULT_WORKSPACE_ID;
  }

  return value
    .replace(/[^a-zA-Z0-9_.:-]/g, '-')
    .slice(0, 80) || DEFAULT_WORKSPACE_ID;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function sanitizePortfolio(input, existing = null) {
  const timestamp = nowIso();
  const id = String(input?.id ?? existing?.id ?? '').trim() || makeId('portfolio');
  const items = safeArray(input?.items);
  const timelineItems = safeArray(input?.timelineItems).length ? safeArray(input.timelineItems) : items;

  return {
    id,
    fileName: String(input?.fileName ?? existing?.fileName ?? 'portfolio.csv').trim() || 'portfolio.csv',
    items,
    timelineItems,
    parserDiagnostics: input?.parserDiagnostics ?? null,
    agentReview: input?.agentReview ?? null,
    ingestSource: String(input?.ingestSource ?? existing?.ingestSource ?? 'api').trim() || 'api',
    metadata: input?.metadata && typeof input.metadata === 'object' ? input.metadata : existing?.metadata ?? {},
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

function sanitizeImportRecord(input, existing = null) {
  const timestamp = nowIso();
  const id = String(input?.id ?? existing?.id ?? '').trim() || makeId('import');

  return {
    id,
    portfolioId: input?.portfolioId ? String(input.portfolioId) : existing?.portfolioId ?? null,
    fileName: String(input?.fileName ?? existing?.fileName ?? 'portfolio.csv').trim() || 'portfolio.csv',
    status: ['ok', 'needs-review', 'blocked', 'failed'].includes(input?.status)
      ? input.status
      : existing?.status ?? 'ok',
    itemCount: Number.isFinite(Number(input?.itemCount)) ? Number(input.itemCount) : existing?.itemCount ?? 0,
    securityCount: Number.isFinite(Number(input?.securityCount))
      ? Number(input.securityCount)
      : existing?.securityCount ?? 0,
    parserDiagnostics: input?.parserDiagnostics ?? existing?.parserDiagnostics ?? null,
    agentReview: input?.agentReview ?? existing?.agentReview ?? null,
    ingestSource: String(input?.ingestSource ?? existing?.ingestSource ?? 'api').trim() || 'api',
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

function createEmptyStore() {
  return {
    version: 1,
    workspaces: {},
  };
}

async function readStore() {
  if (!useFileStore) {
    return memoryStore;
  }

  try {
    if (!existsSync(localDataPath)) {
      return createEmptyStore();
    }

    const rawValue = await readFile(localDataPath, 'utf8');
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' ? parsed : createEmptyStore();
  } catch {
    return createEmptyStore();
  }
}

async function writeStore(store) {
  if (!useFileStore) {
    globalThis.__ATOMFOLIO_PORTFOLIO_STORE__ = store;
    return;
  }

  await mkdir(path.dirname(localDataPath), { recursive: true });
  await writeFile(localDataPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function ensureWorkspace(store, workspaceId) {
  const safeWorkspaceId = cleanWorkspaceId(workspaceId);

  if (!store.workspaces || typeof store.workspaces !== 'object') {
    store.workspaces = {};
  }

  if (!store.workspaces[safeWorkspaceId]) {
    store.workspaces[safeWorkspaceId] = {
      portfolios: [],
      imports: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }

  return {
    workspaceId: safeWorkspaceId,
    workspace: store.workspaces[safeWorkspaceId],
  };
}

export function resolveWorkspaceId(requestOrValue) {
  if (typeof requestOrValue === 'string') {
    return cleanWorkspaceId(requestOrValue);
  }

  const headers = requestOrValue?.headers ?? {};
  const headerWorkspaceId =
    typeof headers.get === 'function'
      ? headers.get('x-atomfolio-workspace-id')
      : headers['x-atomfolio-workspace-id'];
  const queryWorkspaceId = requestOrValue?.query?.workspaceId;

  return cleanWorkspaceId(headerWorkspaceId ?? queryWorkspaceId);
}

export async function listPortfolios(workspaceId) {
  const store = await readStore();
  const resolved = ensureWorkspace(store, workspaceId);

  return {
    workspaceId: resolved.workspaceId,
    portfolios: safeArray(resolved.workspace.portfolios),
  };
}

export async function getPortfolio(workspaceId, portfolioId) {
  const { portfolios } = await listPortfolios(workspaceId);
  return portfolios.find((portfolio) => portfolio.id === String(portfolioId ?? '')) ?? null;
}

export async function createPortfolio(workspaceId, input) {
  const store = await readStore();
  const resolved = ensureWorkspace(store, workspaceId);
  const portfolio = sanitizePortfolio(input);

  resolved.workspace.portfolios = [
    portfolio,
    ...safeArray(resolved.workspace.portfolios).filter((entry) => entry.id !== portfolio.id),
  ];
  resolved.workspace.updatedAt = nowIso();
  await writeStore(store);

  return {
    workspaceId: resolved.workspaceId,
    portfolio,
  };
}

export async function updatePortfolio(workspaceId, portfolioId, input) {
  const store = await readStore();
  const resolved = ensureWorkspace(store, workspaceId);
  const portfolioIdString = String(portfolioId ?? '');
  const currentPortfolios = safeArray(resolved.workspace.portfolios);
  const existing = currentPortfolios.find((entry) => entry.id === portfolioIdString);

  if (!existing) {
    return null;
  }

  const nextPortfolio = sanitizePortfolio({ ...input, id: portfolioIdString }, existing);
  resolved.workspace.portfolios = currentPortfolios.map((entry) =>
    entry.id === portfolioIdString ? nextPortfolio : entry,
  );
  resolved.workspace.updatedAt = nowIso();
  await writeStore(store);

  return {
    workspaceId: resolved.workspaceId,
    portfolio: nextPortfolio,
  };
}

export async function deletePortfolio(workspaceId, portfolioId) {
  const store = await readStore();
  const resolved = ensureWorkspace(store, workspaceId);
  const portfolioIdString = String(portfolioId ?? '');
  const beforeCount = safeArray(resolved.workspace.portfolios).length;

  resolved.workspace.portfolios = safeArray(resolved.workspace.portfolios).filter(
    (entry) => entry.id !== portfolioIdString,
  );

  if (resolved.workspace.portfolios.length === beforeCount) {
    return false;
  }

  resolved.workspace.updatedAt = nowIso();
  await writeStore(store);
  return true;
}

export async function listImportHistory(workspaceId) {
  const store = await readStore();
  const resolved = ensureWorkspace(store, workspaceId);

  return {
    workspaceId: resolved.workspaceId,
    imports: safeArray(resolved.workspace.imports),
  };
}

export async function saveImportHistory(workspaceId, input) {
  const store = await readStore();
  const resolved = ensureWorkspace(store, workspaceId);
  const importRecord = sanitizeImportRecord(input);

  resolved.workspace.imports = [
    importRecord,
    ...safeArray(resolved.workspace.imports).filter((entry) => entry.id !== importRecord.id),
  ].slice(0, 100);
  resolved.workspace.updatedAt = nowIso();
  await writeStore(store);

  return {
    workspaceId: resolved.workspaceId,
    importRecord,
  };
}
