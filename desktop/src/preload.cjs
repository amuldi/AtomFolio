const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atomfolio', {
  getState: () => ipcRenderer.invoke('atomfolio:get-state'),
  // Fire-and-forget (send, not invoke), one message per gesture rather than one per pointermove —
  // see main.js's atomfolio:widget-drag-start handler for why the drag itself is tracked by the
  // main process polling the cursor, not by streaming deltas up from here.
  startWidgetDrag: () => ipcRenderer.send('atomfolio:widget-drag-start'),
  endWidgetDrag: () => ipcRenderer.send('atomfolio:widget-drag-end'),
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
  onTheme: (callback) => {
    const listener = (_event, theme) => callback(theme);
    ipcRenderer.on('atomfolio:theme', listener);
    return () => ipcRenderer.removeListener('atomfolio:theme', listener);
  },
});
