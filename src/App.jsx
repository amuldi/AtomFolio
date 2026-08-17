import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { createPortfolioHeatmap } from './lib/portfolioHeatmap.js';
import { createPortfolioAllocation } from './lib/portfolioAllocation.js';
import {
  collapsePortfolioItemsForDisplay as collapsePortfolioItemsForDisplayShared,
  parsePortfolioTextDetailed as parsePortfolioTextDetailedShared,
  shouldFallbackToLocalTimeline as shouldFallbackToLocalTimelineShared,
} from './lib/portfolioIngestionCore.js';
import { createPortfolioScorecard } from './lib/portfolioScoring.js';
import { createPortfolioAnalyticsSummary } from './lib/portfolioAnalyticsSummary.js';
import { enrichPortfolioItem, resolveExactSecurityReferenceCode } from './lib/securityKnowledge.js';
import { useAtomTransition } from './utils/useAtomTransition.js';
import { useViewportWidth } from './utils/useViewportWidth.js';
import {
  normalizeDisplayKey,
  getItemFieldValue,
  resolveHoldingName,
  resolveHoldingTicker,
  resolveHoldingAccount,
  resolveHoldingAtomId,
  resolveHoldingMetric,
} from './utils/holdings.js';
import {
  fetchLiveMarketData,
  formatMarketChange,
  formatMarketChangePercent,
  formatMarketPrice,
  formatMarketTime,
} from './lib/liveMarketData.js';
import {
  createServerPortfolio,
  createDesktopDeviceToken,
  deleteServerPortfolio,
  claimGuestWorkspace,
  fetchWorkspaceSession,
  getPortfolioWorkspaceId,
  isGuestPortfolioWorkspaceId,
  listServerPortfolios,
  readStoredOption,
  revokeDesktopDeviceTokens,
  setPortfolioWorkspaceId,
  saveServerImportHistory,
} from './utils/storage.js';
import { textFor } from './utils/format.js';
import { ToolSideDrawer } from './components/tool-drawer/ToolSideDrawer.jsx';
import {
  DEFAULT_REBALANCE_TARGET_WEIGHTS,
  MAX_PORTFOLIOS,
  TOOL_DRAWER_DEFAULT_WIDTH,
  buildDisplayFxRates,
  formatDateKey,
  getSignedValueToneClass,
  normalizeCurrencyCode,
  resolveEntryReviewStatus,
  resolveMarketDisplayName,
  summarizePortfolioEntryAccounts,
} from './lib/toolDrawerShared.js';
import {
  createAtomState,
  createSceneCameraRig,
  generateAtomLayout,
  projectPoint,
  trackballVector,
} from './utils/scene.js';
import { DEFAULT_USD_KRW_RATE } from './utils/currency.js';
import {
  AtomSketch as AtomSketchView,
  PortfolioPreviewAtom as PortfolioPreviewAtomView,
} from './components/atom/index.jsx';
import { AuthPanel } from './components/auth/AuthPanel.jsx';
import { AtomDetailPanel } from './components/panels/AtomDetailPanel.jsx';
import { CommandPalette } from './components/command-palette/CommandPalette.jsx';
import { AtomCanvas } from './scene/index.js';

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? '';
// Stage A dev-only preview of the WebGL scene migration (see plan at
// .claude/plans/binary-leaping-wind.md). Off by default; append ?webglScene=1 to compare against
// the SVG scene. Removed once Stage B lands and the WebGL path becomes the real renderer.
const ENABLE_WEBGL_SCENE_PREVIEW =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('webglScene') === '1';

const VIEWBOX_SIZE = 640;
const VIEWBOX_HALF = VIEWBOX_SIZE / 2;
const BOND_LENGTH = 214;
// This is an ANGULAR speed (radians/sec) — it doesn't know or care how large the atom is
// currently rendered on screen. .stage-frame's own width formula (styles.css) got widened
// (~19% at a 1440x900 viewport) per "make the whole atom bigger" feedback; the same angular
// speed then sweeps proportionally more actual screen pixels per second at that larger size,
// which is very likely why the idle rotation started reading as "unnatural" right after — nothing
// about the rotation logic itself changed. Lowered by roughly that same ~19% (0.018 -> 0.015) so
// the apparent (pixels/sec) speed lands back near what it was before the resize, independent of
// the atom's own on-screen size.
const AUTO_ROTATE_SPEED = 0.015;
const GROUP_OPTION_KEYS = ['region', 'sector', 'style', 'risk'];
const SCORE_AXIS_KEYS = [
  'profitability',
  'diversification',
  'riskManagement',
  'composition',
  'timing',
  'stability',
];
const LANGUAGE_OPTIONS = ['ko', 'en'];
const ASSET_CLASS_MODE_OPTIONS = ['auto', 'preferOriginal'];
const ALLOCATION_WEIGHT_MODE_OPTIONS = ['auto', 'stock', 'assetClass', 'account'];
const SCORE_WEIGHT_PRESET_OPTIONS = [
  'balanced',
  'returnFocus',
  'longTermReturnFocus',
  'stabilityFocus',
];
const BASE_CURRENCY_OPTIONS = ['KRW', 'USD'];
const DATE_BASIS_OPTIONS = ['kst', 'local'];
const SETTING_TOGGLE_OPTIONS = ['on', 'off'];
const STORAGE_KEYS = {
  language: 'atom-sketch-language',
  assetClassMode: 'atom-sketch-asset-class-mode',
  allocationWeightMode: 'atom-sketch-allocation-weight-mode',
  scoreWeightPreset: 'atom-sketch-score-weight-preset',
  baseCurrency: 'atom-sketch-base-currency',
  dateBasis: 'atom-sketch-date-basis',
  autoSave: 'atom-sketch-auto-save',
  dailySnapshots: 'atom-sketch-daily-snapshots',
  portfolioData: 'atom-sketch-portfolio-data-v1',
  toolTriggerPosition: 'atom-sketch-tool-trigger-position',
  groupDockPosition: 'atom-sketch-group-dock-position',
  heatmapDockPosition: 'atom-sketch-heatmap-dock-position',
  scoreDockPosition: 'atom-sketch-score-dock-position-v2',
  allocationDockPosition: 'atom-sketch-allocation-dock-position',
  twinDockPosition: 'atom-sketch-twin-dock-position',
  atomHintDismissed: 'atom-sketch-atom-hint-dismissed',
  toolDrawerDock: 'atom-sketch-tool-drawer-dock',
};
const SHOOTING_STAR_INTERVAL_MS = 30000;
const SHOOTING_STAR_CLEAR_BUFFER_MS = 420;
const SCENE_FRAME_INTERVAL_MS = 1000 / 30;
const LARGE_SCENE_FRAME_INTERVAL_MS = 1000 / 24;
const DRAG_SCENE_FRAME_INTERVAL_MS = 1000 / 60;
const REDUCED_MOTION_FRAME_INTERVAL_MS = 1000 / 12;
const LARGE_SCENE_ATOM_THRESHOLD = 12;
const DRAG_ROTATION_RESPONSE = 30;
const IDLE_ROTATION_RESPONSE = 10;
const DRAG_ROTATION_SENSITIVITY = 0.68;
// Step 2/2 of the drag-inertia fix (see MAX_DRAG_SPIN_VELOCITY's own comment for step 1 and the
// ceiling formula both constants share): lowered 7.4 -> 3.0 on top of the raised velocity cap
// below. Simulated: a moderate flick that continued ~22° over ~770ms with the cap alone now
// continues ~53° over ~1.9s — long enough to actually read as a decaying glide rather than a
// slightly-longer snap. Left untouched in step 1 on its own (holding this at 7.4) specifically to
// verify the velocity-cap raise's effect in isolation first, per changing one tuning value at a
// time; low decay alone (without the higher cap) can't reach a useful distance without an
// unreasonably long duration, since both distance and duration scale with 1/decay together.
const DRAG_SPIN_DECAY = 3.0;
// The total angle the atom keeps spinning after release, integrated over the whole decay curve,
// works out to exactly MAX_DRAG_SPIN_VELOCITY / DRAG_SPIN_DECAY radians — a hard ceiling no
// gesture can exceed, regardless of how hard it's flicked. At the old 0.58/7.4, that ceiling was
// ~0.078 rad ≈ 4.5°: even a flick that instantly saturated the velocity cap on release produced
// under 5° of continued rotation over ~0.5s, which is why the "spins hard, then eases to a stop"
// effect this was meant to have read as "doesn't spin at all" — the numbers were never zero, just
// below the threshold anyone would actually notice.
const MAX_DRAG_SPIN_VELOCITY = 3.2;
const SECURITY_ENRICHMENT_RETRY_DELAYS_MS = [0, 1500, 5000, 14000];
const ACTIVE_FLOATING_TOOL_Z_INDEX = 80;
const FLOATING_TOOL_Z_INDEX = {
  settings: 30,
  'tool-menu': 31,
  group: 32,
  heatmap: 33,
  allocation: 34,
  score: 35,
  twin: 36,
  'tool-drawer': 37,
};
// Bottom used to be a third dock option (its own height-based resize numbers lived here) — dropped
// in favor of left/right only, see .tool-drawer's CSS for why a transform-based slide can't cleanly
// support a third axis the way the old clip-path box could.
const TOOL_DRAWER_DOCK_OPTIONS = ['left', 'right'];
const SERVER_SYNC_DEBOUNCE_MS = 850;
const DAILY_SNAPSHOT_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const TOOLTIP_WIDTH = 320;
const TOOLTIP_HEIGHT = 260;
function noise(seed) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function jitter(seed, amount) {
  return (noise(seed) * 2 - 1) * amount;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function damp(current, target, lambda, delta) {
  return current + (target - current) * (1 - Math.exp(-lambda * delta));
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function createPortfolioEntryFromPayload(payload, entryId) {
  const timelineItems = Array.isArray(payload?.timelineItems) ? payload.timelineItems : [];
  const rawDisplayItems = Array.isArray(payload?.items)
    ? payload.items
    : collapsePortfolioItemsForDisplayShared(timelineItems);
  const displayItems = collapsePortfolioItemsForDisplayShared(rawDisplayItems);

  return {
    id:
      entryId ||
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `portfolio-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`),
    fileName: payload?.fileName || 'portfolio.csv',
    items: displayItems,
    timelineItems,
    parserDiagnostics: payload?.parserDiagnostics ?? null,
    agentReview: payload?.agentReview ?? null,
    ingestSource: payload?.ingestSource ?? 'server',
    metadata: payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
    createdAt: payload?.createdAt ?? null,
    updatedAt: payload?.updatedAt ?? null,
  };
}

function serializePortfolioEntryForStorage(entry) {
  const items = Array.isArray(entry?.items) ? entry.items : [];
  const timelineItems =
    Array.isArray(entry?.timelineItems) && entry.timelineItems.length ? entry.timelineItems : items;

  return {
    id: String(entry?.id ?? ''),
    fileName: String(entry?.fileName ?? 'portfolio.csv'),
    items,
    timelineItems,
    parserDiagnostics: entry?.parserDiagnostics ?? null,
    agentReview: entry?.agentReview ?? null,
    ingestSource: entry?.ingestSource ?? 'restored-local',
    metadata: entry?.metadata && typeof entry.metadata === 'object' ? entry.metadata : {},
    createdAt: entry?.createdAt ?? null,
    updatedAt: entry?.updatedAt ?? null,
  };
}

function portfolioEntryTimestamp(entry) {
  const parsed = Date.parse(entry?.updatedAt ?? entry?.createdAt ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function portfolioEntriesEqual(first, second) {
  try {
    return (
      JSON.stringify(serializePortfolioEntryForStorage(first)) ===
      JSON.stringify(serializePortfolioEntryForStorage(second))
    );
  } catch {
    return false;
  }
}

function mergePortfolioEntriesWithServer(localEntries, serverEntries) {
  const entries = Array.isArray(localEntries) ? localEntries.slice(0, MAX_PORTFOLIOS) : [];
  const byId = new Map(entries.map((entry, index) => [entry.id, index]));
  const summary = {
    addedFromServer: 0,
    updatedFromServer: 0,
    localNewer: 0,
  };

  (Array.isArray(serverEntries) ? serverEntries : [])
    .slice(0, MAX_PORTFOLIOS)
    .forEach((serverEntry) => {
      if (!serverEntry?.id) {
        return;
      }

      const localIndex = byId.get(serverEntry.id);
      if (!Number.isInteger(localIndex)) {
        if (entries.length < MAX_PORTFOLIOS) {
          byId.set(serverEntry.id, entries.length);
          entries.push(serverEntry);
          summary.addedFromServer += 1;
        }
        return;
      }

      const localEntry = entries[localIndex];
      if (portfolioEntriesEqual(localEntry, serverEntry)) {
        return;
      }

      const serverTime = portfolioEntryTimestamp(serverEntry);
      const localTime = portfolioEntryTimestamp(localEntry);
      if (serverTime >= localTime) {
        entries[localIndex] = serverEntry;
        summary.updatedFromServer += 1;
        return;
      }

      summary.localNewer += 1;
    });

  return { entries, summary };
}

function dateFromDateKey(dateKey) {
  const match = String(dateKey ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const [, yearValue, monthValue, dayValue] = match;
  const year = Number.parseInt(yearValue, 10);
  const month = Number.parseInt(monthValue, 10);
  const day = Number.parseInt(dayValue, 10);
  const date = new Date(year, month - 1, day);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return date;
}

function normalizePortfolioDateKey(value) {
  const dateKey = formatAtomDateLabel(value);

  return dateFromDateKey(dateKey) ? dateKey : '';
}

function addDaysToDateKey(dateKey, days) {
  const date = dateFromDateKey(dateKey);
  if (!date) {
    return '';
  }

  date.setDate(date.getDate() + days);
  return formatDateKey(date);
}

function readSavedAtDateKey(savedAt, dateBasis = 'kst') {
  if (!savedAt) {
    return '';
  }

  const date = new Date(savedAt);
  if (Number.isFinite(date.getTime())) {
    return formatDateKeyForBasis(date, dateBasis);
  }

  return normalizePortfolioDateKey(savedAt);
}

function buildElapsedDateKeysSince(savedAt, today = new Date(), dateBasis = 'kst') {
  const savedDateKey = readSavedAtDateKey(savedAt, dateBasis);
  const todayDateKey = formatDateKeyForBasis(today, dateBasis);

  if (!savedDateKey || savedDateKey >= todayDateKey) {
    return [];
  }

  const dateKeys = [];
  let cursorDateKey = addDaysToDateKey(savedDateKey, 1);

  while (cursorDateKey && cursorDateKey <= todayDateKey) {
    dateKeys.push(cursorDateKey);
    cursorDateKey = addDaysToDateKey(cursorDateKey, 1);
  }

  return dateKeys;
}

function isPortfolioSnapshotDateLabel(label) {
  const normalized = normalizeDisplayKey(label);

  return [
    '날짜',
    '일자',
    '기준일',
    '기준일자',
    '평가일',
    '평가일자',
    '조회일',
    '조회일자',
    'date',
    'day',
    'recorddate',
    'valuedate',
    'valuationdate',
    'snapshotdate',
    'asofdate',
  ]
    .map(normalizeDisplayKey)
    .includes(normalized);
}

function readPortfolioSnapshotDateKey(item) {
  const directDateKey = normalizePortfolioDateKey(
    item?.dailySnapshotDate ?? item?.snapshotDate ?? item?.recordedAt ?? item?.asOfDate,
  );

  if (directDateKey) {
    return directDateKey;
  }

  const dateField = (item?.fields ?? []).find((field) =>
    isPortfolioSnapshotDateLabel(field?.label),
  );

  return normalizePortfolioDateKey(dateField?.value);
}

function upsertPortfolioSnapshotDateField(fields, dateKey) {
  const nextFields = Array.isArray(fields) ? fields.map((field) => ({ ...field })) : [];
  const dateFieldIndex = nextFields.findIndex((field) =>
    isPortfolioSnapshotDateLabel(field?.label),
  );

  if (dateFieldIndex >= 0) {
    nextFields[dateFieldIndex] = {
      ...nextFields[dateFieldIndex],
      value: dateKey,
    };
    return nextFields;
  }

  return [{ label: '날짜', value: dateKey }, ...nextFields];
}

function dailySnapshotItemKey(item, index) {
  return (
    [
      item?.code,
      item?.ticker,
      item?.stockCode,
      item?.name,
      item?.stockName,
      item?.companyName,
      item?.label,
    ]
      .map((value) => normalizeDisplayKey(value))
      .find(Boolean) ?? `row:${index}`
  );
}

function dailySnapshotId(item, dateKey, index) {
  const baseId = String(item?.id ?? dailySnapshotItemKey(item, index))
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]/g, '-')
    .slice(0, 80);

  return `${baseId || `holding-${index + 1}`}:snapshot:${dateKey}`;
}

function createDailyPortfolioSnapshotItem(item, dateKey, index) {
  return {
    ...item,
    id: dailySnapshotId(item, dateKey, index),
    recordedAt: dateKey,
    snapshotDate: dateKey,
    dailySnapshotDate: dateKey,
    fields: upsertPortfolioSnapshotDateField(item?.fields, dateKey),
    metadataSourceByField: {
      ...(item?.metadataSourceByField ?? {}),
      recordedAt: 'daily-roll-forward',
      snapshotDate: 'daily-roll-forward',
    },
  };
}

function getDailySnapshotSourceItems(entry) {
  if (Array.isArray(entry?.items) && entry.items.length) {
    return entry.items;
  }

  const timelineItems = Array.isArray(entry?.timelineItems) ? entry.timelineItems : [];
  return collapsePortfolioItemsForDisplayShared(timelineItems);
}

function rollForwardPortfolioEntry(entry, savedAt, dateBasis = 'kst') {
  const elapsedDateKeys = buildElapsedDateKeysSince(savedAt, new Date(), dateBasis);
  if (!elapsedDateKeys.length) {
    return entry;
  }

  const sourceItems = getDailySnapshotSourceItems(entry);
  if (!sourceItems.length) {
    return entry;
  }

  const timelineItems =
    Array.isArray(entry?.timelineItems) && entry.timelineItems.length
      ? entry.timelineItems
      : sourceItems;
  const existingSnapshotKeysByDate = new Map();

  timelineItems.forEach((item, index) => {
    const dateKey = readPortfolioSnapshotDateKey(item);
    if (!dateKey) {
      return;
    }

    const itemKey = dailySnapshotItemKey(item, index);
    const itemKeys = existingSnapshotKeysByDate.get(dateKey) ?? new Set();
    itemKeys.add(itemKey);
    existingSnapshotKeysByDate.set(dateKey, itemKeys);
  });

  const appendedItems = [];
  elapsedDateKeys.forEach((dateKey) => {
    const existingItemKeys = existingSnapshotKeysByDate.get(dateKey) ?? new Set();

    sourceItems.forEach((item, index) => {
      const itemKey = dailySnapshotItemKey(item, index);
      if (existingItemKeys.has(itemKey)) {
        return;
      }

      existingItemKeys.add(itemKey);
      appendedItems.push(createDailyPortfolioSnapshotItem(item, dateKey, index));
    });

    existingSnapshotKeysByDate.set(dateKey, existingItemKeys);
  });

  if (!appendedItems.length) {
    return entry;
  }

  const nextTimelineItems = [...timelineItems, ...appendedItems];
  const lastSnapshotDate = appendedItems.at(-1)?.dailySnapshotDate ?? elapsedDateKeys.at(-1);

  return {
    ...entry,
    items: collapsePortfolioItemsForDisplayShared(nextTimelineItems),
    timelineItems: nextTimelineItems,
    metadata: {
      ...(entry?.metadata ?? {}),
      lastDailySnapshotAt: lastSnapshotDate,
      dailySnapshotCount: Number(entry?.metadata?.dailySnapshotCount ?? 0) + appendedItems.length,
    },
  };
}

function rollForwardPortfolioEntriesSince(entries, savedAt, dateBasis = 'kst') {
  if (!Array.isArray(entries) || !entries.length) {
    return Array.isArray(entries) ? entries : [];
  }

  let changed = false;
  const nextEntries = entries.map((entry) => {
    const entrySavedAt =
      savedAt ??
      entry?.metadata?.lastSavedAt ??
      entry?.metadata?.lastDailySnapshotAt ??
      entry?.updatedAt ??
      entry?.createdAt;
    const nextEntry = rollForwardPortfolioEntry(entry, entrySavedAt, dateBasis);

    if (nextEntry !== entry) {
      changed = true;
    }

    return nextEntry;
  });

  return changed ? nextEntries : entries;
}

function readStoredPortfolioState() {
  if (typeof window === 'undefined') {
    return { entries: [], activePortfolioId: null, savedAt: null };
  }

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEYS.portfolioData);
    if (!rawValue) {
      return { entries: [], activePortfolioId: null, savedAt: null };
    }

    const parsed = JSON.parse(rawValue);
    const savedAt = parsed?.savedAt ?? null;
    const dateBasis = readStoredOption(STORAGE_KEYS.dateBasis, DATE_BASIS_OPTIONS, 'kst');
    const dailySnapshots = readStoredOption(
      STORAGE_KEYS.dailySnapshots,
      SETTING_TOGGLE_OPTIONS,
      'on',
    );
    const baseEntries = Array.isArray(parsed?.entries)
      ? parsed.entries
          .slice(0, MAX_PORTFOLIOS)
          .map((storedEntry) =>
            createPortfolioEntryFromPayload(
              {
                fileName: storedEntry?.fileName,
                items: Array.isArray(storedEntry?.items) ? storedEntry.items : [],
                timelineItems: Array.isArray(storedEntry?.timelineItems)
                  ? storedEntry.timelineItems
                  : Array.isArray(storedEntry?.items)
                    ? storedEntry.items
                    : [],
                parserDiagnostics: storedEntry?.parserDiagnostics ?? null,
                agentReview: storedEntry?.agentReview ?? null,
                ingestSource: storedEntry?.ingestSource ?? 'restored-local',
                metadata: storedEntry?.metadata,
                createdAt: storedEntry?.createdAt,
                updatedAt: storedEntry?.updatedAt,
              },
              storedEntry?.id,
            ),
          )
          .filter((entry) => entry.id)
      : [];
    const restoredEntries =
      dailySnapshots === 'on'
        ? rollForwardPortfolioEntriesSince(baseEntries, savedAt, dateBasis)
        : baseEntries;

    const parsedActiveId = String(parsed?.activePortfolioId ?? '');
    const activePortfolioId = restoredEntries.some((entry) => entry.id === parsedActiveId)
      ? parsedActiveId
      : (restoredEntries[0]?.id ?? null);

    return {
      entries: restoredEntries,
      activePortfolioId,
      savedAt,
    };
  } catch {
    return { entries: [], activePortfolioId: null, savedAt: null };
  }
}

function writeStoredPortfolioState(entries, activePortfolioId) {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const safeEntries = Array.isArray(entries)
      ? entries
          .slice(0, MAX_PORTFOLIOS)
          .map(serializePortfolioEntryForStorage)
          .filter((entry) => entry.id)
      : [];

    if (!safeEntries.length) {
      window.localStorage.removeItem(STORAGE_KEYS.portfolioData);
      return null;
    }

    const safeActiveId = String(activePortfolioId ?? '');
    const nextActivePortfolioId = safeEntries.some((entry) => entry.id === safeActiveId)
      ? safeActiveId
      : safeEntries[0].id;
    const savedAt = new Date().toISOString();

    window.localStorage.setItem(
      STORAGE_KEYS.portfolioData,
      JSON.stringify({
        version: 1,
        savedAt,
        activePortfolioId: nextActivePortfolioId,
        entries: safeEntries,
      }),
    );
    return savedAt;
  } catch (error) {
    console.warn('portfolio-persist-failed', error);
    return null;
  }
}

function buildLocalPortfolioPayload(fileName, localItems, parserDiagnostics, overrides = {}) {
  const displayItems = collapsePortfolioItemsForDisplayShared(localItems);

  return {
    fileName,
    itemCount: localItems.length,
    securityCount: displayItems.length,
    items: displayItems,
    timelineItems: localItems,
    parserDiagnostics,
    agentReview: null,
    ingestSource: 'client-local',
    ...overrides,
  };
}

function buildImportRecordFromPortfolioEntry(entry) {
  const timelineItems =
    Array.isArray(entry?.timelineItems) && entry.timelineItems.length
      ? entry.timelineItems
      : Array.isArray(entry?.items)
        ? entry.items
        : [];
  const displayItems = Array.isArray(entry?.items) ? entry.items : [];

  return {
    id: 'import-' + String(entry?.id ?? Date.now()),
    portfolioId: String(entry?.id ?? ''),
    fileName: String(entry?.fileName ?? 'portfolio.csv'),
    status: resolveEntryReviewStatus(entry),
    itemCount: timelineItems.length,
    securityCount: displayItems.length || timelineItems.length,
    parserDiagnostics: entry?.parserDiagnostics ?? null,
    agentReview: entry?.agentReview ?? null,
    ingestSource: entry?.ingestSource ?? 'client-local',
  };
}

function queueImportHistorySync(entry) {
  if (typeof window === 'undefined' || !entry?.id) {
    return;
  }

  void saveServerImportHistory(buildImportRecordFromPortfolioEntry(entry)).catch(() => {});
}

function readPrefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function sceneFrameIntervalFor(atomCount, reducedMotion, isDragging = false) {
  if (reducedMotion) {
    return REDUCED_MOTION_FRAME_INTERVAL_MS;
  }

  if (isDragging) {
    return DRAG_SCENE_FRAME_INTERVAL_MS;
  }

  return atomCount > LARGE_SCENE_ATOM_THRESHOLD
    ? LARGE_SCENE_FRAME_INTERVAL_MS
    : SCENE_FRAME_INTERVAL_MS;
}

function format(value) {
  return value.toFixed(2);
}

function createShootingStar() {
  const seed =
    (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001 +
    Math.random() * 17;

  return {
    id: `shooting-star-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    startX: 62 + noise(seed + 0.13) * 26,
    startY: 6 + noise(seed + 0.47) * 20,
    travelX: -(180 + noise(seed + 0.83) * 118),
    travelY: 110 + noise(seed + 1.19) * 138,
    angle: -34 + jitter(seed + 1.51, 5.6),
    length: 92 + noise(seed + 1.87) * 72,
    duration: 1800 + noise(seed + 2.23) * 940,
    scale: 0.82 + noise(seed + 2.59) * 0.28,
    opacity: 0.34 + noise(seed + 2.93) * 0.14,
  };
}

function formatDateKeyForBasis(value = new Date(), dateBasis = 'kst') {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return '';
  }

  if (dateBasis !== 'kst') {
    return formatDateKey(date);
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${byType.year}-${byType.month}-${byType.day}`;
}

// A Date object whose *local* getters (getFullYear/getMonth/getDate/...) read back as the KST
// wall-clock time, for callers (like the heatmap's day-bucketing) that need an actual Date to do
// local-time day math with, not just a formatted string.
function nowForDateBasis(dateBasis = 'kst') {
  const now = new Date();
  if (dateBasis !== 'kst') {
    return now;
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return new Date(
    Number(byType.year),
    Number(byType.month) - 1,
    Number(byType.day),
    Number(byType.hour),
    Number(byType.minute),
    Number(byType.second),
  );
}

function groupOptionsFor(language) {
  const labels = textFor(language).groupLabels;
  return GROUP_OPTION_KEYS.map((key) => ({ key, label: labels[key] }));
}

function scoreAxesFor(language) {
  const labels = textFor(language).scoreAxisLabels;
  return SCORE_AXIS_KEYS.map((key) => ({ key, label: labels[key] }));
}

const LEGACY_ATOM_TERM_PATTERN = new RegExp(`원${'자'}(?!재)`, 'g');

function normalizePortfolioVocabulary(value) {
  return String(value ?? '').replace(LEGACY_ATOM_TERM_PATTERN, '포트폴리오');
}

function canHighlightGroupField(atom, groupKey) {
  if (!atom || !groupKey) {
    return false;
  }

  const value = String(atom[groupKey] ?? '').trim();
  if (!value) {
    return false;
  }

  const source = String(atom.metadataSourceByField?.[groupKey] ?? '')
    .trim()
    .toLowerCase();
  return (
    source === 'provided' || source === 'reference' || source === 'derived' || source === 'wikidata'
  );
}

function resolveFieldLabelKey(label) {
  const normalized = normalizeDisplayKey(normalizePortfolioVocabulary(label));

  if (
    ['종목 티커', '종목코드', '티커', 'ticker', 'symbol', 'stockcode', 'securitycode']
      .map(normalizeDisplayKey)
      .includes(normalized)
  ) {
    return 'stockCode';
  }

  if (
    [
      '종목명',
      '자산명',
      '상품명',
      'name',
      'security',
      'securityname',
      'assetname',
      'productname',
      'company',
    ]
      .map(normalizeDisplayKey)
      .includes(normalized)
  ) {
    return 'stockName';
  }

  if (
    [
      '계좌id',
      '계좌번호',
      '계좌코드',
      '포트폴리오id',
      '포트폴리오번호',
      '포트폴리오코드',
      'acctid',
      'accountid',
      'accountnumber',
    ]
      .map(normalizeDisplayKey)
      .includes(normalized)
  ) {
    return 'accountId';
  }

  if (
    [
      '계좌유형',
      '계좌종류',
      '계좌구분',
      '계좌명',
      '포트폴리오 유형',
      '포트폴리오종류',
      '포트폴리오구분',
      '포트폴리오명',
      'accounttype',
      'accountkind',
      'accountclass',
    ]
      .map(normalizeDisplayKey)
      .includes(normalized)
  ) {
    return 'accountType';
  }

  if (
    ['매수일', '매입일', '취득일', 'buydate', 'purchasedate']
      .map(normalizeDisplayKey)
      .includes(normalized)
  ) {
    return 'buyDate';
  }

  if (
    ['매수가', '매입가', 'buyprice', 'purchaseprice', 'entryprice']
      .map(normalizeDisplayKey)
      .includes(normalized)
  ) {
    return 'buyPrice';
  }

  if (['보유수량', '수량', 'shares', 'quantity'].map(normalizeDisplayKey).includes(normalized)) {
    return 'shares';
  }

  if (
    ['수익률', '등락률', 'return', 'returns', 'performance', 'change']
      .map(normalizeDisplayKey)
      .includes(normalized)
  ) {
    return 'return';
  }

  if (
    ['투자지역', '지역', 'region', 'market', 'country']
      .map(normalizeDisplayKey)
      .includes(normalized)
  ) {
    return 'region';
  }

  if (
    ['분야', '업종', '산업', '섹터', 'sector', 'industry', 'theme']
      .map(normalizeDisplayKey)
      .includes(normalized)
  ) {
    return 'sector';
  }

  if (
    ['투자스타일', '스타일', 'style', 'strategy', 'factor']
      .map(normalizeDisplayKey)
      .includes(normalized)
  ) {
    return 'style';
  }

  if (
    ['위험등급', '위험', '리스크', 'risk', 'riskgrade', 'risklevel']
      .map(normalizeDisplayKey)
      .includes(normalized)
  ) {
    return 'risk';
  }

  if (
    ['자산구분', 'assetclass', 'asset type', 'assettype']
      .map(normalizeDisplayKey)
      .includes(normalized)
  ) {
    return 'assetClass';
  }

  if (['통화', 'currency', 'fx', 'quotedcurrency'].map(normalizeDisplayKey).includes(normalized)) {
    return 'currency';
  }

  if (
    ['규모분류', '시가총액분류', 'marketcap', 'marketcapclass', 'capstyle']
      .map(normalizeDisplayKey)
      .includes(normalized)
  ) {
    return 'marketCapClass';
  }

  if (['변동성', 'volatility', 'volatilitylevel'].map(normalizeDisplayKey).includes(normalized)) {
    return 'volatility';
  }

  if (
    ['과세구분', 'taxstatus', 'taxtreatment', 'taxable']
      .map(normalizeDisplayKey)
      .includes(normalized)
  ) {
    return 'taxStatus';
  }

  if (
    ['비교지수', '벤치마크', 'benchmark', 'referenceindex']
      .map(normalizeDisplayKey)
      .includes(normalized)
  ) {
    return 'benchmark';
  }

  return null;
}

function formatFieldLabel(label, language = 'ko') {
  const key = resolveFieldLabelKey(label);
  if (!key) {
    return normalizePortfolioVocabulary(label);
  }

  return textFor(language).fieldLabels[key] ?? label;
}

const CORE_ATOM_INFO_FIELDS = [
  { key: 'region', label: '투자 지역' },
  { key: 'sector', label: '분야' },
  { key: 'style', label: '투자 스타일' },
  { key: 'risk', label: '위험 등급' },
];

const PENDING_ATOM_INFO_VALUES = new Set(['확인중', 'checking']);
const HIDDEN_ATOM_INFO_FIELD_KEYS = new Set(['assetClass']);
const HIDDEN_ATOM_INFO_FIELD_LABELS = [
  '날짜',
  '일자',
  'date',
  'day',
  '전일대비',
  '전일 대비',
  'previousChange',
  'changeAmount',
  '시세시각',
  '시세 시각',
  'marketUpdatedAt',
  'quoteTime',
  '시세출처',
  '시세 출처',
  'marketSource',
  'quoteSource',
  '자산군',
  '자산 구분',
  '자산구분',
  '자산 유형',
  'assetClass',
  'assetType',
].map(normalizeDisplayKey);

function atomInfoFallbackValue(language = 'ko') {
  return language === 'en' ? 'Checking' : '확인 중';
}

function isPendingAtomInfoValue(value) {
  return PENDING_ATOM_INFO_VALUES.has(normalizeDisplayKey(value));
}

function buildAtomInfoFields(atom, language = 'ko') {
  if (!atom) {
    return [];
  }

  const fields = Array.isArray(atom.fields) ? atom.fields : [];
  const inferredAtom = enrichPortfolioItem(atom);
  const resolvedFields = [];
  const seenKeys = new Set();
  const seenLabels = new Set();
  const fallbackValue = atomInfoFallbackValue(language);

  const pushField = (label, value) => {
    const trimmedLabel = normalizePortfolioVocabulary(label).trim();
    const trimmedValue = String(value ?? '').trim();

    if (!trimmedLabel || !trimmedValue) {
      return;
    }

    const resolvedKey = resolveFieldLabelKey(trimmedLabel);
    if (
      HIDDEN_ATOM_INFO_FIELD_KEYS.has(resolvedKey) ||
      HIDDEN_ATOM_INFO_FIELD_LABELS.includes(normalizeDisplayKey(trimmedLabel))
    ) {
      return;
    }

    const dedupeKey = resolvedKey || normalizeDisplayKey(trimmedLabel);
    if (dedupeKey && seenKeys.has(dedupeKey)) {
      return;
    }

    if (seenLabels.has(trimmedLabel)) {
      return;
    }

    if (dedupeKey) {
      seenKeys.add(dedupeKey);
    }
    seenLabels.add(trimmedLabel);
    resolvedFields.push({ label: trimmedLabel, value: trimmedValue });
  };

  CORE_ATOM_INFO_FIELDS.forEach(({ key, label }) => {
    const matchedField = fields.find((field) => resolveFieldLabelKey(field?.label) === key);
    const matchedValue = String(matchedField?.value ?? '').trim();
    const atomValue = String(atom[key] ?? '').trim();
    const inferredValue = String(inferredAtom?.[key] ?? '').trim();

    pushField(
      label,
      (!isPendingAtomInfoValue(matchedValue) && matchedValue) ||
        (!isPendingAtomInfoValue(atomValue) && atomValue) ||
        (!isPendingAtomInfoValue(inferredValue) && inferredValue) ||
        fallbackValue,
    );
  });

  fields.forEach((field) => {
    pushField(field?.label, field?.value);
  });

  return resolvedFields;
}

function hashString(value) {
  return Array.from(String(value ?? '')).reduce(
    (accumulator, character) => accumulator * 31 + character.charCodeAt(0),
    7,
  );
}

function createContributionPreview(items) {
  const columns = 4;
  const rows = 4;
  const total = columns * rows;
  const baseSeed = items.reduce(
    (accumulator, item, index) =>
      accumulator + hashString(item.label) * (index + 1) + hashString(item.detail),
    17,
  );

  const cells = Array.from({ length: total }, (_, index) => {
    const signal = noise(baseSeed + index * 19);
    const intensitySignal = noise(baseSeed + 401 + index * 13);
    const positive = signal > 0.42;
    const hasData = signal > 0.22;
    return {
      key: `contribution-${index}`,
      hasData,
      positive: hasData ? positive : false,
      intensity: hasData ? 0.22 + intensitySignal * 0.78 : 0,
    };
  });

  return { cells, columns, rows };
}

const META_VALUE_TRANSLATIONS = {
  en: {
    미국: 'US',
    한국: 'Korea',
    글로벌: 'Global',
    선진국: 'Developed Markets',
    일본: 'Japan',
    홍콩: 'Hong Kong',
    캐나다: 'Canada',
    고위험: 'High Risk',
    중위험: 'Medium Risk',
    저위험: 'Low Risk',
    성장주: 'Growth',
    가치주: 'Value',
    배당주: 'Dividend',
    방어형: 'Defensive',
    분산형: 'Diversified',
    개별주식: 'Single Stock',
    '주식 ETF': 'Equity ETF',
    '채권 ETF': 'Bond ETF',
    '원자재 ETF': 'Commodity ETF',
    기술: 'Technology',
    '인터넷 플랫폼': 'Internet Platform',
    반도체: 'Semiconductors',
    '반도체/전자': 'Semiconductors / Electronics',
    '철강/소재': 'Steel / Materials',
    자동차: 'Automobiles',
    배터리: 'Batteries',
    금융: 'Financials',
    바이오: 'Biotech',
    '방산/산업재': 'Aerospace / Industrials',
    '플랫폼/소비재': 'Platform / Consumer',
    전기차: 'EV',
    복합금융: 'Diversified Financials',
    필수소비재: 'Consumer Staples',
    에너지: 'Energy',
    '대형 기술주': 'Large-Cap Tech',
    '광범위 시장': 'Broad Market',
    '국제 주식': 'International Equities',
    채권: 'Bonds',
    원자재: 'Commodities',
    금: 'Gold',
    부동산: 'Real Estate',
    '전세계 주식': 'Global Equities',
    '배당 ETF': 'Dividend ETF',
    '국내 주식': 'Korean Stocks',
    '미국 주식': 'US Stocks',
    '해외 주식': 'International Stocks',
    '국내 주식 ETF': 'Korean Equity ETF',
    '미국 주식 ETF': 'US Equity ETF',
    '글로벌 주식 ETF': 'Global Equity ETF',
    '금/원자재 ETF': 'Gold / Commodity ETF',
    '리츠/부동산': 'REIT / Real Estate',
    '현금성 자산': 'Cash & Cash Equivalents',
    '디지털 자산': 'Digital Assets',
    대체자산: 'Alternative Assets',
    '기타 자산': 'Other Assets',
    미분류: 'Unclassified',
  },
  ko: {
    us: '미국',
    unitedstates: '미국',
    america: '미국',
    korea: '한국',
    southkorea: '한국',
    global: '글로벌',
    developedmarkets: '선진국',
    japan: '일본',
    hongkong: '홍콩',
    canada: '캐나다',
    highrisk: '고위험',
    mediumrisk: '중위험',
    lowrisk: '저위험',
    growth: '성장주',
    value: '가치주',
    dividend: '배당주',
    defensive: '방어형',
    diversified: '분산형',
    singlestock: '개별주식',
    equityetf: '주식 ETF',
    bondetf: '채권 ETF',
    commodityetf: '원자재 ETF',
    technology: '기술',
    internetplatform: '인터넷 플랫폼',
    semiconductors: '반도체',
    semiconductorselectronics: '반도체/전자',
    steelmaterials: '철강/소재',
    automobiles: '자동차',
    batteries: '배터리',
    financials: '금융',
    biotech: '바이오',
    aerospaceindustrials: '방산/산업재',
    platformconsumer: '플랫폼/소비재',
    ev: '전기차',
    diversifiedfinancials: '복합금융',
    consumerstaples: '필수소비재',
    energy: '에너지',
    largecaptech: '대형 기술주',
    broadmarket: '광범위 시장',
    internationalequities: '국제 주식',
    bonds: '채권',
    commodities: '원자재',
    gold: '금',
    realestate: '부동산',
    globalequities: '전세계 주식',
    dividendetf: '배당 ETF',
    koreanstocks: '국내 주식',
    domesticstocks: '국내 주식',
    usstocks: '미국 주식',
    internationalstocks: '해외 주식',
    koreanequityetf: '국내 주식 ETF',
    domesticequityetf: '국내 주식 ETF',
    usequityetf: '미국 주식 ETF',
    globalequityetf: '글로벌 주식 ETF',
    goldcommodityetf: '금/원자재 ETF',
    reitrealestate: '리츠/부동산',
    cashcashequivalents: '현금성 자산',
    digitalassets: '디지털 자산',
    alternativeassets: '대체자산',
    otherassets: '기타 자산',
    unclassified: '미분류',
    shares: '주',
    sh: '주',
  },
};

function translateDisplayValue(value, language = 'ko') {
  const trimmed = String(value ?? '').trim();

  if (!trimmed) {
    return value;
  }

  if (language === 'en') {
    const sharesMatch = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)\s*주$/);
    if (sharesMatch) {
      return `${sharesMatch[1]} sh`;
    }
  }

  if (language === 'ko') {
    const sharesMatch = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)\s*(?:shares?|sh)$/i);
    if (sharesMatch) {
      return `${sharesMatch[1]}주`;
    }
  }

  const normalized = normalizeDisplayKey(trimmed);
  return (
    META_VALUE_TRANSLATIONS[language]?.[normalized] ??
    META_VALUE_TRANSLATIONS[language]?.[trimmed] ??
    value
  );
}

function formatAtomDateLabel(value) {
  const trimmed = String(value ?? '').trim();

  if (!trimmed) {
    return '';
  }

  const normalized = trimmed.replace(/\s+/, ' ');
  const isoDateTimeMatch = normalized.match(
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]\d{1,2}:\d{2}(?::\d{2})?)?/,
  );
  if (isoDateTimeMatch) {
    const [, year, month, day] = isoDateTimeMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const isoDateMatch = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoDateMatch) {
    const [, year, month, day] = isoDateMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const compactMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactMatch) {
    const [, year, month, day] = compactMatch;
    return `${year}-${month}-${day}`;
  }

  const shortDateMatch = trimmed.match(
    /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[T\s]\d{1,2}:\d{2}(?::\d{2})?)?/,
  );
  if (shortDateMatch) {
    const [, month, day, year] = shortDateMatch;
    const fullYear = year.length === 2 ? `20${year}` : year;
    return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return trimmed;
}

function formatReturnDetail(value, label = '') {
  const trimmed = value.trim();

  if (!trimmed) {
    return '';
  }

  const numeric = Number.parseFloat(trimmed.replace(/[,%\s]/g, ''));
  if (!Number.isFinite(numeric)) {
    return '';
  }

  const explicitPercent =
    /%|pct|percent|return|yield|change|rate|수익률|등락률|변동률|손익률/i.test(
      String(label ?? '').trim(),
    );
  const percentValue =
    explicitPercent || trimmed.includes('%') || Math.abs(numeric) > 1 ? numeric : numeric * 100;
  const fixed = percentValue
    .toFixed(Math.abs(percentValue) >= 10 ? 1 : 2)
    .replace(/(\.\d*?[1-9])0+$/, '$1')
    .replace(/\.0$/, '');
  const sign = percentValue > 0 ? '+' : '';

  return `${sign}${fixed}%`;
}

function countReplacementCharacters(text) {
  return (text.match(/\uFFFD/g) ?? []).length;
}

async function readPortfolioFile(file) {
  const buffer = await file.arrayBuffer();
  const decoders = ['utf-8', 'euc-kr'];
  let bestText = '';
  let bestScore = Number.POSITIVE_INFINITY;

  for (const encoding of decoders) {
    try {
      const text = new TextDecoder(encoding).decode(buffer);
      const score = countReplacementCharacters(text);

      if (score < bestScore) {
        bestText = text;
        bestScore = score;
      }
    } catch {
      continue;
    }
  }

  return bestText;
}

async function ingestPortfolioTextViaApi(fileName, text) {
  const response = await fetch('/api/portfolio/ingest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fileName,
      text,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      payload && typeof payload.error === 'string' ? payload.error : 'Portfolio ingestion failed.',
    );
  }

  return payload;
}

async function enrichSecurityItemsViaApi(items, options = {}) {
  const response = await fetch('/api/securities/enrich', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      items,
      force: Boolean(options.force),
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      payload && typeof payload.error === 'string' ? payload.error : 'Security enrichment failed.',
    );
  }

  return payload;
}

const STRONG_METADATA_SOURCES = new Set(['provided', 'reference', 'wikidata', 'yahoo']);

function hasMissingCoreMetadata(item) {
  return ['region', 'sector', 'style', 'risk'].some((field) => {
    const value = String(item?.[field] ?? '').trim();
    const source = String(item?.metadataSourceByField?.[field] ?? item?.metadataSource ?? 'raw')
      .trim()
      .toLowerCase();

    return !value || !STRONG_METADATA_SOURCES.has(source);
  });
}

function hasMissingLiveQuote(item) {
  const latestPrice = Number(item?.latestPrice);

  return (
    !String(item?.marketPrice ?? '').trim() && !(Number.isFinite(latestPrice) && latestPrice > 0)
  );
}

function metadataMergeKey(item) {
  return (
    [item?.code, item?.ticker, item?.name, item?.companyName, item?.label]
      .map((value) => normalizeDisplayKey(value))
      .find(Boolean) ?? ''
  );
}

function mergeSecurityMetadataItems(baseItems, enrichedItems) {
  if (!Array.isArray(baseItems) || !Array.isArray(enrichedItems) || !enrichedItems.length) {
    return baseItems;
  }

  const enrichedByKey = new Map();
  enrichedItems.forEach((item, index) => {
    const key = metadataMergeKey(item) || `index:${index}`;
    if (!enrichedByKey.has(key)) {
      enrichedByKey.set(key, item);
    }
  });

  return baseItems.map((item, index) => {
    const key = metadataMergeKey(item) || `index:${index}`;
    return mergeSecurityMetadataItem(item, enrichedByKey.get(key) ?? enrichedItems[index]);
  });
}

const LIVE_QUOTE_ITEM_KEYS = [
  'marketPrice',
  'marketCurrency',
  'currency',
  'marketUpdatedAt',
  'marketSource',
  'quoteSource',
  'latestPrice',
  'marketChange',
  'marketChangePercent',
];
const LIVE_QUOTE_FIELD_LABELS = new Set(
  ['현재가', '전일대비', '등락률', '통화', '시세시각', '시세출처'].map(normalizeDisplayKey),
);

function mergeSecurityMetadataFields(currentFields, enrichedFields, keepLiveQuoteFields) {
  const nextFields = Array.isArray(currentFields) ? [...currentFields] : [];

  for (const field of enrichedFields ?? []) {
    const label = String(field?.label ?? '').trim();
    const value = String(field?.value ?? '').trim();

    if (!label || !value) {
      continue;
    }

    const normalizedLabel = normalizeDisplayKey(label);
    const existingIndex = nextFields.findIndex(
      (currentField) => normalizeDisplayKey(currentField?.label) === normalizedLabel,
    );

    if (existingIndex >= 0) {
      if (keepLiveQuoteFields && LIVE_QUOTE_FIELD_LABELS.has(normalizedLabel)) {
        continue;
      }

      nextFields[existingIndex] = { label, value };
    } else {
      nextFields.push({ label, value });
    }
  }

  return nextFields;
}

function mergeSecurityMetadataItem(currentItem, enrichedItem) {
  if (!enrichedItem) {
    return currentItem;
  }

  const keepLiveQuoteFields = Boolean(
    currentItem?.marketSource ||
    currentItem?.quoteSource ||
    Number.isFinite(currentItem?.latestPrice),
  );
  const nextItem = {
    ...currentItem,
    ...enrichedItem,
    fields: mergeSecurityMetadataFields(
      currentItem?.fields,
      enrichedItem?.fields,
      keepLiveQuoteFields,
    ),
    metadataSourceByField: {
      ...(currentItem?.metadataSourceByField ?? {}),
      ...(enrichedItem?.metadataSourceByField ?? {}),
    },
  };

  if (keepLiveQuoteFields) {
    for (const key of LIVE_QUOTE_ITEM_KEYS) {
      if (
        currentItem?.[key] !== undefined &&
        currentItem?.[key] !== null &&
        currentItem?.[key] !== ''
      ) {
        nextItem[key] = currentItem[key];
      }
    }
  }

  return nextItem;
}

function normalizeQuoteFieldValue(value) {
  return String(value ?? '').trim();
}

function upsertQuoteField(fields, label, value) {
  const cleanValue = normalizeQuoteFieldValue(value);

  if (!cleanValue) {
    return Array.isArray(fields) ? fields : [];
  }

  const nextFields = Array.isArray(fields) ? [...fields] : [];
  const targetKey = resolveFieldLabelKey(label) || normalizeDisplayKey(label);
  const index = nextFields.findIndex((field) => {
    const fieldKey = resolveFieldLabelKey(field?.label) || normalizeDisplayKey(field?.label);
    return fieldKey === targetKey;
  });
  const nextField = { label, value: cleanValue };

  if (index >= 0) {
    nextFields[index] = nextField;
  } else {
    nextFields.push(nextField);
  }

  return nextFields;
}

function applyLiveQuoteToPortfolioItem(item, quote) {
  if (!quote || !Number.isFinite(quote.latestPrice)) {
    return item;
  }

  const displayName =
    resolveMarketDisplayName(quote) || item?.stockName || item?.name || item?.label;
  const symbol = String(quote.symbol ?? item?.ticker ?? item?.stockCode ?? item?.code ?? '').trim();
  const marketPrice = formatMarketPrice(quote.latestPrice, quote.currency);
  const marketUpdatedAt = formatMarketTime(quote.updatedAt, 'ko');
  let fields = Array.isArray(item?.fields) ? [...item.fields] : [];

  fields = upsertQuoteField(fields, '종목 티커', symbol);
  fields = upsertQuoteField(fields, '종목명', displayName);
  fields = upsertQuoteField(fields, '현재가', marketPrice);
  fields = upsertQuoteField(fields, '전일대비', formatMarketChange(quote.change));
  fields = upsertQuoteField(fields, '등락률', formatMarketChangePercent(quote.changePercent));
  fields = upsertQuoteField(fields, '통화', quote.currency || 'KRW');
  fields = upsertQuoteField(fields, '시세시각', marketUpdatedAt);
  fields = upsertQuoteField(fields, '시세출처', quote.source);
  fields = upsertQuoteField(fields, '상장 시장', quote.exchangeName);

  return {
    ...item,
    label: displayName || item.label,
    name: displayName || item.name,
    companyName: displayName || item.companyName,
    stockName: displayName || item.stockName,
    stockCode: symbol || item.stockCode,
    ticker: symbol || item.ticker,
    code: symbol || item.code,
    marketPrice,
    marketCurrency: quote.currency || item.marketCurrency || 'KRW',
    currency: quote.currency || item.currency || 'KRW',
    marketUpdatedAt,
    marketSource: quote.source,
    quoteSource: quote.source,
    latestPrice: quote.latestPrice,
    marketChange: quote.change,
    marketChangePercent: quote.changePercent,
    fields,
    metadataSourceByField: {
      ...(item.metadataSourceByField ?? {}),
      stockName: 'live-market',
      stockCode: 'live-market',
      ticker: 'live-market',
      marketPrice: 'live-market',
      currency: 'live-market',
    },
  };
}

function liveQuoteLookupForItem(item) {
  const rawTicker =
    String(item?.ticker ?? item?.stockCode ?? item?.code ?? '').trim() ||
    getItemFieldValue(item, ['종목 티커', '종목코드', '티커', 'ticker', 'stockCode', 'code']);
  const name =
    String(item?.stockName ?? item?.name ?? item?.companyName ?? item?.label ?? '').trim() ||
    getItemFieldValue(item, ['종목명', 'stockName', 'name']);
  const exactTicker = resolveExactSecurityReferenceCode([rawTicker, name]);
  const ticker = exactTicker || rawTicker;

  return { ticker, name, key: normalizeDisplayKey(ticker || name) };
}

function normalizeMarketSymbolBase(value) {
  return normalizeDisplayKey(String(value ?? '').replace(/\.(KS|KQ|TO|V|T|HK|SS|SZ|DU|L)$/i, ''));
}

function liveQuoteMatchesLookup(quote, lookup) {
  const requestedTicker = normalizeMarketSymbolBase(lookup?.ticker);
  if (!requestedTicker) {
    const requestedName = normalizeDisplayKey(lookup?.name);

    if (!requestedName) {
      return true;
    }

    const exactTicker = normalizeMarketSymbolBase(
      resolveExactSecurityReferenceCode([lookup?.name]),
    );
    const returnedSymbol = normalizeMarketSymbolBase(quote?.symbol);

    if (exactTicker) {
      return returnedSymbol === exactTicker;
    }

    const quoteIdentifiers = [quote?.symbol, quote?.name, quote?.displayName, quote?.rawName]
      .map(normalizeDisplayKey)
      .filter(Boolean);

    return quoteIdentifiers.some(
      (identifier) =>
        identifier === requestedName ||
        (identifier.length >= 4 && requestedName.includes(identifier)) ||
        (requestedName.length >= 4 && identifier.includes(requestedName)),
    );
  }

  const returnedSymbol = normalizeMarketSymbolBase(quote?.symbol);
  return returnedSymbol === requestedTicker;
}

const LIVE_QUOTE_FETCH_CONCURRENCY = 6;
const LIVE_QUOTE_REFRESH_MS = 90 * 1000;
// Bounds each background refresh burst well under the server's 30-requests/60s market-live rate
// limit (see server/apiHandlers.mjs RATE_LIMITS) even with the concurrency above, leaving headroom
// for whatever else (manual ticker search, financials lookups) shares that same per-user budget.
const LIVE_QUOTE_REFRESH_MAX_ITEMS = 20;

// Runs `worker` over `items` with at most `limit` requests in flight at once — a portfolio's
// worth of quote lookups used to go out one at a time (a 20-holding portfolio meant 20 sequential
// round-trips, each waiting on the last), which is what made live-quote backfill and refresh feel
// slow. A shared cursor lets `limit` workers keep pulling the next item until the list is drained.
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runWorker()));

  return results;
}

async function enrichPortfolioItemsWithLiveQuotes(items) {
  if (!Array.isArray(items) || !items.length) {
    return items;
  }

  const lookups = [];
  const seen = new Set();

  items.forEach((item) => {
    const lookup = liveQuoteLookupForItem(item);
    if (!lookup.key || seen.has(lookup.key)) {
      return;
    }

    seen.add(lookup.key);
    lookups.push(lookup);
  });

  const quoteByKey = new Map();

  await mapWithConcurrency(lookups.slice(0, 80), LIVE_QUOTE_FETCH_CONCURRENCY, async (lookup) => {
    try {
      const quote = await fetchLiveMarketData({
        ticker: lookup.ticker,
        name: lookup.name,
      });
      if (liveQuoteMatchesLookup(quote, lookup)) {
        quoteByKey.set(lookup.key, quote);
      }
    } catch {
      // Leave the uploaded value as-is when every live provider fails.
    }
  });

  return items.map((item) => {
    const lookup = liveQuoteLookupForItem(item);
    return quoteByKey.has(lookup.key)
      ? applyLiveQuoteToPortfolioItem(item, quoteByKey.get(lookup.key))
      : item;
  });
}

function mergePortfolioItemUpdates(baseItems, updatedItems) {
  if (!Array.isArray(baseItems) || !Array.isArray(updatedItems) || !updatedItems.length) {
    return baseItems;
  }

  return baseItems.map((item, index) => updatedItems[index] ?? item);
}

function resolveAtomStockDisplayName(item, fallback = 'Stock') {
  return (
    String(item?.companyName ?? '').trim() ||
    String(item?.name ?? '').trim() ||
    String(item?.stockName ?? '').trim() ||
    getItemFieldValue(item, ['종목명', 'stockName', 'name', 'companyName']) ||
    String(item?.label ?? '').trim() ||
    fallback
  );
}

const PORTFOLIO_PREVIEW_SLOTS = [
  {
    x: -0.12,
    y: -0.02,
    scale: 0.32,
    rotation: -23,
    z: -1160,
    blur: 0.66,
    opacity: 0.64,
    shadow: 18,
    delay: '-2.4s',
    duration: '5.8s',
  },
  {
    x: 1.12,
    y: 0.07,
    scale: 0.24,
    rotation: 18,
    z: -1380,
    blur: 1.02,
    opacity: 0.5,
    shadow: 14,
    delay: '-1.2s',
    duration: '6.4s',
  },
  {
    x: 0.1,
    y: 0.09,
    scale: 0.2,
    rotation: -7,
    z: -1540,
    blur: 1.28,
    opacity: 0.42,
    shadow: 11,
    delay: '-1.8s',
    duration: '6.2s',
  },
  {
    x: 0.94,
    y: 0.27,
    scale: 0.28,
    rotation: 13,
    z: -1240,
    blur: 0.84,
    opacity: 0.56,
    shadow: 15,
    delay: '-2.9s',
    duration: '5.9s',
  },
  {
    x: -0.08,
    y: 0.82,
    scale: 0.29,
    rotation: 17,
    z: -1200,
    blur: 0.74,
    opacity: 0.6,
    shadow: 16,
    delay: '-3.1s',
    duration: '6.1s',
  },
  {
    x: 0.18,
    y: 1.08,
    scale: 0.21,
    rotation: -15,
    z: -1600,
    blur: 1.34,
    opacity: 0.38,
    shadow: 10,
    delay: '-1.5s',
    duration: '6.7s',
  },
  {
    x: 1.08,
    y: 0.96,
    scale: 0.23,
    rotation: -19,
    z: -1460,
    blur: 1.1,
    opacity: 0.46,
    shadow: 12,
    delay: '-0.8s',
    duration: '6.9s',
  },
  {
    x: 0.86,
    y: 0.72,
    scale: 0.19,
    rotation: 9,
    z: -1700,
    blur: 1.52,
    opacity: 0.34,
    shadow: 9,
    delay: '-2.2s',
    duration: '7.1s',
  },
  {
    x: 0.48,
    y: -0.12,
    scale: 0.18,
    rotation: -11,
    z: -1820,
    blur: 1.56,
    opacity: 0.32,
    shadow: 8,
    delay: '-3.4s',
    duration: '7.4s',
  },
  {
    x: -0.18,
    y: 0.43,
    scale: 0.2,
    rotation: 25,
    z: -1520,
    blur: 1.18,
    opacity: 0.42,
    shadow: 11,
    delay: '-0.6s',
    duration: '6.8s',
  },
  {
    x: 1.18,
    y: 0.48,
    scale: 0.18,
    rotation: -4,
    z: -1760,
    blur: 1.48,
    opacity: 0.34,
    shadow: 9,
    delay: '-2.7s',
    duration: '7.2s',
  },
  {
    x: 0.58,
    y: 1.16,
    scale: 0.17,
    rotation: 21,
    z: -1880,
    blur: 1.62,
    opacity: 0.3,
    shadow: 8,
    delay: '-1.9s',
    duration: '7.6s',
  },
];

function SketchUploadArrowIcon() {
  return (
    <svg className="upload-arrow__icon" viewBox="0 0 48 48" aria-hidden="true">
      <path
        className="upload-arrow__stroke-soft"
        d="M23.1 7.8L30.1 15.6L27.2 15.1L27.4 28.9L21.2 28.6L21.4 15.4L18 15.7L23.1 7.8Z"
      />
      <path
        className="upload-arrow__stroke-main"
        d="M23.7 7.1L29.7 14.6L26.6 14.2L26.7 30.3L21.7 30L21.8 14.6L18.2 15L23.7 7.1Z"
      />
      <path className="upload-arrow__stroke-soft" d="M12 31.4L15.7 35.2L31.8 35.4L35.6 31.7" />
      <path className="upload-arrow__stroke-main" d="M12.8 30.6L15.9 33.9L31.4 34L34.9 30.8" />
      <path className="upload-arrow__stroke-soft" d="M15.6 34.8L15.2 38L32 38.2L31.7 35" />
      <path className="upload-arrow__stroke-main" d="M16.1 34.1L15.8 37.1L31.4 37.2L31.2 34.3" />
    </svg>
  );
}

function HoverCard({ atom, position, language }) {
  const infoFields = buildAtomInfoFields(atom, language);

  if (!atom || !infoFields.length || !position) {
    return null;
  }

  const returnRaw = atom.detail ?? '';
  const returnToneClass = getSignedValueToneClass(returnRaw, 'is-positive', 'is-negative');
  const displayFields = returnRaw
    ? infoFields.filter((field) => resolveFieldLabelKey(field.label) !== 'return')
    : infoFields;

  return (
    <aside
      className="hover-card"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      <div className="hover-card__header">
        <div className="hover-card__title-wrap">
          <strong className="hover-card__title">{atom.label}</strong>
          {returnRaw ? (
            <span className={`hover-card__return${returnToneClass ? ` ${returnToneClass}` : ''}`}>
              {returnRaw}
            </span>
          ) : null}
        </div>
      </div>

      <div className="hover-card__list">
        {displayFields.map((field, index) => (
          <div className="hover-card__row" key={`${atom.id}-${field.label}-${index}`}>
            <span className="hover-card__label">{formatFieldLabel(field.label, language)}</span>
            <span className="hover-card__value">
              {translateDisplayValue(field.value, language)}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}

function createManualPortfolioItem(row, index) {
  const accountName = String(row?.accountName ?? '').trim() || '직접 입력 포트폴리오';
  const stockName =
    String(row?.stockName ?? '').trim() ||
    String(row?.marketName ?? '').trim() ||
    String(row?.ticker ?? '').trim() ||
    `직접 입력 종목 ${index + 1}`;
  const ticker = String(row?.ticker ?? '').trim();
  const buyPrice = String(row?.buyPrice ?? '').trim();
  // Which currency buyPrice was actually typed/toggled in at entry time — kept as its own field,
  // deliberately never pre-converted into the security's own trading currency. Storing a
  // synthetic converted number instead of this was the root of a real bug: a real 370,000원 cost
  // basis got permanently rewritten into a fabricated "370,000 USD" (or a stale conversion of it)
  // depending on which side of the toggle the user happened to be on, instead of just remembering
  // "this was 원" and letting resolvePosition (portfolioAnalyticsSummary.js) compare like-for-like
  // amounts at read time, with today's live rate, every time.
  const purchaseCurrency = normalizeCurrencyCode(row?.purchaseCurrency) || '';
  const shares = String(row?.shares ?? '').trim();
  const assetClass = String(row?.assetClass ?? '').trim() || '주식';
  const sector = String(row?.sector ?? '').trim();
  const marketPrice = String(row?.marketPrice ?? '').trim();
  const marketCurrency = String(row?.marketCurrency ?? '').trim();
  const marketUpdatedAt = String(row?.marketUpdatedAt ?? '').trim();
  const recordedAt = String(row?.recordedAt ?? '').trim() || formatDateKey();
  const returnDetail = formatReturnDetail(String(row?.returnRate ?? '0'), '수익률') || '0%';
  const fields = [
    { label: '포트폴리오명', value: accountName },
    { label: '종목명', value: stockName },
    { label: '종목 티커', value: ticker },
    { label: '날짜', value: recordedAt },
    { label: '매수가', value: buyPrice },
    { label: '매수통화', value: purchaseCurrency },
    { label: '보유수량', value: shares },
    { label: '수익률', value: returnDetail },
    { label: '자산군', value: assetClass },
    { label: '분야', value: sector },
    { label: '현재가', value: marketPrice },
    { label: '통화', value: marketCurrency },
    { label: '시세시각', value: marketUpdatedAt },
  ].filter((field) => String(field.value ?? '').trim());

  return {
    id:
      row?.id ||
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `manual-${Date.now()}-${index}`),
    label: stockName,
    name: stockName,
    detail: returnDetail,
    stockName,
    stockCode: ticker,
    ticker,
    code: ticker,
    accountType: accountName,
    accountName,
    recordedAt,
    buyPrice,
    purchaseCurrency,
    shares,
    return: returnDetail,
    assetClass,
    sector,
    marketPrice,
    currency: marketCurrency,
    marketUpdatedAt,
    fields,
    metadataSource: 'manual-entry',
    metadataSourceByField: {
      accountType: 'manual',
      stockName: 'manual',
      stockCode: ticker ? 'manual' : 'fallback',
      buyPrice: buyPrice ? 'manual' : 'fallback',
      shares: shares ? 'manual' : 'fallback',
      return: 'manual',
      assetClass: 'manual',
    },
  };
}

export default function App() {
  const shellRef = useRef(null);
  const svgRef = useRef(null);
  const fileInputRef = useRef(null);
  // Full holding names (atom.label) render unclamped on desktop, where the stage sits with wide
  // margins on every side — there's room. On a phone-width viewport the stage itself sits close
  // to the screen edges (see .stage-frame's own narrow-viewport width formula in styles.css), so
  // a long name on an outer-ring holding can run clean off the edge of the *page*, not just the
  // stage — see AtomLabel in components/atom/index.jsx for where this actually gets applied.
  // null = no truncation (the existing, unclamped desktop behavior).
  const windowWidth = useViewportWidth();
  const atomLabelMaxLength = windowWidth < 480 ? 13 : windowWidth < 768 ? 20 : null;
  const atomsRef = useRef(
    generateAtomLayout([], { resolveLabel: resolveAtomStockDisplayName }).map(createAtomState),
  );
  // Layout for the *next* portfolio, computed ahead of time during dissolve instead of at the
  // swap instant — see switchToPortfolio (which fills this in as soon as the target portfolio is
  // known, well before the swap) and the atomsRef-filling effect further down (which reads it
  // instead of calling generateAtomLayout fresh, when it's for the portfolio actually being
  // switched to). entryId doubles as the "is this still valid" check: a live quote refresh
  // on the *current* portfolio also changes portfolioItems without going through this precompute
  // path at all, so its entryId simply won't match and the effect falls back to computing fresh,
  // the same as before this existed.
  const precomputedAtomLayoutRef = useRef({ entryId: null, atoms: null });
  // See the atomsRef-rebuild effect below (keyed on [portfolioItems, activePortfolioId]) for why
  // this exists: it needs to tell a genuine portfolio switch apart from a same-portfolio live
  // quote refresh, both of which land here as "portfolioItems changed reference".
  const lastAtomLayoutIdentityRef = useRef({ entryId: null, itemCount: 0 });
  const cameraRef = useRef(createSceneCameraRig());
  const rotationRef = useRef({
    current: new THREE.Quaternion(),
    target: new THREE.Quaternion(),
    lastTrack: new THREE.Vector3(0, 0, 1),
    spinAxis: new THREE.Vector3(0, 1, 0),
    spinVelocity: 0,
    lastDragAt: 0,
  });
  const spreadRef = useRef({ current: 0, target: 0, timeoutId: null });
  const dragRef = useRef({ atomId: null, moved: false, startX: 0, startY: 0 });
  const interactionRef = useRef({
    lastInputAt: typeof performance !== 'undefined' ? performance.now() : 0,
    hoveringAtomId: null,
    selectedAtomId: null,
  });
  const motionPreferenceRef = useRef({
    reduced: readPrefersReducedMotion(),
    visible: typeof document === 'undefined' || document.visibilityState !== 'hidden',
  });
  const frameCommitRef = useRef(0);
  const targetTiltRef = useRef({ x: 0, y: 0 });
  const currentTiltRef = useRef({ x: 0, y: 0 });
  // Dissolve/materialize when the main atom's own data changes (a user-initiated portfolio
  // switch) — see switchToPortfolio below (which drives it) and the rAF loop further down (which
  // reads transitionAngularVelocityRef every frame).
  const {
    scale: atomTransitionScale,
    phase: atomTransitionPhase,
    transitionAngularVelocityRef: atomTransitionAngularVelocityRef,
    dissolve: dissolveAtom,
    materialize: materializeAtom,
    advanceTransition: advanceAtomTransition,
  } = useAtomTransition();
  const pendingHoverInfoRef = useRef(null);
  const restoredPortfolioStateRef = useRef(null);
  const portfolioSyncTimerRef = useRef(0);
  const portfolioAutoEnrichmentRef = useRef(new Set());
  // Latest request token issued per entryId by scheduleLiveQuoteEnrichment below — the 90s
  // background refresh interval fires again regardless of whether the previous round's fetch
  // has resolved yet, and enrichPortfolioItemsWithLiveQuotes has no cancellation of its own, so a
  // slow round finishing after a faster, later one would otherwise silently overwrite fresher
  // quotes with stale ones for the rest of that 90s window. Keyed by entryId (not a single ref)
  // since more than one portfolio's items can be scheduled for enrichment around the same time
  // (import, hydration, and the live-refresh tick all call this for whichever entry is theirs).
  const liveQuoteEnrichmentTokenRef = useRef(new Map());
  if (restoredPortfolioStateRef.current === null) {
    restoredPortfolioStateRef.current = readStoredPortfolioState();
  }
  const restoredPortfolioState = restoredPortfolioStateRef.current;
  const portfolioLastSavedAtRef = useRef(restoredPortfolioState.savedAt);
  const [portfolioEntries, setPortfolioEntries] = useState(() => restoredPortfolioState.entries);
  const portfolioEntriesRef = useRef(restoredPortfolioState.entries);
  const activePortfolioLiveItemsRef = useRef([]);
  const [activePortfolioId, setActivePortfolioId] = useState(
    () => restoredPortfolioState.activePortfolioId,
  );
  // The single dissolve -> swap -> materialize path for every *user-initiated* portfolio switch
  // (preview-atom click, the accounts list / comparison table pickers, command-palette "go to
  // holding" landing on a different portfolio, creating a new portfolio and jumping to it, ...) —
  // originally written just for the preview-atom click, generalized here so every one of those
  // plays the same transition instead of only that one path snapping instantly like the rest used
  // to. Deliberately NOT used for programmatic changes (initial load, delete-fallback, background
  // server-merge reconciliation) — those still call setActivePortfolioId directly further down;
  // animating those would read as a flicker at exactly the moment (delete, load) it'd be most
  // jarring, not as a deliberate transition.
  const switchToPortfolio = useCallback(
    async (entryId) => {
      if (!entryId || entryId === activePortfolioId || atomTransitionPhase !== 'idle') {
        return;
      }
      // Compute the target portfolio's layout now, in parallel with the dissolve that's about to
      // play, instead of leaving it for the swap-effect to compute at the dissolve->materialize
      // handoff (previously the one moment this synchronous work could actually land as a felt
      // hitch — right as the atom needs to start growing back in). ~420ms of dissolve is plenty
      // of headroom for a layout pass over any realistic holdings count.
      const targetEntry = portfolioEntriesRef.current.find((entry) => entry.id === entryId);
      precomputedAtomLayoutRef.current = {
        entryId,
        atoms: generateAtomLayout(targetEntry?.items ?? [], {
          resolveLabel: resolveAtomStockDisplayName,
        }).map(createAtomState),
      };
      await dissolveAtom();
      setActivePortfolioId(entryId);
      await materializeAtom();
    },
    [activePortfolioId, atomTransitionPhase, dissolveAtom, materializeAtom],
  );
  const [portfolioError, setPortfolioError] = useState('');
  const [portfolioErrorClosing, setPortfolioErrorClosing] = useState(false);
  const [hoveredFileEntryId, setHoveredFileEntryId] = useState(null);
  const [, setHoveredFileAnchorRect] = useState(null);
  const [toolTrayOpen, setToolTrayOpen] = useState(false);
  const [activeDrawerTool, setActiveDrawerTool] = useState(null);
  const [toolDrawerWidth, setToolDrawerWidth] = useState(TOOL_DRAWER_DEFAULT_WIDTH);
  const [toolDrawerDock, setToolDrawerDock] = useState(() =>
    readStoredOption(STORAGE_KEYS.toolDrawerDock, TOOL_DRAWER_DOCK_OPTIONS, 'left'),
  );
  // Which screen edge is currently highlighted while dragging the drawer's dock handle — null
  // outside of an active drag. Lifted up here (rather than kept local to ToolSideDrawer) because
  // the highlight itself has to render as a full screen-edge bar *outside* .tool-drawer — that
  // element has its own clip-path now (see Stage 1), which would clip a same-element child down
  // to the rail too, same problem as the light-mode background bleed that turned up there.
  const [dockDragHoverEdge, setDockDragHoverEdge] = useState(null);
  // Cmd+K palette (search/add/move/delete holdings in one place) and the pending-ticker handoff
  // into the existing manual-entry form when the palette's "add" row is chosen — see
  // openManualToolWithTicker below for why this is a prop into ToolSideDrawer rather than lifting
  // its whole manual-form state up here.
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [pendingManualTicker, setPendingManualTicker] = useState(null);
  const [, setShowGroupDock] = useState(() => restoredPortfolioState.entries.length > 0);
  const [, setShowScoreDock] = useState(() => restoredPortfolioState.entries.length > 0);
  const [, setGroupDockSpawn] = useState(null);
  const [, setScoreDockSpawn] = useState(null);
  const [activeGroupKey, setActiveGroupKey] = useState(null);
  const [selectedAtomId, setSelectedAtomId] = useState(null);
  // First-visit-only hint on the atom stage — dismissed on first interaction or after a few
  // seconds either way, then remembered so it never comes back. Same copy/timing as the desktop
  // popover's own atom hint (desktop/src/renderer/atom-view.jsx).
  const [atomHintVisible, setAtomHintVisible] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    try {
      return window.localStorage.getItem(STORAGE_KEYS.atomHintDismissed) !== '1';
    } catch {
      return false;
    }
  });
  const dismissAtomHint = useCallback(() => {
    setAtomHintVisible(false);
    try {
      window.localStorage.setItem(STORAGE_KEYS.atomHintDismissed, '1');
    } catch {
      // Worst case it reappears next visit — not harmful enough to handle further.
    }
  }, []);
  useEffect(() => {
    if (!atomHintVisible) {
      return undefined;
    }
    const timer = setTimeout(dismissAtomHint, 4000);
    return () => clearTimeout(timer);
  }, [atomHintVisible, dismissAtomHint]);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [frameTime, setFrameTime] = useState(0);
  const [shootingStar, setShootingStar] = useState(null);
  const [fileDragActive, setFileDragActive] = useState(false);
  const fileDragCounterRef = useRef(0);
  const [, setPortfolioLoading] = useState(false);
  const [introCenterBurstAt, setIntroCenterBurstAt] = useState(-1);
  const [activeFloatingTool, setActiveFloatingTool] = useState(null);
  const [language, setLanguage] = useState(() => {
    if (typeof window === 'undefined') {
      return 'ko';
    }

    return readStoredOption(STORAGE_KEYS.language, LANGUAGE_OPTIONS, 'ko');
  });
  const text = textFor(language);
  const [baseCurrency, setBaseCurrency] = useState(() =>
    readStoredOption(STORAGE_KEYS.baseCurrency, BASE_CURRENCY_OPTIONS, 'KRW'),
  );
  const [usdKrwRate, setUsdKrwRate] = useState(DEFAULT_USD_KRW_RATE);
  const [dateBasis, setDateBasis] = useState(() =>
    readStoredOption(STORAGE_KEYS.dateBasis, DATE_BASIS_OPTIONS, 'kst'),
  );
  const [autoSaveMode, setAutoSaveMode] = useState(() =>
    readStoredOption(STORAGE_KEYS.autoSave, SETTING_TOGGLE_OPTIONS, 'on'),
  );
  const [dailySnapshotMode, setDailySnapshotMode] = useState(() =>
    readStoredOption(STORAGE_KEYS.dailySnapshots, SETTING_TOGGLE_OPTIONS, 'on'),
  );
  const [, setPortfolioSavedAt] = useState(() => restoredPortfolioState.savedAt);
  const [portfolioSyncStatus, setPortfolioSyncStatus] = useState('idle');
  const [assetClassMode] = useState(() =>
    readStoredOption(STORAGE_KEYS.assetClassMode, ASSET_CLASS_MODE_OPTIONS, 'auto'),
  );
  const [allocationWeightMode] = useState(() =>
    readStoredOption(STORAGE_KEYS.allocationWeightMode, ALLOCATION_WEIGHT_MODE_OPTIONS, 'auto'),
  );
  const [scoreWeightPreset, setScoreWeightPreset] = useState(() =>
    readStoredOption(STORAGE_KEYS.scoreWeightPreset, SCORE_WEIGHT_PRESET_OPTIONS, 'balanced'),
  );
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState(() => getPortfolioWorkspaceId());
  // 'idle' | 'copied' | 'failed' — drives the settings panel's click-to-copy feedback on the
  // workspace ID. A ref alongside the state so the reset timeout can always clear whatever timer
  // it itself started, even across a rapid double-click that fires handleCopyWorkspaceId twice.
  const [workspaceIdCopyStatus, setWorkspaceIdCopyStatus] = useState('idle');
  const workspaceIdCopyResetTimerRef = useRef(null);
  const [workspaceSession, setWorkspaceSession] = useState(null);
  const [workspaceClaimStatus, setWorkspaceClaimStatus] = useState('idle');
  const [workspaceClaimError, setWorkspaceClaimError] = useState('');
  // Desktop connection code (server/deviceTokens.mjs) — 'idle' | 'pending' | 'revealed' | 'failed'.
  // The raw token only ever exists in deviceTokenValue right after a successful generate call;
  // nothing re-fetches it later (the server only ever stores its hash), so navigating away or
  // regenerating is the only way it leaves this state.
  const [deviceTokenStatus, setDeviceTokenStatus] = useState('idle');
  const [deviceTokenValue, setDeviceTokenValue] = useState('');
  const [deviceTokenError, setDeviceTokenError] = useState('');
  const [deviceTokenCopyStatus, setDeviceTokenCopyStatus] = useState('idle');
  const deviceTokenCopyResetTimerRef = useRef(null);

  portfolioEntriesRef.current = portfolioEntries;

  const noteInteraction = () => {
    interactionRef.current.lastInputAt = performance.now();
  };

  const interactWithFloatingTool = useCallback((toolKey) => {
    noteInteraction();
    setActiveFloatingTool((current) => (current === toolKey ? current : toolKey));
  }, []);

  const floatingLayerStyleFor = useCallback(
    (toolKey) => ({
      zIndex:
        activeFloatingTool === toolKey
          ? ACTIVE_FLOATING_TOOL_Z_INDEX
          : FLOATING_TOOL_Z_INDEX[toolKey],
    }),
    [activeFloatingTool],
  );
  const interactWithDrawerTool = useCallback(
    () => interactWithFloatingTool('tool-drawer'),
    [interactWithFloatingTool],
  );
  const handleDrawerToolSelect = useCallback(
    (toolKey) => {
      setActiveDrawerTool(toolKey);
      setToolTrayOpen((currentOpen) => {
        if (currentOpen && activeDrawerTool === toolKey) {
          return false;
        }

        return true;
      });
    },
    [activeDrawerTool],
  );

  const openPortfolioPicker = () => {
    noteInteraction();
    fileInputRef.current?.click();
  };

  // Global Cmd+K / Ctrl+K toggle. Bound at the window level (not a specific input) so it opens
  // from anywhere — the atom scene, the tool drawer, mid-scroll in the news list — the same way
  // it does in Raycast/Linear/Notion.
  useEffect(() => {
    const handleKeyDown = (event) => {
      const isPaletteShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (!isPaletteShortcut) {
        return;
      }
      event.preventDefault();
      noteInteraction();
      setCommandPaletteOpen((current) => !current);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // The manual-entry form's ticker/name/etc. state lives inside ToolSideDrawer, not up here (it's
  // a large, self-contained form with its own market-lookup effects) — rather than lifting all of
  // that just so one new caller can seed one field, ToolSideDrawer takes this as a prop and
  // applies+clears it itself the moment it sees a new value (see its own effect for
  // pendingManualTicker). Bumping a counter alongside the ticker string is what makes re-picking
  // the *same* ticker twice in a row (add "AAPL", cancel, immediately add "AAPL" again) still
  // register as a fresh request instead of a no-op prop change.
  const openManualToolWithTicker = useCallback((ticker) => {
    noteInteraction();
    setPendingManualTicker({ ticker, requestedAt: Date.now() });
    setActiveDrawerTool('manual');
    setToolTrayOpen(true);
  }, []);

  const loadWorkspaceSession = useCallback(async () => {
    try {
      const workspaceId = getPortfolioWorkspaceId();
      const session = await fetchWorkspaceSession(workspaceId);
      setCurrentWorkspaceId(workspaceId);
      setWorkspaceSession(session);
    } catch {
      setCurrentWorkspaceId(getPortfolioWorkspaceId());
      setWorkspaceSession(null);
    }
  }, []);

  useEffect(() => {
    void loadWorkspaceSession();
  }, [loadWorkspaceSession]);

  const handleClaimGuestWorkspace = useCallback(async () => {
    const guestWorkspaceId = getPortfolioWorkspaceId();

    if (!isGuestPortfolioWorkspaceId(guestWorkspaceId)) {
      setWorkspaceClaimStatus('done');
      setWorkspaceClaimError('');
      return;
    }

    setWorkspaceClaimStatus('pending');
    setWorkspaceClaimError('');

    try {
      const payload = await claimGuestWorkspace({ guestWorkspaceId });
      if (!payload?.ok || !payload?.targetWorkspaceId) {
        throw new Error(payload?.error ?? text.workspaceClaimFailed);
      }

      const nextWorkspaceId = setPortfolioWorkspaceId(payload.targetWorkspaceId);
      setCurrentWorkspaceId(nextWorkspaceId);

      const safeEntries = Array.isArray(portfolioEntries)
        ? portfolioEntries
            .slice(0, MAX_PORTFOLIOS)
            .map(serializePortfolioEntryForStorage)
            .filter((entry) => entry.id)
        : [];

      if (safeEntries.length) {
        const syncResults = await Promise.allSettled(
          safeEntries.map((entry) => createServerPortfolio(entry, nextWorkspaceId)),
        );
        setPortfolioSyncStatus(
          syncResults.every((result) => result.status === 'fulfilled') ? 'saved' : 'offline',
        );
      }

      const copiedCount =
        Number(payload?.copied?.portfolios ?? 0) +
        Number(payload?.copied?.imports ?? 0) +
        Number(payload?.copied?.analyses ?? 0) +
        Number(payload?.copied?.snapshots ?? 0);
      setWorkspaceClaimStatus(copiedCount > 0 || safeEntries.length ? 'done' : 'empty');
      await loadWorkspaceSession();
    } catch (error) {
      setWorkspaceClaimStatus('failed');
      setWorkspaceClaimError(
        error instanceof Error && error.message ? error.message : text.workspaceClaimFailed,
      );
    }
  }, [loadWorkspaceSession, portfolioEntries, text.workspaceClaimFailed]);

  const handleAuthPanelSuccess = useCallback(() => {
    void handleClaimGuestWorkspace().then(() => loadWorkspaceSession());
  }, [handleClaimGuestWorkspace, loadWorkspaceSession]);

  const showPortfolioError = (message) => {
    setPortfolioErrorClosing(false);
    setPortfolioError(message);
  };

  const clearPortfolioError = () => {
    setPortfolioErrorClosing(false);
    setPortfolioError('');
  };

  const rollForwardSavedPortfolioHistory = useCallback(() => {
    if (dailySnapshotMode !== 'on') {
      return;
    }

    const savedAt = portfolioLastSavedAtRef.current;

    setPortfolioEntries((current) => {
      const nextEntries = rollForwardPortfolioEntriesSince(current, savedAt, dateBasis);

      if (nextEntries !== current) {
        portfolioLastSavedAtRef.current = new Date().toISOString();
      }

      return nextEntries;
    });
  }, [dailySnapshotMode, dateBasis]);

  const clearHoveredFileTooltip = useCallback(() => {
    setHoveredFileEntryId(null);
    setHoveredFileAnchorRect(null);
  }, []);

  const scheduleLiveQuoteEnrichment = useCallback((entryId, seedItems) => {
    if (!entryId || !Array.isArray(seedItems) || !seedItems.length) {
      return;
    }

    const tokens = liveQuoteEnrichmentTokenRef.current;
    const requestId = (tokens.get(entryId) ?? 0) + 1;
    tokens.set(entryId, requestId);

    void (async () => {
      try {
        const enrichedItems = await enrichPortfolioItemsWithLiveQuotes(seedItems);

        if (tokens.get(entryId) !== requestId) {
          // A newer enrichment for this same entry was scheduled (and possibly already
          // resolved) while this one was in flight — apply nothing so its stale quotes can't
          // clobber whatever the newer round already wrote.
          return;
        }

        setPortfolioEntries((current) =>
          current.map((entry) => {
            if (entry.id !== entryId) {
              return entry;
            }

            const hasMatchingTimeline =
              Array.isArray(entry.timelineItems) &&
              entry.timelineItems.length === enrichedItems.length;
            const timelineItems = hasMatchingTimeline
              ? mergePortfolioItemUpdates(entry.timelineItems, enrichedItems)
              : entry.timelineItems;
            const displaySource = hasMatchingTimeline
              ? timelineItems
              : mergePortfolioItemUpdates(entry.items, enrichedItems);

            return {
              ...entry,
              items: collapsePortfolioItemsForDisplayShared(displaySource),
              timelineItems,
            };
          }),
        );
      } catch {
        // Keep uploaded portfolio data when live quote normalization fails.
      }
    })();
  }, []);

  const scheduleSecurityMetadataEnrichment = useCallback((entryId, seedItems) => {
    if (!entryId || !Array.isArray(seedItems) || !seedItems.some(hasMissingCoreMetadata)) {
      return;
    }

    void (async () => {
      let workingItems = seedItems;

      for (const delayMs of SECURITY_ENRICHMENT_RETRY_DELAYS_MS) {
        if (delayMs > 0) {
          await wait(delayMs);
        }

        try {
          const enrichment = await enrichSecurityItemsViaApi(workingItems, { force: true });
          if (!Array.isArray(enrichment?.items) || !enrichment.items.length) {
            continue;
          }

          workingItems = enrichment.items;

          setPortfolioEntries((current) =>
            current.map((entry) =>
              entry.id === entryId
                ? {
                    ...entry,
                    items: mergeSecurityMetadataItems(entry.items, enrichment.items),
                    timelineItems:
                      Array.isArray(entry.timelineItems) &&
                      entry.timelineItems.length === enrichment.items.length
                        ? mergeSecurityMetadataItems(entry.timelineItems, enrichment.items)
                        : entry.timelineItems,
                  }
                : entry,
            ),
          );

          if (!workingItems.some(hasMissingCoreMetadata)) {
            return;
          }
        } catch {
          // Keep the best available local or server-derived metadata and retry later.
        }
      }
    })();
  }, []);

  useEffect(() => {
    if (!portfolioEntries.length) {
      portfolioAutoEnrichmentRef.current.clear();
      return;
    }

    portfolioEntries.forEach((entry) => {
      const sourceItems =
        (Array.isArray(entry.timelineItems) && entry.timelineItems.length
          ? entry.timelineItems
          : entry.items) ?? [];

      if (!entry?.id || !sourceItems.length) {
        return;
      }

      const identifierKey =
        sourceItems.map(metadataMergeKey).filter(Boolean).join('|') ||
        `${entry.fileName ?? entry.id}:${sourceItems.length}`;

      if (sourceItems.some(hasMissingLiveQuote)) {
        const quoteKey = `${entry.id}:quote:${identifierKey}`;
        if (!portfolioAutoEnrichmentRef.current.has(quoteKey)) {
          portfolioAutoEnrichmentRef.current.add(quoteKey);
          scheduleLiveQuoteEnrichment(entry.id, sourceItems);
        }
      }

      if (sourceItems.some(hasMissingCoreMetadata)) {
        const metadataKey = `${entry.id}:metadata:${identifierKey}`;
        if (!portfolioAutoEnrichmentRef.current.has(metadataKey)) {
          portfolioAutoEnrichmentRef.current.add(metadataKey);
          const locallyEnrichedItems = sourceItems.map((item) => enrichPortfolioItem(item));

          setPortfolioEntries((current) =>
            current.map((currentEntry) =>
              currentEntry.id === entry.id
                ? {
                    ...currentEntry,
                    items: mergeSecurityMetadataItems(currentEntry.items, locallyEnrichedItems),
                    timelineItems:
                      Array.isArray(currentEntry.timelineItems) && currentEntry.timelineItems.length
                        ? mergeSecurityMetadataItems(
                            currentEntry.timelineItems,
                            locallyEnrichedItems,
                          )
                        : currentEntry.timelineItems,
                  }
                : currentEntry,
            ),
          );
          scheduleSecurityMetadataEnrichment(entry.id, locallyEnrichedItems);
        }
      }
    });
  }, [portfolioEntries, scheduleLiveQuoteEnrichment, scheduleSecurityMetadataEnrichment]);

  const updateHoverInfo = (atomId, clientX, clientY) => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    pendingHoverInfoRef.current = {
      atomId,
      x: Math.round(clamp(clientX + 18, 16, viewportWidth - TOOLTIP_WIDTH - 16)),
      y: Math.round(clamp(clientY + 18, 16, viewportHeight - TOOLTIP_HEIGHT - 16)),
    };
  };

  const clientToLocalPoint = (clientX, clientY) => {
    const svg = svgRef.current;

    if (!svg) {
      return null;
    }

    const bounds = svg.getBoundingClientRect();

    if (!bounds.width || !bounds.height) {
      return null;
    }

    return {
      x: ((clientX - bounds.left) / bounds.width) * VIEWBOX_SIZE - VIEWBOX_HALF,
      y: ((clientY - bounds.top) / bounds.height) * VIEWBOX_SIZE - VIEWBOX_HALF,
    };
  };

  useEffect(() => {
    interactionRef.current.selectedAtomId = selectedAtomId;
  }, [selectedAtomId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const motionQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    const syncMotionPreference = () => {
      motionPreferenceRef.current.reduced = Boolean(motionQuery?.matches);
      document.documentElement.dataset.motion = motionPreferenceRef.current.reduced
        ? 'reduced'
        : 'full';
      frameCommitRef.current = 0;
    };

    const syncVisibility = () => {
      motionPreferenceRef.current.visible = document.visibilityState !== 'hidden';
      frameCommitRef.current = 0;
    };

    syncMotionPreference();
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    if (motionQuery?.addEventListener) {
      motionQuery.addEventListener('change', syncMotionPreference);
    } else {
      motionQuery?.addListener?.(syncMotionPreference);
    }

    return () => {
      document.removeEventListener('visibilitychange', syncVisibility);
      if (motionQuery?.removeEventListener) {
        motionQuery.removeEventListener('change', syncMotionPreference);
      } else {
        motionQuery?.removeListener?.(syncMotionPreference);
      }
      delete document.documentElement.dataset.motion;
    };
  }, []);

  useEffect(() => {
    let frameId = 0;
    let last = performance.now();
    const autoRotateY = new THREE.Quaternion();
    const autoRotateX = new THREE.Quaternion();
    const spinQuaternion = new THREE.Quaternion();
    const transitionSpinY = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const xAxis = new THREE.Vector3(1, 0, 0);

    const animate = (now) => {
      const delta = Math.min((now - last) / 1000, 0.05);
      last = now;
      const motionPreference = motionPreferenceRef.current;
      const isDraggingStructure = Boolean(dragRef.current.atomId);
      const hasDragSpin = rotationRef.current.spinVelocity > 0.01;

      if (!motionPreference.visible) {
        frameId = window.requestAnimationFrame(animate);
        return;
      }

      currentTiltRef.current.x = damp(currentTiltRef.current.x, targetTiltRef.current.x, 7, delta);
      currentTiltRef.current.y = damp(currentTiltRef.current.y, targetTiltRef.current.y, 7, delta);

      if (shellRef.current) {
        shellRef.current.style.setProperty(
          '--drift-x',
          `${(motionPreference.reduced ? 0 : currentTiltRef.current.x * 4).toFixed(2)}px`,
        );
        shellRef.current.style.setProperty(
          '--drift-y',
          `${(motionPreference.reduced ? 0 : currentTiltRef.current.y * 4).toFixed(2)}px`,
        );
      }

      for (const atom of atomsRef.current) {
        atom.hoverMix = damp(atom.hoverMix, atom.hovered ? 1 : 0, 10, delta);
        atom.dragMix = damp(atom.dragMix, atom.dragging ? 1 : 0, 12, delta);
      }

      spreadRef.current.current = damp(
        spreadRef.current.current,
        spreadRef.current.target,
        spreadRef.current.target > spreadRef.current.current ? 12 : 18,
        delta,
      );

      const shouldAutoRotate = !motionPreference.reduced && !isDraggingStructure;

      if (!motionPreference.reduced && !isDraggingStructure && hasDragSpin) {
        spinQuaternion.setFromAxisAngle(
          rotationRef.current.spinAxis,
          Math.min(rotationRef.current.spinVelocity * delta, 0.04),
        );
        rotationRef.current.target.premultiply(spinQuaternion).normalize();
        rotationRef.current.spinVelocity *= Math.exp(-DRAG_SPIN_DECAY * delta);
        if (rotationRef.current.spinVelocity < 0.01) {
          rotationRef.current.spinVelocity = 0;
        }
      }

      if (shouldAutoRotate) {
        autoRotateY.setFromAxisAngle(yAxis, delta * AUTO_ROTATE_SPEED);
        autoRotateX.setFromAxisAngle(xAxis, Math.sin(now * 0.00012) * delta * 0.0038);
        rotationRef.current.target.premultiply(autoRotateY).premultiply(autoRotateX).normalize();
      }

      // Drives useAtomTransition's own progress — this loop is the only rAF loop either of them
      // runs now, so this is the one place that has to call it. A no-op whenever no
      // dissolve()/materialize() is in flight. Must run before the read below, so that read sees
      // this frame's velocity rather than last frame's.
      advanceAtomTransition(now);

      // Dissolve/materialize's own spin — added on top of (not multiplied into) idle rotation
      // above, and applies regardless of the drag/reduced-motion gating on that idle rotation:
      // this is a transition playing out on its own timeline, not ambient drift.
      // useAtomTransition itself zeroes this out under prefers-reduced-motion, so there's no
      // separate guard needed here for that.
      if (atomTransitionAngularVelocityRef.current !== 0) {
        transitionSpinY.setFromAxisAngle(yAxis, delta * atomTransitionAngularVelocityRef.current);
        rotationRef.current.target.premultiply(transitionSpinY).normalize();
      }

      rotationRef.current.current.slerp(
        rotationRef.current.target,
        1 -
          Math.exp(
            -(isDraggingStructure ? DRAG_ROTATION_RESPONSE : IDLE_ROTATION_RESPONSE) * delta,
          ),
      );
      rotationRef.current.current.normalize();
      const idleDriftX = motionPreference.reduced
        ? 0
        : Math.sin(now * 0.00018) * 8.2 +
          Math.cos(now * 0.000071 + currentTiltRef.current.x * 0.8) * 2.0;
      const idleDriftY = motionPreference.reduced
        ? 0
        : Math.cos(now * 0.00015) * 6.4 +
          Math.sin(now * 0.000096 + currentTiltRef.current.y * 0.9) * 1.8;

      cameraRef.current.target.focus = 0;
      cameraRef.current.target.panX = 0;
      cameraRef.current.target.panY = 0;
      cameraRef.current.target.dolly = 0;
      cameraRef.current.target.zoom = 1;
      cameraRef.current.target.roll = motionPreference.reduced
        ? 0
        : Math.sin(now * 0.00009) * 0.64 + currentTiltRef.current.x * 0.42;
      cameraRef.current.target.driftX = idleDriftX;
      cameraRef.current.target.driftY = idleDriftY;

      cameraRef.current.current.panX = damp(
        cameraRef.current.current.panX,
        cameraRef.current.target.panX,
        5.8,
        delta,
      );
      cameraRef.current.current.panY = damp(
        cameraRef.current.current.panY,
        cameraRef.current.target.panY,
        5.8,
        delta,
      );
      cameraRef.current.current.dolly = damp(
        cameraRef.current.current.dolly,
        cameraRef.current.target.dolly,
        6.4,
        delta,
      );
      cameraRef.current.current.zoom = damp(
        cameraRef.current.current.zoom,
        cameraRef.current.target.zoom,
        6.2,
        delta,
      );
      cameraRef.current.current.roll = damp(
        cameraRef.current.current.roll,
        cameraRef.current.target.roll,
        5.4,
        delta,
      );
      cameraRef.current.current.driftX = damp(
        cameraRef.current.current.driftX,
        cameraRef.current.target.driftX,
        3.8,
        delta,
      );
      cameraRef.current.current.driftY = damp(
        cameraRef.current.current.driftY,
        cameraRef.current.target.driftY,
        3.8,
        delta,
      );
      cameraRef.current.current.focus = damp(
        cameraRef.current.current.focus,
        cameraRef.current.target.focus,
        6.8,
        delta,
      );

      if (
        now - frameCommitRef.current >=
        sceneFrameIntervalFor(
          atomsRef.current.length,
          motionPreference.reduced,
          isDraggingStructure || hasDragSpin,
        )
      ) {
        frameCommitRef.current = now;
        setFrameTime(now);
        if (pendingHoverInfoRef.current !== null) {
          const pending = pendingHoverInfoRef.current;
          pendingHoverInfoRef.current = null;
          setHoverInfo((current) => {
            if (
              current?.atomId === pending.atomId &&
              current.x === pending.x &&
              current.y === pending.y
            ) {
              return current;
            }
            return pending;
          });
        }
      }
      frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(spreadRef.current.timeoutId);
      document.body.style.cursor = '';
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEYS.language, language);
    document.documentElement.lang = language === 'en' ? 'en' : 'ko';
  }, [language]);

  // Dark is the only mode this app renders (see styles.css's base :root) — no light/dark toggle,
  // no system-preference detection. This one-time cleanup just erases any 'light'/'dark' choice a
  // now-removed settings toggle may have written to a browser in an earlier build, so a returning
  // visitor's page doesn't carry over a stale data-theme attribute that no longer has any matching
  // CSS rule to key off (harmless either way, but no reason to leave it sitting there).
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = 'dark';
    window.localStorage.removeItem('atom-sketch-theme');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEYS.baseCurrency, baseCurrency);
  }, [baseCurrency]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEYS.toolDrawerDock, toolDrawerDock);
  }, [toolDrawerDock]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const controller = new AbortController();
    let active = true;

    const loadUsdKrwRate = async () => {
      try {
        const rateData = await fetchLiveMarketData({
          ticker: 'USDKRW=X',
          name: 'USD/KRW',
          signal: controller.signal,
        });
        const nextRate = Number(rateData?.latestPrice);

        if (!active || controller.signal.aborted || !Number.isFinite(nextRate) || nextRate <= 0) {
          return;
        }

        setUsdKrwRate(nextRate);
      } catch {
        // Keep the fallback exchange rate when the live FX lookup is unavailable.
      }
    };

    loadUsdKrwRate();
    const intervalId = window.setInterval(loadUsdKrwRate, 15 * 60 * 1000);

    return () => {
      active = false;
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEYS.dateBasis, dateBasis);
  }, [dateBasis]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEYS.autoSave, autoSaveMode);
  }, [autoSaveMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEYS.dailySnapshots, dailySnapshotMode);
  }, [dailySnapshotMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const motionQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    let clearId = 0;

    const triggerShootingStar = () => {
      if (motionQuery?.matches || document.visibilityState === 'hidden') {
        return;
      }

      const nextShootingStar = createShootingStar();
      setShootingStar(nextShootingStar);
      window.clearTimeout(clearId);
      clearId = window.setTimeout(() => {
        setShootingStar((current) => (current?.id === nextShootingStar.id ? null : current));
      }, nextShootingStar.duration + SHOOTING_STAR_CLEAR_BUFFER_MS);
    };

    const clearActiveShootingStar = () => {
      if (!motionQuery?.matches && document.visibilityState !== 'hidden') {
        return;
      }

      window.clearTimeout(clearId);
      setShootingStar(null);
    };

    const intervalId = window.setInterval(triggerShootingStar, SHOOTING_STAR_INTERVAL_MS);
    document.addEventListener('visibilitychange', clearActiveShootingStar);
    if (motionQuery?.addEventListener) {
      motionQuery.addEventListener('change', clearActiveShootingStar);
    } else {
      motionQuery?.addListener?.(clearActiveShootingStar);
    }

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(clearId);
      document.removeEventListener('visibilitychange', clearActiveShootingStar);
      if (motionQuery?.removeEventListener) {
        motionQuery.removeEventListener('change', clearActiveShootingStar);
      } else {
        motionQuery?.removeListener?.(clearActiveShootingStar);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEYS.assetClassMode, assetClassMode);
  }, [assetClassMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEYS.allocationWeightMode, allocationWeightMode);
  }, [allocationWeightMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEYS.scoreWeightPreset, scoreWeightPreset);
  }, [scoreWeightPreset]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    if (dailySnapshotMode !== 'on') {
      return undefined;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        rollForwardSavedPortfolioHistory();
      }
    };

    const intervalId = window.setInterval(
      rollForwardSavedPortfolioHistory,
      DAILY_SNAPSHOT_CHECK_INTERVAL_MS,
    );

    window.addEventListener('focus', rollForwardSavedPortfolioHistory);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', rollForwardSavedPortfolioHistory);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [dailySnapshotMode, rollForwardSavedPortfolioHistory]);

  useEffect(() => {
    if (dailySnapshotMode !== 'on') {
      return;
    }

    rollForwardSavedPortfolioHistory();
  }, [dailySnapshotMode, dateBasis, rollForwardSavedPortfolioHistory]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    let cancelled = false;

    void listServerPortfolios()
      .then((payload) => {
        if (cancelled) {
          return;
        }

        const serverEntries = Array.isArray(payload?.portfolios)
          ? payload.portfolios
              .slice(0, MAX_PORTFOLIOS)
              .map((portfolio) => {
                const entry = createPortfolioEntryFromPayload(portfolio, portfolio?.id);
                return dailySnapshotMode === 'on'
                  ? rollForwardPortfolioEntry(
                      entry,
                      portfolio?.updatedAt ?? portfolio?.createdAt,
                      dateBasis,
                    )
                  : entry;
              })
              .filter((entry) => entry.id)
          : [];

        if (!serverEntries.length) {
          return;
        }

        const { entries: mergedEntries, summary } = mergePortfolioEntriesWithServer(
          portfolioEntriesRef.current,
          serverEntries,
        );
        const hasServerUpdates = summary.addedFromServer > 0 || summary.updatedFromServer > 0;

        if (hasServerUpdates) {
          portfolioEntriesRef.current = mergedEntries;
          setPortfolioEntries(mergedEntries);
          setActivePortfolioId((current) =>
            mergedEntries.some((entry) => entry.id === current)
              ? current
              : (mergedEntries[0]?.id ?? null),
          );
          setPortfolioSyncStatus('server-merged');
          setShowGroupDock(true);
          setShowScoreDock(true);
          return;
        }

        if (summary.localNewer > 0) {
          setPortfolioSyncStatus('conflict');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPortfolioSyncStatus('offline');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dailySnapshotMode, dateBasis]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    window.clearTimeout(portfolioSyncTimerRef.current);
    let cancelled = false;

    if (autoSaveMode !== 'on') {
      setPortfolioSyncStatus('paused');
      return undefined;
    }

    const persistedAt = writeStoredPortfolioState(portfolioEntries, activePortfolioId);
    const localPersistFailed = portfolioEntries.length > 0 && !persistedAt;
    portfolioLastSavedAtRef.current = persistedAt;
    setPortfolioSavedAt(persistedAt);

    const safeEntries = Array.isArray(portfolioEntries)
      ? portfolioEntries
          .slice(0, MAX_PORTFOLIOS)
          .map(serializePortfolioEntryForStorage)
          .filter((entry) => entry.id)
      : [];

    if (!safeEntries.length) {
      setPortfolioSyncStatus('idle');
      return undefined;
    }

    setPortfolioSyncStatus(localPersistFailed ? 'local-failed' : 'pending');
    portfolioSyncTimerRef.current = window.setTimeout(() => {
      void Promise.allSettled(safeEntries.map((entry) => createServerPortfolio(entry)))
        .then((results) => {
          if (cancelled) {
            return;
          }

          const allSaved = results.every((result) => result.status === 'fulfilled');
          setPortfolioSyncStatus(
            allSaved ? (localPersistFailed ? 'local-failed' : 'saved') : 'offline',
          );
        })
        .catch(() => {
          if (!cancelled) {
            setPortfolioSyncStatus('offline');
          }
        });
    }, SERVER_SYNC_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(portfolioSyncTimerRef.current);
    };
  }, [activePortfolioId, autoSaveMode, portfolioEntries]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        event.target.isContentEditable
      ) {
        return;
      }

      if (event.key === 'Escape') {
        return;
      }

      if (
        (event.key === 'u' || event.key === 'U') &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        openPortfolioPicker();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!portfolioError) {
      setPortfolioErrorClosing(false);
      return undefined;
    }

    const fadeId = window.setTimeout(() => {
      setPortfolioErrorClosing(true);
    }, 3000);
    const clearId = window.setTimeout(() => {
      clearPortfolioError();
    }, 3600);

    return () => {
      window.clearTimeout(fadeId);
      window.clearTimeout(clearId);
    };
  }, [portfolioError]);

  const activePortfolio =
    portfolioEntries.find((entry) => entry.id === activePortfolioId) ?? portfolioEntries[0] ?? null;
  const portfolioItems = activePortfolio?.items ?? [];
  const portfolioTimelineItems = activePortfolio?.timelineItems ?? portfolioItems;
  // Deferred counterparts feed only the side-panel analytics below (heatmap/allocation/scorecard/
  // analytics summary) — never the atom's own geometry (that reads the immediate portfolioItems
  // directly, via the effect that fills atomsRef.current), so the materialize animation always
  // grows into the *correct* new shape right away. Those four memos walk the full timeline —
  // thousands of rows for some accounts — which used to run synchronously in the same commit as
  // switching portfolios, freezing the main thread for a felt beat right in the middle of the
  // dissolve/materialize sequence. useDeferredValue lets that render happen at low priority
  // instead: React keeps showing the previous portfolio's analytics uninterrupted (not blank,
  // not stale-looking — genuinely still valid until the moment it's replaced) while the urgent
  // render (atom shape, scale, rotation) keeps painting every frame, then swaps the panels in
  // once the heavy recompute finishes a few frames later instead of one long blocking one.
  const deferredPortfolioItems = useDeferredValue(portfolioItems);
  const deferredPortfolioTimelineItems = useDeferredValue(portfolioTimelineItems);
  // Read from a ref inside the interval below rather than depending on portfolioItems/
  // portfolioTimelineItems directly — those are fresh array references on every render (the atom
  // scene's RAF loop re-renders far more often than every 90s), so depending on them would reset
  // the interval before it ever got a chance to fire.
  activePortfolioLiveItemsRef.current = portfolioTimelineItems.length
    ? portfolioTimelineItems
    : portfolioItems;

  // Keeps the holdings on screen genuinely live rather than a one-time backfill: the effect below
  // (portfolioAutoEnrichmentRef-gated) only ever fetches a quote once per holding, the first time
  // it's missing a price. This ticks in the background — only while the tab is in the foreground,
  // same gating as the news panel's auto-refresh — and re-fetches whichever portfolio is currently
  // on screen, so prices/returns keep moving instead of freezing at import time.
  useEffect(() => {
    const portfolioId = activePortfolio?.id;
    if (!portfolioId) {
      return undefined;
    }

    const tick = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      const sourceItems = activePortfolioLiveItemsRef.current.slice(
        0,
        LIVE_QUOTE_REFRESH_MAX_ITEMS,
      );
      if (!sourceItems.length) {
        return;
      }
      scheduleLiveQuoteEnrichment(portfolioId, sourceItems);
    };

    const intervalId = window.setInterval(tick, LIVE_QUOTE_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [activePortfolio?.id, scheduleLiveQuoteEnrichment]);

  const allPortfolioItems = useMemo(
    () => portfolioEntries.flatMap((entry) => (Array.isArray(entry.items) ? entry.items : [])),
    [portfolioEntries],
  );

  useEffect(() => {
    // Reuse the layout switchToPortfolio already computed during the dissolve that just played,
    // if this is that same swap landing — entryId mismatch (a live quote refresh on the
    // still-active portfolio, the very first mount, a programmatic switch that never went through
    // switchToPortfolio's precompute path at all) falls back to computing it fresh right here,
    // exactly as before this existed.
    const precomputed = precomputedAtomLayoutRef.current;
    precomputedAtomLayoutRef.current = { entryId: null, atoms: null };
    atomsRef.current =
      precomputed.entryId != null && precomputed.entryId === activePortfolioId
        ? precomputed.atoms
        : generateAtomLayout(portfolioItems, { resolveLabel: resolveAtomStockDisplayName }).map(
            createAtomState,
          );

    // A live quote refresh on the still-active portfolio (see the interval a few effects below)
    // replaces portfolioItems with a new array of the *same* holdings — same entryId, same count
    // — purely so their price fields stay current. That still lands here, since it's a
    // portfolioItems reference change same as an actual switch. It used to be treated identically
    // to one: this effect unconditionally cleared the current selection/hover/drag state on every
    // run, so clicking an atom to open its detail panel and then just leaving the mouse still, the
    // very next quote tick would silently close the panel out from under the user — no click, no
    // cursor movement, just a price update. Only reset that interaction state on an actual switch
    // (different portfolio, or the holdings themselves were added/removed) — a plain refresh keeps
    // the rebuilt atomsRef.current (so prices/labels still stay live) but leaves whatever the user
    // was doing alone.
    const isGenuineSwitch =
      lastAtomLayoutIdentityRef.current.entryId !== activePortfolioId ||
      lastAtomLayoutIdentityRef.current.itemCount !== portfolioItems.length;
    lastAtomLayoutIdentityRef.current = {
      entryId: activePortfolioId,
      itemCount: portfolioItems.length,
    };

    if (!isGenuineSwitch) {
      return;
    }

    dragRef.current.atomId = null;
    dragRef.current.moved = false;
    rotationRef.current.spinVelocity = 0;
    interactionRef.current.hoveringAtomId = null;
    interactionRef.current.selectedAtomId = null;
    interactionRef.current.lastInputAt = performance.now();
    pendingHoverInfoRef.current = null;
    document.body.style.cursor = '';
    setSelectedAtomId(null);
    setHoverInfo(null);
  }, [portfolioItems, activePortfolioId]);

  useEffect(() => {
    if (!portfolioEntries.length) {
      if (activePortfolioId) {
        setActivePortfolioId(null);
      }
      return;
    }

    if (!portfolioEntries.some((entry) => entry.id === activePortfolioId)) {
      setActivePortfolioId(portfolioEntries[0].id);
    }
  }, [activePortfolioId, portfolioEntries]);

  useEffect(() => {
    const deltaQuaternion = new THREE.Quaternion();
    const appliedDeltaQuaternion = new THREE.Quaternion();
    const dragSpinAxis = new THREE.Vector3();

    const updateDraggedStructure = (event) => {
      if (!dragRef.current.atomId) {
        return;
      }

      event.preventDefault();
      noteInteraction();

      if (!dragRef.current.moved) {
        const moveX = event.clientX - dragRef.current.startX;
        const moveY = event.clientY - dragRef.current.startY;
        if (moveX * moveX + moveY * moveY > 36) {
          dragRef.current.moved = true;
        }
      }

      const point = clientToLocalPoint(event.clientX, event.clientY);
      if (!point) {
        return;
      }

      const nextTrack = trackballVector(point);
      deltaQuaternion.setFromUnitVectors(rotationRef.current.lastTrack, nextTrack);
      appliedDeltaQuaternion.identity().slerp(deltaQuaternion, DRAG_ROTATION_SENSITIVITY);
      rotationRef.current.target.premultiply(appliedDeltaQuaternion).normalize();
      const now = performance.now();
      const elapsed = rotationRef.current.lastDragAt
        ? Math.max((now - rotationRef.current.lastDragAt) / 1000, 0.001)
        : 0;
      const quaternionW = clamp(appliedDeltaQuaternion.w, -1, 1);
      const angle = 2 * Math.acos(quaternionW);
      const sinHalfAngle = Math.sqrt(Math.max(0, 1 - quaternionW * quaternionW));

      if (elapsed > 0 && angle > 0.0001 && sinHalfAngle > 0.0001) {
        dragSpinAxis
          .set(
            appliedDeltaQuaternion.x / sinHalfAngle,
            appliedDeltaQuaternion.y / sinHalfAngle,
            appliedDeltaQuaternion.z / sinHalfAngle,
          )
          .normalize();
        rotationRef.current.spinAxis.lerp(dragSpinAxis, 0.42).normalize();
        rotationRef.current.spinVelocity =
          rotationRef.current.spinVelocity * 0.52 +
          clamp(angle / elapsed, 0, MAX_DRAG_SPIN_VELOCITY) * 0.48;
      }

      rotationRef.current.lastDragAt = now;
      rotationRef.current.lastTrack.copy(nextTrack);
    };

    const endDrag = () => {
      if (!dragRef.current.atomId) {
        return;
      }

      const clickedAtomId = dragRef.current.atomId;
      const wasMoved = dragRef.current.moved;
      const atom = atomsRef.current.find((item) => item.id === clickedAtomId);
      if (atom) {
        atom.dragging = false;
      }

      dragRef.current.atomId = null;
      dragRef.current.moved = false;
      if (!wasMoved) {
        rotationRef.current.spinVelocity = 0;
      } else {
        interactionRef.current.hoveringAtomId = null;
      }
      interactionRef.current.lastInputAt = performance.now();
      pendingHoverInfoRef.current = null;
      document.body.style.cursor = '';
      setHoverInfo(null);

      if (!wasMoved) {
        setSelectedAtomId((current) => (current === clickedAtomId ? null : clickedAtomId));
      }
    };

    window.addEventListener('pointermove', updateDraggedStructure, {
      passive: false,
    });
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);

    return () => {
      window.removeEventListener('pointermove', updateDraggedStructure);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, []);

  const handleNodePointerDown = (atomId, event) => {
    // Dissolving/materializing swaps the atom's underlying data out from under any rotation state
    // that was mid-gesture — ignoring new drags while a transition is in flight (rather than
    // starting one that will immediately reference stale/about-to-change atom data) is simpler and
    // safer than trying to reconcile the two.
    if (atomTransitionPhase !== 'idle') {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    if (dragRef.current.atomId) {
      const previousAtom = atomsRef.current.find((item) => item.id === dragRef.current.atomId);

      if (previousAtom) {
        previousAtom.dragging = false;
      }
    }

    const atom = atomsRef.current.find((item) => item.id === atomId);
    const point = clientToLocalPoint(event.clientX, event.clientY);

    if (!atom || !point) {
      return;
    }

    dragRef.current.atomId = atomId;
    dragRef.current.moved = false;
    dragRef.current.startX = event.clientX;
    dragRef.current.startY = event.clientY;
    interactionRef.current.hoveringAtomId = atomId;
    noteInteraction();
    atom.dragging = true;
    rotationRef.current.lastTrack.copy(trackballVector(point));
    rotationRef.current.lastDragAt = performance.now();
    rotationRef.current.spinVelocity = 0;
    frameCommitRef.current = 0;
    pendingHoverInfoRef.current = null;
    document.body.style.cursor = 'grabbing';
    setHoverInfo(null);
  };

  const handleNodeEnter = (atomId, event) => {
    const atom = atomsRef.current.find((item) => item.id === atomId);

    if (!atom) {
      return;
    }

    atom.hovered = true;
    interactionRef.current.hoveringAtomId = atomId;
    noteInteraction();
    updateHoverInfo(atomId, event.clientX, event.clientY);
    targetTiltRef.current.x = 0;
    targetTiltRef.current.y = 0;

    if (!atom.dragging) {
      document.body.style.cursor = 'grab';
    }
  };

  const handleNodeMove = (atomId, event) => {
    noteInteraction();

    if (dragRef.current.atomId) {
      return;
    }

    updateHoverInfo(atomId, event.clientX, event.clientY);
  };

  const handleNodeLeave = (atomId) => {
    const atom = atomsRef.current.find((item) => item.id === atomId);

    if (!atom) {
      if (pendingHoverInfoRef.current?.atomId === atomId) {
        pendingHoverInfoRef.current = null;
      }
      return;
    }

    atom.hovered = false;
    if (interactionRef.current.hoveringAtomId === atomId) {
      interactionRef.current.hoveringAtomId = null;
    }
    if (pendingHoverInfoRef.current?.atomId === atomId) {
      pendingHoverInfoRef.current = null;
    }
    noteInteraction();
    setHoverInfo((current) => (current?.atomId === atomId ? null : current));

    if (!atom.dragging) {
      document.body.style.cursor = '';
    }
  };

  const handleNodeKeyboardSelect = useCallback((atomId) => {
    const atom = atomsRef.current.find((item) => item.id === atomId);

    if (!atom) {
      return;
    }

    noteInteraction();
    setHoverInfo(null);
    setActiveGroupKey(null);
    setSelectedAtomId((current) => (current === atomId ? null : atomId));
  }, []);

  const handlePointerMove = () => {
    noteInteraction();
    targetTiltRef.current.x = 0;
    targetTiltRef.current.y = 0;
  };

  const handlePointerLeave = () => {
    noteInteraction();
    targetTiltRef.current.x = 0;
    targetTiltRef.current.y = 0;
  };

  const handleWheel = (event) => {
    event.preventDefault();
    noteInteraction();
    window.clearTimeout(spreadRef.current.timeoutId);
    spreadRef.current.target = 0;
    spreadRef.current.current = 0;
  };

  const handlePortfolioFileChange = async (event) => {
    const files = Array.from(event.target.files ?? []);
    const currentText = textFor(language);

    if (!files.length) {
      return;
    }

    noteInteraction();

    const remainingSlots = Math.max(0, MAX_PORTFOLIOS - portfolioEntries.length);
    if (!remainingSlots) {
      showPortfolioError(currentText.maxFilesError);
      event.target.value = '';
      return;
    }

    setPortfolioLoading(true);

    try {
      const nextPreparedEntries = [];

      for (const file of files.slice(0, remainingSlots)) {
        const text = await readPortfolioFile(file);
        const { items: localItems, diagnostics: localParserDiagnostics } =
          parsePortfolioTextDetailedShared(text);

        if (!localItems.length) {
          throw new Error(`${file.name}: ${currentText.parseError}`);
        }

        const entryId =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `portfolio-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        nextPreparedEntries.push({
          entryId,
          fileName: file.name,
          text,
          localItems,
          localParserDiagnostics,
          localEntry: createPortfolioEntryFromPayload(
            buildLocalPortfolioPayload(file.name, localItems, localParserDiagnostics),
            entryId,
          ),
        });
      }

      clearPortfolioError();
      setSelectedAtomId(null);
      setActiveGroupKey(null);
      setShowGroupDock(true);
      setShowScoreDock(true);
      setGroupDockSpawn(null);
      setScoreDockSpawn(null);
      setPortfolioEntries((current) =>
        [...current, ...nextPreparedEntries.map((entry) => entry.localEntry)].slice(
          0,
          MAX_PORTFOLIOS,
        ),
      );
      setActivePortfolioId((current) => current ?? nextPreparedEntries[0]?.entryId ?? null);
      setPortfolioLoading(false);

      nextPreparedEntries.forEach(
        ({ entryId, fileName, text, localItems, localParserDiagnostics }) => {
          void (async () => {
            let payload;

            try {
              payload = await ingestPortfolioTextViaApi(fileName, text);

              if (shouldFallbackToLocalTimelineShared(payload, localItems)) {
                payload = {
                  ...buildLocalPortfolioPayload(fileName, localItems, localParserDiagnostics, {
                    agentReview: {
                      ...(payload.agentReview ?? {}),
                      status:
                        payload.agentReview?.status === 'blocked' ? 'blocked' : 'needs-review',
                      summary:
                        payload.agentReview?.summary ??
                        '서버 결과를 받았지만 시계열 데이터는 로컬 파서를 우선 적용했습니다.',
                      warnings: [
                        ...(payload.agentReview?.warnings ?? []),
                        {
                          code: 'local-timeline-override',
                          severity: 'warning',
                          message:
                            '서버 시계열 결과가 너무 짧아 로컬 파서의 timeline 데이터를 표시합니다.',
                          source: 'client-fallback',
                        },
                      ],
                    },
                    ingestSource: 'server-with-local-timeline',
                  }),
                };
              } else {
                payload = {
                  ...payload,
                  ingestSource: 'server',
                };
              }
            } catch (error) {
              payload = buildLocalPortfolioPayload(fileName, localItems, localParserDiagnostics, {
                agentReview: {
                  mode: 'client-local-fallback',
                  status: localItems.length ? 'needs-review' : 'blocked',
                  summary: '서버 ingest에 실패해 브라우저 로컬 파서 결과를 유지합니다.',
                  warnings: [
                    {
                      code: 'server-ingest-failed',
                      severity: 'warning',
                      message:
                        error instanceof Error
                          ? error.message
                          : 'Server ingest failed. Showing the local parser result instead.',
                      source: 'client-fallback',
                    },
                  ],
                  agents: [],
                },
                ingestSource: 'client-local-fallback',
              });
            }

            const nextEntry = createPortfolioEntryFromPayload(payload, entryId);
            setPortfolioEntries((current) =>
              current.map((entry) => (entry.id === entryId ? nextEntry : entry)),
            );
            queueImportHistorySync(nextEntry);
            scheduleLiveQuoteEnrichment(entryId, nextEntry.items);
            scheduleSecurityMetadataEnrichment(entryId, payload?.items);
          })();
        },
      );
    } catch (error) {
      showPortfolioError(error instanceof Error ? error.message : currentText.readError);
      setPortfolioLoading(false);
    } finally {
      event.target.value = '';
    }
  };

  const processPortfolioFiles = async (files) => {
    const currentText = textFor(language);

    if (!files.length) {
      return;
    }

    noteInteraction();

    const remainingSlots = Math.max(0, MAX_PORTFOLIOS - portfolioEntries.length);
    if (!remainingSlots) {
      showPortfolioError(currentText.maxFilesError);
      return;
    }

    setPortfolioLoading(true);

    try {
      const nextPreparedEntries = [];

      for (const file of files.slice(0, remainingSlots)) {
        const text = await readPortfolioFile(file);
        const { items: localItems, diagnostics: localParserDiagnostics } =
          parsePortfolioTextDetailedShared(text);

        if (!localItems.length) {
          throw new Error(`${file.name}: ${currentText.parseError}`);
        }

        const entryId =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `portfolio-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        nextPreparedEntries.push({
          entryId,
          fileName: file.name,
          text,
          localItems,
          localParserDiagnostics,
          localEntry: createPortfolioEntryFromPayload(
            buildLocalPortfolioPayload(file.name, localItems, localParserDiagnostics),
            entryId,
          ),
        });
      }

      clearPortfolioError();
      setSelectedAtomId(null);
      setActiveGroupKey(null);
      setShowGroupDock(true);
      setShowScoreDock(true);
      setGroupDockSpawn(null);
      setScoreDockSpawn(null);
      setPortfolioEntries((current) =>
        [...current, ...nextPreparedEntries.map((entry) => entry.localEntry)].slice(
          0,
          MAX_PORTFOLIOS,
        ),
      );
      setActivePortfolioId((current) => current ?? nextPreparedEntries[0]?.entryId ?? null);
      setPortfolioLoading(false);

      nextPreparedEntries.forEach(
        ({ entryId, fileName, text, localItems, localParserDiagnostics }) => {
          void (async () => {
            let payload;

            try {
              payload = await ingestPortfolioTextViaApi(fileName, text);

              if (shouldFallbackToLocalTimelineShared(payload, localItems)) {
                payload = {
                  ...buildLocalPortfolioPayload(fileName, localItems, localParserDiagnostics, {
                    agentReview: {
                      ...(payload.agentReview ?? {}),
                      status:
                        payload.agentReview?.status === 'blocked' ? 'blocked' : 'needs-review',
                      summary:
                        payload.agentReview?.summary ??
                        '서버 결과를 받았지만 시계열 데이터는 로컬 파서를 우선 적용했습니다.',
                      warnings: [
                        ...(payload.agentReview?.warnings ?? []),
                        {
                          code: 'local-timeline-override',
                          severity: 'warning',
                          message:
                            '서버 시계열 결과가 너무 짧아 로컬 파서의 timeline 데이터를 표시합니다.',
                          source: 'client-fallback',
                        },
                      ],
                    },
                    ingestSource: 'server-with-local-timeline',
                  }),
                };
              } else {
                payload = {
                  ...payload,
                  ingestSource: 'server',
                };
              }
            } catch {
              payload = buildLocalPortfolioPayload(fileName, localItems, localParserDiagnostics, {
                agentReview: {
                  mode: 'client-local-fallback',
                  status: localItems.length ? 'needs-review' : 'blocked',
                  summary: '서버 ingest에 실패해 브라우저 로컬 파서 결과를 유지합니다.',
                  warnings: [
                    {
                      code: 'server-ingest-failed',
                      severity: 'warning',
                      message: 'Server ingest failed. Showing the local parser result instead.',
                      source: 'client-fallback',
                    },
                  ],
                  agents: [],
                },
                ingestSource: 'client-local-fallback',
              });
            }

            const nextEntry = createPortfolioEntryFromPayload(payload, entryId);
            setPortfolioEntries((current) =>
              current.map((entry) => (entry.id === entryId ? nextEntry : entry)),
            );
            queueImportHistorySync(nextEntry);
            scheduleLiveQuoteEnrichment(entryId, nextEntry.items);
            scheduleSecurityMetadataEnrichment(entryId, payload?.items);
          })();
        },
      );
    } catch (error) {
      showPortfolioError(error instanceof Error ? error.message : currentText.readError);
      setPortfolioLoading(false);
    }
  };

  const handleFileDragEnter = (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) {
      return;
    }

    event.preventDefault();
    fileDragCounterRef.current += 1;
    setFileDragActive(true);
  };

  const handleFileDragOver = (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleFileDragLeave = (event) => {
    fileDragCounterRef.current -= 1;
    if (fileDragCounterRef.current <= 0) {
      fileDragCounterRef.current = 0;
      setFileDragActive(false);
    }
  };

  const handleFileDrop = async (event) => {
    event.preventDefault();
    fileDragCounterRef.current = 0;
    setFileDragActive(false);

    const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => {
      const name = file.name.toLowerCase();
      return (
        name.endsWith('.csv') ||
        name.endsWith('.tsv') ||
        name.endsWith('.txt') ||
        file.type === 'text/csv' ||
        file.type === 'text/tab-separated-values' ||
        file.type === 'text/plain'
      );
    });

    await processPortfolioFiles(files);
  };

  const handleClearPortfolio = (entryId) => {
    noteInteraction();
    clearHoveredFileTooltip();
    const nextEntries = portfolioEntries.filter((entry) => entry.id !== entryId);
    const nextActiveId =
      activePortfolioId === entryId ? (nextEntries[0]?.id ?? null) : activePortfolioId;

    setPortfolioEntries(nextEntries);
    setActivePortfolioId(nextActiveId);
    void deleteServerPortfolio(entryId).catch(() => {});
    clearPortfolioError();
    if (!nextEntries.length) {
      setShowGroupDock(false);
      setShowScoreDock(false);
      setGroupDockSpawn(null);
      setScoreDockSpawn(null);
      setActiveGroupKey(null);
      setSelectedAtomId(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleCreateManualAtom = ({ accountName }) => {
    const safeAccountName = String(accountName ?? '').trim();

    if (!safeAccountName) {
      return;
    }

    if (portfolioEntries.length >= MAX_PORTFOLIOS) {
      showPortfolioError(textFor(language).maxFilesError);
      return;
    }

    noteInteraction();
    clearPortfolioError();

    const entryId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `manual-atom-${Date.now()}`;
    const payload = buildLocalPortfolioPayload(
      safeAccountName,
      [],
      {
        reviewStatus: 'ok',
        warnings: [],
      },
      {
        agentReview: {
          status: 'ok',
          summary: '사용자가 직접 생성한 포트폴리오입니다.',
          warnings: [],
          agents: [],
        },
        ingestSource: 'manual-entry',
      },
    );
    const entry = createPortfolioEntryFromPayload(payload, entryId);

    // Ref updated synchronously alongside state (not via a functional setPortfolioEntries
    // updater) so switchToPortfolio's own portfolioEntriesRef.current lookup — called right
    // below, before this render has committed — already sees this brand-new entry instead of
    // computing its precomputed layout from a still-stale, entry-less ref.
    const nextEntries = [...portfolioEntries, entry].slice(0, MAX_PORTFOLIOS);
    portfolioEntriesRef.current = nextEntries;
    setPortfolioEntries(nextEntries);
    void switchToPortfolio(entryId);
    setToolTrayOpen(true);
    setActiveDrawerTool('accounts');
  };

  const handleCreateManualPortfolio = ({ accountName, rows }) => {
    const cleanedRows = Array.isArray(rows)
      ? rows.filter((row) => String(row?.stockName ?? row?.ticker ?? '').trim())
      : [];

    if (!cleanedRows.length) {
      return;
    }

    if (portfolioEntries.length >= MAX_PORTFOLIOS) {
      showPortfolioError(textFor(language).maxFilesError);
      return;
    }

    noteInteraction();
    clearPortfolioError();

    const entryId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `manual-portfolio-${Date.now()}`;
    const safeAccountName = String(accountName ?? '').trim() || '직접 입력 포트폴리오';
    const manualItems = cleanedRows.map((row, index) =>
      createManualPortfolioItem(
        {
          ...row,
          accountName: String(row?.accountName ?? '').trim() || safeAccountName,
        },
        index,
      ),
    );
    const payload = buildLocalPortfolioPayload(
      safeAccountName,
      manualItems,
      {
        reviewStatus: 'ok',
        warnings: [],
      },
      {
        agentReview: {
          status: 'ok',
          summary: '사용자가 직접 입력한 포트폴리오별 종목입니다.',
          warnings: [],
          agents: [],
        },
        ingestSource: 'manual-entry',
      },
    );
    const entry = createPortfolioEntryFromPayload(payload, entryId);

    // See handleCreateManualAtom just above for why the ref is updated synchronously here too.
    const nextEntries = [...portfolioEntries, entry].slice(0, MAX_PORTFOLIOS);
    portfolioEntriesRef.current = nextEntries;
    setPortfolioEntries(nextEntries);
    void switchToPortfolio(entryId);
    setToolTrayOpen(true);
    setActiveDrawerTool('accounts');
  };

  const handleAppendManualHoldings = ({ entryId, accountName, rows }) => {
    const cleanedRows = Array.isArray(rows)
      ? rows.filter((row) => String(row?.stockName ?? row?.ticker ?? '').trim())
      : [];

    if (!entryId || !cleanedRows.length) {
      return;
    }

    noteInteraction();
    clearPortfolioError();

    // Computed from the closure's own portfolioEntries (not a functional setPortfolioEntries
    // updater) so the ref can be updated with this exact same value, synchronously — see
    // handleCreateManualAtom above for why switchToPortfolio needs that.
    const nextEntries = portfolioEntries.map((entry) => {
      if (entry.id !== entryId) {
        return entry;
      }

      const safeAccountName =
        String(accountName ?? '').trim() ||
        summarizePortfolioEntryAccounts(entry, language).accountText ||
        '직접 입력 포트폴리오';
      const sourceItems = (entry.timelineItems?.length ? entry.timelineItems : entry.items) ?? [];
      const nextItems = [
        ...sourceItems,
        ...cleanedRows.map((row, index) =>
          createManualPortfolioItem(
            {
              ...row,
              accountName: String(row?.accountName ?? '').trim() || safeAccountName,
            },
            sourceItems.length + index,
          ),
        ),
      ];

      return {
        ...entry,
        items: collapsePortfolioItemsForDisplayShared(nextItems),
        timelineItems: nextItems,
        parserDiagnostics: {
          ...(entry.parserDiagnostics ?? {}),
          reviewStatus: entry.parserDiagnostics?.reviewStatus ?? 'ok',
        },
      };
    });
    portfolioEntriesRef.current = nextEntries;
    setPortfolioEntries(nextEntries);
    void switchToPortfolio(entryId);
  };

  const handleUpdatePortfolioHolding = ({ entryId, itemId, itemIndex, accountName, row }) => {
    if (!entryId || !row) {
      return;
    }

    noteInteraction();
    clearPortfolioError();

    // Deliberately still plain setActivePortfolioId, not switchToPortfolio — editing one field on
    // one holding (from the management table or a drawer form) isn't a "switch portfolios" moment
    // even on the rare path where entryId isn't already the active one; dissolving/materializing
    // the whole atom over a single-field edit would read as a strange overreaction to it, not a
    // transition. This also keeps handleMoveHolding below race-free: it composes this + append,
    // and only one of the two should actually animate.
    setPortfolioEntries((current) =>
      current.map((entry) => {
        if (entry.id !== entryId) {
          return entry;
        }

        const sourceItems = (entry.timelineItems?.length ? entry.timelineItems : entry.items) ?? [];
        const targetIndex = sourceItems.findIndex((item, index) =>
          itemId ? item.id === itemId : index === itemIndex,
        );

        if (targetIndex < 0) {
          return entry;
        }

        const previousItem = sourceItems[targetIndex];
        const nextItem = createManualPortfolioItem(
          {
            ...row,
            id: previousItem.id ?? itemId,
            accountName:
              String(row?.accountName ?? '').trim() ||
              String(accountName ?? '').trim() ||
              resolveHoldingAccount(previousItem),
          },
          targetIndex,
        );
        const nextItems = sourceItems.map((item, index) =>
          index === targetIndex ? nextItem : item,
        );

        return {
          ...entry,
          items: collapsePortfolioItemsForDisplayShared(nextItems),
          timelineItems: nextItems,
          parserDiagnostics: {
            ...(entry.parserDiagnostics ?? {}),
            reviewStatus: entry.parserDiagnostics?.reviewStatus ?? 'ok',
          },
        };
      }),
    );
    setActivePortfolioId(entryId);
  };

  const handleRemovePortfolioHolding = ({ entryId, itemId, itemIds, itemIndex, itemIndexes }) => {
    if (!entryId) {
      return;
    }

    noteInteraction();
    clearPortfolioError();

    // Plain setActivePortfolioId, not switchToPortfolio — same reasoning as
    // handleUpdatePortfolioHolding just above: a single-holding delete isn't a portfolio switch,
    // and handleMoveHolding below relies on this staying instant (it composes this with an append
    // that *does* animate — two animated calls back to back would race each other).

    setPortfolioEntries((current) =>
      current.map((entry) => {
        if (entry.id !== entryId) {
          return entry;
        }

        const sourceItems = (entry.timelineItems?.length ? entry.timelineItems : entry.items) ?? [];
        const groupedIds = new Set(
          (Array.isArray(itemIds) && itemIds.length ? itemIds : [itemId])
            .map((id) => String(id ?? '').trim())
            .filter(Boolean),
        );
        const groupedIndexes = new Set(
          (Array.isArray(itemIndexes) && itemIndexes.length ? itemIndexes : [itemIndex])
            .map((index) => Number(index))
            .filter((index) => Number.isInteger(index) && index >= 0),
        );
        const nextItems = sourceItems.filter((item, index) => {
          const sourceId = String(item?.id ?? '').trim();

          if (sourceId && groupedIds.has(sourceId)) {
            return false;
          }

          if (!groupedIds.size && groupedIndexes.has(index)) {
            return false;
          }

          return true;
        });

        return {
          ...entry,
          items: collapsePortfolioItemsForDisplayShared(nextItems),
          timelineItems: nextItems,
        };
      }),
    );
    setActivePortfolioId(entryId);
  };

  // "이동" in the command palette — there's no dedicated move operation in storage, but remove +
  // append already fully round-trip a holding's data, so composing them here is the whole
  // implementation; no new state-shape or persistence path needed. Defined here (after both
  // pieces it composes) rather than up near the palette's other handlers so its useCallback deps
  // don't reference consts that haven't been declared yet in source order.
  const handleMoveHolding = useCallback(
    ({ sourceEntryId, targetEntryId, item, itemId, itemIds, itemIndex, itemIndexes }) => {
      if (!sourceEntryId || !targetEntryId || sourceEntryId === targetEntryId) {
        return;
      }
      const targetEntry = portfolioEntries.find((entry) => entry.id === targetEntryId);
      const row = {
        stockName: resolveHoldingName(item),
        ticker: resolveHoldingTicker(item),
        buyPrice: resolveHoldingMetric(item, ['매수가', 'buyPrice', 'purchasePrice']),
        shares: resolveHoldingMetric(item, ['보유수량', 'shares', 'quantity']),
        returnRate:
          String(item?.detail ?? item?.return ?? '').trim() ||
          resolveHoldingMetric(item, ['수익률', 'return']),
        assetClass: String(item?.assetClass ?? '').trim() || '주식',
      };
      handleRemovePortfolioHolding({
        entryId: sourceEntryId,
        itemId,
        itemIds,
        itemIndex,
        itemIndexes,
      });
      handleAppendManualHoldings({
        entryId: targetEntryId,
        accountName: targetEntry?.fileName?.replace(/\.csv$/i, '') || '',
        rows: [row],
      });
    },
    [portfolioEntries, handleRemovePortfolioHolding, handleAppendManualHoldings],
  );

  const hasPortfolio = portfolioEntries.length > 0;
  const hasPortfolioItems = portfolioItems.length > 0;
  const showToolDrawer = true;
  const hoveredFileEntry = useMemo(
    () => portfolioEntries.find((entry) => entry.id === hoveredFileEntryId) ?? null,
    [hoveredFileEntryId, portfolioEntries],
  );
  useEffect(() => {
    if (hoveredFileEntryId && !hoveredFileEntry) {
      clearHoveredFileTooltip();
    }
  }, [clearHoveredFileTooltip, hoveredFileEntry, hoveredFileEntryId]);
  const groupOptions = useMemo(() => groupOptionsFor(language), [language]);
  const scoreAxes = useMemo(() => scoreAxesFor(language), [language]);
  const displayFxRates = useMemo(() => buildDisplayFxRates(usdKrwRate), [usdKrwRate]);
  // One flat list, rendered in this order, no sub-grouping — keeps the settings panel to a single
  // quick-glance list rather than reintroducing section headers for five items.
  const settingsSections = [
    {
      key: 'language',
      title: text.settingsSectionLanguage,
      options: LANGUAGE_OPTIONS.map((option) => ({
        key: option,
        label: option === 'ko' ? text.korean : text.english,
        active: language === option,
        onSelect: () => setLanguage(option),
      })),
    },
    {
      key: 'base-currency',
      title: text.settingsSectionBaseCurrency,
      options: BASE_CURRENCY_OPTIONS.map((option) => ({
        key: option,
        label: option === 'KRW' ? text.settingsCurrencyKrw : text.settingsCurrencyUsd,
        active: baseCurrency === option,
        onSelect: () => setBaseCurrency(option),
      })),
    },
    {
      key: 'date-basis',
      title: text.settingsSectionDateBasis,
      options: DATE_BASIS_OPTIONS.map((option) => ({
        key: option,
        label: option === 'kst' ? text.settingsDateBasisKst : text.settingsDateBasisLocal,
        active: dateBasis === option,
        onSelect: () => setDateBasis(option),
      })),
    },
    {
      key: 'auto-save',
      title: text.settingsSectionAutoSave,
      options: SETTING_TOGGLE_OPTIONS.map((option) => ({
        key: option,
        label: option === 'on' ? text.settingsAutoSaveOn : text.settingsAutoSaveOff,
        active: autoSaveMode === option,
        onSelect: () => setAutoSaveMode(option),
      })),
    },
    {
      key: 'daily-snapshots',
      title: text.settingsSectionDailySnapshots,
      options: SETTING_TOGGLE_OPTIONS.map((option) => ({
        key: option,
        label: option === 'on' ? text.settingsDailySnapshotsOn : text.settingsDailySnapshotsOff,
        active: dailySnapshotMode === option,
        onSelect: () => setDailySnapshotMode(option),
      })),
    },
  ];
  const currentWorkspaceIsGuest = isGuestPortfolioWorkspaceId(currentWorkspaceId);
  const workspaceAuthenticated = Boolean(workspaceSession?.authenticated);
  const workspaceUserLabel =
    workspaceSession?.user?.displayName ||
    workspaceSession?.user?.email ||
    workspaceSession?.user?.id ||
    '-';
  const workspaceClaimDisabled =
    !workspaceAuthenticated || !currentWorkspaceIsGuest || workspaceClaimStatus === 'pending';
  const workspaceClaimStatusText =
    workspaceClaimStatus === 'pending'
      ? text.workspaceClaimPending
      : workspaceClaimStatus === 'done'
        ? text.workspaceClaimDone
        : workspaceClaimStatus === 'empty'
          ? text.workspaceClaimEmpty
          : workspaceClaimStatus === 'failed'
            ? workspaceClaimError || text.workspaceClaimFailed
            : workspaceAuthenticated && currentWorkspaceIsGuest
              ? text.workspaceClaimButton
              : text.workspaceClaimReady;
  const portfolioSyncStatusText =
    {
      idle: text.workspaceSyncIdle,
      pending: text.workspaceSyncPending,
      saved: text.workspaceSyncSaved,
      offline: text.workspaceSyncOffline,
      paused: text.workspaceSyncPaused,
      'server-merged': text.workspaceSyncServerMerged,
      conflict: text.workspaceSyncConflict,
      'local-failed': text.workspaceSyncLocalFailed,
    }[portfolioSyncStatus] ?? text.workspaceSyncIdle;
  // Click-to-copy for the workspace ID (requirement: no separate "copy" button to hunt for — the
  // ID itself is the click target). navigator.clipboard is the primary path; execCommand('copy')
  // via a throwaway textarea is the fallback for contexts where the Clipboard API is unavailable
  // (e.g. non-HTTPS, some embedded webviews) rather than silently doing nothing.
  //
  // navigator.clipboard.writeText's promise can hang indefinitely rather than reject — observed in
  // an automated/unfocused-document browser context, where it neither resolved nor threw, which
  // without a race would leave this whole handler (and the button's feedback) stuck forever with
  // no error and no fallback ever attempted. Racing it against a short timeout guarantees the
  // execCommand fallback still runs even when the Clipboard API silently never settles.
  const handleCopyWorkspaceId = useCallback(async () => {
    noteInteraction();
    const value = currentWorkspaceId;
    let copied = false;

    try {
      if (navigator?.clipboard?.writeText) {
        await Promise.race([
          navigator.clipboard.writeText(value),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('clipboard-write-timeout')), 800),
          ),
        ]);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied && typeof document !== 'undefined') {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {
        copied = false;
      }
    }

    clearTimeout(workspaceIdCopyResetTimerRef.current);
    setWorkspaceIdCopyStatus(copied ? 'copied' : 'failed');
    workspaceIdCopyResetTimerRef.current = setTimeout(() => setWorkspaceIdCopyStatus('idle'), 1800);
  }, [currentWorkspaceId, noteInteraction]);
  const handleGenerateDeviceToken = useCallback(async () => {
    noteInteraction();
    setDeviceTokenStatus('pending');
    setDeviceTokenError('');

    try {
      const payload = await createDesktopDeviceToken();
      if (!payload?.ok || !payload?.token) {
        throw new Error(payload?.error ?? text.desktopConnectError);
      }

      setDeviceTokenValue(payload.token);
      setDeviceTokenStatus('revealed');
    } catch (error) {
      setDeviceTokenStatus('failed');
      setDeviceTokenError(
        error instanceof Error && error.message ? error.message : text.desktopConnectError,
      );
    }
  }, [noteInteraction, text.desktopConnectError]);
  const handleRevokeDeviceTokens = useCallback(async () => {
    noteInteraction();
    setDeviceTokenStatus('pending');
    setDeviceTokenError('');

    try {
      await revokeDesktopDeviceTokens();
      setDeviceTokenValue('');
      setDeviceTokenStatus('idle');
    } catch (error) {
      setDeviceTokenStatus('failed');
      setDeviceTokenError(
        error instanceof Error && error.message ? error.message : text.desktopConnectError,
      );
    }
  }, [noteInteraction, text.desktopConnectError]);
  // Same click-to-copy pattern as handleCopyWorkspaceId — kept separate rather than
  // parameterizing that one, since this copies from React state (deviceTokenValue) instead of a
  // prop, and the two controls have independent feedback timers.
  const handleCopyDeviceToken = useCallback(async () => {
    noteInteraction();
    let copied = false;

    try {
      if (navigator?.clipboard?.writeText) {
        await Promise.race([
          navigator.clipboard.writeText(deviceTokenValue),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('clipboard-write-timeout')), 800),
          ),
        ]);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied && typeof document !== 'undefined') {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = deviceTokenValue;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {
        copied = false;
      }
    }

    clearTimeout(deviceTokenCopyResetTimerRef.current);
    setDeviceTokenCopyStatus(copied ? 'copied' : 'failed');
    deviceTokenCopyResetTimerRef.current = setTimeout(() => setDeviceTokenCopyStatus('idle'), 1800);
  }, [deviceTokenValue, noteInteraction]);
  const renderSettingsPanel = () => (
    <div className="tool-drawer__settings">
      <p className="settings-panel__title">{text.settings}</p>

      <div className="settings-panel__rows">
        {settingsSections.map((section) => (
          <div key={section.key} className="settings-panel__row">
            <span className="settings-panel__row-label">{section.title}</span>
            <div className="settings-panel__options">
              {section.options.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`settings-option${option.active ? ' is-active' : ''}`}
                  onClick={() => {
                    noteInteraction();
                    option.onSelect();
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="settings-panel__account">
        <p className="settings-panel__account-title">{text.settingsSectionWorkspace}</p>
        <dl className="settings-workspace">
          <div className="settings-workspace__row">
            <dt>{text.workspaceStatusLabel}</dt>
            <dd>
              <span
                className={`settings-status-pill${workspaceAuthenticated ? ' is-signed-in' : ' is-guest'}`}
              >
                {workspaceAuthenticated ? text.workspaceStatusSignedIn : text.workspaceStatusGuest}
              </span>
            </dd>
          </div>
          <div className="settings-workspace__row">
            <dt>{text.workspaceIdLabel}</dt>
            <dd>
              <button
                type="button"
                className={`settings-workspace__copy${workspaceIdCopyStatus !== 'idle' ? ` is-${workspaceIdCopyStatus}` : ''}`}
                onClick={handleCopyWorkspaceId}
                title={workspaceIdCopyStatus === 'idle' ? text.workspaceIdCopyHint : undefined}
              >
                <span className="settings-workspace__copy-value">{currentWorkspaceId}</span>
                {workspaceIdCopyStatus === 'copied' ? (
                  <svg
                    className="settings-workspace__copy-icon"
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                  >
                    <path
                      d="M4 10.5L8 14.5L16 5.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg
                    className="settings-workspace__copy-icon"
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                  >
                    <rect
                      x="7"
                      y="7"
                      width="10"
                      height="10"
                      rx="1.6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    />
                    <path
                      d="M4 13V4.6C4 4.27 4.27 4 4.6 4H13"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                )}
                <span
                  className="settings-workspace__copy-feedback"
                  role="status"
                  aria-live="polite"
                >
                  {workspaceIdCopyStatus === 'copied'
                    ? text.workspaceIdCopied
                    : workspaceIdCopyStatus === 'failed'
                      ? text.workspaceIdCopyFailed
                      : ''}
                </span>
              </button>
            </dd>
          </div>
          <div className="settings-workspace__row settings-workspace__row--muted">
            <dt>{text.workspaceSyncLabel}</dt>
            <dd>{portfolioSyncStatusText}</dd>
          </div>
          {workspaceAuthenticated ? (
            <div className="settings-workspace__row settings-workspace__row--muted">
              <dt>{text.workspaceUserLabel}</dt>
              <dd title={workspaceUserLabel}>{workspaceUserLabel}</dd>
            </div>
          ) : null}
        </dl>

        <div className="settings-panel__account-auth">
          {CLERK_PUBLISHABLE_KEY ? (
            <AuthPanel
              text={text}
              onAuthenticated={handleAuthPanelSuccess}
              workspaceId={currentWorkspaceId}
            />
          ) : null}
          <button
            type="button"
            className="settings-action"
            disabled={workspaceClaimDisabled}
            onClick={() => {
              noteInteraction();
              void handleClaimGuestWorkspace();
            }}
          >
            {workspaceClaimStatus === 'pending'
              ? text.workspaceClaimPending
              : text.workspaceClaimButton}
          </button>
          <p
            className={`settings-workspace__hint${workspaceClaimStatus === 'failed' ? ' is-error' : ''}`}
          >
            {workspaceClaimStatusText}
          </p>
        </div>

        {workspaceAuthenticated ? (
          <div className="settings-panel__links">
            {deviceTokenStatus === 'revealed' && deviceTokenValue ? (
              <>
                <button
                  type="button"
                  className={`settings-workspace__copy is-block${deviceTokenCopyStatus !== 'idle' ? ` is-${deviceTokenCopyStatus}` : ''}`}
                  onClick={handleCopyDeviceToken}
                  title={deviceTokenCopyStatus === 'idle' ? text.workspaceIdCopyHint : undefined}
                >
                  <span className="settings-workspace__copy-value">{deviceTokenValue}</span>
                  {deviceTokenCopyStatus === 'copied' ? (
                    <svg
                      className="settings-workspace__copy-icon"
                      viewBox="0 0 20 20"
                      aria-hidden="true"
                    >
                      <path
                        d="M4 10.5L8 14.5L16 5.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="settings-workspace__copy-icon"
                      viewBox="0 0 20 20"
                      aria-hidden="true"
                    >
                      <rect
                        x="7"
                        y="7"
                        width="10"
                        height="10"
                        rx="1.6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                      <path
                        d="M4 13V4.6C4 4.27 4.27 4 4.6 4H13"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                    </svg>
                  )}
                  <span
                    className="settings-workspace__copy-feedback"
                    role="status"
                    aria-live="polite"
                  >
                    {deviceTokenCopyStatus === 'copied'
                      ? text.workspaceIdCopied
                      : deviceTokenCopyStatus === 'failed'
                        ? text.workspaceIdCopyFailed
                        : ''}
                  </span>
                </button>
                <p className="settings-workspace__hint">{text.desktopConnectRevealHint}</p>
              </>
            ) : null}
            <button
              type="button"
              className="settings-link"
              disabled={deviceTokenStatus === 'pending'}
              onClick={() => {
                void handleGenerateDeviceToken();
              }}
            >
              {deviceTokenStatus === 'pending'
                ? text.desktopConnectPending
                : deviceTokenValue
                  ? text.desktopConnectRegenerateButton
                  : text.desktopConnectGenerateButton}
            </button>
            <button
              type="button"
              className="settings-link"
              disabled={deviceTokenStatus === 'pending'}
              onClick={() => {
                void handleRevokeDeviceTokens();
              }}
            >
              {text.desktopConnectRevokeButton}
            </button>
            {deviceTokenStatus === 'failed' ? (
              <p className="settings-workspace__hint is-error">{deviceTokenError}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="settings-panel__legal">
        <p className="settings-panel__legal-disclaimer">{text.legalDisclaimer}</p>
        <div className="settings-panel__legal-links">
          <a href="/terms" className="settings-link">
            {text.legalTermsLink}
          </a>
          <a href="/privacy" className="settings-link">
            {text.legalPrivacyLink}
          </a>
        </div>
      </div>
    </div>
  );
  const contributionPreview = useMemo(
    () => createContributionPreview(deferredPortfolioItems),
    [deferredPortfolioItems],
  );
  const portfolioAllocation = useMemo(
    () =>
      createPortfolioAllocation(deferredPortfolioItems, {
        classificationMode: assetClassMode,
        weightMode: allocationWeightMode,
      }),
    [allocationWeightMode, assetClassMode, deferredPortfolioItems],
  );
  const portfolioAnalyticsSummary = useMemo(() => {
    if (!hasPortfolio) {
      return null;
    }

    return createPortfolioAnalyticsSummary(deferredPortfolioItems, deferredPortfolioTimelineItems, {
      period: 'month',
      topN: 5,
      targetBucketWeights: DEFAULT_REBALANCE_TARGET_WEIGHTS,
      // Without this, a foreign (USD) holding's buyAmount/marketValue would be summed into the
      // 총 평가금액/총 매입금액/총 평가손익 totals as raw numbers — the exact bug this fixes: see
      // resolvePosition's own comment in portfolioAnalyticsSummary.js.
      baseCurrency,
      fxRates: displayFxRates,
    });
  }, [
    hasPortfolio,
    deferredPortfolioItems,
    deferredPortfolioTimelineItems,
    baseCurrency,
    displayFxRates,
  ]);
  const portfolioHeatmap = useMemo(
    () =>
      createPortfolioHeatmap(deferredPortfolioTimelineItems, {
        weeks: 24,
        today: nowForDateBasis(dateBasis),
      }),
    [deferredPortfolioTimelineItems, dateBasis],
  );
  const drawerHeatmap = useMemo(
    () =>
      portfolioHeatmap
        ? {
            ...portfolioHeatmap,
            columns: contributionPreview.columns,
            rows: contributionPreview.rows,
          }
        : null,
    [portfolioHeatmap, contributionPreview],
  );
  const selectedAtom = atomsRef.current.find((atom) => atom.id === selectedAtomId) ?? null;
  const activeGroupValue =
    selectedAtom &&
    activeGroupKey &&
    canHighlightGroupField(selectedAtom, activeGroupKey) &&
    typeof selectedAtom[activeGroupKey] === 'string'
      ? selectedAtom[activeGroupKey].trim()
      : '';
  const normalizedActiveGroupValue = normalizeDisplayKey(activeGroupValue);
  const highlightActive = Boolean(selectedAtom && activeGroupKey && normalizedActiveGroupValue);
  const selectedAtomFocusActive = Boolean(selectedAtomId && !highlightActive);
  const portfolioScorecard = useMemo(() => {
    if (!hasPortfolio) {
      return null;
    }

    return createPortfolioScorecard(deferredPortfolioItems, language, {
      weightPreset: scoreWeightPreset,
    });
  }, [hasPortfolio, language, deferredPortfolioItems, scoreWeightPreset]);
  const overallPortfolioScorecard = useMemo(() => {
    if (!allPortfolioItems.length) {
      return null;
    }

    return createPortfolioScorecard(allPortfolioItems, language, {
      weightPreset: scoreWeightPreset,
    });
  }, [allPortfolioItems, language, scoreWeightPreset]);
  const showCenterClearHit = Boolean(selectedAtomId || activeGroupKey);
  const clearCenterSelection = () => {
    noteInteraction();
    setSelectedAtomId(null);
    setActiveGroupKey(null);
  };
  const handleFocusPortfolioHolding = useCallback(
    async ({ entryId, item, itemIndex }) => {
      noteInteraction();
      if (entryId && entryId !== activePortfolioId) {
        // Awaited deliberately: atomsRef.current below is only correct for the *new* portfolio
        // once its materialize has actually run (the effect that repopulates it keys off
        // activePortfolioId/portfolioItems, which only update after switchToPortfolio's own
        // setActivePortfolioId commits) — resolving the atom to select before that would still be
        // looking at the outgoing portfolio's shapes. materializeAtom's own ~420ms is comfortably
        // longer than the render+effect flush it's implicitly waiting on here, so this isn't a
        // race so much as it looks like one at a glance.
        await switchToPortfolio(entryId);
      }

      const atomId = resolveHoldingAtomId(atomsRef.current, item, itemIndex);
      if (atomId) {
        setSelectedAtomId(atomId);
        setActiveGroupKey(null);
      }
    },
    [activePortfolioId, switchToPortfolio],
  );
  const triggerIntroCenterBurst = () => {
    noteInteraction();
    setIntroCenterBurstAt(performance.now());
  };
  const introCenterBurst =
    !hasPortfolioItems && introCenterBurstAt >= 0
      ? Math.sin(clamp((frameTime - introCenterBurstAt) / 420, 0, 1) * Math.PI)
      : 0;

  const pulse = 0.5 + Math.sin(frameTime * 0.00042) * 0.5;
  const centerMotion = frameTime * 0.00112;
  const spreadScale = 1;
  const nodeShrink = 1;
  const cameraMotion = cameraRef.current.current;
  const stageCameraX = cameraMotion.panX * 0.2 + cameraMotion.driftX * 0.84;
  const stageCameraY = cameraMotion.panY * 0.17 + cameraMotion.driftY * 0.9;
  const sceneStyle = {
    '--space-pan-x': `${format(cameraMotion.panX * -0.26 + cameraMotion.driftX * 1.18)}px`,
    '--space-pan-y': `${format(cameraMotion.panY * -0.22 + cameraMotion.driftY * 1.12)}px`,
    '--space-pan-stage-x': `${format(stageCameraX)}px`,
    '--space-pan-stage-y': `${format(stageCameraY)}px`,
    '--space-depth': format(cameraMotion.dolly * 0.012 + cameraMotion.focus * 0.38),
    '--camera-focus': format(cameraMotion.focus),
    '--camera-stage-zoom': format(1 + (cameraMotion.zoom - 1) * 0.42 + cameraMotion.focus * 0.025),
    '--camera-stage-roll': `${format(cameraMotion.roll * 0.46)}deg`,
    '--camera-glow': format(0.28 + cameraMotion.focus * 0.5),
    '--tool-drawer-current-width': toolTrayOpen ? `${toolDrawerWidth}px` : '0px',
    // Which direction to push the atom to keep it visually centered in whatever space the open
    // drawer leaves behind depends on which side it's docked to — left dock pushes the atom
    // right (positive), right dock pushes it left (negative).
    '--stage-panel-shift': toolTrayOpen
      ? `${(toolDrawerDock === 'right' ? -1 : 1) * (toolDrawerWidth / 2)}px`
      : '0px',
  };
  const shootingStarStyle = useMemo(() => {
    if (!shootingStar) {
      return null;
    }

    return {
      '--shooting-star-left': `${format(shootingStar.startX)}%`,
      '--shooting-star-top': `${format(shootingStar.startY)}%`,
      '--shooting-star-travel-x': `${format(shootingStar.travelX)}px`,
      '--shooting-star-travel-y': `${format(shootingStar.travelY)}px`,
      '--shooting-star-angle': `${format(shootingStar.angle)}deg`,
      '--shooting-star-length': `${format(shootingStar.length)}px`,
      '--shooting-star-duration': `${format(shootingStar.duration)}ms`,
      '--shooting-star-scale': format(shootingStar.scale),
      '--shooting-star-opacity': format(shootingStar.opacity),
    };
  }, [shootingStar]);
  const atoms = useMemo(
    () =>
      atomsRef.current.map((atom) => {
        const position = atom.baseDirection
          .clone()
          .applyQuaternion(rotationRef.current.current)
          .multiplyScalar(BOND_LENGTH);
        const projection = projectPoint(position, cameraMotion);
        const matchesActiveGroup =
          highlightActive &&
          canHighlightGroupField(atom, activeGroupKey) &&
          normalizeDisplayKey(atom[activeGroupKey]) === normalizedActiveGroupValue;

        return {
          ...atom,
          ...projection,
          x: projection.x * spreadScale,
          y: projection.y * spreadScale,
          scale: projection.scale * nodeShrink,
          isSelected: atom.id === selectedAtomId,
          isGroupMatch: matchesActiveGroup,
          dimmed: selectedAtomFocusActive
            ? atom.id !== selectedAtomId
            : highlightActive
              ? !matchesActiveGroup
              : false,
          position,
        };
      }),
    [
      activeGroupKey,
      cameraMotion,
      frameTime,
      highlightActive,
      nodeShrink,
      normalizedActiveGroupValue,
      selectedAtomFocusActive,
      selectedAtomId,
      spreadScale,
    ],
  );
  const hoveredAtom = atoms.find((atom) => atom.id === hoverInfo?.atomId) ?? null;
  const selectedAtomData = atoms.find((atom) => atom.id === selectedAtomId) ?? null;
  const selectedAtomInfoFields = buildAtomInfoFields(selectedAtomData, language);
  const selectedAtomReturnRaw = selectedAtomData?.detail ?? '';
  const selectedAtomReturnToneClass = getSignedValueToneClass(
    selectedAtomReturnRaw,
    'is-positive',
    'is-negative',
  );
  const selectedAtomDisplayFields = (
    selectedAtomReturnRaw
      ? selectedAtomInfoFields.filter((field) => resolveFieldLabelKey(field.label) !== 'return')
      : selectedAtomInfoFields
  ).map((field) => ({
    label: formatFieldLabel(field.label, language),
    value: translateDisplayValue(field.value, language),
  }));

  return (
    <main
      ref={shellRef}
      className={`app-shell${fileDragActive ? ' is-file-drag' : ''}${toolTrayOpen ? ' is-tool-drawer-open' : ''}`}
      style={sceneStyle}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onWheel={handleWheel}
      onDragEnter={handleFileDragEnter}
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      {fileDragActive ? (
        <div className="file-drop-overlay" aria-hidden="true">
          <div className="file-drop-overlay__inner">
            <div className="file-drop-overlay__icon">
              <SketchUploadArrowIcon />
            </div>
            <p className="file-drop-overlay__label">{text.uploadDragHint}</p>
          </div>
        </div>
      ) : null}
      <div className="space-depth" aria-hidden="true">
        <div className="space-depth__nebula space-depth__nebula--far" />
        <div className="space-depth__stars space-depth__stars--far" />
        <div className="space-depth__stars space-depth__stars--mid" />
        <div className="space-depth__stars space-depth__stars--near" />
        <div className="space-depth__meteor-field">
          {shootingStarStyle ? (
            <div key={shootingStar.id} className="space-depth__meteor" style={shootingStarStyle} />
          ) : null}
        </div>
        <div className="space-depth__halo" />
      </div>

      {/* The old 탐색/관리 (Explore/Manage) mode toggle was removed here — it duplicated the
          single "how do I look at/change my holdings" job the holdings list + 수정 button and ⌘K
          already cover, and having three different entry points for that one job was exactly the
          "여러 개 버튼이 있어 헷갈리는" complaint this cleanup was for. Cmd+K/Ctrl+K (the global
          listener above) had zero visible affordance anywhere in the app before this hint —
          genuinely undiscoverable unless a user already had the habit from another app. This is
          deliberately small and out of the way (top-right corner) rather than a modal/tour: a
          persistent low-key reminder, not a one-time popup that can be missed or dismissed and
          then forgotten. */}
      <button
        type="button"
        className="command-palette-hint"
        aria-label={text.commandPaletteHintAria}
        onClick={() => {
          noteInteraction();
          setCommandPaletteOpen(true);
        }}
      >
        <span className="command-palette-hint__label">{text.commandPaletteHint}</span>
        <span className="command-palette-hint__key" aria-hidden="true">
          ⌘K
        </span>
      </button>

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        portfolioEntries={portfolioEntries}
        language={language}
        onGoToHolding={({ entryId, item, itemIndex }) => {
          handleFocusPortfolioHolding({ entryId, item, itemIndex });
        }}
        onDeleteHolding={handleRemovePortfolioHolding}
        onMoveHolding={handleMoveHolding}
        onAddNew={openManualToolWithTicker}
      />

      <div className="floating-ui-layer">
        {showToolDrawer ? (
          <ToolSideDrawer
            open={toolTrayOpen}
            activeTool={activeDrawerTool}
            onSelectTool={handleDrawerToolSelect}
            groupOptions={groupOptions}
            activeGroupKey={activeGroupKey}
            onGroupChange={setActiveGroupKey}
            heatmap={drawerHeatmap}
            allocation={portfolioAllocation}
            analyticsSummary={portfolioAnalyticsSummary}
            scorecard={portfolioScorecard}
            overallScorecard={overallPortfolioScorecard}
            scoreAxes={scoreAxes}
            scoreWeightPreset={scoreWeightPreset}
            onScoreWeightPresetChange={setScoreWeightPreset}
            items={portfolioItems}
            timelineItems={portfolioTimelineItems}
            portfolioEntries={portfolioEntries}
            activePortfolio={activePortfolio}
            activePortfolioId={activePortfolio?.id ?? activePortfolioId}
            onSelectPortfolio={switchToPortfolio}
            onFocusHolding={handleFocusPortfolioHolding}
            onClearHoldingFocus={clearCenterSelection}
            onClearPortfolio={handleClearPortfolio}
            onOpenPortfolioPicker={openPortfolioPicker}
            onCreateManualAtom={handleCreateManualAtom}
            onCreateManualPortfolio={handleCreateManualPortfolio}
            onAppendManualHoldings={handleAppendManualHoldings}
            onUpdatePortfolioHolding={handleUpdatePortfolioHolding}
            onRemovePortfolioHolding={handleRemovePortfolioHolding}
            pendingManualTicker={pendingManualTicker}
            drawerWidth={toolDrawerWidth}
            onDrawerWidthChange={setToolDrawerWidth}
            dock={toolDrawerDock}
            onDockChange={setToolDrawerDock}
            onDockDragHoverEdgeChange={setDockDragHoverEdge}
            language={language}
            baseCurrency={baseCurrency}
            fxRates={displayFxRates}
            dateBasis={dateBasis}
            layerStyle={floatingLayerStyleFor('tool-drawer')}
            onInteract={interactWithDrawerTool}
            renderSettingsPanel={renderSettingsPanel}
          />
        ) : null}

        {dockDragHoverEdge ? (
          // Rendered as .tool-drawer's own sibling, not its child — .tool-drawer carries a
          // clip-path now (Stage 1), which clips its entire subtree down to the rail while
          // closed; a same-element child here would only ever be visible in the same sliver the
          // rail already occupies, never able to paint the full opposite/bottom edge this needs.
          <div
            className={`dock-edge-hint dock-edge-hint--${dockDragHoverEdge}`}
            aria-hidden="true"
          />
        ) : null}

        <div className="upload-anchor">
          <input
            ref={fileInputRef}
            className="file-input"
            type="file"
            multiple
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
            onChange={handlePortfolioFileChange}
          />
          {portfolioError ? (
            <p className={`upload-error${portfolioErrorClosing ? ' is-fading' : ''}`}>
              {portfolioError}
            </p>
          ) : null}
        </div>
      </div>

      <div className="stage-frame">
        <div className="stage-tilt">
          <div className="stage-reveal">
            <div className={`stage-breath${!hasPortfolioItems ? ' is-intro' : ''}`}>
              <div className="stage-camera" onPointerDownCapture={dismissAtomHint}>
                {/* Whole-scene dissolve/materialize (useAtomTransition) — scale, not individual
                    node repositioning, so it works identically whichever scene renderer is active
                    below. --materialize defaults to 1 (full size) via the CSS custom property's
                    own fallback in App.css, so this wrapper is a no-op outside a transition. */}
                <div
                  className="atom-materialize-wrapper"
                  style={{ '--materialize': atomTransitionScale }}
                >
                  {ENABLE_WEBGL_SCENE_PREVIEW ? (
                    <AtomCanvas
                      atoms={atoms}
                      rotationRef={rotationRef}
                      motionPreferenceRef={motionPreferenceRef}
                      bondLength={BOND_LENGTH}
                      onAtomPointerDown={handleNodePointerDown}
                      onAtomPointerEnter={handleNodeEnter}
                      onAtomPointerMove={handleNodeMove}
                      onAtomPointerLeave={handleNodeLeave}
                      onKeyboardSelect={handleNodeKeyboardSelect}
                      onCenterClick={
                        hasPortfolioItems ? clearCenterSelection : triggerIntroCenterBurst
                      }
                    />
                  ) : null}
                  <AtomSketchView
                    atoms={atoms}
                    pulse={pulse}
                    centerMotion={centerMotion}
                    centerClickBurst={introCenterBurst}
                    standalone={!hasPortfolioItems}
                    svgRef={svgRef}
                    ariaLabel={text.atomAria}
                    maxLabelLength={atomLabelMaxLength}
                    highlightActive={highlightActive}
                    centerFocusActive={Boolean(selectedAtomId)}
                    onCenterClick={
                      hasPortfolioItems ? clearCenterSelection : triggerIntroCenterBurst
                    }
                    onPointerDown={handleNodePointerDown}
                    onPointerEnter={handleNodeEnter}
                    onPointerMove={handleNodeMove}
                    onPointerLeave={handleNodeLeave}
                    onKeyboardSelect={handleNodeKeyboardSelect}
                  />
                </div>
                {atomHintVisible && hasPortfolioItems ? (
                  <div className="atom-hint" role="status">
                    {text.atomHint}
                  </div>
                ) : null}
                {/* First-launch gap found during a new-user walkthrough: with zero portfolios, the
                    stage showed nothing but the idle-pulse atom - nothing distinguishing "empty
                    because you haven't added anything" from "broken." Clicking straight through
                    to the accounts drawer (the same handler the rail button itself uses) turns
                    this into a working shortcut, not just a static label. Kept to one quiet line
                    (was a bold headline + an explanatory sentence about CSV/manual entry) — the
                    accounts drawer it opens is where that choice actually gets made, so spelling
                    it out here first was just prose standing between the click and the drawer. */}
                {!hasPortfolio ? (
                  <button
                    type="button"
                    className="atom-hint atom-hint--empty-state"
                    onClick={() => {
                      noteInteraction();
                      handleDrawerToolSelect('accounts');
                    }}
                  >
                    <span className="atom-hint--empty-state-glyph" aria-hidden="true">
                      +
                    </span>
                    {text.emptyStateHint}
                  </button>
                ) : null}
                {portfolioEntries.length ? (
                  <div className="portfolio-preview-layer">
                    {portfolioEntries
                      // The active portfolio is already the atom in the center — showing it a
                      // second time as one of its own orbiting "switch to this" previews was
                      // just a redundant, non-functional button (switchToPortfolio's own
                      // entryId === activePortfolioId guard already no-ops a click on it, but
                      // nothing kept it out of the layer visually). With N total portfolios this
                      // should read as N-1 other-portfolio previews, not N.
                      .filter((entry) => entry.id !== activePortfolioId)
                      .slice(0, PORTFOLIO_PREVIEW_SLOTS.length)
                      .map((entry, index) => (
                        <PortfolioPreviewAtomView
                          key={entry.id}
                          entry={entry}
                          slot={PORTFOLIO_PREVIEW_SLOTS[index]}
                          onSelect={switchToPortfolio}
                        />
                      ))}
                  </div>
                ) : null}
              </div>
              {showCenterClearHit ? (
                <button
                  className="center-clear-hit"
                  type="button"
                  aria-label={text.clearCenterAria}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                  }}
                  onClick={clearCenterSelection}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <HoverCard atom={hoveredAtom} position={hoverInfo} language={language} />
      {selectedAtomData ? (
        <AtomDetailPanel
          atom={selectedAtomData}
          fields={selectedAtomDisplayFields}
          returnValue={selectedAtomReturnRaw}
          returnToneClass={selectedAtomReturnToneClass}
          text={text}
          onClose={() => {
            noteInteraction();
            setSelectedAtomId(null);
          }}
        />
      ) : null}
    </main>
  );
}
