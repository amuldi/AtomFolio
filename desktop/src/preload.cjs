const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atomfolio', {
  getState: () => ipcRenderer.invoke('atomfolio:get-state'),
  connect: (workspaceId) => ipcRenderer.invoke('atomfolio:connect', workspaceId),
  disconnect: () => ipcRenderer.invoke('atomfolio:disconnect'),
  selectPortfolio: (portfolioId) => ipcRenderer.invoke('atomfolio:select-portfolio', portfolioId),
  addHolding: (payload) => ipcRenderer.invoke('atomfolio:add-holding', payload),
  searchNews: (query) => ipcRenderer.invoke('atomfolio:search-news', query),
  openExternal: (url) => ipcRenderer.invoke('atomfolio:open-external', url),
  getSettings: () => ipcRenderer.invoke('atomfolio:get-settings'),
  updateSettings: (partial) => ipcRenderer.invoke('atomfolio:update-settings', partial),
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
});
