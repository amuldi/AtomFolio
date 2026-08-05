import { app, Tray, BrowserWindow, ipcMain, Menu, Notification, shell, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveConfig, rememberSeenArticleIds } from './lib/store.mjs';
import { createApiClient } from './lib/api.mjs';
import { summarizeWorkspacePortfolios, collectWorkspaceTickers } from './lib/portfolioTotals.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Polling never runs faster than this even if a config file is hand-edited — protects the shared
// news/portfolio API from a misconfigured client.
const MIN_POLL_INTERVAL_SEC = 60;
const POPOVER_WIDTH = 340;
const POPOVER_HEIGHT = 480;

let tray = null;
let popover = null;
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
  news: [],
};

function broadcastState() {
  if (popover && !popover.isDestroyed()) {
    popover.webContents.send('atomfolio:state', state);
  }
}

function setState(partial) {
  state = { ...state, ...partial };
  broadcastState();
}

function createPopover() {
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
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    roundedCorners: true,
    vibrancy: 'popover',
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  popover.loadFile(path.join(__dirname, 'renderer', 'popover.html'));
  popover.on('blur', () => {
    if (popover && !popover.isDestroyed()) {
      popover.hide();
    }
  });

  return popover;
}

function positionPopoverNearTray() {
  if (!tray || !popover) {
    return;
  }

  const trayBounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const x = Math.round(
    Math.min(
      Math.max(trayBounds.x + trayBounds.width / 2 - POPOVER_WIDTH / 2, display.workArea.x + 8),
      display.workArea.x + display.workArea.width - POPOVER_WIDTH - 8,
    ),
  );
  const y = Math.round(trayBounds.y + trayBounds.height + 4);
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
  const iconPath = path.join(__dirname, '..', 'assets', 'trayIconTemplate.png');
  tray = new Tray(iconPath);
  tray.setToolTip('AtomFolio');
  tray.on('click', togglePopover);
  // Right-click keeps a minimal escape hatch (quit) without cluttering the primary click path.
  tray.on('right-click', () => {
    tray.popUpContextMenu(
      Menu.buildFromTemplate([{ label: 'Quit AtomFolio', click: () => app.quit() }]),
    );
  });
}

async function refresh({ silent = false } = {}) {
  const config = loadConfig();

  if (!config.workspaceId) {
    setState({ connected: false, loading: false, totals: null, news: [], lastError: null });
    return;
  }

  if (!silent) {
    setState({ loading: true, lastError: null });
  }

  const api = createApiClient({ apiBaseUrl: config.apiBaseUrl, workspaceId: config.workspaceId });

  try {
    const portfolioPayload = await api.fetchPortfolios();
    const portfolios = portfolioPayload?.portfolios ?? [];
    const totals = summarizeWorkspacePortfolios(portfolios);
    const tickers = collectWorkspaceTickers(portfolios);

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

    setState({
      connected: true,
      loading: false,
      lastError: null,
      lastUpdatedAt: Date.now(),
      totals,
      news: decoratedNews,
    });
  } catch (error) {
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
    saveConfig({ workspaceId: null, lastSeenArticleIds: [] });
    notifiedThisSessionIds.clear();

    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }

    setState({ connected: false, totals: null, news: [], lastError: null });
    return { ok: true };
  });

  ipcMain.handle('atomfolio:open-external', (_event, url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) {
      shell.openExternal(url);
    }
  });
}

app.whenReady().then(async () => {
  // Menu bar only — a Dock icon would make this look like a second, redundant copy of the web app.
  app.dock?.hide();

  createTray();
  createPopover();
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
