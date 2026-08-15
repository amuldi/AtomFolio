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
// Not user-configurable (unlike pollIntervalSec) — deliberately fixed rather than exposed as a
// setting, so there's no config-file/UI knob that could turn this into the kind of
// misconfigured-client request storm MIN_POLL_INTERVAL_SEC above guards the heavier endpoints
// against. See startVersionPolling for what this actually hits.
const VERSION_POLL_INTERVAL_SEC = 5;
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
// against it. Deliberately not applied on every 'move' tick — only once the drag actually ends
// (see the atomfolio:widget-drag-end handler) — so it never fights the user's hand mid-drag.
const ATOM_WIDGET_SNAP_THRESHOLD = 24;
// How often the main process re-reads the global cursor position while ⌘-dragging the widget
// (see startAtomWidgetDrag). 16ms ~ 60Hz — smooth without meaningfully loading the CPU for what's
// normally a few-second gesture.
const ATOM_WIDGET_DRAG_POLL_MS = 16;
// Edge Dock — see dockAtomWidgetTo/undockAtomWidgetAt. Deliberately a *much* tighter zone than
// ATOM_WIDGET_SNAP_THRESHOLD above: plain edge-snap (flush, but still floating/full-size) already
// owns the 24px zone, so docking only kicks in when the widget has been pushed essentially all
// the way to the edge — a distinctly more deliberate gesture than a normal release that happens
// to land near one.
const ATOM_WIDGET_DOCK_TRIGGER_THRESHOLD = 10;
// Wider than the trigger zone — this is just when the drag-preview visual (compress + edge glow)
// starts showing "let go here to dock", well before the release itself would actually commit.
const ATOM_WIDGET_DOCK_PREVIEW_THRESHOLD = 40;
// The widget has to stay inside the trigger zone continuously for at least this long before a
// release counts as an intentional dock, not just a fast drag that happened to pass close to the
// edge on its way somewhere else. See updateAtomWidgetDockTracking.
const ATOM_WIDGET_DOCK_DWELL_MS = 200;
// Size of the small always-visible tab a docked widget collapses to.
const ATOM_WIDGET_DOCKED_WIDTH = 84;
const ATOM_WIDGET_DOCKED_HEIGHT = 108;
// Pages inside the popover's horizontal pager (see popover.js's createPager) — kept in one place
// since both the header's own ⚙ shortcut and the context-menu shortcuts below need to agree on
// the indices. Summary (the portfolio mini-dashboard) is page 0 — the popover opens there, not on
// news, so "what's my portfolio doing right now" is the first thing a click ever shows.
const POPOVER_PAGE_SUMMARY = 0;
const POPOVER_PAGE_NEWS = 1;
const POPOVER_PAGE_SETTINGS = 2;
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
// Edge Dock bookkeeping for the drag currently in flight (all null/false when no drag is active).
// atomWidgetDockZone tracks how long the widget has continuously been inside the dock-trigger
// zone (see updateAtomWidgetDockTracking) — read once, at drag-end, to decide dock vs. plain
// edge-snap. atomWidgetDockPreviewSide is only the last value *sent* to the renderer, so the
// preview IPC only fires on an actual change, not every 16ms poll tick. atomWidgetDragOriginWasDocked
// records whether *this* drag started from a docked state, so drag-end knows to grow back out to
// floating (undock) rather than falling back to a plain edge-snap when it doesn't end in a dock.
let atomWidgetDockZone = null;
let atomWidgetDockPreviewSide = null;
let atomWidgetDragOriginWasDocked = false;
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
  // Mirrors config.atomWidgetSleeping the same way — atom-view.jsx uses this to keep the idle
  // rotation at full speed while asleep (see its own comment on engagementRef): a sleeping widget
  // can never receive focus (it's fully click-through), so the normal "only spin at full speed
  // once actually interacted with" signal would otherwise stay permanently false and the widget
  // would crawl at IDLE_ROTATE_DISENGAGED_MULTIPLIER forever instead of reading as ambient motion.
  sleeping: false,
  // Mirrors config.atomWidgetMode the same way categoryDimension/sleeping above mirror their own
  // config fields — atom-view.jsx uses this to switch into the compact Edge Dock layout and to
  // set data-widget-mode on <html> (same mechanism as data-theme). Hardcoded to store.mjs's own
  // default here for the same reason as sleeping above; corrected from the real config before
  // either window's first paint.
  atomWidgetMode: 'floating',
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
  // Unlike the atom widget (which now deliberately stays on whichever single Space it was shown
  // on, see createAtomWidget's own comment), the popover is opened on demand from the tray icon —
  // clicking that icon is available from every Space/fullscreen app, so the panel it opens has to
  // actually be able to render wherever the click happened, not just the Space it was first
  // created on.
  popover.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
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
// before any saved position exists. Centers on whichever display the cursor is currently on — the
// display someone's actually working on right now — not wherever a previous drag left the widget,
// and not always the system's designated "primary" display (which stays fixed regardless of which
// screen is actually in use on a multi-monitor setup). This used to always use
// screen.getPrimaryDisplay() on the reasoning that showing the widget should be a predictable
// "it's right here" action; in practice that meant re-showing it after toggling it off could put
// it on a screen the user isn't even looking at.
function centeredAtomWidgetPosition(width, height) {
  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
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
// How close (in px) two displays' bounds have to line up to count as physically touching —
// covers the sub-pixel/rounding gaps some multi-monitor arrangements report between displays a
// user has actually arranged flush against each other in System Settings.
const DISPLAY_ADJACENCY_TOLERANCE_PX = 4;

// Whether `display` has another connected display immediately beyond its given side — an
// internal seam in an extended desktop, not a real edge of anything. This matters because
// edgeProximityForBounds below feeds the Edge Dock trigger/preview zones: without this check, the
// seam between two side-by-side monitors reads as "an edge" from *both* displays' point of view
// (whichever display screen.getDisplayMatching currently attributes the dragged window to), so
// dragging the widget across from one monitor to the other would trip the dock zone right at the
// boundary instead of letting the drag continue through — exactly the "gets small instead of
// moving to the other screen" bug this exists to fix. Only counts a display as adjacent if it
// also overlaps vertically at all; one stacked directly above/below with no horizontal overlap
// isn't adjacent for a left/right check.
function hasAdjacentDisplay(display, side) {
  return screen.getAllDisplays().some((other) => {
    if (other.id === display.id) {
      return false;
    }
    const verticalOverlap =
      Math.min(display.bounds.y + display.bounds.height, other.bounds.y + other.bounds.height) -
      Math.max(display.bounds.y, other.bounds.y);
    if (verticalOverlap <= 0) {
      return false;
    }
    return side === 'left'
      ? Math.abs(other.bounds.x + other.bounds.width - display.bounds.x) <= DISPLAY_ADJACENCY_TOLERANCE_PX
      : Math.abs(display.bounds.x + display.bounds.width - other.bounds.x) <= DISPLAY_ADJACENCY_TOLERANCE_PX;
  });
}

// Which edge of whichever display currently contains `bounds` is closer, and by how much — used
// by the dock-zone tracking below (updateAtomWidgetDockTracking). Always returns a side (never
// null); callers compare `distance` against whichever threshold is relevant to them. A side
// blocked by hasAdjacentDisplay above is never returned/never clears a threshold on its own — its
// distance is reported as infinite specifically so a seam between monitors can't win the
// left-vs-right comparison or independently trip the trigger/preview zones.
function edgeProximityForBounds(bounds) {
  const display = screen.getDisplayMatching(bounds);
  const workArea = display.workArea;
  const leftDistance = hasAdjacentDisplay(display, 'left') ? Infinity : bounds.x - workArea.x;
  const rightDistance = hasAdjacentDisplay(display, 'right')
    ? Infinity
    : workArea.x + workArea.width - (bounds.x + bounds.width);
  const side = leftDistance <= rightDistance ? 'left' : 'right';
  return { side, distance: Math.max(0, Math.min(leftDistance, rightDistance)), display, workArea };
}

// Called on every drag-poll tick (see startAtomWidgetDrag below) with the widget's just-updated
// bounds. Maintains two independent things, both purely local state read back out at drag-end/
// during the drag — neither one moves or resizes the window itself:
//   1. atomWidgetDockZone — how long the widget has been continuously inside the tight
//      dock-trigger zone. Reset to null the instant it leaves that zone, so a drag that grazes
//      the edge and moves on doesn't accumulate dwell time from an earlier, unrelated pass.
//   2. atomWidgetDockPreviewSide — the wider, cosmetic preview zone. Only sent to the renderer
//      when it actually changes, not every 16ms tick, to keep the IPC traffic proportional to
//      actual state changes rather than the poll rate.
function updateAtomWidgetDockTracking(bounds) {
  const proximity = edgeProximityForBounds(bounds);
  const inTriggerZone = proximity.distance <= ATOM_WIDGET_DOCK_TRIGGER_THRESHOLD;
  const inPreviewZone = proximity.distance <= ATOM_WIDGET_DOCK_PREVIEW_THRESHOLD;

  if (inTriggerZone) {
    if (!atomWidgetDockZone || atomWidgetDockZone.side !== proximity.side) {
      atomWidgetDockZone = { side: proximity.side, enteredAt: Date.now() };
    }
  } else {
    atomWidgetDockZone = null;
  }

  const previewSide = inPreviewZone ? proximity.side : null;
  if (previewSide !== atomWidgetDockPreviewSide) {
    atomWidgetDockPreviewSide = previewSide;
    if (atomWidget && !atomWidget.isDestroyed()) {
      atomWidget.webContents.send('atomfolio:widget-edge-preview', { side: previewSide });
    }
  }
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
  // Captured once, at drag-start — a drag never resizes the window, so re-reading width/height on
  // every poll tick would just be a wasted getBounds() call.
  atomWidgetDragOrigin = {
    cursorX: cursor.x,
    cursorY: cursor.y,
    windowX: bounds.x,
    windowY: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
  atomWidgetDragOriginWasDocked = state.atomWidgetMode !== 'floating';
  atomWidgetDockZone = null;
  atomWidgetDockPreviewSide = null;
  atomWidgetDragInterval = setInterval(() => {
    if (!atomWidget || atomWidget.isDestroyed() || !atomWidgetDragOrigin) {
      stopAtomWidgetDrag();
      return;
    }
    const point = screen.getCursorScreenPoint();
    const dx = point.x - atomWidgetDragOrigin.cursorX;
    const dy = point.y - atomWidgetDragOrigin.cursorY;
    const x = Math.round(atomWidgetDragOrigin.windowX + dx);
    const y = Math.round(atomWidgetDragOrigin.windowY + dy);
    // No clampPointToVisibleDisplay here on purpose (see this module's own note elsewhere) — a
    // drag in progress should be able to cross freely onto another display, not get held at the
    // edge of whichever one it started on. Edge-snap/dock only apply once the drag actually ends.
    atomWidget.setPosition(x, y, false);
    updateAtomWidgetDockTracking({ x, y, width: atomWidgetDragOrigin.width, height: atomWidgetDragOrigin.height });
  }, ATOM_WIDGET_DRAG_POLL_MS);
}

function stopAtomWidgetDrag() {
  if (atomWidgetDragInterval) {
    clearInterval(atomWidgetDragInterval);
    atomWidgetDragInterval = null;
  }
  atomWidgetDragOrigin = null;
  atomWidgetDockZone = null;
  // Whatever decision the drag-end handler makes next (dock, undock, or a plain snap) supersedes
  // any lingering preview visual — but dock/undock each send their own transition message, and a
  // plain snap sends nothing, so the preview has to be explicitly cleared here or it'd stay stuck
  // showing "let go to dock" after a drag that didn't actually dock.
  if (atomWidgetDockPreviewSide !== null) {
    atomWidgetDockPreviewSide = null;
    if (atomWidget && !atomWidget.isDestroyed()) {
      atomWidget.webContents.send('atomfolio:widget-edge-preview', { side: null });
    }
  }
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

// Called only once a drag actually ends (see the atomfolio:widget-drag-end handler), never
// mid-gesture. Each axis snaps independently, so a corner release snaps both — same as most
// window managers' edge-snap behavior. This is the *plain* snap (flush against the edge, still
// full floating size) — see dockAtomWidgetTo below for the separate, more deliberate Edge Dock
// transition, which this function has nothing to do with and never triggers on its own.
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

// Edge Dock: collapses the widget into a small always-visible tab flush against the given screen
// edge. Called both when a drag ends inside the dock-trigger zone (see the drag-end handler
// below) and when restoring a previously-docked state at launch (createAtomWidget). Deliberately
// leaves config's atomWidgetPosition/atomWidgetSize (the *floating* geometry) untouched — those
// still mean "the widget's last known floating bounds" even while docked, which is what lets
// undockAtomWidgetAt below always have somewhere sane to grow back into. animate:false is only
// used for the launch-time restore path, where the window is being created already-docked and
// there's nothing to visibly transition from.
function dockAtomWidgetTo(side, { animate = true } = {}) {
  if (!atomWidget || atomWidget.isDestroyed()) {
    return;
  }
  const anchorBounds = atomWidget.getBounds();
  const display = screen.getDisplayMatching(anchorBounds);
  const workArea = display.workArea;
  const width = ATOM_WIDGET_DOCKED_WIDTH;
  const height = ATOM_WIDGET_DOCKED_HEIGHT;
  const x = side === 'left' ? workArea.x : workArea.x + workArea.width - width;
  const y = Math.round(
    Math.min(Math.max(anchorBounds.y, workArea.y), workArea.y + workArea.height - height),
  );

  // Loosened before setBounds, not after — setBounds would otherwise be clamped right back up to
  // the still-in-effect floating minimums.
  atomWidget.setMinimumSize(width, height);
  atomWidget.setMaximumSize(width, height);
  atomWidget.setResizable(false);
  if (animate) {
    atomWidget.webContents.send('atomfolio:widget-dock-transition', { phase: 'docking', side });
  }
  atomWidget.setBounds({ x, y, width, height }, animate);

  saveConfig({ atomWidgetMode: `docked-${side}`, atomWidgetDockDisplayId: display.id });
  setState({ atomWidgetMode: `docked-${side}` });
}

// The reverse of dockAtomWidgetTo — grows the widget back out to its normal floating size/
// behavior. dropBounds is wherever the (still docked-sized) window currently sits at the moment
// undocking is triggered — a click, or a drag that ended outside the dock-trigger zone — not
// necessarily the display it was originally docked on, since a drag can carry it onto a different
// display first. The floating rect reappears just clear of whichever edge it was resting against,
// roughly level with dropBounds, rather than jumping back to wherever a long-past drag last left
// it — that would read as disconnected from the gesture that just undocked it.
function undockAtomWidgetAt(dropBounds, { animate = true } = {}) {
  if (!atomWidget || atomWidget.isDestroyed()) {
    return;
  }
  const config = loadConfig();
  const floatWidth = config.atomWidgetSize?.width ?? ATOM_WIDGET_WIDTH;
  const floatHeight = config.atomWidgetSize?.height ?? ATOM_WIDGET_HEIGHT;
  const display = screen.getDisplayMatching(dropBounds);
  const workArea = display.workArea;
  const dockedFromLeft = dropBounds.x <= workArea.x + workArea.width / 2;
  const x = dockedFromLeft
    ? Math.round(workArea.x + ATOM_WIDGET_DEFAULT_MARGIN)
    : Math.round(workArea.x + workArea.width - floatWidth - ATOM_WIDGET_DEFAULT_MARGIN);
  const y = Math.round(
    Math.min(
      Math.max(dropBounds.y - (floatHeight - dropBounds.height) / 2, workArea.y),
      workArea.y + workArea.height - floatHeight,
    ),
  );

  atomWidget.setMaximumSize(ATOM_WIDGET_MAX_WIDTH, ATOM_WIDGET_MAX_HEIGHT);
  atomWidget.setMinimumSize(ATOM_WIDGET_MIN_WIDTH, ATOM_WIDGET_MIN_HEIGHT);
  atomWidget.setResizable(true);
  if (animate) {
    atomWidget.webContents.send('atomfolio:widget-dock-transition', { phase: 'undocking', side: null });
  }
  atomWidget.setBounds({ x, y, width: floatWidth, height: floatHeight }, animate);

  saveConfig({
    atomWidgetMode: 'floating',
    atomWidgetDockDisplayId: null,
    atomWidgetPosition: { x, y },
    atomWidgetSize: { width: floatWidth, height: floatHeight },
  });
  setState({ atomWidgetMode: 'floating' });
}

function createAtomWidget() {
  const config = loadConfig();

  // A dock remembered against a display that's no longer connected (unplugged monitor, different
  // desk) has nowhere safe to restore to — correct it back to floating up front rather than
  // guessing where a now-nonexistent edge would be. Corrected in config immediately (not just
  // read-around locally) so every other function that reads atomWidgetMode this session — the
  // drag-end handler, the context menu — agrees with what actually got created below.
  const dockedSide = config.atomWidgetMode === 'docked-left' ? 'left' : config.atomWidgetMode === 'docked-right' ? 'right' : null;
  const dockedDisplay = dockedSide && config.atomWidgetDockDisplayId != null
    ? screen.getAllDisplays().find((display) => display.id === config.atomWidgetDockDisplayId)
    : null;
  const restoreDocked = Boolean(dockedSide && dockedDisplay);
  if (dockedSide && !dockedDisplay) {
    saveConfig({ atomWidgetMode: 'floating', atomWidgetDockDisplayId: null });
    config.atomWidgetMode = 'floating';
    config.atomWidgetDockDisplayId = null;
  }

  const width = restoreDocked ? ATOM_WIDGET_DOCKED_WIDTH : (config.atomWidgetSize?.width ?? ATOM_WIDGET_WIDTH);
  const height = restoreDocked ? ATOM_WIDGET_DOCKED_HEIGHT : (config.atomWidgetSize?.height ?? ATOM_WIDGET_HEIGHT);
  let x;
  let y;
  if (restoreDocked) {
    const workArea = dockedDisplay.workArea;
    x = dockedSide === 'left' ? workArea.x : workArea.x + workArea.width - width;
    y = Math.round(workArea.y + (workArea.height - height) / 2);
  } else if (config.atomWidgetPosition) {
    ({ x, y } = clampPointToVisibleDisplay(config.atomWidgetPosition.x, config.atomWidgetPosition.y, width, height));
  } else {
    ({ x, y } = defaultAtomWidgetPosition());
  }

  atomWidget = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: restoreDocked ? width : ATOM_WIDGET_MIN_WIDTH,
    minHeight: restoreDocked ? height : ATOM_WIDGET_MIN_HEIGHT,
    maxWidth: restoreDocked ? width : ATOM_WIDGET_MAX_WIDTH,
    maxHeight: restoreDocked ? height : ATOM_WIDGET_MAX_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    // Unlike the popover (an opaque rounded panel, where a native shadow reads as a normal macOS
    // surface), the widget's content is an irregular transparent shape — a rectangular native
    // window shadow behind it would look like a visible glitch, not depth. The atom's own SVG
    // glow already does the "lifted off the desktop" job.
    hasShadow: false,
    resizable: !restoreDocked,
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
  // Deliberately *not* calling setVisibleOnAllWorkspaces here — the widget should only ever be
  // visible on whichever single Space/Desktop it was showing on when "원자 위젯 표시" was turned
  // on (Electron's default for a BrowserWindow), not chase the user across every Space the way an
  // earlier version of this file made it do. The popover (opened from the tray icon, which is
  // reachable from any Space) is the one that still needs to follow — see createPopover.
  atomWidget.loadFile(path.join(__dirname, 'renderer', 'atom-widget.html'));

  // One shared debounce for both events, saving position + size together — not two independent
  // move/resize handlers. A corner/edge drag that changes the origin *and* the dimensions in the
  // same native resize (e.g. dragging the top-left corner) doesn't reliably fire both 'move' and
  // 'resize' on every platform; getBounds() always reflects the window's true current geometry
  // regardless of which event happened to fire, so saving both from either event can't miss half
  // the change the way two separately-scoped handlers could.
  const saveAtomWidgetGeometry = () => {
    // Only *floating* geometry is meaningful to remember as "last floating bounds" — while docked
    // (or mid-transition into/out of dock, which itself fires synthetic move/resize events via
    // setBounds), the window's current rect is the tiny dock tab, not something a future floating
    // restore should ever land on. dockAtomWidgetTo/undockAtomWidgetAt already persist their own
    // geometry explicitly; this debounce would otherwise race and clobber it right back.
    if (state.atomWidgetMode !== 'floating') {
      return;
    }
    clearTimeout(atomWidgetGeometrySaveTimer);
    atomWidgetGeometrySaveTimer = setTimeout(() => {
      if (!atomWidget || atomWidget.isDestroyed() || state.atomWidgetMode !== 'floating') {
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
      { label: '요약 보기', click: () => showPopoverFocusedOnPage(POPOVER_PAGE_SUMMARY) },
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
    // Same toggle either direction reaches (dock via drag-to-edge, undock via click/drag-out) —
    // just a discoverable, no-gesture-required fallback for the same action.
    if (state.atomWidgetMode !== 'floating') {
      template.push({
        label: '가장자리 고정 해제',
        click: () => {
          if (atomWidget && !atomWidget.isDestroyed()) {
            undockAtomWidgetAt(atomWidget.getBounds());
          }
        },
      });
    }
    template.push({ type: 'separator' }, { label: '위젯 숨기기', click: () => setAtomWidgetVisible(false) });
    Menu.buildFromTemplate(template).popup({ window: atomWidget });
  });

  if (config.atomWidgetVisible) {
    // Routed through setAtomWidgetVisible (same path the tray menu's "위젯 보이기" uses), not a
    // direct showInactive() here — that's what actually applies the always-center-on-show
    // behavior (see its own comment) and the click-through/sleep-mode reset. Calling
    // atomWidget.showInactive() directly at launch skipped all of that, so a widget already
    // visible from a previous run reappeared wherever it was last dragged to instead of centered.
    setAtomWidgetVisible(true);
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
    // The cursor's current display's center on show, regardless of wherever a previous drag left
    // it — see centeredAtomWidgetPosition's own comment. This makes the saved atomWidgetPosition
    // (still written by saveAtomWidgetGeometry below on every 'move'/'resize', including live
    // during a drag) relevant only to createAtomWidget's *initial* window bounds at app launch,
    // not to anything that happens on a later show — it's kept rather than removed because it
    // still does that one job, and atomWidgetSize is saved by the same debounced handler.
    // Docked is the one exception: a docked tab already has a deliberate, meaningful position
    // (flush against its edge) — recentering it on show would both visually contradict "docked"
    // and require briefly growing it back to floating size just to center it, for no reason.
    if (state.atomWidgetMode === 'floating') {
      const { width, height } = atomWidget.getBounds();
      const { x, y } = centeredAtomWidgetPosition(width, height);
      atomWidget.setPosition(x, y, false);
    }
    // Reset click-through explicitly rather than trusting whatever state a previous hide left it
    // in — atom-view.jsx's own hit-test (see atomfolio:widget-set-click-through) only re-evaluates
    // on pointermove, so without this a widget re-shown under a cursor that hasn't moved yet could
    // briefly reappear still click-through from before it was hidden. Sleep mode still wins even
    // here, though — showing the widget shouldn't itself wake it back up.
    atomWidget.setIgnoreMouseEvents(Boolean(loadConfig().atomWidgetSleeping), { forward: true });
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

// "잠자기" — lives in the tray icon's right-click menu (see tray.on('right-click') below), not
// the popover's settings panel. Persists the same way setAtomWidgetVisible does (saveConfig, then
// an immediate apply to the live window) rather than round-tripping through the
// atomfolio:update-settings IPC channel the settings panel uses — nothing in the popover needs to
// know this changed, and the atomfolio:widget-set-click-through handler already re-checks
// config.atomWidgetSleeping on every message regardless, so this call is only about not leaving
// the widget interactive for however long it takes the cursor to move again after the toggle.
function setAtomWidgetSleeping(sleeping) {
  saveConfig({ atomWidgetSleeping: sleeping });
  // Broadcasts regardless of whether atomWidget currently exists — state.sleeping is what
  // atom-view.jsx reads to keep idle rotation at full speed while asleep (see state's own
  // comment), and there's no reason to skip updating that just because the window handle check
  // below is about to return early.
  setState({ sleeping: Boolean(sleeping) });
  if (!atomWidget || atomWidget.isDestroyed()) {
    return;
  }
  atomWidget.setIgnoreMouseEvents(Boolean(sleeping), { forward: true });
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
  // The background poll only runs every pollIntervalSec (60s+, see MIN_POLL_INTERVAL_SEC) — a web
  // edit made a moment before opening the popover would otherwise sit stale on screen for up to
  // that whole interval. Opening the popover is exactly the moment someone's about to look at this
  // data, so it's worth one extra silent refresh right here rather than waiting on the timer.
  // silent: true keeps this from flashing a loading state for what's usually already up to date.
  void refresh({ silent: true });
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
// used by the widget's context-menu "요약 보기"/"뉴스 열기"/"설정 열기" shortcuts to land directly
// on a page instead of always opening onto summary (the pager's own default on every popover show,
// see popover.js's resetToFirstPageIfVisible).
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
        {
          label: '잠자기',
          type: 'checkbox',
          checked: config.atomWidgetSleeping,
          click: (menuItem) => setAtomWidgetSleeping(menuItem.checked),
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

  const api = createApiClient({
    apiBaseUrl: config.apiBaseUrl,
    workspaceId: config.workspaceId,
    deviceToken: config.deviceToken,
  });

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

    // Insights are a pure function of items + config (no network), so they're ready at the same
    // time as everything else above — computing them here (not down where they used to live,
    // after the news fetch) is what lets the broadcast below go out without waiting on news at
    // all. See the immediate setState just below for why that gap mattered.
    const allInsights = evaluateInsights({ items: selectedPortfolioItems, config });
    const activeInsight = allInsights[0] ?? null;

    // Broadcast the portfolio-scoped state (items/totals/holdings/selectedPortfolioId) the moment
    // it's known, instead of waiting on the news fetch below too. Switching portfolios used to
    // stay visually frozen for both awaited network calls combined (fetchPortfolios, then
    // fetchHoldingNews) before atom-view.jsx's own selectedPortfolioId-watching effect ever saw a
    // change and could start its dissolve/materialize transition — a multi-hundred-ms dead patch
    // that read as the widget "hanging" rather than switching. News (and the notification it can
    // trigger) genuinely has nothing to do with what the atom widget renders, so it's decoupled
    // into its own later setState instead of gating this one.
    if (requestToken === latestRefreshToken) {
      setState({
        connected: true,
        loading: false,
        lastError: null,
        totals,
        holdings,
        items: selectedPortfolioItems,
        portfolios: portfolioList,
        selectedPortfolioId,
        activeInsight,
      });
    }

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

    // Proactive insights (stop-loss/take-profit/allocation drift) were already computed above,
    // alongside totals/holdings, so the atom widget's broadcast didn't have to wait on this news
    // fetch. Only the notification side (rate-limited by cooldown) still happens here — nothing
    // about it depends on when the popover/widget saw the insight, only on whether the user has
    // already been told about it recently.
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

// Fast, cheap polling for "did anything change", separate from the much heavier startPolling
// above (which re-fetches portfolios, holding-scoped news, and re-evaluates insights every tick).
// Without this, a web-side edit only ever reached the widget on the *next* full poll tick — up to
// config.pollIntervalSec, several minutes by default — or when the popover happened to be
// reopened (togglePopover's own silent refresh). Hits handleWorkspaceVersionRequest
// (server/apiHandlers.mjs), a single indexed-row lookup against a timestamp that's already bumped
// on every write in both store drivers — cheap enough to poll every few seconds without the
// bandwidth/compute cost a full refresh() at that frequency would mean, and only triggers the
// real (silent) refresh() when the value actually moves.
let versionPollTimer = null;
// null means "haven't observed a version yet" — the tick right after (re)starting this always
// just establishes that baseline instead of firing a refresh() that would just redundantly repeat
// whatever the connect/startup flow's own full refresh() already did moments earlier.
let lastKnownWorkspaceVersion = null;
// Guards against a slow response (network hiccup) leaving two checks in flight at once — the
// interval fires on a wall-clock schedule regardless of whether the previous tick's request has
// actually resolved yet.
let versionPollInFlight = false;

function startVersionPolling() {
  stopVersionPolling();

  versionPollTimer = setInterval(async () => {
    if (versionPollInFlight) {
      return;
    }
    const config = loadConfig();
    if (!config.workspaceId) {
      return;
    }

    versionPollInFlight = true;
    try {
      const api = createApiClient({
        apiBaseUrl: config.apiBaseUrl,
        workspaceId: config.workspaceId,
        deviceToken: config.deviceToken,
      });
      const { version } = await api.fetchWorkspaceVersion();

      if (lastKnownWorkspaceVersion === null) {
        lastKnownWorkspaceVersion = version;
      } else if (version !== lastKnownWorkspaceVersion) {
        lastKnownWorkspaceVersion = version;
        void refresh({ silent: true });
      }
    } catch {
      // A transient blip on a background check every few seconds isn't worth surfacing — the
      // much slower full poll (startPolling, via refresh()) already owns real connectivity-error
      // reporting through state.lastError.
    } finally {
      versionPollInFlight = false;
    }
  }, VERSION_POLL_INTERVAL_SEC * 1000);
}

function stopVersionPolling() {
  if (versionPollTimer) {
    clearInterval(versionPollTimer);
    versionPollTimer = null;
  }
  lastKnownWorkspaceVersion = null;
  versionPollInFlight = false;
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
  // edge-snapping/Edge-Dock decisions should actually run (see snapAtomWidgetToEdges's own
  // comment and createAtomWidget's for why this isn't wired off a native window event instead).
  // Three possible outcomes, decided here rather than split across separate handlers so the
  // dock/undock/plain-snap choice is made from one consistent snapshot of drag state:
  //   1. The widget spent the required dwell time pushed into the tight dock-trigger zone right
  //      up to release — dock it (this also covers "dragged from one dock, released near the
  //      other side", which just re-docks to whichever edge won).
  //   2. The drag started from a docked state but didn't end in a dock zone — the user pulled it
  //      away from the edge, so it grows back out to floating at the drop point.
  //   3. Neither — the existing plain edge-snap (flush, but still full floating size).
  ipcMain.on('atomfolio:widget-drag-end', () => {
    const bounds = atomWidget && !atomWidget.isDestroyed() ? atomWidget.getBounds() : null;
    const dockZone = atomWidgetDockZone;
    const wasDockOriginDrag = atomWidgetDragOriginWasDocked;
    stopAtomWidgetDrag();

    if (!bounds) {
      return;
    }

    const dwellMs = dockZone ? Date.now() - dockZone.enteredAt : 0;
    const shouldDock = Boolean(dockZone) && dwellMs >= ATOM_WIDGET_DOCK_DWELL_MS;

    if (shouldDock) {
      dockAtomWidgetTo(dockZone.side);
    } else if (wasDockOriginDrag) {
      undockAtomWidgetAt(bounds);
    } else {
      snapAtomWidgetToEdges();
    }
  });

  // A plain click on the docked tab (no drag) — see atom-view.jsx's docked-mode pointer handling,
  // which calls this instead of startWidgetDrag/endWidgetDrag when the pointer never actually
  // moved. Undocks back to floating at the tab's current position, same as dragging it out would,
  // just without a drag having happened.
  ipcMain.handle('atomfolio:undock-widget', () => {
    if (!atomWidget || atomWidget.isDestroyed() || state.atomWidgetMode === 'floating') {
      return;
    }
    undockAtomWidgetAt(atomWidget.getBounds());
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
    // "잠자기" overrides the renderer's own hit-test unconditionally — asleep, the widget is
    // click-through no matter what's under the cursor, full stop. Read fresh off config (not a
    // cached flag) so a settings change from the popover takes effect on this very next message,
    // not just from update-settings' own immediate apply (see that handler's own comment for why
    // both exist).
    const sleeping = Boolean(loadConfig().atomWidgetSleeping);
    atomWidget.setIgnoreMouseEvents(sleeping ? true : Boolean(shouldIgnore), { forward: true });
  });

  ipcMain.handle('atomfolio:connect', async (_event, rawValue) => {
    const cleanValue = String(rawValue ?? '').trim();

    if (!cleanValue) {
      return { ok: false, error: 'workspace-id-required' };
    }

    // Two accepted shapes: a plain guest:<uuid> workspace ID (no auth, as always), or a
    // atomfolio_dt_-prefixed device connection code generated from the web app's settings panel
    // while signed in (server/deviceTokens.mjs) — that one doesn't carry its own workspace id, so
    // it's resolved server-side via the same session check the web app uses rather than guessing
    // the user:<id> shape here.
    //
    // Probing before saving config or calling the shared refresh() in either case — refresh()
    // sets connected:true as a side effect even when it fails (right for a *silent* poll keeping
    // an already-working connection alive through a network blip; wrong here, since it briefly
    // flips the main view on and then this handler flips it back off for a value that was never
    // valid to begin with — a flash, not a clean "that didn't work"). Validating first, before
    // touching config/state at all, means a bad value never gets past the connect screen in the
    // first place: no flash, and .connect__error's message actually reaches the button that
    // triggered it instead of racing a state-broadcast re-render that replaces it out from under
    // the pending promise.
    const isDeviceToken = cleanValue.startsWith('atomfolio_dt_');

    try {
      if (isDeviceToken) {
        const sessionApi = createApiClient({ apiBaseUrl: loadConfig().apiBaseUrl, deviceToken: cleanValue });
        const session = await sessionApi.fetchWorkspaceSession();

        if (!session?.authenticated || !session?.workspaceId) {
          return { ok: false, error: 'atomfolio-connect-token-invalid' };
        }

        const probeApi = createApiClient({
          apiBaseUrl: loadConfig().apiBaseUrl,
          workspaceId: session.workspaceId,
          deviceToken: cleanValue,
        });
        await probeApi.fetchPortfolios();

        saveConfig({ workspaceId: session.workspaceId, deviceToken: cleanValue, lastSeenArticleIds: [] });
      } else {
        const probeApi = createApiClient({ apiBaseUrl: loadConfig().apiBaseUrl, workspaceId: cleanValue });
        await probeApi.fetchPortfolios();

        saveConfig({ workspaceId: cleanValue, deviceToken: null, lastSeenArticleIds: [] });
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'atomfolio-connect-failed' };
    }

    notifiedThisSessionIds.clear();
    await refresh();
    startPolling();
    startVersionPolling();
    return { ok: true };
  });

  ipcMain.handle('atomfolio:disconnect', () => {
    saveConfig({ workspaceId: null, deviceToken: null, lastSeenArticleIds: [], selectedPortfolioId: null });
    notifiedThisSessionIds.clear();

    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    stopVersionPolling();

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
    const api = createApiClient({
    apiBaseUrl: config.apiBaseUrl,
    workspaceId: config.workspaceId,
    deviceToken: config.deviceToken,
  });

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
    const api = createApiClient({
    apiBaseUrl: config.apiBaseUrl,
    workspaceId: config.workspaceId,
    deviceToken: config.deviceToken,
  });
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
  setState({
    categoryDimension: config.atomCategoryDimension,
    sleeping: config.atomWidgetSleeping,
    // Re-read after createAtomWidget() above, which may have corrected atomWidgetMode back to
    // 'floating' itself if the display it was docked on is no longer connected.
    atomWidgetMode: config.atomWidgetMode,
  });
  broadcastTheme();
  if (config.workspaceId) {
    await refresh();
    startPolling();
    startVersionPolling();
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
