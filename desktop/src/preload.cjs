const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atomfolio', {
  getState: () => ipcRenderer.invoke('atomfolio:get-state'),
  // Fire-and-forget, sent only when atom-view.jsx's own hit-test actually changes state (not on
  // every pointermove) — see main.js's atomfolio:widget-set-click-through handler for what this
  // does to the window itself.
  setWidgetClickThrough: (shouldIgnore) => ipcRenderer.send('atomfolio:widget-set-click-through', Boolean(shouldIgnore)),
  // Round-trip for the widget-close dissolve — main.js sends 'closing' before actually hiding the
  // window, atom-view.jsx plays the transition and acks back. See main.js's
  // hideAtomWidgetAfterDissolve for the timeout fallback if this ack never arrives.
  widgetCloseAck: () => ipcRenderer.send('atomfolio:widget-close-ack'),
  // Mirrors atom-view.jsx's own selected-atom state to the main process (fire-and-forget, one per
  // click/deselect) — see main.js's widgetSelection for the one thing it's actually used for:
  // offering "open *this stock's* news" in the widget's own context menu instead of only the
  // generic news page. { ticker, label } or null.
  setWidgetSelection: (selection) => ipcRenderer.send('atomfolio:widget-selection', selection),
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
  // Widget context-menu's "{종목} 뉴스 보기" — same show-and-jump shape as onFocusPage, plus a
  // query the news page's search bar should run. See main.js's showPopoverFocusedOnNewsSearch.
  onFocusNewsSearch: (callback) => {
    const listener = (_event, query) => callback(query);
    ipcRenderer.on('atomfolio:focus-news-search', listener);
    return () => ipcRenderer.removeListener('atomfolio:focus-news-search', listener);
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
