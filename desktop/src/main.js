import {
  app,
  Tray,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  shell,
  screen,
  globalShortcut,
  nativeTheme,
} from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
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
// How close to a work-area edge (in px) the widget needs to land, on release, to snap flush
// against it. Deliberately not applied on every 'move' tick — only from the 'moved' handler,
// which macOS fires once the drag actually settles — so it never fights the user's hand mid-drag.
const ATOM_WIDGET_SNAP_THRESHOLD = 24;
// How often the main process re-reads the global cursor position while ⌘-dragging the widget
// (see startAtomWidgetDrag). 16ms ~ 60Hz — smooth without meaningfully loading the CPU for what's
// normally a few-second gesture.
const ATOM_WIDGET_DRAG_POLL_MS = 16;
// Pages inside the popover's horizontal pager (see popover.js's createPager) — kept in one place
// since both the header's own ⚙ shortcut and the context-menu shortcuts below need to agree on
// the indices.
const POPOVER_PAGE_NEWS = 0;
const POPOVER_PAGE_SETTINGS = 1;
// A window this transparent would make its own text unreadable — the slider in settings is
// clamped to this floor too, but the backend re-clamps in case config.json was hand-edited.
const MIN_WINDOW_OPACITY = 0.4;

let tray = null;
let popover = null;
let atomWidget = null;
let atomWidgetGeometrySaveTimer = null;
// Non-null only while a ⌘-drag is in flight — see startAtomWidgetDrag/stopAtomWidgetDrag.
let atomWidgetDragInterval = null;
let atomWidgetDragOrigin = null;
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
  // Mirrors config.atomCategoryDimension (store.mjs) into the same broadcast channel atom-view.jsx
  // already subscribes to (onState), rather than a separate settings round-trip — the popover is
  // the only window with a settings panel, but the atom widget is the one that actually needs this
  // value, and state is already pushed to both windows on every change (see broadcastState below).
  // Hardcoded to store.mjs's own default here rather than calling loadConfig() at module-load time
  // (before app.whenReady()) — app.whenReady's own startup sequence below corrects this to
  // whatever's actually persisted before either window's first paint.
  categoryDimension: 'sector',
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

// The settings-panel slider only controls width — height derives from the same aspect ratio as
// the widget's own default (300/260), same as dragging a corner handle would roughly preserve.
// Both ends are re-clamped here regardless of what the renderer sends, same defense-in-depth as
// clampOpacity above.
function clampAtomWidgetSizeForWidth(width) {
  const numeric = Number(width);
  const clampedWidth = Math.min(
    ATOM_WIDGET_MAX_WIDTH,
    Math.max(ATOM_WIDGET_MIN_WIDTH, Number.isFinite(numeric) ? Math.round(numeric) : ATOM_WIDGET_WIDTH),
  );
  const derivedHeight = Math.round(clampedWidth * (ATOM_WIDGET_HEIGHT / ATOM_WIDGET_WIDTH));
  const clampedHeight = Math.min(ATOM_WIDGET_MAX_HEIGHT, Math.max(ATOM_WIDGET_MIN_HEIGHT, derivedHeight));
  return { width: clampedWidth, height: clampedHeight };
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

// Used every time the widget is shown (setAtomWidgetVisible(true)) — deliberately not the same
// thing as defaultAtomWidgetPosition above, which only matters once, at the very first launch
// before any saved position exists. Always the *primary* display's center, not whichever display
// the widget last happened to be on — showing the widget is meant to be a predictable "it's right
// here" action regardless of where a previous drag left it.
function centeredAtomWidgetPosition(width, height) {
  const workArea = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
  };
}

// Global-cursor-polling drag, not renderer pointermove deltas. Electron's renderer process only
// receives pointer events while the cursor is over its own window — a fast drag lets the cursor
// outrun the (still catching-up) window edge, at which point the cursor leaves the window and
// pointermove stops arriving entirely, so the drag visibly "sticks" until the cursor happens to
// re-enter the window's new bounds. screen.getCursorScreenPoint() has no such restriction (it's a
// main-process, OS-level query), so polling it directly tracks the cursor everywhere, including
// off-window and across displays, with nothing for a fast gesture to outrun.
function startAtomWidgetDrag() {
  if (!atomWidget || atomWidget.isDestroyed()) {
    return;
  }
  // Guards a stray second widget-drag-start (e.g. a dropped widget-drag-end IPC) from stacking a
  // second interval on top of the first rather than replacing it.
  stopAtomWidgetDrag();
  const cursor = screen.getCursorScreenPoint();
  const bounds = atomWidget.getBounds();
  atomWidgetDragOrigin = {
    cursorX: cursor.x,
    cursorY: cursor.y,
    windowX: bounds.x,
    windowY: bounds.y,
  };
  atomWidgetDragInterval = setInterval(() => {
    if (!atomWidget || atomWidget.isDestroyed() || !atomWidgetDragOrigin) {
      stopAtomWidgetDrag();
      return;
    }
    const point = screen.getCursorScreenPoint();
    const dx = point.x - atomWidgetDragOrigin.cursorX;
    const dy = point.y - atomWidgetDragOrigin.cursorY;
    // No clampPointToVisibleDisplay here on purpose (see this module's own note elsewhere) — a
    // drag in progress should be able to cross freely onto another display, not get held at the
    // edge of whichever one it started on. Edge-snap/display-matching only apply once the drag
    // actually ends, in stopAtomWidgetDrag below.
    atomWidget.setPosition(
      Math.round(atomWidgetDragOrigin.windowX + dx),
      Math.round(atomWidgetDragOrigin.windowY + dy),
      false,
    );
  }, ATOM_WIDGET_DRAG_POLL_MS);
}

function stopAtomWidgetDrag() {
  if (atomWidgetDragInterval) {
    clearInterval(atomWidgetDragInterval);
    atomWidgetDragInterval = null;
  }
  atomWidgetDragOrigin = null;
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

// Called only from the 'moved' listener below (once per completed drag), never mid-gesture.
// Each axis snaps independently, so a corner release snaps both — same as most window managers'
// edge-snap behavior.
function snapAtomWidgetToEdges() {
  if (!atomWidget || atomWidget.isDestroyed()) {
    return;
  }
  const bounds = atomWidget.getBounds();
  const workArea = screen.getDisplayMatching(bounds).workArea;

  let { x, y } = bounds;
  const { width, height } = bounds;

  if (x - workArea.x <= ATOM_WIDGET_SNAP_THRESHOLD) {
    x = workArea.x;
  } else if (workArea.x + workArea.width - (x + width) <= ATOM_WIDGET_SNAP_THRESHOLD) {
    x = workArea.x + workArea.width - width;
  }

  if (y - workArea.y <= ATOM_WIDGET_SNAP_THRESHOLD) {
    y = workArea.y;
  } else if (workArea.y + workArea.height - (y + height) <= ATOM_WIDGET_SNAP_THRESHOLD) {
    y = workArea.y + workArea.height - height;
  }

  // Guards against setPosition() re-triggering its own 'moved' event on a no-op move — with
  // nothing to change, x/y already equal bounds.x/bounds.y, so this simply doesn't fire.
  if (x !== bounds.x || y !== bounds.y) {
    atomWidget.setPosition(x, y, false);
  }
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
      // Unlike the popover (only ever animating while shown and focused), this window is an
      // always-on-top ambient overlay that's supposed to keep drifting/rotating continuously even
      // while some other app has focus and even while it's occluded — Chromium's default
      // background throttling would stall its rAF-driven rotation rig in exactly that situation,
      // which is the widget's normal resting state, not an edge case.
      backgroundThrottling: false,
    },
  });

  atomWidget.setOpacity(clampOpacity(config.widgetOpacity));
  // Without this, the window only actually renders on whichever Space it happened to be created
  // on — alwaysOnTop keeps it in front of other windows there, but switching to a different
  // desktop or into a fullscreen app makes it disappear entirely until the user switches back,
  // even though isVisible()/atomWidgetVisible both still say "shown". An ambient overlay that's
  // supposed to always be on screen has to actually follow every Space, fullscreen apps included.
  atomWidget.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
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
  // Transparent, frameless BrowserWindows on macOS have a known Chromium compositor bug: shrinking
  // the window via a native resize drag can leave the renderer's last-painted frame stretched/
  // stale, or blank the content entirely, and it stays that way — regrowing the window afterward
  // doesn't self-correct, since nothing tells the compositor a new frame is actually needed. Not
  // this app's own layout/JS breaking (the underlying DOM is fine the whole time); the fix is
  // forcing a fresh paint on every resize tick, not just at the end of the debounced geometry save
  // above. webContents.invalidate() is Electron's documented "schedule a full repaint" escape
  // hatch for exactly this class of stuck-renderer problem, and is cheap enough to call on every
  // tick of a live drag, not just once it settles.
  atomWidget.on('resize', () => {
    if (!atomWidget || atomWidget.isDestroyed()) {
      return;
    }
    atomWidget.webContents.invalidate();
  });
  // Edge-snap is triggered explicitly by the atomfolio:widget-drag-end IPC message (sent from
  // atom-view.jsx's own pointerup/pointercancel/⌘-release), not from this 'move'/'moved' native
  // window event — the ⌘-drag itself is driven by startAtomWidgetDrag's own setInterval polling
  // loop, which calls setPosition() many times a second, and snapping on every one of those (if
  // 'moved' fired per call) would fight the user's hand mid-drag instead of only settling things
  // once, on release.

  // A discoverable way to reach things that would otherwise require knowing the tray menu exists.
  atomWidget.webContents.on('context-menu', () => {
    if (!atomWidget || atomWidget.isDestroyed()) {
      return;
    }
    const template = [
      { label: '뉴스 열기', click: () => showPopoverFocusedOnPage(POPOVER_PAGE_NEWS) },
      { label: '설정 열기', click: () => showPopoverFocusedOnPage(POPOVER_PAGE_SETTINGS) },
    ];
    // Only shown once there's something to switch between — mirrors renderPortfolioPicker's own
    // 2+ gate in popover.js, so the two menus agree on when portfolio-switching is a real feature
    // versus a single-portfolio workspace where it'd just be a disabled-feeling submenu of one.
    if (state.portfolios.length >= 2) {
      template.push({
        label: '포트폴리오 전환',
        submenu: state.portfolios.map((portfolio) => ({
          label: portfolio.name,
          type: 'radio',
          checked: portfolio.id === state.selectedPortfolioId,
          click: () => {
            void selectPortfolio(portfolio.id);
          },
        })),
      });
    }
    template.push({ type: 'separator' }, { label: '위젯 숨기기', click: () => setAtomWidgetVisible(false) });
    Menu.buildFromTemplate(template).popup({ window: atomWidget });
  });

  if (config.atomWidgetVisible) {
    // showInactive, not show — an ambient overlay shouldn't steal focus from whatever the user
    // was doing, on launch or when toggled back on from the tray menu.
    atomWidget.showInactive();
  }

  return atomWidget;
}

// How long to wait for atom-view.jsx's dissolve-transition ack before hiding the widget anyway —
// the animation itself runs ~420ms (useAtomTransition's default), so this is a generous ceiling
// past that, not a race against it.
const WIDGET_CLOSE_ACK_TIMEOUT_MS = 900;

// Set (to a cleanup function) only while a hide-after-dissolve sequence is in flight — lets
// setAtomWidgetVisible(true) cancel a pending hide if the user shows the widget again before the
// dissolve/ack round-trip settles, instead of that stale sequence hiding it right back out from
// under them a moment later.
let cancelPendingWidgetHide = null;

function setAtomWidgetVisible(visible) {
  saveConfig({ atomWidgetVisible: visible });
  if (!atomWidget || atomWidget.isDestroyed()) {
    return;
  }
  if (visible) {
    cancelPendingWidgetHide?.();
    // Always the primary display's center on show, regardless of wherever a previous drag left
    // it — see centeredAtomWidgetPosition's own comment. This makes the saved atomWidgetPosition
    // (still written by saveAtomWidgetGeometry below on every 'move'/'resize', including live
    // during a drag) relevant only to createAtomWidget's *initial* window bounds at app launch,
    // not to anything that happens on a later show — it's kept rather than removed because it
    // still does that one job, and atomWidgetSize is saved by the same debounced handler.
    const { width, height } = atomWidget.getBounds();
    const { x, y } = centeredAtomWidgetPosition(width, height);
    atomWidget.setPosition(x, y, false);
    // Reset click-through explicitly rather than trusting whatever state a previous hide left it
    // in — atom-view.jsx's own hit-test (see atomfolio:widget-set-click-through) only re-evaluates
    // on pointermove, so without this a widget re-shown under a cursor that hasn't moved yet could
    // briefly reappear still click-through from before it was hidden.
    atomWidget.setIgnoreMouseEvents(false);
    atomWidget.showInactive();
    // Mirrors hideAtomWidgetAfterDissolve's 'closing' signal below — without this, a widget shown
    // again after being dissolved-and-hidden stays stuck at its dissolved (scale 0) state, since
    // nothing ever tells atom-view.jsx to materialize back in. No ack/timeout needed on this side
    // the way hiding needs one: there's nothing here that has to wait on the renderer, showing the
    // (still-transparent-during-materialize) window immediately is correct either way.
    atomWidget.webContents.send('atomfolio:widget-opening');
    return;
  }
  hideAtomWidgetAfterDissolve();
}

// Plays the dissolve transition (atom-view.jsx) before actually hiding the window, instead of
// cutting straight to invisible. The renderer acks once its own animation finishes;
// WIDGET_CLOSE_ACK_TIMEOUT_MS is the fallback in case that ack never arrives (component unmounted,
// renderer busy, message lost) so the widget can never get stuck refusing to hide.
function hideAtomWidgetAfterDissolve() {
  if (!atomWidget || atomWidget.isDestroyed() || cancelPendingWidgetHide) {
    // Already mid-hide (e.g. a double-click on "위젯 숨기기") — let the one already in flight run
    // its course rather than layering a second dissolve/ack/timeout on top of it.
    return;
  }

  const onAck = () => finish();
  const timeoutId = setTimeout(finish, WIDGET_CLOSE_ACK_TIMEOUT_MS);

  function finish() {
    clearTimeout(timeoutId);
    ipcMain.removeListener('atomfolio:widget-close-ack', onAck);
    cancelPendingWidgetHide = null;
    if (atomWidget && !atomWidget.isDestroyed()) {
      atomWidget.hide();
    }
  }

  cancelPendingWidgetHide = () => {
    clearTimeout(timeoutId);
    ipcMain.removeListener('atomfolio:widget-close-ack', onAck);
    cancelPendingWidgetHide = null;
    // Deliberately not calling atomWidget.hide() here — this path only runs when
    // setAtomWidgetVisible(true) just called showInactive(), so hiding it again would undo that.
  };

  ipcMain.once('atomfolio:widget-close-ack', onAck);
  atomWidget.webContents.send('atomfolio:widget-closing');
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

// Re-registers from scratch rather than diffing old/new accelerator — globalShortcut has no
// "update" call, only register/unregister, and this only ever runs at startup (once) or right
// after the one settings field that can change it, neither of which is hot-path enough to bother
// optimizing away the unregister-everything-and-redo.
function registerToggleShortcut() {
  globalShortcut.unregisterAll();
  const config = loadConfig();
  const accelerator = config.toggleShortcut || 'Alt+A';
  const registered = globalShortcut.register(accelerator, togglePopover);
  if (!registered) {
    // Most likely cause: another app already owns this combination. Not fatal — the tray click
    // and menu bar icon still open the popover, this is just a convenience shortcut.
    console.error(`[atomfolio] failed to register global shortcut "${accelerator}" (already in use?)`);
  }
}

// The stored value is just data until it's actually applied to the OS's Login Items list — this
// is the one place that happens, called once at startup (so a hand-edited config.json takes
// effect on next launch) and again from the settings-panel toggle's IPC handler below.
function applyLaunchAtLoginSetting(value) {
  app.setLoginItemSettings({ openAtLogin: Boolean(value) });
}

// 'system' | 'light' | 'dark' — these are literally the three values Electron's own
// nativeTheme.themeSource accepts, so config.appearance maps straight through with no
// translation. Setting this is what makes nativeTheme.shouldUseDarkColors (and every renderer's
// own `prefers-color-scheme` media query, though popover.css deliberately doesn't use that —
// see its own comment) resolve 'system' against the real macOS appearance instead of a fixed
// choice. Called once at startup and again whenever the setting changes.
function applyAppearanceSetting(appearance) {
  nativeTheme.themeSource = ['system', 'light', 'dark'].includes(appearance) ? appearance : 'system';
}

// Pushed explicitly (not left to `prefers-color-scheme` alone) so the CSS and the settings
// panel's own notion of "what's active right now" can never disagree — one resolved value,
// computed here, is the only source either window reads. Sent to both windows: the popover's
// whole chrome follows it, and the atom widget follows it for its own ink/stroke palette
// (atom-widget.css's data-theme override, consumed by atom-sketch.css's --atom-ink) — the atom's
// *shape* stays exactly what it's always been, only whether it draws in warm cream or warm
// charcoal changes, since it floats over an arbitrary desktop wallpaper rather than this app's
// own chrome and needs to stay visible against either a light or dark one.
function broadcastTheme() {
  const payload = { isDark: nativeTheme.shouldUseDarkColors };
  if (popover && !popover.isDestroyed()) {
    popover.webContents.send('atomfolio:theme', payload);
  }
  if (atomWidget && !atomWidget.isDestroyed()) {
    atomWidget.webContents.send('atomfolio:theme', payload);
  }
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

// Same reveal choreography as showPopoverFocusedOn above, minus the article-specific scroll —
// used by the widget's context-menu "뉴스 열기"/"설정 열기" shortcuts to land directly on a page
// instead of always opening onto news (the pager's own default on every popover show).
function showPopoverFocusedOnPage(pageIndex) {
  if (!popover) {
    return;
  }

  positionPopoverNearTray();
  popover.show();
  popover.focus();
  popover.webContents.send('atomfolio:focus-page', pageIndex);
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

// A minimal analogue of the web app's createManualPortfolioItem (src/App.jsx) — not imported
// directly since it isn't an exported shared util (it lives inline in that file, not in one of
// the src/lib modules main.js already reaches into for portfolioTotals/insights), and duplicating
// its full manual-entry field set here would be overkill for a ticker+quantity-only quick-add.
// Kept just detailed enough to show up immediately: generateAtomLayout (already bundled and used
// unmodified in atom-view.jsx) renders every item unconditionally by ticker/stockName, and
// atom-view.jsx's own selected-item readout falls back to an item's raw fields when it has no
// computed marketValue yet (a fresh quick-add has no price data until the next quote refresh).
function buildQuickAddItem(ticker, quantity) {
  const shares = String(quantity);
  return {
    id: randomUUID(),
    label: ticker,
    name: ticker,
    stockName: ticker,
    stockCode: ticker,
    ticker,
    code: ticker,
    shares,
    assetClass: '주식',
    fields: [
      { label: '종목명', value: ticker },
      { label: '종목 티커', value: ticker },
      { label: '보유수량', value: shares },
    ],
    metadataSource: 'desktop-quick-add',
  };
}

// Shared by the popover's picker (via the IPC handler below) and the widget's context-menu
// "포트폴리오 전환" submenu (called directly from the main process, no IPC round-trip needed since
// the click handler already runs there).
async function selectPortfolio(portfolioId) {
  const cleanId = String(portfolioId ?? '').trim() || null;
  saveConfig({ selectedPortfolioId: cleanId });
  await refresh();
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

  // Sent once per ⌘-drag gesture (not once per pointermove) — see startAtomWidgetDrag's own
  // comment for why the drag itself is tracked here via cursor polling rather than as a stream of
  // renderer-computed deltas.
  ipcMain.on('atomfolio:widget-drag-start', () => {
    startAtomWidgetDrag();
  });

  // Sent once, on pointerup/pointercancel or on ⌘ being released mid-drag — the one moment
  // edge-snapping should actually run (see snapAtomWidgetToEdges's own comment and
  // createAtomWidget's for why this isn't wired off a native window event instead).
  ipcMain.on('atomfolio:widget-drag-end', () => {
    stopAtomWidgetDrag();
    snapAtomWidgetToEdges();
  });

  // atom-view.jsx's own hit-test decides *when* this should flip (see its own comment) — this
  // handler just applies whatever it decided. forward: true is load-bearing, not a nicety: without
  // it, the moment the window switches to ignoring mouse events, it stops receiving mousemove too,
  // so the renderer would lose the one signal (a pointermove back over an actual hit target) it
  // needs in order to ever ask to un-ignore again — the widget would be permanently click-through
  // until reopened. With forward: true, move events still reach the renderer while only
  // clicks/drags pass through to whatever's behind.
  ipcMain.on('atomfolio:widget-set-click-through', (_event, shouldIgnore) => {
    if (!atomWidget || atomWidget.isDestroyed()) {
      return;
    }
    atomWidget.setIgnoreMouseEvents(Boolean(shouldIgnore), { forward: true });
  });

  ipcMain.handle('atomfolio:connect', async (_event, workspaceId) => {
    const cleanId = String(workspaceId ?? '').trim();

    if (!cleanId) {
      return { ok: false, error: 'workspace-id-required' };
    }

    // Probe with this ID before saving config or calling the shared refresh() — refresh() sets
    // connected:true as a side effect even when it fails (right for a *silent* poll keeping an
    // already-working connection alive through a network blip; wrong here, since it briefly
    // flips the main view on and then this handler flips it back off for a workspace ID that was
    // never valid to begin with — a flash, not a clean "that ID didn't work"). Validating first,
    // before touching config/state at all, means a bad ID never gets past the connect screen in
    // the first place: no flash, and .connect__error's message actually reaches the button that
    // triggered it instead of racing a state-broadcast re-render that replaces it out from
    // under the pending promise.
    try {
      const probeApi = createApiClient({ apiBaseUrl: loadConfig().apiBaseUrl, workspaceId: cleanId });
      await probeApi.fetchPortfolios();
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'atomfolio-connect-failed' };
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
    await selectPortfolio(portfolioId);
    return { ok: true };
  });

  // Fetch-append-PUT rather than a dedicated create-item call — see api.mjs's updatePortfolio
  // comment for why there's no narrower endpoint to call instead. Re-fetches the portfolio fresh
  // (not off `state.items`, which is the flattened single-portfolio view refresh() already
  // trimmed down) so the PUT body carries every field the server round-tripped, not just the
  // subset the desktop app happens to keep around.
  ipcMain.handle('atomfolio:add-holding', async (_event, payload) => {
    const portfolioId = String(payload?.portfolioId ?? '').trim();
    const ticker = String(payload?.ticker ?? '').trim().toUpperCase();
    const quantity = Number(payload?.quantity);

    if (!portfolioId || !ticker || !Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, error: 'invalid-holding' };
    }

    const config = loadConfig();
    const api = createApiClient({ apiBaseUrl: config.apiBaseUrl, workspaceId: config.workspaceId });

    try {
      const { portfolio } = await api.fetchPortfolio(portfolioId);
      if (!portfolio) {
        return { ok: false, error: 'portfolio-not-found' };
      }

      const newItem = buildQuickAddItem(ticker, quantity);
      // timelineItems (per-date history) mirrors items 1:1 for anything without real history of
      // its own — only touched if the portfolio already has one, same as the web's own
      // handleAppendManualHoldings does, so the two don't silently diverge.
      const nextTimelineItems = portfolio.timelineItems?.length
        ? [...portfolio.timelineItems, newItem]
        : portfolio.timelineItems;

      await api.updatePortfolio(portfolioId, {
        ...portfolio,
        items: [...(portfolio.items ?? []), newItem],
        timelineItems: nextTimelineItems,
      });

      await refresh({ silent: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'add-holding-failed' };
    }
  });

  ipcMain.handle('atomfolio:search-news', async (_event, query) => {
    const config = loadConfig();
    if (!config.workspaceId) {
      return { items: [] };
    }
    const api = createApiClient({ apiBaseUrl: config.apiBaseUrl, workspaceId: config.workspaceId });
    try {
      return await api.searchNews(String(query ?? '').trim());
    } catch {
      return { items: [] };
    }
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
      atomWidgetSize: config.atomWidgetSize ?? { width: ATOM_WIDGET_WIDTH, height: ATOM_WIDGET_HEIGHT },
      atomWidgetSizeBounds: { minWidth: ATOM_WIDGET_MIN_WIDTH, maxWidth: ATOM_WIDGET_MAX_WIDTH },
      launchAtLogin: config.launchAtLogin,
      appearance: config.appearance,
      atomCategoryDimension: config.atomCategoryDimension,
    };
  });

  // Separate from get-settings/onState — this is the one value both windows need *before* their
  // first paint (to avoid a flash of the wrong theme), so it's a dedicated round-trip the
  // renderer can await right at bootstrap instead of waiting on the heavier state fetch.
  ipcMain.handle('atomfolio:get-theme', () => ({ isDark: nativeTheme.shouldUseDarkColors }));

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
      'launchAtLogin',
      'appearance',
      'atomCategoryDimension',
    ];
    const clean = {};
    for (const key of allowedKeys) {
      if (partial && key in partial) {
        clean[key] = partial[key];
      }
    }
    // Handled separately from the generic pass-through above (not just added to allowedKeys) —
    // unlike the plain numeric settings, this needs its own clamp/derive step rather than being
    // saved as whatever shape the renderer happens to send.
    if (partial && 'atomWidgetSize' in partial) {
      clean.atomWidgetSize = clampAtomWidgetSizeForWidth(partial.atomWidgetSize?.width);
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
    if ('atomWidgetSize' in clean && atomWidget && !atomWidget.isDestroyed()) {
      const { width, height } = clean.atomWidgetSize;
      atomWidget.setSize(width, height);
    }
    if ('launchAtLogin' in clean) {
      applyLaunchAtLoginSetting(clean.launchAtLogin);
    }
    if ('appearance' in clean) {
      applyAppearanceSetting(clean.appearance);
      // themeSource changing doesn't always change shouldUseDarkColors (e.g. picking 'light'
      // when the Mac is already in light mode) — nativeTheme's own 'updated' event only fires on
      // an actual resolved-value change, so broadcast unconditionally here rather than relying on
      // it to cover this case too.
      broadcastTheme();
    }
    if ('atomCategoryDimension' in clean) {
      // refresh() below doesn't touch this field (it only recomputes portfolio/holdings data), so
      // without this the atom widget wouldn't see the new dimension until something else happened
      // to trigger a state broadcast.
      setState({ categoryDimension: clean.atomCategoryDimension });
    }

    await refresh({ silent: true });
    return { ok: true };
  });
}

app.whenReady().then(async () => {
  // Menu bar only — a Dock icon would make this look like a second, redundant copy of the web app.
  app.dock?.hide();

  // Before either window is created, so nativeTheme.shouldUseDarkColors is already resolved by
  // the time anything could ask for it (get-theme, the initial broadcastTheme below).
  applyAppearanceSetting(loadConfig().appearance);

  createTray();
  createPopover();
  createAtomWidget();
  registerIpcHandlers();
  registerToggleShortcut();
  // 'updated' fires whenever the *resolved* dark/light value actually changes — either macOS's
  // own appearance changing while themeSource is 'system', or applyAppearanceSetting flipping to
  // a different themeSource that resolves differently. Either way, the popover needs to know.
  nativeTheme.on('updated', broadcastTheme);

  const config = loadConfig();
  applyLaunchAtLoginSetting(config.launchAtLogin);
  // Corrects the hardcoded default `state.categoryDimension` was declared with (see its own
  // comment) to whatever's actually persisted, before either window's first paint — setState
  // (not a bare assignment) so this also broadcasts to the popover/atom widget the same way any
  // other settings change would.
  setState({ categoryDimension: config.atomCategoryDimension });
  broadcastTheme();
  if (config.workspaceId) {
    await refresh();
    startPolling();
  }
});

app.on('window-all-closed', (event) => {
  // A tray app has no "last window" to quit on — it lives in the menu bar.
  event.preventDefault();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopAtomWidgetDrag();
});
