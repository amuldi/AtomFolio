// Tiny JSON-file config store under Electron's standard per-app userData directory. No database,
// no external deps — this only ever holds a handful of fields (connection + poll bookkeeping).
import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const DEFAULTS = {
  workspaceId: null,
  apiBaseUrl: process.env.ATOMFOLIO_API_BASE_URL || 'https://atomfolio.vercel.app',
  pollIntervalSec: 60,
  lastSeenArticleIds: [],
};

const MAX_SEEN_IDS = 80;

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

export function loadConfig() {
  try {
    const raw = readFileSync(configPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(partial) {
  const next = { ...loadConfig(), ...partial };
  const dir = path.dirname(configPath());

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

export function rememberSeenArticleIds(config, newIds) {
  const merged = [...newIds, ...config.lastSeenArticleIds];
  const deduped = [...new Set(merged)].slice(0, MAX_SEEN_IDS);
  return saveConfig({ lastSeenArticleIds: deduped });
}
