import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deletePostgresPortfolio,
  getPostgresImportRecord,
  getPostgresPortfolio,
  getPostgresStoreStatus,
  isPostgresStoreEnabled,
  listPostgresImportHistory,
  listPostgresPortfolios,
  upsertPostgresImportHistory,
  upsertPostgresPortfolio,
} from './postgresPortfolioStore.mjs';

export const DEFAULT_WORKSPACE_ID = 'anonymous';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const localDataPath = path.join(projectRoot, 'data', 'portfolio-store.json');
const requestedStoreDriver = String(process.env.ATOMFOLIO_STORE_DRIVER ?? '').trim().toLowerCase();
const useFileStore =
  requestedStoreDriver === 'file' ||
  (!isPostgresStoreEnabled() &&
    requestedStoreDriver !== 'memory' &&
    !process.env.VERCEL &&
    process.env.NODE_ENV !== 'production');

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

export function getPortfolioStoreStatus() {
  if (isPostgresStoreEnabled()) {
    return {
      driver: 'postgres',
      ...getPostgresStoreStatus(),
    };
  }

  return {
    driver: useFileStore ? 'file' : 'memory',
    databaseConfigured: false,
    autoMigrate: false,
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
  const safeWorkspaceId = cleanWorkspaceId(workspaceId);

  if (isPostgresStoreEnabled()) {
    return listPostgresPortfolios(safeWorkspaceId);
  }

  const store = await readStore();
  const resolved = ensureWorkspace(store, safeWorkspaceId);

  return {
    workspaceId: resolved.workspaceId,
    portfolios: safeArray(resolved.workspace.portfolios),
  };
}

export async function getPortfolio(workspaceId, portfolioId) {
  if (isPostgresStoreEnabled()) {
    return getPostgresPortfolio(cleanWorkspaceId(workspaceId), String(portfolioId ?? ''));
  }

  const { portfolios } = await listPortfolios(workspaceId);
  return portfolios.find((portfolio) => portfolio.id === String(portfolioId ?? '')) ?? null;
}

export async function createPortfolio(workspaceId, input) {
  const safeWorkspaceId = cleanWorkspaceId(workspaceId);
  const portfolio = sanitizePortfolio(input);

  if (isPostgresStoreEnabled()) {
    return upsertPostgresPortfolio(safeWorkspaceId, portfolio);
  }

  const store = await readStore();
  const resolved = ensureWorkspace(store, safeWorkspaceId);

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
  const safeWorkspaceId = cleanWorkspaceId(workspaceId);
  const portfolioIdString = String(portfolioId ?? '');

  if (isPostgresStoreEnabled()) {
    const existing = await getPostgresPortfolio(safeWorkspaceId, portfolioIdString);

    if (!existing) {
      return null;
    }

    const nextPortfolio = sanitizePortfolio({ ...input, id: portfolioIdString }, existing);
    return upsertPostgresPortfolio(safeWorkspaceId, nextPortfolio);
  }

  const store = await readStore();
  const resolved = ensureWorkspace(store, safeWorkspaceId);
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
  const safeWorkspaceId = cleanWorkspaceId(workspaceId);
  const portfolioIdString = String(portfolioId ?? '');

  if (isPostgresStoreEnabled()) {
    return deletePostgresPortfolio(safeWorkspaceId, portfolioIdString);
  }

  const store = await readStore();
  const resolved = ensureWorkspace(store, safeWorkspaceId);
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
  const safeWorkspaceId = cleanWorkspaceId(workspaceId);

  if (isPostgresStoreEnabled()) {
    return listPostgresImportHistory(safeWorkspaceId);
  }

  const store = await readStore();
  const resolved = ensureWorkspace(store, safeWorkspaceId);

  return {
    workspaceId: resolved.workspaceId,
    imports: safeArray(resolved.workspace.imports),
  };
}

export async function saveImportHistory(workspaceId, input) {
  const safeWorkspaceId = cleanWorkspaceId(workspaceId);
  let importRecord = sanitizeImportRecord(input);

  if (isPostgresStoreEnabled()) {
    const existing = importRecord.id
      ? await getPostgresImportRecord(safeWorkspaceId, importRecord.id)
      : null;
    importRecord = sanitizeImportRecord(input, existing);
    return upsertPostgresImportHistory(safeWorkspaceId, importRecord);
  }

  const store = await readStore();
  const resolved = ensureWorkspace(store, safeWorkspaceId);

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
