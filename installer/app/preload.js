const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onStatus: (callback) => ipcRenderer.on('set-status', (_event, payload) => callback(payload)),
  onError: (callback) => ipcRenderer.on('set-error', (_event, payload) => callback(payload)),
  retry: () => ipcRenderer.send('retry-setup'),
});
