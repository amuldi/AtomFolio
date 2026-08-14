import { neon } from '@neondatabase/serverless';

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS atomfolio_users (
    id text PRIMARY KEY,
    auth_provider text,
    auth_subject text,
    display_name text,
    email text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE atomfolio_users
    ADD COLUMN IF NOT EXISTS auth_provider text`,
  `ALTER TABLE atomfolio_users
    ADD COLUMN IF NOT EXISTS auth_subject text`,
  `CREATE TABLE IF NOT EXISTS atomfolio_workspaces (
    id text PRIMARY KEY,
    user_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE atomfolio_workspaces
    ADD COLUMN IF NOT EXISTS user_id text`,
  `CREATE TABLE IF NOT EXISTS atomfolio_portfolios (
    workspace_id text NOT NULL REFERENCES atomfolio_workspaces(id) ON DELETE CASCADE,
    id text NOT NULL,
    file_name text NOT NULL,
    items jsonb NOT NULL DEFAULT '[]'::jsonb,
    timeline_items jsonb NOT NULL DEFAULT '[]'::jsonb,
    parser_diagnostics jsonb,
    agent_review jsonb,
    ingest_source text NOT NULL DEFAULT 'api',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, id)
  )`,
  `CREATE TABLE IF NOT EXISTS atomfolio_imports (
    workspace_id text NOT NULL REFERENCES atomfolio_workspaces(id) ON DELETE CASCADE,
    id text NOT NULL,
    portfolio_id text,
    file_name text NOT NULL,
    status text NOT NULL DEFAULT 'ok',
    item_count integer NOT NULL DEFAULT 0,
    security_count integer NOT NULL DEFAULT 0,
    parser_diagnostics jsonb,
    agent_review jsonb,
    ingest_source text NOT NULL DEFAULT 'api',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, id),
    CHECK (status IN ('ok', 'needs-review', 'blocked', 'failed'))
  )`,
  `CREATE INDEX IF NOT EXISTS atomfolio_portfolios_workspace_created_idx
    ON atomfolio_portfolios (workspace_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS atomfolio_imports_workspace_created_idx
    ON atomfolio_imports (workspace_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS atomfolio_workspaces_user_idx
    ON atomfolio_workspaces (user_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS atomfolio_users_auth_subject_idx
    ON atomfolio_users (auth_provider, auth_subject)
    WHERE auth_provider IS NOT NULL AND auth_subject IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS atomfolio_workspace_members (
    workspace_id text NOT NULL REFERENCES atomfolio_workspaces(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES atomfolio_users(id) ON DELETE CASCADE,
    role text NOT NULL DEFAULT 'owner',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id),
    CHECK (role IN ('owner', 'editor', 'viewer'))
  )`,
  `CREATE INDEX IF NOT EXISTS atomfolio_workspace_members_user_idx
    ON atomfolio_workspace_members (user_id, workspace_id)`,
  `CREATE TABLE IF NOT EXISTS atomfolio_ai_analyses (
    workspace_id text NOT NULL REFERENCES atomfolio_workspaces(id) ON DELETE CASCADE,
    id text NOT NULL,
    portfolio_id text,
    analysis_type text NOT NULL,
    input_hash text NOT NULL,
    model text,
    status text NOT NULL DEFAULT 'ready',
    input_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    result jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, id),
    CHECK (status IN ('ready', 'fallback', 'failed'))
  )`,
  `CREATE INDEX IF NOT EXISTS atomfolio_ai_analyses_lookup_idx
    ON atomfolio_ai_analyses (workspace_id, portfolio_id, analysis_type, input_hash, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS atomfolio_portfolio_snapshots (
    workspace_id text NOT NULL REFERENCES atomfolio_workspaces(id) ON DELETE CASCADE,
    portfolio_id text NOT NULL,
    snapshot_date date NOT NULL,
    source text NOT NULL DEFAULT 'daily-rollforward',
    items jsonb NOT NULL DEFAULT '[]'::jsonb,
    metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, portfolio_id, snapshot_date, source)
  )`,
  `CREATE INDEX IF NOT EXISTS atomfolio_portfolio_snapshots_portfolio_idx
    ON atomfolio_portfolio_snapshots (workspace_id, portfolio_id, snapshot_date DESC)`,
  // Broker credentials (KIS first; broker is a free-text column so more can be added without a
  // migration). encrypted_payload is one AES-256-GCM blob (iv + authTag + ciphertext, see
  // secretCrypto.mjs) holding the whole secret bundle for that broker — app key/secret and, once
  // KIS issues one, the access token. Expiry and status stay in plaintext columns on purpose:
  // checking "is this token still valid" shouldn't require a decrypt.
  `CREATE TABLE IF NOT EXISTS atomfolio_broker_credentials (
    workspace_id text NOT NULL REFERENCES atomfolio_workspaces(id) ON DELETE CASCADE,
    broker text NOT NULL,
    encrypted_payload bytea NOT NULL,
    status text NOT NULL DEFAULT 'connected',
    last_error text,
    access_token_expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, broker),
    CHECK (status IN ('connected', 'expired', 'error'))
  )`,
  // Lets a non-browser client (the desktop menu bar app) act as a specific authenticated user
  // without running a full OAuth flow — see server/deviceTokens.mjs. Only a SHA-256 hash of the
  // token is ever stored, never the token itself, the same "don't keep a recoverable copy of the
  // secret" principle atomfolio_broker_credentials follows via encryption instead of hashing
  // (hashing here because nothing ever needs to recover the original token, only compare against
  // it).
  `CREATE TABLE IF NOT EXISTS atomfolio_device_tokens (
    token_hash text PRIMARY KEY,
    user_id text NOT NULL REFERENCES atomfolio_users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz
  )`,
  `CREATE INDEX IF NOT EXISTS atomfolio_device_tokens_user_idx
    ON atomfolio_device_tokens (user_id)`,
];

let sqlClient = null;
let schemaReadyPromise = null;

function getRequestedStoreDriver() {
  return String(process.env.ATOMFOLIO_STORE_DRIVER ?? '').trim().toLowerCase();
}

export function getPostgresDatabaseUrl() {
  return String(
    process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      process.env.POSTGRES_PRISMA_URL ??
      process.env.POSTGRES_URL_NON_POOLING ??
      '',
  ).trim();
}

export function isPostgresStoreEnabled() {
  const requestedStoreDriver = getRequestedStoreDriver();

  if (requestedStoreDriver === 'postgres') {
    return true;
  }

  if (requestedStoreDriver === 'file' || requestedStoreDriver === 'memory') {
    return false;
  }

  return Boolean(getPostgresDatabaseUrl());
}

export function getPostgresStoreStatus() {
  return {
    databaseConfigured: Boolean(getPostgresDatabaseUrl()),
    autoMigrate: process.env.ATOMFOLIO_DB_AUTO_MIGRATE !== 'false',
  };
}

function getSqlClient() {
  const databaseUrl = getPostgresDatabaseUrl();

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required when ATOMFOLIO_STORE_DRIVER=postgres.');
  }

  if (!sqlClient) {
    sqlClient = neon(databaseUrl);
  }

  return sqlClient;
}

export async function ensurePostgresSchema({ force = false } = {}) {
  if (!force && process.env.ATOMFOLIO_DB_AUTO_MIGRATE === 'false') {
    return;
  }

  if (!schemaReadyPromise) {
    const sql = getSqlClient();
    schemaReadyPromise = (async () => {
      for (const statement of SCHEMA_STATEMENTS) {
        await sql.query(statement);
      }
    })();
  }

  await schemaReadyPromise;
}

async function query(text, params = []) {
  await ensurePostgresSchema();
  return getSqlClient().query(text, params);
}

async function touchWorkspace(workspaceId) {
  await query(
    `INSERT INTO atomfolio_workspaces (id, created_at, updated_at)
     VALUES ($1, now(), now())
     ON CONFLICT (id) DO UPDATE SET updated_at = now()`,
    [workspaceId],
  );
}

function parseJsonValue(value, fallback) {
  if (value == null) {
    return fallback;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  return value;
}

function toIsoString(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }

  return new Date().toISOString();
}

function portfolioFromRow(row) {
  return {
    id: String(row.id),
    fileName: String(row.file_name ?? 'portfolio.csv'),
    items: parseJsonValue(row.items, []),
    timelineItems: parseJsonValue(row.timeline_items, []),
    parserDiagnostics: parseJsonValue(row.parser_diagnostics, null),
    agentReview: parseJsonValue(row.agent_review, null),
    ingestSource: String(row.ingest_source ?? 'api'),
    metadata: parseJsonValue(row.metadata, {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function importRecordFromRow(row) {
  return {
    id: String(row.id),
    portfolioId: row.portfolio_id ? String(row.portfolio_id) : null,
    fileName: String(row.file_name ?? 'portfolio.csv'),
    status: String(row.status ?? 'ok'),
    itemCount: Number(row.item_count ?? 0),
    securityCount: Number(row.security_count ?? 0),
    parserDiagnostics: parseJsonValue(row.parser_diagnostics, null),
    agentReview: parseJsonValue(row.agent_review, null),
    ingestSource: String(row.ingest_source ?? 'api'),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function aiAnalysisFromRow(row) {
  return {
    id: String(row.id),
    portfolioId: row.portfolio_id ? String(row.portfolio_id) : null,
    analysisType: String(row.analysis_type ?? 'portfolio-summary'),
    inputHash: String(row.input_hash ?? ''),
    model: row.model ? String(row.model) : null,
    status: String(row.status ?? 'ready'),
    inputSummary: parseJsonValue(row.input_summary, {}),
    result: parseJsonValue(row.result, {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function cleanNullableText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function workspaceAccessFromRow(workspace, member = null) {
  return {
    exists: Boolean(workspace),
    workspaceId: workspace ? String(workspace.id) : null,
    ownerId: workspace?.user_id ? String(workspace.user_id) : null,
    role: member?.role ? String(member.role) : null,
    createdAt: workspace?.created_at ? toIsoString(workspace.created_at) : null,
    updatedAt: workspace?.updated_at ? toIsoString(workspace.updated_at) : null,
  };
}

export async function ensurePostgresUser(user) {
  if (!user?.id) {
    return null;
  }

  const rows = await query(
    `INSERT INTO atomfolio_users (
       id,
       auth_provider,
       auth_subject,
       display_name,
       email,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, now(), now())
     ON CONFLICT (id) DO UPDATE SET
       auth_provider = COALESCE(EXCLUDED.auth_provider, atomfolio_users.auth_provider),
       auth_subject = COALESCE(EXCLUDED.auth_subject, atomfolio_users.auth_subject),
       display_name = COALESCE(EXCLUDED.display_name, atomfolio_users.display_name),
       email = COALESCE(EXCLUDED.email, atomfolio_users.email),
       updated_at = now()
     RETURNING *`,
    [
      user.id,
      cleanNullableText(user.authProvider),
      cleanNullableText(user.authSubject),
      cleanNullableText(user.displayName),
      cleanNullableText(user.email),
    ],
  );

  return rows[0] ?? null;
}

export async function getPostgresWorkspaceAccess(workspaceId, userId = '') {
  const workspaceRows = await query(
    `SELECT *
     FROM atomfolio_workspaces
     WHERE id = $1
     LIMIT 1`,
    [workspaceId],
  );
  const workspace = workspaceRows[0] ?? null;

  if (!workspace || !userId) {
    return workspaceAccessFromRow(workspace);
  }

  if (workspace.user_id === userId) {
    return workspaceAccessFromRow(workspace, { role: 'owner' });
  }

  const memberRows = await query(
    `SELECT role
     FROM atomfolio_workspace_members
     WHERE workspace_id = $1 AND user_id = $2
     LIMIT 1`,
    [workspaceId, userId],
  );

  return workspaceAccessFromRow(workspace, memberRows[0] ?? null);
}

async function upsertPostgresWorkspaceMember(workspaceId, userId, role) {
  await query(
    `INSERT INTO atomfolio_workspace_members (
       workspace_id,
       user_id,
       role,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, now(), now())
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET
       role = EXCLUDED.role,
       updated_at = now()`,
    [workspaceId, userId, role],
  );
}

export async function ensurePostgresWorkspaceAccess(workspaceId, user) {
  if (!user?.id) {
    return getPostgresWorkspaceAccess(workspaceId);
  }

  await ensurePostgresUser(user);

  const workspaceRows = await query(
    `SELECT *
     FROM atomfolio_workspaces
     WHERE id = $1
     LIMIT 1`,
    [workspaceId],
  );
  const workspace = workspaceRows[0] ?? null;

  if (!workspace) {
    const insertedRows = await query(
      `INSERT INTO atomfolio_workspaces (id, user_id, created_at, updated_at)
       VALUES ($1, $2, now(), now())
       RETURNING *`,
      [workspaceId, user.id],
    );
    await upsertPostgresWorkspaceMember(workspaceId, user.id, 'owner');
    return workspaceAccessFromRow(insertedRows[0], { role: 'owner' });
  }

  if (workspace.user_id === user.id) {
    await upsertPostgresWorkspaceMember(workspaceId, user.id, 'owner');
    return workspaceAccessFromRow(workspace, { role: 'owner' });
  }

  const memberRows = await query(
    `SELECT role
     FROM atomfolio_workspace_members
     WHERE workspace_id = $1 AND user_id = $2
     LIMIT 1`,
    [workspaceId, user.id],
  );

  if (memberRows[0]) {
    return workspaceAccessFromRow(workspace, memberRows[0]);
  }

  if (!workspace.user_id) {
    const claimedRows = await query(
      `UPDATE atomfolio_workspaces
       SET user_id = $2, updated_at = now()
       WHERE id = $1 AND user_id IS NULL
       RETURNING *`,
      [workspaceId, user.id],
    );

    if (claimedRows[0]) {
      await upsertPostgresWorkspaceMember(workspaceId, user.id, 'owner');
      return workspaceAccessFromRow(claimedRows[0], { role: 'owner' });
    }
  }

  return workspaceAccessFromRow(workspace);
}

export async function listPostgresPortfolios(workspaceId) {
  const rows = await query(
    `SELECT *
     FROM atomfolio_portfolios
     WHERE workspace_id = $1
     ORDER BY created_at DESC, id ASC`,
    [workspaceId],
  );

  return {
    workspaceId,
    portfolios: rows.map(portfolioFromRow),
  };
}

export async function getPostgresPortfolio(workspaceId, portfolioId) {
  const rows = await query(
    `SELECT *
     FROM atomfolio_portfolios
     WHERE workspace_id = $1 AND id = $2
     LIMIT 1`,
    [workspaceId, portfolioId],
  );

  return rows[0] ? portfolioFromRow(rows[0]) : null;
}

export async function upsertPostgresPortfolio(workspaceId, portfolio) {
  await touchWorkspace(workspaceId);

  const rows = await query(
    `INSERT INTO atomfolio_portfolios (
       workspace_id,
       id,
       file_name,
       items,
       timeline_items,
       parser_diagnostics,
       agent_review,
       ingest_source,
       metadata,
       created_at,
       updated_at
     )
     VALUES (
       $1,
       $2,
       $3,
       $4::jsonb,
       $5::jsonb,
       $6::jsonb,
       $7::jsonb,
       $8,
       $9::jsonb,
       $10::timestamptz,
       $11::timestamptz
     )
     ON CONFLICT (workspace_id, id) DO UPDATE SET
       file_name = EXCLUDED.file_name,
       items = EXCLUDED.items,
       timeline_items = EXCLUDED.timeline_items,
       parser_diagnostics = EXCLUDED.parser_diagnostics,
       agent_review = EXCLUDED.agent_review,
       ingest_source = EXCLUDED.ingest_source,
       metadata = EXCLUDED.metadata,
       updated_at = EXCLUDED.updated_at
     RETURNING *`,
    [
      workspaceId,
      portfolio.id,
      portfolio.fileName,
      JSON.stringify(portfolio.items ?? []),
      JSON.stringify(portfolio.timelineItems ?? []),
      portfolio.parserDiagnostics == null ? null : JSON.stringify(portfolio.parserDiagnostics),
      portfolio.agentReview == null ? null : JSON.stringify(portfolio.agentReview),
      portfolio.ingestSource,
      JSON.stringify(portfolio.metadata ?? {}),
      portfolio.createdAt,
      portfolio.updatedAt,
    ],
  );

  return {
    workspaceId,
    portfolio: portfolioFromRow(rows[0]),
  };
}

export async function deletePostgresPortfolio(workspaceId, portfolioId) {
  const rows = await query(
    `DELETE FROM atomfolio_portfolios
     WHERE workspace_id = $1 AND id = $2
     RETURNING id`,
    [workspaceId, portfolioId],
  );

  if (!rows.length) {
    return false;
  }

  await touchWorkspace(workspaceId);
  return true;
}

export async function listPostgresImportHistory(workspaceId) {
  const rows = await query(
    `SELECT *
     FROM atomfolio_imports
     WHERE workspace_id = $1
     ORDER BY created_at DESC, id ASC`,
    [workspaceId],
  );

  return {
    workspaceId,
    imports: rows.map(importRecordFromRow),
  };
}

export async function getPostgresImportRecord(workspaceId, importRecordId) {
  const rows = await query(
    `SELECT *
     FROM atomfolio_imports
     WHERE workspace_id = $1 AND id = $2
     LIMIT 1`,
    [workspaceId, importRecordId],
  );

  return rows[0] ? importRecordFromRow(rows[0]) : null;
}

export async function upsertPostgresImportHistory(workspaceId, importRecord) {
  await touchWorkspace(workspaceId);

  const rows = await query(
    `INSERT INTO atomfolio_imports (
       workspace_id,
       id,
       portfolio_id,
       file_name,
       status,
       item_count,
       security_count,
       parser_diagnostics,
       agent_review,
       ingest_source,
       created_at,
       updated_at
     )
     VALUES (
       $1,
       $2,
       $3,
       $4,
       $5,
       $6,
       $7,
       $8::jsonb,
       $9::jsonb,
       $10,
       $11::timestamptz,
       $12::timestamptz
     )
     ON CONFLICT (workspace_id, id) DO UPDATE SET
       portfolio_id = EXCLUDED.portfolio_id,
       file_name = EXCLUDED.file_name,
       status = EXCLUDED.status,
       item_count = EXCLUDED.item_count,
       security_count = EXCLUDED.security_count,
       parser_diagnostics = EXCLUDED.parser_diagnostics,
       agent_review = EXCLUDED.agent_review,
       ingest_source = EXCLUDED.ingest_source,
       updated_at = EXCLUDED.updated_at
     RETURNING *`,
    [
      workspaceId,
      importRecord.id,
      importRecord.portfolioId,
      importRecord.fileName,
      importRecord.status,
      importRecord.itemCount,
      importRecord.securityCount,
      importRecord.parserDiagnostics == null ? null : JSON.stringify(importRecord.parserDiagnostics),
      importRecord.agentReview == null ? null : JSON.stringify(importRecord.agentReview),
      importRecord.ingestSource,
      importRecord.createdAt,
      importRecord.updatedAt,
    ],
  );

  await query(
    `DELETE FROM atomfolio_imports
     WHERE workspace_id = $1
       AND id NOT IN (
         SELECT id
         FROM atomfolio_imports
         WHERE workspace_id = $1
         ORDER BY created_at DESC, id ASC
         LIMIT 100
       )`,
    [workspaceId],
  );

  return {
    workspaceId,
    importRecord: importRecordFromRow(rows[0]),
  };
}

export async function listPostgresAiAnalyses(
  workspaceId,
  { portfolioId = '', analysisType = '', inputHash = '', limit = 20 } = {},
) {
  const clauses = ['workspace_id = $1'];
  const params = [workspaceId];

  if (portfolioId) {
    params.push(portfolioId);
    clauses.push(`portfolio_id = $${params.length}`);
  }

  if (analysisType) {
    params.push(analysisType);
    clauses.push(`analysis_type = $${params.length}`);
  }

  if (inputHash) {
    params.push(inputHash);
    clauses.push(`input_hash = $${params.length}`);
  }

  params.push(Math.min(100, Math.max(1, Number(limit) || 20)));

  const rows = await query(
    `SELECT *
     FROM atomfolio_ai_analyses
     WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC, id ASC
     LIMIT $${params.length}`,
    params,
  );

  return {
    workspaceId,
    analyses: rows.map(aiAnalysisFromRow),
  };
}

export async function upsertPostgresAiAnalysis(workspaceId, analysis) {
  await touchWorkspace(workspaceId);

  const rows = await query(
    `INSERT INTO atomfolio_ai_analyses (
       workspace_id,
       id,
       portfolio_id,
       analysis_type,
       input_hash,
       model,
       status,
       input_summary,
       result,
       created_at,
       updated_at
     )
     VALUES (
       $1,
       $2,
       $3,
       $4,
       $5,
       $6,
       $7,
       $8::jsonb,
       $9::jsonb,
       $10::timestamptz,
       $11::timestamptz
     )
     ON CONFLICT (workspace_id, id) DO UPDATE SET
       portfolio_id = EXCLUDED.portfolio_id,
       analysis_type = EXCLUDED.analysis_type,
       input_hash = EXCLUDED.input_hash,
       model = EXCLUDED.model,
       status = EXCLUDED.status,
       input_summary = EXCLUDED.input_summary,
       result = EXCLUDED.result,
       updated_at = EXCLUDED.updated_at
     RETURNING *`,
    [
      workspaceId,
      analysis.id,
      analysis.portfolioId,
      analysis.analysisType,
      analysis.inputHash,
      analysis.model,
      analysis.status,
      JSON.stringify(analysis.inputSummary ?? {}),
      JSON.stringify(analysis.result ?? {}),
      analysis.createdAt,
      analysis.updatedAt,
    ],
  );

  return {
    workspaceId,
    analysis: aiAnalysisFromRow(rows[0]),
  };
}

async function copyPostgresRows({ tableName, columns, sourceWorkspaceId, targetWorkspaceId }) {
  const columnList = columns.join(', ');
  const selectColumnList = columns.map((column) => (column === 'workspace_id' ? '$2' : column)).join(', ');
  const conflictTarget =
    tableName === 'atomfolio_portfolio_snapshots'
      ? '(workspace_id, portfolio_id, snapshot_date, source)'
      : '(workspace_id, id)';

  const rows = await query(
    `INSERT INTO ${tableName} (${columnList})
     SELECT ${selectColumnList}
     FROM ${tableName}
     WHERE workspace_id = $1
     ON CONFLICT ${conflictTarget} DO NOTHING
     RETURNING 1`,
    [sourceWorkspaceId, targetWorkspaceId],
  );

  return rows.length;
}

export async function claimPostgresGuestWorkspace({
  guestWorkspaceId,
  targetWorkspaceId,
  user,
  removeGuest = false,
}) {
  await ensurePostgresWorkspaceAccess(targetWorkspaceId, user);

  const copied = {
    portfolios: await copyPostgresRows({
      tableName: 'atomfolio_portfolios',
      columns: [
        'workspace_id',
        'id',
        'file_name',
        'items',
        'timeline_items',
        'parser_diagnostics',
        'agent_review',
        'ingest_source',
        'metadata',
        'created_at',
        'updated_at',
      ],
      sourceWorkspaceId: guestWorkspaceId,
      targetWorkspaceId,
    }),
    imports: await copyPostgresRows({
      tableName: 'atomfolio_imports',
      columns: [
        'workspace_id',
        'id',
        'portfolio_id',
        'file_name',
        'status',
        'item_count',
        'security_count',
        'parser_diagnostics',
        'agent_review',
        'ingest_source',
        'created_at',
        'updated_at',
      ],
      sourceWorkspaceId: guestWorkspaceId,
      targetWorkspaceId,
    }),
    analyses: await copyPostgresRows({
      tableName: 'atomfolio_ai_analyses',
      columns: [
        'workspace_id',
        'id',
        'portfolio_id',
        'analysis_type',
        'input_hash',
        'model',
        'status',
        'input_summary',
        'result',
        'created_at',
        'updated_at',
      ],
      sourceWorkspaceId: guestWorkspaceId,
      targetWorkspaceId,
    }),
    snapshots: await copyPostgresRows({
      tableName: 'atomfolio_portfolio_snapshots',
      columns: [
        'workspace_id',
        'portfolio_id',
        'snapshot_date',
        'source',
        'items',
        'metrics',
        'created_at',
      ],
      sourceWorkspaceId: guestWorkspaceId,
      targetWorkspaceId,
    }),
  };

  if (removeGuest) {
    await query(
      `DELETE FROM atomfolio_workspaces
       WHERE id = $1`,
      [guestWorkspaceId],
    );
  }

  await touchWorkspace(targetWorkspaceId);

  return {
    guestWorkspaceId,
    targetWorkspaceId,
    copied,
  };
}

export async function createPostgresDeviceToken(userId, tokenHash) {
  await query(
    `INSERT INTO atomfolio_device_tokens (token_hash, user_id, created_at)
     VALUES ($1, $2, now())`,
    [tokenHash, userId],
  );
}

// Returns the owning userId and bumps last_used_at in one round trip, or null when the hash isn't
// (or is no longer) valid — a revoked/regenerated token simply isn't in the table anymore.
export async function verifyPostgresDeviceToken(tokenHash) {
  const rows = await query(
    `UPDATE atomfolio_device_tokens
     SET last_used_at = now()
     WHERE token_hash = $1
     RETURNING user_id`,
    [tokenHash],
  );

  return rows[0]?.user_id ? String(rows[0].user_id) : null;
}

// A user only ever has one live device token at a time (see deviceTokens.mjs) — issuing a new one
// revokes whatever came before, and this is also the standalone "disconnect all desktop devices"
// action.
export async function revokePostgresDeviceTokensForUser(userId) {
  const rows = await query(
    `DELETE FROM atomfolio_device_tokens
     WHERE user_id = $1
     RETURNING token_hash`,
    [userId],
  );

  return rows.length;
}
