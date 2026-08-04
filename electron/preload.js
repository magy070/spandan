const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => process.versions.electron
});

contextBridge.exposeInMainWorld('isDesktopApp', true);
