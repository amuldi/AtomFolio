const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atomfolio', {
  getState: () => ipcRenderer.invoke('atomfolio:get-state'),
  // Fire-and-forget (send, not invoke), one message per gesture rather than one per pointermove —
  // see main.js's atomfolio:widget-drag-start handler for why the drag itself is tracked by the
  // main process polling the cursor, not by streaming deltas up from here.
  startWidgetDrag: () => ipcRenderer.send('atomfolio:widget-drag-start'),
  endWidgetDrag: () => ipcRenderer.send('atomfolio:widget-drag-end'),
  // A plain click on the docked tab (no real movement) — see main.js's atomfolio:undock-widget
  // handler. Distinct from endWidgetDrag: that one lets main.js's own dock-zone tracking decide
  // dock vs. undock vs. plain-snap; this one is only ever sent when the renderer already knows
  // for certain (no movement happened) that undocking is the only sensible outcome.
  undockWidget: () => ipcRenderer.invoke('atomfolio:undock-widget'),
  // Fire-and-forget, sent only when atom-view.jsx's own hit-test actually changes state (not on
  // every pointermove) — see main.js's atomfolio:widget-set-click-through handler for what this
  // does to the window itself.
  setWidgetClickThrough: (shouldIgnore) => ipcRenderer.send('atomfolio:widget-set-click-through', Boolean(shouldIgnore)),
  // Round-trip for the widget-close dissolve — main.js sends 'closing' before actually hiding the
  // window, atom-view.jsx plays the transition and acks back. See main.js's
  // hideAtomWidgetAfterDissolve for the timeout fallback if this ack never arrives.
  widgetCloseAck: () => ipcRenderer.send('atomfolio:widget-close-ack'),
  connect: (workspaceId) => ipcRenderer.invoke('atomfolio:connect', workspaceId),
  disconnect: () => ipcRenderer.invoke('atomfolio:disconnect'),
  selectPortfolio: (portfolioId) => ipcRenderer.invoke('atomfolio:select-portfolio', portfolioId),
  addHolding: (payload) => ipcRenderer.invoke('atomfolio:add-holding', payload),
  searchNews: (query) => ipcRenderer.invoke('atomfolio:search-news', query),
  openExternal: (url) => ipcRenderer.invoke('atomfolio:open-external', url),
  getSettings: () => ipcRenderer.invoke('atomfolio:get-settings'),
  updateSettings: (partial) => ipcRenderer.invoke('atomfolio:update-settings', partial),
  // Separate from getSettings — see main.js's atomfolio:get-theme handler for why.
  getTheme: () => ipcRenderer.invoke('atomfolio:get-theme'),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('atomfolio:state', listener);
    return () => ipcRenderer.removeListener('atomfolio:state', listener);
  },
  onFocusArticle: (callback) => {
    const listener = (_event, articleId) => callback(articleId);
    ipcRenderer.on('atomfolio:focus-article', listener);
    return () => ipcRenderer.removeListener('atomfolio:focus-article', listener);
  },
  onFocusPage: (callback) => {
    const listener = (_event, pageIndex) => callback(pageIndex);
    ipcRenderer.on('atomfolio:focus-page', listener);
    return () => ipcRenderer.removeListener('atomfolio:focus-page', listener);
  },
  onWidgetClosing: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('atomfolio:widget-closing', listener);
    return () => ipcRenderer.removeListener('atomfolio:widget-closing', listener);
  },
  onWidgetOpening: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('atomfolio:widget-opening', listener);
    return () => ipcRenderer.removeListener('atomfolio:widget-opening', listener);
  },
  // Edge Dock — see main.js's updateAtomWidgetDockTracking. Fires only on an actual zone change
  // (entering/leaving/switching sides), not on every drag-poll tick.
  onWidgetEdgePreview: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('atomfolio:widget-edge-preview', listener);
    return () => ipcRenderer.removeListener('atomfolio:widget-edge-preview', listener);
  },
  // Edge Dock — see main.js's dockAtomWidgetTo/undockAtomWidgetAt. Fires once per transition,
  // right as the window's own setBounds animation starts, so the renderer's spring/overshoot
  // keyframe can run alongside it.
  onWidgetDockTransition: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('atomfolio:widget-dock-transition', listener);
    return () => ipcRenderer.removeListener('atomfolio:widget-dock-transition', listener);
  },
  onTheme: (callback) => {
    const listener = (_event, theme) => callback(theme);
    ipcRenderer.on('atomfolio:theme', listener);
    return () => ipcRenderer.removeListener('atomfolio:theme', listener);
  },
});
