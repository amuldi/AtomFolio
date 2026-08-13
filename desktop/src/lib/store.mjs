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
  // Whether AtomFolio is registered as a macOS Login Item (System Settings → General → Login
  // Items), i.e. launches automatically after sign-in/reboot. The stored value alone does
  // nothing — main.js mirrors it to the OS via app.setLoginItemSettings whenever it changes, and
  // once more at startup so a hand-edited config.json stays in sync too.
  launchAtLogin: false,
  // Accelerator string (Electron's format — see its `accelerator` docs, e.g. 'Alt+A') for the
  // global hotkey that toggles the popover from anywhere via Electron's globalShortcut, even
  // while some other app is focused. No settings-panel control for it yet (would need a
  // key-capture UI), but kept as data here rather than a literal in main.js so a future one — or
  // a hand-edited config.json — can repoint it without a code change.
  toggleShortcut: 'Alt+A',
  // 'system' | 'light' | 'dark' — drives nativeTheme.themeSource (main.js's
  // applyAppearanceSetting), which is what actually resolves to a light/dark decision (system
  // reads the real macOS appearance; light/dark pin it regardless of macOS's own setting). The
  // popover's own CSS never looks at this value directly — see popover.css's data-theme comment.
  appearance: 'system',
  // Which field on a portfolio item counts as its "category" for the atom widget's same-category
  // connecting lines (atom-view.jsx) — one of 'assetClass' | 'region' | 'sector' | 'style' | 'risk',
  // the same enrichment fields securityKnowledge.js already fills in for every holding. 'sector'
  // (분야) picked as the default since it's the grouping most portfolios actually vary along;
  // the others exist for portfolios where a different axis is more meaningful (e.g. an
  // all-US-tech portfolio, where 위험 등급 or 투자 스타일 says more than 분야 does).
  atomCategoryDimension: 'sector',
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
