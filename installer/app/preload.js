const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onStatus: (callback) => ipcRenderer.on('set-status', (_event, payload) => callback(payload)),
  onError: (callback) => ipcRenderer.on('set-error', (_event, payload) => callback(payload)),
  retry: () => ipcRenderer.send('retry-setup'),
  getAppDataInfo: () => ipcRenderer.invoke('studenthero:get-app-data-info'),
  openAppDataPath: (key) => ipcRenderer.invoke('studenthero:open-app-data-path', key),
  clearAllUserData: () => ipcRenderer.invoke('studenthero:clear-all-user-data'),
  hibernate: () => ipcRenderer.invoke('studenthero:hibernate'),
});
