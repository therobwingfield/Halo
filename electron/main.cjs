const { app, BrowserWindow, screen, ipcMain, protocol } = require('electron');
const path = require('path');
const { exec, spawn } = require('child_process');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true, stream: true } }
]);

// GUARDRAIL: when true, all hardware brightness changes are logged instead of applied.
const HARDWARE_SAFE_MODE = false;

const isDev = process.env.NODE_ENV === 'development';

// For a portable build the real .exe path is exposed here; process.execPath points at
// a temp extraction folder that changes every launch, which breaks login auto-start.
const portableExe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;

let mainWindow;
let clockWindow;

let initialBrightnessSnapshot = [];
let softwareOverlays = [];
let activeFeatures = { dimmer: true, clock_ctrl: false };

function broadcastFeatures() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sync-feature-states', activeFeatures);
  }
}

function resolveScriptPath() {
  if (isDev) return path.join(__dirname, '../scripts/brightness.py');
  return path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'brightness.py');
}

// Dimmer slider position (0-100) applied automatically on launch, so the screens
// come up already dimmed and ready to fine-tune instead of at full brightness.
const STARTUP_SLIDER = 50;

// Same mapping the dimmer UI uses: slider 50-100 drives hardware brightness 0-100,
// and slider 0-50 fades in a black overlay (up to 0.9) on top of hardware-minimum.
function sliderToHardware(slider) {
  return slider > 50 ? Math.round((slider - 50) * 2) : 0;
}
function sliderToOverlay(slider) {
  return slider <= 50 ? 0.9 * ((50 - slider) / 50) : 0;
}

function runBrightnessScript(args) {
  return new Promise((resolve) => {
    const scriptPath = resolveScriptPath();
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

// On launch: snapshot the current brightness (so exit can restore it), then dim every
// monitor to STARTUP_SLIDER so the screens start dimmed and ready to adjust.
async function applyStartupDim() {
  if (!activeFeatures.dimmer) return;
  const displays = await runBrightnessScript(['get']);
  if (displays.length > 0 && initialBrightnessSnapshot.length === 0) {
    initialBrightnessSnapshot = JSON.parse(JSON.stringify(displays)); // deep copy snapshot
  }
  await runBrightnessScript(['set_master', sliderToHardware(STARTUP_SLIDER)]);
  const overlay = sliderToOverlay(STARTUP_SLIDER);
  for (const win of softwareOverlays) {
    if (!win.isDestroyed()) win.setOpacity(overlay);
  }
}

// Fire-and-forget restore of the brightness we captured at launch. Runs detached so it
// completes even while the app is tearing down.
function restoreBrightnessOnExit() {
  if (initialBrightnessSnapshot.length === 0) return;
  try {
    const scriptPath = resolveScriptPath();
    for (const d of initialBrightnessSnapshot) {
      const child = spawn('python', [scriptPath, 'set', d.id, String(d.brightness)], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: process.env
      });
      child.unref();
    }
  } catch (err) { /* best effort */ }
}

function createSoftwareOverlays() {
  if (softwareOverlays.length > 0) return;
  const displays = screen.getAllDisplays();
  displays.forEach((display) => {
    const win = new BrowserWindow({
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
  const { width, x, y } = primaryDisplay.workArea;

  const windowWidth = 240;
  const windowHeight = 130;

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
    mainWindow.webContents.on('console-message', (event, level, message) => {
      console.log(`[REACT CONSOLE]: ${message}`);
    });
  } else {
    mainWindow.loadURL('app://localhost/index.html');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    restoreBrightnessOnExit();
    app.quit();
  });
}

function createClockWindow() {
  if (clockWindow) {
    clockWindow.show();
    return;
  }
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, x, y } = primaryDisplay.workArea;

  clockWindow = new BrowserWindow({
    width: 400,
    height: 100,
    x: Math.round(x + (width / 2) - 200),
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

app.whenReady().then(() => {
  app.setLoginItemSettings({
    openAtLogin: true,
    path: portableExe,
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
  applyStartupDim();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- Brightness / dimmer ---

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

// --- Window helpers ---

ipcMain.handle('hide-main-window', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.handle('show-main-window', () => {
  if (mainWindow) mainWindow.show();
});

// --- Clock ---

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
    clockWindow.setPosition(Math.round(x + (width / 2) - (bounds.width / 2)), y + 20);
  }
});

// --- Pop-out panels (dimmer / clock controls) ---

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
    x: Math.round(popX),
    y: Math.round(popY),
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
  for (const key of ['dimmer', 'clock_ctrl']) {
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

// --- Feature state sync ---

ipcMain.handle('set-feature-state', (event, name, state) => {
  activeFeatures[name] = state;
  broadcastFeatures();
});

ipcMain.handle('get-feature-states', () => {
  return activeFeatures;
});
