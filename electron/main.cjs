const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const loudness = require('loudness');

const isDev = process.env.NODE_ENV === 'development';

let mainWindow;
let clockWindow;
let stopWindow;

function createMainWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  const windowWidth = 260;
  const windowHeight = 180;

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: Math.round((width / 2) - (windowWidth / 2)),
    y: height - windowHeight - 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      webSecurity: false
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
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
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      webSecurity: false
    }
  });
  clockWindow.setIgnoreMouseEvents(true);
  
  const targetUrl = isDev ? 'http://localhost:5173/#/clock' : `file://${path.join(__dirname, '../dist/index.html')}#/clock`;
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
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      webSecurity: false
    }
  });

  const targetUrl = isDev ? 'http://localhost:5173/#/stop' : `file://${path.join(__dirname, '../dist/index.html')}#/stop`;
  stopWindow.loadURL(targetUrl);
}

app.whenReady().then(() => {
  createMainWindow();

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
  try {
    await loudness.setVolume(vol);
    return true;
  } catch (e) {
    return false;
  }
});

function runBrightnessScript(args) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, '../scripts/brightness.py');
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
  return await runBrightnessScript(['get']);
});

ipcMain.handle('set-master-brightness', async (event, value) => {
  return await runBrightnessScript(['set_master', value]);
});

ipcMain.handle('set-brightness', async (event, id, value) => {
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
});

ipcMain.handle('hide-clock', () => {
  if (clockWindow) clockWindow.hide();
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
