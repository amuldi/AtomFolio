const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atomfolio', {
  getState: () => ipcRenderer.invoke('atomfolio:get-state'),
  connect: (workspaceId) => ipcRenderer.invoke('atomfolio:connect', workspaceId),
  disconnect: () => ipcRenderer.invoke('atomfolio:disconnect'),
  openExternal: (url) => ipcRenderer.invoke('atomfolio:open-external', url),
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
});
