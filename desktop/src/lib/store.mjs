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
  selectedPortfolioId: null,
  // Proactive-insight thresholds — personal trading preferences, kept local-only (never sent to
  // the server, unlike the portfolio data itself, which the user already trusts the backend with).
  notificationsEnabled: true,
  stopLossPercent: -10,
  takeProfitPercent: 20,
  allocationDriftPercent: 15,
  targetBucketWeights: { stock: 60, dividend: 15, goldCash: 15, reit: 5, other: 5 },
  // { [conditionKey]: lastFiredAtMs } — rate-limits repeat notifications for the same condition;
  // never sent to the server either.
  insightCooldowns: {},
  // The floating atom widget — a separate always-on-top window from the popover. Position is
  // null until the user actually moves it once; createAtomWidget() falls back to a sensible
  // default (primary display, top-right) rather than storing that default here.
  atomWidgetVisible: true,
  atomWidgetPosition: null,
  atomWidgetSize: null,
  // Window opacity — 1 is fully opaque. Clamped to a readable floor (see main.js) before ever
  // being applied, so this stored value alone can't make either window illegibly transparent.
  popoverOpacity: 1,
  widgetOpacity: 1,
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
