import { app, Tray, BrowserWindow, ipcMain, Menu, Notification, shell, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveConfig, rememberSeenArticleIds } from './lib/store.mjs';
import { createApiClient } from './lib/api.mjs';
// .bundle.mjs, not the raw source — these two reach into the web app's shared src/, which isn't
// included in a packaged app's asar; see scripts/build-main-libs.mjs for why.
import {
  summarizeWorkspacePortfolios,
  summarizeWorkspaceHoldings,
  collectWorkspaceTickers,
  listWorkspacePortfolios,
} from './lib/portfolioTotals.bundle.mjs';
import { evaluateInsights, filterByCooldown } from './lib/insights.bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Polling never runs faster than this even if a config file is hand-edited — protects the shared
// news/portfolio API from a misconfigured client.
const MIN_POLL_INTERVAL_SEC = 60;
// Atom moved out into its own floating widget — popover only needs to fit news + settings now.
const POPOVER_WIDTH = 340;
const POPOVER_HEIGHT = 480;
const ATOM_WIDGET_WIDTH = 260;
const ATOM_WIDGET_HEIGHT = 300;
const ATOM_WIDGET_MIN_WIDTH = 160;
const ATOM_WIDGET_MIN_HEIGHT = 190;
const ATOM_WIDGET_MAX_WIDTH = 480;
const ATOM_WIDGET_MAX_HEIGHT = 560;
const ATOM_WIDGET_DEFAULT_MARGIN = 24;
const ATOM_WIDGET_GEOMETRY_SAVE_DEBOUNCE_MS = 400;
// A window this transparent would make its own text unreadable — the slider in settings is
// clamped to this floor too, but the backend re-clamps in case config.json was hand-edited.
const MIN_WINDOW_OPACITY = 0.4;

let tray = null;
let popover = null;
let atomWidget = null;
let atomWidgetGeometrySaveTimer = null;
let pollTimer = null;
/** @type {Set<string>} article ids already pushed to the renderer at least once this session —
 * separate from the persisted lastSeenArticleIds, which only exists to avoid re-notifying across
 * app restarts. This one drives the transient "NEW" badge. */
const notifiedThisSessionIds = new Set();

let state = {
  connected: false,
  loading: false,
  lastError: null,
  lastUpdatedAt: null,
  totals: null,
  holdings: [],
  items: [],
  news: [],
  portfolios: [],
  selectedPortfolioId: null,
  activeInsight: null,
};

function broadcastState() {
  if (popover && !popover.isDestroyed()) {
    popover.webContents.send('atomfolio:state', state);
  }
  if (atomWidget && !atomWidget.isDestroyed()) {
    atomWidget.webContents.send('atomfolio:state', state);
  }
}

// The tray icon itself stays a plain profit/loss dot — no atom detail at 22px, that's what the
// popover is for. Never named "...Template.png": macOS force-monochromes template images, which
// would discard the color that's the entire point of this indicator.
function trayDotToneFor(totals) {
  const rate = totals?.totalReturnRate;
  if (!Number.isFinite(rate) || rate === 0) {
    return 'neutral';
  }
  return rate > 0 ? 'profit' : 'loss';
}

function updateTrayIcon() {
  if (!tray) {
    return;
  }
  const tone = state.connected ? trayDotToneFor(state.totals) : 'neutral';
  tray.setImage(path.join(__dirname, '..', 'assets', `trayDot-${tone}.png`));
}

function setState(partial) {
  state = { ...state, ...partial };
  updateTrayIcon();
  broadcastState();
}

function clampOpacity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 1;
  }
  return Math.min(1, Math.max(MIN_WINDOW_OPACITY, numeric));
}

function createPopover() {
  const config = loadConfig();
  popover = new BrowserWindow({
    width: POPOVER_WIDTH,
    height: POPOVER_HEIGHT,
    show: false,
    frame: false,
    fullscreenable: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // transparent (not vibrancy) is only here so the CSS border-radius on .panel actually shows
    // rounded corners against the desktop — the panel itself paints a fully opaque background, no
    // native frosted-glass blur. Ordinary opaque macOS chrome, not a translucent overlay.
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  popover.setOpacity(clampOpacity(config.popoverOpacity));
  popover.loadFile(path.join(__dirname, 'renderer', 'popover.html'));
  popover.on('blur', () => {
    if (popover && !popover.isDestroyed()) {
      popover.hide();
    }
  });

  return popover;
}

function defaultAtomWidgetPosition() {
  const workArea = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(workArea.x + workArea.width - ATOM_WIDGET_WIDTH - ATOM_WIDGET_DEFAULT_MARGIN),
    y: Math.round(workArea.y + ATOM_WIDGET_DEFAULT_MARGIN),
  };
}

// A position saved on a display that's since been unplugged (external monitor, different desk)
// would otherwise put the widget somewhere the user can never see or reach again. Snapping back
// onto whichever display now best matches that rect keeps it always reachable.
function clampPointToVisibleDisplay(x, y, width, height) {
  const display = screen.getDisplayMatching({ x, y, width, height });
  const workArea = display.workArea;
  return {
    x: Math.round(Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - width)),
    y: Math.round(Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - height)),
  };
}

function createAtomWidget() {
  const config = loadConfig();
  const width = config.atomWidgetSize?.width ?? ATOM_WIDGET_WIDTH;
  const height = config.atomWidgetSize?.height ?? ATOM_WIDGET_HEIGHT;
  const { x, y } = config.atomWidgetPosition
    ? clampPointToVisibleDisplay(config.atomWidgetPosition.x, config.atomWidgetPosition.y, width, height)
    : defaultAtomWidgetPosition();

  atomWidget = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: ATOM_WIDGET_MIN_WIDTH,
    minHeight: ATOM_WIDGET_MIN_HEIGHT,
    maxWidth: ATOM_WIDGET_MAX_WIDTH,
    maxHeight: ATOM_WIDGET_MAX_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    // Unlike the popover (an opaque rounded panel, where a native shadow reads as a normal macOS
    // surface), the widget's content is an irregular transparent shape — a rectangular native
    // window shadow behind it would look like a visible glitch, not depth. The atom's own SVG
    // glow already does the "lifted off the desktop" job.
    hasShadow: false,
    resizable: true,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  atomWidget.setOpacity(clampOpacity(config.widgetOpacity));
  atomWidget.loadFile(path.join(__dirname, 'renderer', 'atom-widget.html'));

  // One shared debounce for both events, saving position + size together — not two independent
  // move/resize handlers. A corner/edge drag that changes the origin *and* the dimensions in the
  // same native resize (e.g. dragging the top-left corner) doesn't reliably fire both 'move' and
  // 'resize' on every platform; getBounds() always reflects the window's true current geometry
  // regardless of which event happened to fire, so saving both from either event can't miss half
  // the change the way two separately-scoped handlers could.
  const saveAtomWidgetGeometry = () => {
    clearTimeout(atomWidgetGeometrySaveTimer);
    atomWidgetGeometrySaveTimer = setTimeout(() => {
      if (!atomWidget || atomWidget.isDestroyed()) {
        return;
      }
      const { x, y, width, height } = atomWidget.getBounds();
      saveConfig({ atomWidgetPosition: { x, y }, atomWidgetSize: { width, height } });
    }, ATOM_WIDGET_GEOMETRY_SAVE_DEBOUNCE_MS);
  };
  atomWidget.on('move', saveAtomWidgetGeometry);
  atomWidget.on('resize', saveAtomWidgetGeometry);

  // A discoverable way to turn the widget off without needing to know the tray menu exists.
  atomWidget.webContents.on('context-menu', () => {
    if (!atomWidget || atomWidget.isDestroyed()) {
      return;
    }
    Menu.buildFromTemplate([
      { label: '위젯 숨기기', click: () => setAtomWidgetVisible(false) },
    ]).popup({ window: atomWidget });
  });

  if (config.atomWidgetVisible) {
    // showInactive, not show — an ambient overlay shouldn't steal focus from whatever the user
    // was doing, on launch or when toggled back on from the tray menu.
    atomWidget.showInactive();
  }

  return atomWidget;
}

function setAtomWidgetVisible(visible) {
  saveConfig({ atomWidgetVisible: visible });
  if (!atomWidget || atomWidget.isDestroyed()) {
    return;
  }
  if (visible) {
    atomWidget.showInactive();
  } else {
    atomWidget.hide();
  }
}

function positionPopoverNearTray() {
  if (!tray || !popover) {
    return;
  }

  const trayBounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const workArea = display.workArea;
  const x = Math.round(
    Math.min(
      Math.max(trayBounds.x + trayBounds.width / 2 - POPOVER_WIDTH / 2, workArea.x + 8),
      workArea.x + workArea.width - POPOVER_WIDTH - 8,
    ),
  );
  // Clamped on both ends: pinned above the work-area floor so a taller popover never runs off the
  // bottom of a short display, but never pushed above the tray itself either (the natural position
  // is already below the menu bar, so this floor only ever bites on unusually short screens).
  const y = Math.round(
    Math.max(
      Math.min(trayBounds.y + trayBounds.height + 4, workArea.y + workArea.height - POPOVER_HEIGHT - 8),
      workArea.y + 8,
    ),
  );
  popover.setPosition(x, y, false);
}

function togglePopover() {
  if (!popover) {
    return;
  }

  if (popover.isVisible()) {
    popover.hide();
    return;
  }

  positionPopoverNearTray();
  popover.show();
  popover.focus();
}

function showPopoverFocusedOn(articleId) {
  if (!popover) {
    return;
  }

  positionPopoverNearTray();
  popover.show();
  popover.focus();
  popover.webContents.send('atomfolio:focus-article', articleId);
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'trayDot-neutral.png');
  tray = new Tray(iconPath);
  tray.setToolTip('AtomFolio');
  tray.on('click', togglePopover);
  // Right-click keeps a minimal escape hatch (widget toggle + quit) without cluttering the
  // primary click path, which stays scoped to the news/settings popover.
  tray.on('right-click', () => {
    const config = loadConfig();
    tray.popUpContextMenu(
      Menu.buildFromTemplate([
        {
          label: '원자 위젯 표시',
          type: 'checkbox',
          checked: config.atomWidgetVisible,
          click: (menuItem) => setAtomWidgetVisible(menuItem.checked),
        },
        { type: 'separator' },
        { label: 'Quit AtomFolio', click: () => app.quit() },
      ]),
    );
  });
}

// refresh() does two sequential awaited network calls, so two calls can overlap — most likely the
// initial connect's refresh still in flight when the user immediately switches portfolios in the
// picker. Without this guard, whichever call happens to finish last wins and can silently clobber
// a newer selection with a stale one. Each call captures its own token at entry and only commits
// state if it's still the latest by the time its awaits resolve.
let latestRefreshToken = 0;

async function refresh({ silent = false } = {}) {
  const requestToken = ++latestRefreshToken;
  const config = loadConfig();

  if (!config.workspaceId) {
    setState({
      connected: false,
      loading: false,
      totals: null,
      holdings: [],
      items: [],
      news: [],
      portfolios: [],
      selectedPortfolioId: null,
      activeInsight: null,
      lastError: null,
    });
    return;
  }

  if (!silent) {
    setState({ loading: true, lastError: null });
  }

  const api = createApiClient({ apiBaseUrl: config.apiBaseUrl, workspaceId: config.workspaceId });

  try {
    const portfolioPayload = await api.fetchPortfolios();
    const portfolios = portfolioPayload?.portfolios ?? [];
    const portfolioList = listWorkspacePortfolios(portfolios);

    // The atom view and news are scoped to one portfolio at a time (not the whole workspace
    // pooled together) so switching portfolios in the picker actually shows a different atom and
    // different holding-scoped news, not just a different slice of the same aggregate. Falls back
    // to the first portfolio if nothing was picked yet, or the picked one no longer exists.
    const requestedId = config.selectedPortfolioId;
    const selectedPortfolio =
      portfolios.find((entry) => entry.id === requestedId) ?? portfolios[0] ?? null;
    const selectedPortfolioId = selectedPortfolio?.id ?? null;

    if (selectedPortfolioId !== requestedId && requestToken === latestRefreshToken) {
      saveConfig({ selectedPortfolioId });
    }

    const scopedPortfolios = selectedPortfolio ? [selectedPortfolio] : [];
    const totals = summarizeWorkspacePortfolios(scopedPortfolios);
    const holdings = summarizeWorkspaceHoldings(scopedPortfolios);
    const tickers = collectWorkspaceTickers(scopedPortfolios);
    // Raw items (not the summarized `holdings` above) for the popover's atom view — it feeds
    // these straight into the real generateAtomLayout from the web app, which expects full
    // portfolio-item shape (region/sector/assetClass etc.), not the flattened summary.
    const selectedPortfolioItems = Array.isArray(selectedPortfolio?.items)
      ? selectedPortfolio.items
      : [];

    let newsItems = [];
    try {
      const newsPayload = await api.fetchHoldingNews(tickers);
      newsItems = Array.isArray(newsPayload?.items) ? newsPayload.items : [];
    } catch {
      // Holding a stale/empty news list beats blanking the whole popover over a news-only failure.
      newsItems = state.news ?? [];
    }

    const previouslySeen = new Set(config.lastSeenArticleIds);
    const isFirstLoadThisConnection = notifiedThisSessionIds.size === 0;
    const freshArticles = newsItems.filter((item) => item.id && !previouslySeen.has(item.id));

    const decoratedNews = newsItems.map((item) => ({
      ...item,
      isNew: Boolean(item.id) && !notifiedThisSessionIds.has(item.id) && !isFirstLoadThisConnection,
    }));

    for (const item of newsItems) {
      if (item.id) {
        notifiedThisSessionIds.add(item.id);
      }
    }

    if (!isFirstLoadThisConnection && freshArticles.length && Notification.isSupported()) {
      for (const article of freshArticles.slice(0, 3)) {
        const notification = new Notification({
          title: article.title,
          body: article.source || 'AtomFolio',
          silent: false,
        });
        notification.on('click', () => showPopoverFocusedOn(article.id));
        notification.show();
      }
    }

    if (newsItems.length) {
      rememberSeenArticleIds(config, newsItems.map((item) => item.id).filter(Boolean));
    }

    // Proactive insights (stop-loss/take-profit/allocation drift): the popover always highlights
    // whatever's currently true (not rate-limited — showing it when the user happens to open the
    // popover isn't spammy the way a repeat notification would be), but only the first one still
    // outside its cooldown window actually fires a Notification, and only the single most severe
    // one — several highlighted at once would just be noise.
    const allInsights = evaluateInsights({ items: selectedPortfolioItems, config });
    const activeInsight = allInsights[0] ?? null;

    if (config.notificationsEnabled && Notification.isSupported()) {
      const [notifiable] = filterByCooldown(allInsights, config.insightCooldowns);
      if (notifiable) {
        const notification = new Notification({
          title: notifiable.message,
          body: 'AtomFolio',
          silent: false,
        });
        notification.on('click', () => togglePopover());
        notification.show();
        saveConfig({
          insightCooldowns: { ...config.insightCooldowns, [notifiable.key]: Date.now() },
        });
      }
    }

    if (requestToken !== latestRefreshToken) {
      return;
    }

    setState({
      connected: true,
      loading: false,
      lastError: null,
      lastUpdatedAt: Date.now(),
      totals,
      holdings,
      items: selectedPortfolioItems,
      news: decoratedNews,
      portfolios: portfolioList,
      selectedPortfolioId,
      activeInsight,
    });
  } catch (error) {
    if (requestToken !== latestRefreshToken) {
      return;
    }

    setState({
      connected: true,
      loading: false,
      lastError: error instanceof Error ? error.message : 'atomfolio-refresh-failed',
    });
  }
}

function startPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }

  const config = loadConfig();
  const intervalSec = Math.max(MIN_POLL_INTERVAL_SEC, Number(config.pollIntervalSec) || MIN_POLL_INTERVAL_SEC);
  pollTimer = setInterval(() => {
    // Background tabs on the web throttle timers; a menu bar app has no such notion — this keeps
    // running whether or not the popover window is open, which is the whole point of a tray app.
    void refresh({ silent: true });
  }, intervalSec * 1000);
}

function registerIpcHandlers() {
  ipcMain.handle('atomfolio:get-state', () => state);

  ipcMain.handle('atomfolio:connect', async (_event, workspaceId) => {
    const cleanId = String(workspaceId ?? '').trim();

    if (!cleanId) {
      return { ok: false, error: 'workspace-id-required' };
    }

    saveConfig({ workspaceId: cleanId, lastSeenArticleIds: [] });
    notifiedThisSessionIds.clear();
    await refresh();
    startPolling();
    return { ok: true };
  });

  ipcMain.handle('atomfolio:disconnect', () => {
    saveConfig({ workspaceId: null, lastSeenArticleIds: [], selectedPortfolioId: null });
    notifiedThisSessionIds.clear();

    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }

    setState({
      connected: false,
      totals: null,
      holdings: [],
      items: [],
      news: [],
      portfolios: [],
      selectedPortfolioId: null,
      activeInsight: null,
      lastError: null,
    });
    return { ok: true };
  });

  ipcMain.handle('atomfolio:select-portfolio', async (_event, portfolioId) => {
    const cleanId = String(portfolioId ?? '').trim() || null;
    saveConfig({ selectedPortfolioId: cleanId });
    await refresh();
    return { ok: true };
  });

  ipcMain.handle('atomfolio:open-external', (_event, url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) {
      shell.openExternal(url);
    }
  });

  ipcMain.handle('atomfolio:get-settings', () => {
    const config = loadConfig();
    return {
      notificationsEnabled: config.notificationsEnabled,
      stopLossPercent: config.stopLossPercent,
      takeProfitPercent: config.takeProfitPercent,
      allocationDriftPercent: config.allocationDriftPercent,
      pollIntervalSec: config.pollIntervalSec,
      popoverOpacity: config.popoverOpacity,
      widgetOpacity: config.widgetOpacity,
    };
  });

  // Only these fields — never the workspace/connection ones — are reachable from here, so the
  // settings panel can't accidentally touch anything beyond the thresholds it's meant to control.
  ipcMain.handle('atomfolio:update-settings', async (_event, partial) => {
    const allowedKeys = [
      'notificationsEnabled',
      'stopLossPercent',
      'takeProfitPercent',
      'allocationDriftPercent',
      'pollIntervalSec',
      'popoverOpacity',
      'widgetOpacity',
    ];
    const clean = {};
    for (const key of allowedKeys) {
      if (partial && key in partial) {
        clean[key] = partial[key];
      }
    }

    saveConfig(clean);

    if ('pollIntervalSec' in clean && pollTimer) {
      startPolling();
    }
    if ('popoverOpacity' in clean && popover && !popover.isDestroyed()) {
      popover.setOpacity(clampOpacity(clean.popoverOpacity));
    }
    if ('widgetOpacity' in clean && atomWidget && !atomWidget.isDestroyed()) {
      atomWidget.setOpacity(clampOpacity(clean.widgetOpacity));
    }

    await refresh({ silent: true });
    return { ok: true };
  });
}

app.whenReady().then(async () => {
  // Menu bar only — a Dock icon would make this look like a second, redundant copy of the web app.
  app.dock?.hide();

  createTray();
  createPopover();
  createAtomWidget();
  registerIpcHandlers();

  const config = loadConfig();
  if (config.workspaceId) {
    await refresh();
    startPolling();
  }
});

app.on('window-all-closed', (event) => {
  // A tray app has no "last window" to quit on — it lives in the menu bar.
  event.preventDefault();
});
