const { app, BrowserWindow, screen, ipcMain, dialog, protocol } = require('electron');
const path = require('path');
const { exec, execSync } = require('child_process');
const loudness = require('loudness');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true, stream: true } }
]);

// Allow background audio engine to play without requiring a click on the main window
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// GUARDRAIL: Disabled for final production build
const HARDWARE_SAFE_MODE = false;

const isDev = process.env.NODE_ENV === 'development';

let mainWindow;
let clockWindow;
let stopWindow;
let workButtonWin;

let initialBrightnessSnapshot = [];
let softwareOverlays = [];
let activeFeatures = { dimmer: true, audio: false, clock_ctrl: false, routine: false };

function broadcastFeatures() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sync-feature-states', activeFeatures);
  }
}

function createSoftwareOverlays() {
  if (softwareOverlays.length > 0) return;
  const displays = screen.getAllDisplays();
  displays.forEach((display, i) => {
    let win = new BrowserWindow({
      x: display.bounds.x, y: display.bounds.y,
      width: display.bounds.width, height: display.bounds.height,
      transparent: true, frame: false, alwaysOnTop: true,
      skipTaskbar: true, hasShadow: false,
      backgroundColor: '#000000',
      webPreferences: { contextIsolation: true }
    });
    win.setIgnoreMouseEvents(true);
    win.setOpacity(0); // Start fully transparent
    win.loadURL(`data:text/html,<body style="margin: 0; overflow: hidden; background: black; cursor: none;"></body>`);
    softwareOverlays.push(win);
  });
}

function createMainWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height, x, y } = primaryDisplay.workArea;
  
  const windowWidth = 260;
  const windowHeight = 180;

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: Math.round(x + width - windowWidth - 20),
    y: Math.round(y + 20),
    icon: path.join(__dirname, 'icon.ico'),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    thickFrame: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      webSecurity: false
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // Forward frontend console errors to the terminal so the AI can read them
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
      console.log(`[REACT CONSOLE]: ${message}`);
    });
  } else {
    mainWindow.loadURL('app://localhost/index.html');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    try {
      let scriptPath = path.join(__dirname, '../scripts/brightness.py');
      if (!isDev) scriptPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'brightness.py');
      const { spawn } = require('child_process');
      const child = spawn('python', [scriptPath, 'set_master', '100'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: process.env
      });
      child.unref();
    } catch(err) {}
    app.quit();
  });
}

function createClockWindow() {
  if (clockWindow) {
    clockWindow.show();
    return;
  }
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height, x, y } = primaryDisplay.workArea;

  clockWindow = new BrowserWindow({
    width: 400,
    height: 100,
    x: x + (width / 2) - 200,
    y: y + 20,
    icon: path.join(__dirname, 'icon.ico'),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    thickFrame: false,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      webSecurity: false
    }
  });
  clockWindow.setIgnoreMouseEvents(true);
  
  const targetUrl = isDev ? 'http://localhost:5173/#/clock' : 'app://localhost/index.html#/clock';
  clockWindow.loadURL(targetUrl);
}

function createStopWindow() {
  if (stopWindow) {
    stopWindow.show();
    return;
  }
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height, x, y } = primaryDisplay.workArea;

  stopWindow = new BrowserWindow({
    width: 300,
    height: 300,
    x: x + (width / 2) - 150,
    y: y + (height / 2) - 150,
    icon: path.join(__dirname, 'icon.ico'),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    thickFrame: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      webSecurity: false
    }
  });

  const targetUrl = isDev ? 'http://localhost:5173/#/stop' : 'app://localhost/index.html#/stop';
  stopWindow.loadURL(targetUrl);
}

function createWorkButtonWindow() {
  if (workButtonWin) {
    workButtonWin.show();
    return;
  }
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height, x, y } = primaryDisplay.workArea;

  workButtonWin = new BrowserWindow({
    width: 200,
    height: 60,
    x: x + (width / 2) - 100,
    y: y + 140, // Drops in right below the clock
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    thickFrame: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      webSecurity: false
    }
  });

  const targetUrl = isDev ? 'http://localhost:5173/#/work_btn' : 'app://localhost/index.html#/work_btn';
  workButtonWin.loadURL(targetUrl);
}


app.whenReady().then(() => {
  app.setLoginItemSettings({
    openAtLogin: true,
    path: process.execPath,
    args: []
  });

  protocol.registerFileProtocol('app', (request, callback) => {
    let url = request.url.replace('app://localhost/', '');
    url = url.split('?')[0]; // Remove query strings if any
    url = url.split('#')[0]; // Remove hash if any
    url = decodeURIComponent(url);
    
    if (url.match(/^[a-zA-Z]:\//)) {
      callback({ path: url });
    } else {
      callback({ path: path.join(__dirname, '../dist', url) });
    }
  });

  createMainWindow();
  createSoftwareOverlays();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('get-volume', async () => {
  try {
    return await loudness.getVolume();
  } catch (e) {
    return 50;
  }
});

ipcMain.handle('set-volume', async (event, vol) => {
  if (HARDWARE_SAFE_MODE) {
    console.log(`[SAFE MODE] Blocked hardware volume change to: ${vol}%`);
    return false;
  }
  try {
    await loudness.setVolume(vol);
    return true;
  } catch (e) {
    return false;
  }
});

function runBrightnessScript(args) {
  return new Promise((resolve) => {
    let scriptPath = path.join(__dirname, '../scripts/brightness.py');
    if (!isDev) {
      scriptPath = path.join(app.getAppPath(), '..', 'app.asar.unpacked', 'scripts', 'brightness.py');
    }
    exec(`python "${scriptPath}" ${args.join(' ')}`, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        resolve([]);
      }
    });
  });
}

ipcMain.handle('get-displays', async () => {
  const displays = await runBrightnessScript(['get']);
  if (initialBrightnessSnapshot.length === 0 && displays.length > 0) {
    initialBrightnessSnapshot = JSON.parse(JSON.stringify(displays)); // deep copy snapshot
  }
  return displays;
});

ipcMain.handle('restore-hardware', async () => {
  if (initialBrightnessSnapshot.length > 0) {
    for (const d of initialBrightnessSnapshot) {
      await runBrightnessScript(['set', d.id, d.brightness]);
    }
  }
  for (const win of softwareOverlays) {
    if (!win.isDestroyed()) win.setOpacity(0);
  }
  return initialBrightnessSnapshot;
});

ipcMain.handle('set-software-dim', (event, index, opacity) => {
  if (index === 'master') {
    for (const win of softwareOverlays) {
      if (!win.isDestroyed()) win.setOpacity(opacity);
    }
  } else {
    const idx = parseInt(index);
    if (softwareOverlays[idx] && !softwareOverlays[idx].isDestroyed()) {
      softwareOverlays[idx].setOpacity(opacity);
    }
  }
});

ipcMain.handle('set-master-brightness', async (event, value) => {
  if (HARDWARE_SAFE_MODE) {
    console.log(`[SAFE MODE] Blocked master brightness change to: ${value}%`);
    return [];
  }
  return await runBrightnessScript(['set_master', value]);
});

ipcMain.handle('set-brightness', async (event, id, value) => {
  if (HARDWARE_SAFE_MODE) {
    console.log(`[SAFE MODE] Blocked brightness change for screen ${id} to: ${value}%`);
    return [];
  }
  return await runBrightnessScript(['set', id, value]);
});

ipcMain.handle('hide-main-window', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.handle('show-main-window', () => {
  if (mainWindow) mainWindow.show();
});

ipcMain.handle('show-clock', () => {
  createClockWindow();
  activeFeatures['clock_ctrl'] = true;
  broadcastFeatures();
});

ipcMain.handle('hide-clock', () => {
  if (clockWindow) clockWindow.hide();
  activeFeatures['clock_ctrl'] = false;
  broadcastFeatures();
});

ipcMain.handle('set-clock-position', (event, pos) => {
  if (!clockWindow) return;
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, x, y } = primaryDisplay.workArea;
  const bounds = clockWindow.getBounds();
  
  if (pos === 'left') {
    clockWindow.setPosition(x + 20, y + 20);
  } else if (pos === 'right') {
    clockWindow.setPosition(x + width - bounds.width - 20, y + 20);
  } else {
    // default center
    clockWindow.setPosition(x + (width / 2) - (bounds.width / 2), y + 20);
  }
});

ipcMain.handle('show-stop-window', () => {
  createStopWindow();
});

ipcMain.handle('hide-stop-window', () => {
  if (stopWindow) stopWindow.hide();
  if (mainWindow) {
    mainWindow.webContents.send('stop-audio-triggered');
  }
});

ipcMain.handle('show-work-button', () => {
  createWorkButtonWindow();
});

ipcMain.handle('hide-work-button', () => {
  if (workButtonWin) workButtonWin.hide();
});

ipcMain.handle('get-audio-metadata', async (event, filePath) => {
  try {
    const mm = await import('music-metadata');
    const metadata = await mm.parseFile(filePath);
    if (metadata.common.picture && metadata.common.picture.length > 0) {
      const picture = metadata.common.picture[0];
      return `data:${picture.format};base64,${picture.data.toString('base64')}`;
    }
    return null;
  } catch (error) {
    return null;
  }
});

ipcMain.handle('select-audio-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a'] }]
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

let popoutWindows = {};

function createChildWindow(name, hash, width, height) {
  if (popoutWindows[name]) {
    popoutWindows[name].show();
    if (mainWindow) mainWindow.webContents.send('popout-state-change', { name, isOpen: true });
    return;
  }

  let popX, popY;
  
  if (mainWindow) {
    const bounds = mainWindow.getBounds();
    const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
    
    popX = bounds.x + bounds.width + 10;
    popY = bounds.y;

    // If it falls off the right side, try the left side
    if (popX + width > display.workArea.x + display.workArea.width) {
      popX = bounds.x - width - 10;
      // If it falls off the left side too, force it inside the left bound
      if (popX < display.workArea.x) popX = display.workArea.x;
    }
    
    // Keep it within vertical bounds
    if (popY < display.workArea.y) popY = display.workArea.y;
    if (popY + height > display.workArea.y + display.workArea.height) {
      popY = display.workArea.y + display.workArea.height - height;
    }
  } else {
    const primaryDisplay = screen.getPrimaryDisplay();
    popX = Math.round(primaryDisplay.workArea.x + (primaryDisplay.workArea.width / 2) - (width / 2));
    popY = Math.round(primaryDisplay.workArea.y + (primaryDisplay.workArea.height / 2) - (height / 2));
  }

  const win = new BrowserWindow({
    width,
    height,
    x: popX,
    y: popY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    thickFrame: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      webSecurity: false
    }
  });

  const targetUrl = isDev ? `http://localhost:5173/#${hash}` : `app://localhost/index.html#${hash}`;
  win.loadURL(targetUrl);
  
  win.on('closed', () => {
    popoutWindows[name] = null;
    if (mainWindow) mainWindow.webContents.send('popout-state-change', { name, isOpen: false });
  });
  
  popoutWindows[name] = win;
  if (mainWindow) mainWindow.webContents.send('popout-state-change', { name, isOpen: true });
}

ipcMain.handle('open-popout', (event, name, route, width, height) => {
  // Close any currently open popouts first to prevent stacking
  for (const key of ['routine', 'dimmer', 'audio', 'clock_ctrl']) {
    if (key !== name && popoutWindows[key] && !popoutWindows[key].isDestroyed()) {
      popoutWindows[key].close();
      popoutWindows[key] = null;
    }
  }

  if (popoutWindows[name] && !popoutWindows[name].isDestroyed()) {
    popoutWindows[name].focus();
    return;
  }
  createChildWindow(name, route, width, height);
});

ipcMain.handle('close-popout', (event, name) => {
  if (popoutWindows[name]) {
    popoutWindows[name].close();
  }
});

ipcMain.handle('audio-command', (event, command, payload) => {
  if (mainWindow) {
    mainWindow.webContents.send('sync-audio-command', command, payload);
  }
});

ipcMain.handle('audio-state-update', (event, state) => {
  if (popoutWindows['audio']) {
    popoutWindows['audio'].webContents.send('sync-audio-state', state);
  }
  activeFeatures['audio'] = state.isPlaying;
  broadcastFeatures();
});

ipcMain.handle('set-feature-state', (event, name, state) => {
  activeFeatures[name] = state;
  broadcastFeatures();
});

ipcMain.handle('get-feature-states', () => {
  return activeFeatures;
});


