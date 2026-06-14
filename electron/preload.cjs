const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  setBrightness: (id, value) => ipcRenderer.invoke('set-brightness', id, value),
  setMasterBrightness: (value) => ipcRenderer.invoke('set-master-brightness', value),
  setVolume: (value) => ipcRenderer.invoke('set-volume', value),
  getVolume: () => ipcRenderer.invoke('get-volume'),
  showClock: () => ipcRenderer.invoke('show-clock'),
  hideClock: () => ipcRenderer.invoke('hide-clock'),
  showStopWindow: () => ipcRenderer.invoke('show-stop-window'),
  hideStopWindow: () => ipcRenderer.invoke('hide-stop-window'),
  hideMainWindow: () => ipcRenderer.invoke('hide-main-window'),
  showMainWindow: () => ipcRenderer.invoke('show-main-window'),
  setClockPosition: (pos) => ipcRenderer.invoke('set-clock-position', pos),
  onStopAudio: (callback) => ipcRenderer.on('stop-audio-triggered', callback)
});
