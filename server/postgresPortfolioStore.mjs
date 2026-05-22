import { neon } from '@neondatabase/serverless';

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS atomfolio_workspaces (
    id text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
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
