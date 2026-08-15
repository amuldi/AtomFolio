import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  claimPostgresGuestWorkspace,
  deletePostgresPortfolio,
  ensurePostgresWorkspaceAccess,
  getPostgresImportRecord,
  getPostgresPortfolio,
  getPostgresStoreStatus,
  getPostgresWorkspaceVersion,
  isPostgresStoreEnabled,
  listPostgresAiAnalyses,
  listPostgresImportHistory,
  listPostgresPortfolios,
  upsertPostgresAiAnalysis,
  upsertPostgresImportHistory,
  upsertPostgresPortfolio,
} from './postgresPortfolioStore.mjs';

export const DEFAULT_WORKSPACE_ID = 'anonymous';
const GUEST_WORKSPACE_PREFIX = 'guest:';
const WORKSPACE_ROLE_RANK = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const localDataPath = process.env.ATOMFOLIO_LOCAL_DATA_PATH
  ? path.resolve(process.env.ATOMFOLIO_LOCAL_DATA_PATH)
  : path.join(projectRoot, 'data', 'portfolio-store.json');
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

function cleanUserId(userId) {
  return String(userId ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_.:@-]/g, '-')
    .slice(0, 120);
}

function cleanUserText(value, maxLength = 180) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function sanitizeUserContext(user) {
  const id = cleanUserId(user?.id);

  if (!id) {
    return null;
  }

  return {
    id,
    email: cleanUserText(user?.email, 254).toLowerCase() || null,
    displayName: cleanUserText(user?.displayName, 180) || null,
    authProvider: cleanUserText(user?.authProvider, 80) || null,
    authSubject: cleanUserText(user?.authSubject, 180) || id,
  };
}

export function isGuestWorkspaceId(workspaceId) {
  const safeWorkspaceId = cleanWorkspaceId(workspaceId);
  return safeWorkspaceId === DEFAULT_WORKSPACE_ID || safeWorkspaceId.startsWith(GUEST_WORKSPACE_PREFIX);
}

// Same "production" definition used by server/workspaceAccess.mjs's shouldTrustAuthHeaders() and
// server/productionReadiness.mjs's isProductionEnvironment() (duplicated rather than imported —
// productionReadiness.mjs already imports from this module, and importing back would create a
// cycle for a two-line check).
function isProductionEnvironment() {
  return process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
}

// A guest workspace's id IS its credential — nothing signs it, no cookie or session backs it up,
// whoever presents `guest:<id>` in the x-atomfolio-workspace-id header gets owner access to it
// (see ensureWorkspaceAccess below). That's fine as long as the id is actually unguessable: the
// client always creates it via crypto.randomUUID() (src/utils/storage.js's createWorkspaceId).
// This checks that a workspace id claiming to be a guest id in production actually has that
// shape, rather than trusting the guest:/anonymous prefix alone:
//   - the bare "anonymous" id is rejected — it's a single shared bucket every unauthenticated
//     visitor can already reach on day one, guessable by definition, so it's not a meaningful
//     per-user credential at all.
//   - "guest:<anything>" is only accepted when <anything> is a real UUID (what createWorkspaceId
//     actually generates), not an arbitrary short/guessable string an attacker could type.
// Outside production (local dev, tests) the looser historical behavior is kept on purpose so
// existing dev workflows and test fixtures using short ids like "guest:test-workspace" keep
// working — this is a production-only tightening, not a breaking change to the guest model.
const GUEST_WORKSPACE_UUID_PATTERN =
  /^guest:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isAcceptableGuestWorkspaceId(safeWorkspaceId) {
  if (!isGuestWorkspaceId(safeWorkspaceId)) {
    return false;
  }

  if (!isProductionEnvironment()) {
    return true;
  }

  return GUEST_WORKSPACE_UUID_PATTERN.test(safeWorkspaceId);
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

function sanitizeAiAnalysis(input, existing = null) {
  const timestamp = nowIso();
  const id = String(input?.id ?? existing?.id ?? '').trim() || makeId('analysis');

  return {
    id,
    portfolioId: input?.portfolioId ? String(input.portfolioId) : existing?.portfolioId ?? null,
    analysisType:
      String(input?.analysisType ?? existing?.analysisType ?? 'portfolio-summary').trim() ||
      'portfolio-summary',
    inputHash: String(input?.inputHash ?? existing?.inputHash ?? '').trim(),
    model: input?.model ? String(input.model) : existing?.model ?? null,
    status: ['ready', 'fallback', 'failed'].includes(input?.status)
      ? input.status
      : existing?.status ?? 'ready',
    inputSummary:
      input?.inputSummary && typeof input.inputSummary === 'object'
        ? input.inputSummary
        : existing?.inputSummary ?? {},
    result:
      input?.result && typeof input.result === 'object' ? input.result : existing?.result ?? {},
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

// Serializes every local-store read-modify-write cycle so concurrent requests can't read the
// same on-disk snapshot, mutate independently, and have the last writer silently drop the other's
// change. Postgres writes don't need this: each statement is its own atomic upsert.
let writeQueueTail = Promise.resolve();

function withLocalStoreTransaction(mutator) {
  const runTransaction = async () => {
    const store = await readStore();
    const { result, dirty } = await mutator(store);

    if (dirty) {
      await writeStore(store);
    }

    return result;
  };

  const scheduled = writeQueueTail.then(runTransaction, runTransaction);
  writeQueueTail = scheduled.then(
    () => undefined,
    () => undefined,
  );

  return scheduled;
}

function withLocalStoreWrite(mutator) {
  return withLocalStoreTransaction(async (store) => ({
    result: await mutator(store),
    dirty: true,
  }));
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
      analyses: [],
      members: [],
      userId: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }

  return {
    workspaceId: safeWorkspaceId,
    workspace: store.workspaces[safeWorkspaceId],
  };
}

function hasRequiredRole(role, requiredRole) {
  const actualRank = WORKSPACE_ROLE_RANK[role] ?? 0;
  const requiredRank = WORKSPACE_ROLE_RANK[requiredRole] ?? WORKSPACE_ROLE_RANK.viewer;
  return actualRank >= requiredRank;
}

function createAccessResult({
  ok,
  workspaceId,
  userId = null,
  role = null,
  mode = 'authenticated',
  statusCode = 200,
  code = 'workspace-access-ok',
  error = '',
}) {
  return {
    ok,
    workspaceId,
    userId,
    role,
    mode,
    statusCode,
    code,
    error,
  };
}

function roleFromWorkspace(workspace, userId) {
  if (!workspace || !userId) {
    return null;
  }

  if (workspace.userId === userId) {
    return 'owner';
  }

  const member = safeArray(workspace.members).find((entry) => entry?.userId === userId);
  return member?.role ?? null;
}

function claimFallbackWorkspace(workspace, user) {
  workspace.userId = user.id;
  workspace.members = [
    {
      userId: user.id,
      role: 'owner',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    ...safeArray(workspace.members).filter((entry) => entry?.userId !== user.id),
  ];
  workspace.updatedAt = nowIso();
}

function mergeWorkspaceRecords(targetRecords, sourceRecords) {
  const currentRecords = safeArray(targetRecords);
  const knownIds = new Set(currentRecords.map((entry) => String(entry?.id ?? '')).filter(Boolean));
  const copiedRecords = [];

  for (const record of safeArray(sourceRecords)) {
    const id = String(record?.id ?? '').trim();
    if (!id || knownIds.has(id)) {
      continue;
    }

    knownIds.add(id);
    copiedRecords.push(record);
  }

  return {
    records: [...copiedRecords, ...currentRecords],
    copiedCount: copiedRecords.length,
  };
}

export async function ensureWorkspaceAccess(workspaceId, userContext = null, { requiredRole = 'viewer' } = {}) {
  const safeWorkspaceId = cleanWorkspaceId(workspaceId);
  const user = sanitizeUserContext(userContext);

  if (!user) {
    if (isAcceptableGuestWorkspaceId(safeWorkspaceId)) {
      return createAccessResult({
        ok: true,
        workspaceId: safeWorkspaceId,
        role: 'owner',
        mode: 'guest',
      });
    }

    if (isGuestWorkspaceId(safeWorkspaceId)) {
      // Guest-shaped id (guest:* or "anonymous"), but rejected by the stricter production policy
      // above — a bare "anonymous" workspace or a non-UUID guest:* suffix. Treat this the same as
      // any other unauthenticated request for a workspace it can't prove ownership of, instead of
      // silently granting owner access to a guessable id.
      return createAccessResult({
        ok: false,
        workspaceId: safeWorkspaceId,
        mode: 'guest-rejected',
        statusCode: 401,
        code: 'guest-workspace-id-invalid',
        error: 'This guest workspace id is not accepted in production. Reload the app to get a new one.',
      });
    }

    return createAccessResult({
      ok: false,
      workspaceId: safeWorkspaceId,
      mode: 'unauthenticated',
      statusCode: 401,
      code: 'workspace-auth-required',
      error: 'Authentication is required for this workspace.',
    });
  }

  if (isPostgresStoreEnabled()) {
    const access = await ensurePostgresWorkspaceAccess(safeWorkspaceId, user);
    const role = access.role;

    if (!role) {
      return createAccessResult({
        ok: false,
        workspaceId: safeWorkspaceId,
        userId: user.id,
        mode: 'authenticated',
        statusCode: 403,
        code: 'workspace-access-denied',
        error: 'You do not have access to this workspace.',
      });
    }

    if (!hasRequiredRole(role, requiredRole)) {
      return createAccessResult({
        ok: false,
        workspaceId: safeWorkspaceId,
        userId: user.id,
        role,
        mode: 'authenticated',
        statusCode: 403,
        code: 'workspace-role-required',
        error: `Workspace role ${requiredRole} is required.`,
      });
    }

    return createAccessResult({
      ok: true,
      workspaceId: safeWorkspaceId,
      userId: user.id,
      role,
      mode: 'authenticated',
    });
  }

  const role = await withLocalStoreTransaction((store) => {
    const resolved = ensureWorkspace(store, safeWorkspaceId);
    const existingRole = roleFromWorkspace(resolved.workspace, user.id);
    const hasOwnerOrMembers =
      Boolean(resolved.workspace.userId) || safeArray(resolved.workspace.members).length > 0;

    if (!existingRole && !hasOwnerOrMembers) {
      claimFallbackWorkspace(resolved.workspace, user);
      return { result: 'owner', dirty: true };
    }

    return { result: existingRole, dirty: false };
  });

  if (!role) {
    return createAccessResult({
      ok: false,
      workspaceId: safeWorkspaceId,
      userId: user.id,
      mode: 'authenticated',
      statusCode: 403,
      code: 'workspace-access-denied',
      error: 'You do not have access to this workspace.',
    });
  }

  if (!hasRequiredRole(role, requiredRole)) {
    return createAccessResult({
      ok: false,
      workspaceId: safeWorkspaceId,
      userId: user.id,
      role,
      mode: 'authenticated',
      statusCode: 403,
      code: 'workspace-role-required',
      error: `Workspace role ${requiredRole} is required.`,
    });
  }

  return createAccessResult({
    ok: true,
    workspaceId: safeWorkspaceId,
    userId: user.id,
    role,
    mode: 'authenticated',
  });
}

export async function claimGuestWorkspaceForUser({
  guestWorkspaceId,
  targetWorkspaceId,
  user,
  removeGuest = false,
}) {
  const safeGuestWorkspaceId = cleanWorkspaceId(guestWorkspaceId);
  const safeTargetWorkspaceId = cleanWorkspaceId(targetWorkspaceId);
  const safeUser = sanitizeUserContext(user);

  if (!safeUser) {
    return {
      ok: false,
      statusCode: 401,
      code: 'workspace-auth-required',
      error: 'Authentication is required to claim a guest workspace.',
    };
  }

  if (!isGuestWorkspaceId(safeGuestWorkspaceId)) {
    return {
      ok: false,
      statusCode: 400,
      code: 'guest-workspace-required',
      error: 'A guest workspace id is required.',
    };
  }

  if (safeGuestWorkspaceId === safeTargetWorkspaceId) {
    return {
      ok: false,
      statusCode: 400,
      code: 'target-workspace-required',
      error: 'Target workspace must be different from the guest workspace.',
    };
  }

  const access = await ensureWorkspaceAccess(safeTargetWorkspaceId, safeUser, {
    requiredRole: 'editor',
  });

  if (!access.ok) {
    return access;
  }

  if (isPostgresStoreEnabled()) {
    const payload = await claimPostgresGuestWorkspace({
      guestWorkspaceId: safeGuestWorkspaceId,
      targetWorkspaceId: access.workspaceId,
      user: safeUser,
      removeGuest,
    });

    return {
      ok: true,
      ...payload,
    };
  }

  const claimResult = await withLocalStoreWrite((store) => {
    const sourceWorkspace = store.workspaces?.[safeGuestWorkspaceId] ?? null;
    const resolvedTarget = ensureWorkspace(store, access.workspaceId);

    if (!resolvedTarget.workspace.userId) {
      claimFallbackWorkspace(resolvedTarget.workspace, safeUser);
    }

    const portfolioMerge = mergeWorkspaceRecords(
      resolvedTarget.workspace.portfolios,
      sourceWorkspace?.portfolios,
    );
    const importMerge = mergeWorkspaceRecords(
      resolvedTarget.workspace.imports,
      sourceWorkspace?.imports,
    );
    const analysisMerge = mergeWorkspaceRecords(
      resolvedTarget.workspace.analyses,
      sourceWorkspace?.analyses,
    );

    resolvedTarget.workspace.portfolios = portfolioMerge.records;
    resolvedTarget.workspace.imports = importMerge.records.slice(0, 100);
    resolvedTarget.workspace.analyses = analysisMerge.records.slice(0, 200);
    resolvedTarget.workspace.updatedAt = nowIso();

    if (removeGuest && store.workspaces?.[safeGuestWorkspaceId]) {
      delete store.workspaces[safeGuestWorkspaceId];
    }

    return {
      targetWorkspaceId: resolvedTarget.workspaceId,
      copied: {
        portfolios: portfolioMerge.copiedCount,
        imports: importMerge.copiedCount,
        analyses: analysisMerge.copiedCount,
        snapshots: 0,
      },
    };
  });

  return {
    ok: true,
    guestWorkspaceId: safeGuestWorkspaceId,
    targetWorkspaceId: claimResult.targetWorkspaceId,
    copied: claimResult.copied,
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
  const allowQueryWorkspaceId =
    process.env.NODE_ENV !== 'production' ||
    process.env.VERCEL !== '1' ||
    process.env.ATOMFOLIO_ALLOW_QUERY_WORKSPACE_ID === 'true';
  const queryWorkspaceId = allowQueryWorkspaceId ? requestOrValue?.query?.workspaceId : null;

  return cleanWorkspaceId(headerWorkspaceId ?? queryWorkspaceId);
}

// A cheap "has anything changed since I last checked" signal for polling clients (the desktop
// widget in particular — see desktop/src/main.js's startVersionPolling) that would otherwise have
// to run the full listPortfolios (and everything a caller does with its result) just to find out
// nothing changed. Mirrors listPortfolios' own store-driver branch; the in-memory/file store's
// version is just workspace.updatedAt, already bumped on every mutation. Deliberately reads
// store.workspaces directly instead of going through ensureWorkspace (unlike listPortfolios
// above) — ensureWorkspace's auto-create-on-first-read would hand back a *freshly minted*
// updatedAt for a workspace that only exists because this very check just created it, and since
// that creation is never persisted back via saveStore, the next poll would recreate it all over
// again with yet another new timestamp — a workspace that's only ever been read (never written)
// would look like it changes on literally every poll. null here just means "nothing to compare
// against yet", which every caller already has to handle as the very first poll's baseline case.
export async function getWorkspaceVersion(workspaceId) {
  const safeWorkspaceId = cleanWorkspaceId(workspaceId);

  if (isPostgresStoreEnabled()) {
    return getPostgresWorkspaceVersion(safeWorkspaceId);
  }

  const store = await readStore();
  return store.workspaces?.[safeWorkspaceId]?.updatedAt ?? null;
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

  return withLocalStoreWrite((store) => {
    const resolved = ensureWorkspace(store, safeWorkspaceId);

    resolved.workspace.portfolios = [
      portfolio,
      ...safeArray(resolved.workspace.portfolios).filter((entry) => entry.id !== portfolio.id),
    ];
    resolved.workspace.updatedAt = nowIso();

    return {
      workspaceId: resolved.workspaceId,
      portfolio,
    };
  });
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

  return withLocalStoreTransaction((store) => {
    const resolved = ensureWorkspace(store, safeWorkspaceId);
    const currentPortfolios = safeArray(resolved.workspace.portfolios);
    const existing = currentPortfolios.find((entry) => entry.id === portfolioIdString);

    if (!existing) {
      return { result: null, dirty: false };
    }

    const nextPortfolio = sanitizePortfolio({ ...input, id: portfolioIdString }, existing);
    resolved.workspace.portfolios = currentPortfolios.map((entry) =>
      entry.id === portfolioIdString ? nextPortfolio : entry,
    );
    resolved.workspace.updatedAt = nowIso();

    return {
      result: {
        workspaceId: resolved.workspaceId,
        portfolio: nextPortfolio,
      },
      dirty: true,
    };
  });
}

export async function deletePortfolio(workspaceId, portfolioId) {
  const safeWorkspaceId = cleanWorkspaceId(workspaceId);
  const portfolioIdString = String(portfolioId ?? '');

  if (isPostgresStoreEnabled()) {
    return deletePostgresPortfolio(safeWorkspaceId, portfolioIdString);
  }

  return withLocalStoreTransaction((store) => {
    const resolved = ensureWorkspace(store, safeWorkspaceId);
    const beforeCount = safeArray(resolved.workspace.portfolios).length;
    const remainingPortfolios = safeArray(resolved.workspace.portfolios).filter(
      (entry) => entry.id !== portfolioIdString,
    );

    if (remainingPortfolios.length === beforeCount) {
      return { result: false, dirty: false };
    }

    resolved.workspace.portfolios = remainingPortfolios;
    resolved.workspace.updatedAt = nowIso();

    return { result: true, dirty: true };
  });
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

  return withLocalStoreWrite((store) => {
    const resolved = ensureWorkspace(store, safeWorkspaceId);

    resolved.workspace.imports = [
      importRecord,
      ...safeArray(resolved.workspace.imports).filter((entry) => entry.id !== importRecord.id),
    ].slice(0, 100);
    resolved.workspace.updatedAt = nowIso();

    return {
      workspaceId: resolved.workspaceId,
      importRecord,
    };
  });
}

export async function listAiAnalyses(workspaceId, filters = {}) {
  const safeWorkspaceId = cleanWorkspaceId(workspaceId);

  if (isPostgresStoreEnabled()) {
    return listPostgresAiAnalyses(safeWorkspaceId, filters);
  }

  const store = await readStore();
  const resolved = ensureWorkspace(store, safeWorkspaceId);
  const analyses = safeArray(resolved.workspace.analyses)
    .filter((analysis) => {
      if (filters.portfolioId && analysis.portfolioId !== filters.portfolioId) {
        return false;
      }
      if (filters.analysisType && analysis.analysisType !== filters.analysisType) {
        return false;
      }
      if (filters.inputHash && analysis.inputHash !== filters.inputHash) {
        return false;
      }
      return true;
    })
    .slice(0, Math.min(100, Math.max(1, Number(filters.limit) || 20)));

  return {
    workspaceId: resolved.workspaceId,
    analyses,
  };
}

export async function saveAiAnalysis(workspaceId, input) {
  const safeWorkspaceId = cleanWorkspaceId(workspaceId);
  let analysis = sanitizeAiAnalysis(input);

  if (isPostgresStoreEnabled()) {
    const { analyses } = await listPostgresAiAnalyses(safeWorkspaceId, {
      portfolioId: analysis.portfolioId,
      analysisType: analysis.analysisType,
      inputHash: analysis.inputHash,
      limit: 1,
    });
    analysis = sanitizeAiAnalysis(input, analyses[0] ?? null);
    return upsertPostgresAiAnalysis(safeWorkspaceId, analysis);
  }

  return withLocalStoreWrite((store) => {
    const resolved = ensureWorkspace(store, safeWorkspaceId);
    const existing = safeArray(resolved.workspace.analyses).find(
      (entry) =>
        entry.portfolioId === analysis.portfolioId &&
        entry.analysisType === analysis.analysisType &&
        entry.inputHash === analysis.inputHash,
    );

    analysis = sanitizeAiAnalysis(input, existing);
    resolved.workspace.analyses = [
      analysis,
      ...safeArray(resolved.workspace.analyses).filter((entry) => entry.id !== analysis.id),
    ].slice(0, 200);
    resolved.workspace.updatedAt = nowIso();

    return {
      workspaceId: resolved.workspaceId,
      analysis,
    };
  });
}
