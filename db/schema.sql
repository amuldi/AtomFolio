CREATE TABLE IF NOT EXISTS atomfolio_workspaces (
  id text PRIMARY KEY,
  user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS atomfolio_users (
  id text PRIMARY KEY,
  auth_provider text,
  auth_subject text,
  display_name text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE atomfolio_users
  ADD COLUMN IF NOT EXISTS auth_provider text;

ALTER TABLE atomfolio_users
  ADD COLUMN IF NOT EXISTS auth_subject text;

ALTER TABLE atomfolio_workspaces
  ADD COLUMN IF NOT EXISTS user_id text;

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

CREATE INDEX IF NOT EXISTS atomfolio_workspaces_user_idx
  ON atomfolio_workspaces (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS atomfolio_users_auth_subject_idx
  ON atomfolio_users (auth_provider, auth_subject)
  WHERE auth_provider IS NOT NULL AND auth_subject IS NOT NULL;

CREATE TABLE IF NOT EXISTS atomfolio_workspace_members (
  workspace_id text NOT NULL REFERENCES atomfolio_workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES atomfolio_users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  CHECK (role IN ('owner', 'editor', 'viewer'))
);

CREATE INDEX IF NOT EXISTS atomfolio_workspace_members_user_idx
  ON atomfolio_workspace_members (user_id, workspace_id);

CREATE TABLE IF NOT EXISTS atomfolio_ai_analyses (
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
);

CREATE INDEX IF NOT EXISTS atomfolio_ai_analyses_lookup_idx
  ON atomfolio_ai_analyses (workspace_id, portfolio_id, analysis_type, input_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS atomfolio_portfolio_snapshots (
  workspace_id text NOT NULL REFERENCES atomfolio_workspaces(id) ON DELETE CASCADE,
  portfolio_id text NOT NULL,
  snapshot_date date NOT NULL,
  source text NOT NULL DEFAULT 'daily-rollforward',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, portfolio_id, snapshot_date, source)
);

CREATE INDEX IF NOT EXISTS atomfolio_portfolio_snapshots_portfolio_idx
  ON atomfolio_portfolio_snapshots (workspace_id, portfolio_id, snapshot_date DESC);

-- Lets a non-browser client (the desktop menu bar app) act as a specific authenticated user
-- without a full OAuth flow — see server/deviceTokens.mjs. Only a SHA-256 hash of the token is
-- ever stored, never the token itself.
CREATE TABLE IF NOT EXISTS atomfolio_device_tokens (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES atomfolio_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS atomfolio_device_tokens_user_idx
  ON atomfolio_device_tokens (user_id);
