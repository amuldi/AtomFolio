CREATE TABLE IF NOT EXISTS atomfolio_workspaces (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS atomfolio_portfolios (
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
);

CREATE TABLE IF NOT EXISTS atomfolio_imports (
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
);

CREATE INDEX IF NOT EXISTS atomfolio_portfolios_workspace_created_idx
  ON atomfolio_portfolios (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS atomfolio_imports_workspace_created_idx
  ON atomfolio_imports (workspace_id, created_at DESC);
