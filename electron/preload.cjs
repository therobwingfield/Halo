const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Dimmer
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  setBrightness: (id, value) => ipcRenderer.invoke('set-brightness', id, value),
  setMasterBrightness: (value) => ipcRenderer.invoke('set-master-brightness', value),
  restoreHardware: () => ipcRenderer.invoke('restore-hardware'),
  getRecoveryState: () => ipcRenderer.invoke('get-recovery-state'),
  // Auto-dim
  getAutoDimState: () => ipcRenderer.invoke('get-autodim-state'),
  setAutoDimEnabled: (on) => ipcRenderer.invoke('set-autodim-enabled', on),
  setAutoDimStrength: (v) => ipcRenderer.invoke('set-autodim-strength', v),
  setSoftwareDim: (index, opacity) => ipcRenderer.invoke('set-software-dim', index, opacity),
  setDisplayTrim: (index, value) => ipcRenderer.invoke('set-display-trim', index, value),
  // Clock
  showClock: () => ipcRenderer.invoke('show-clock'),
  hideClock: () => ipcRenderer.invoke('hide-clock'),
  setClockPosition: (pos) => ipcRenderer.invoke('set-clock-position', pos),
  // Main window
  hideMainWindow: () => ipcRenderer.invoke('hide-main-window'),
  showMainWindow: () => ipcRenderer.invoke('show-main-window'),
  // Pop-outs
  openPopout: (name, hash, w, h) => ipcRenderer.invoke('open-popout', name, hash, w, h),
  closePopout: (name) => ipcRenderer.invoke('close-popout', name),
  onPopoutStateChange: (callback) => ipcRenderer.on('popout-state-change', callback),
  // Feature state sync
  setFeatureState: (name, state) => ipcRenderer.invoke('set-feature-state', name, state),
  getFeatureStates: () => ipcRenderer.invoke('get-feature-states'),
  onSyncFeatureStates: (callback) => ipcRenderer.on('sync-feature-states', callback)
});
