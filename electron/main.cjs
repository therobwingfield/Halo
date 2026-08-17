const { app, BrowserWindow, screen, ipcMain, protocol, desktopCapturer } = require('electron');
const path = require('path');
const { exec, spawn } = require('child_process');
const state = require('./settings.cjs');

// A2 — single-instance lock. Two Halos would each create overlays and each write
// hardware brightness, then fight over restoring it on exit. Only the first wins;
// a second launch just surfaces the existing widget.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // Quit immediately WITHOUT touching brightness — the primary instance owns it.
  app.quit();
}

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

// True when the previous run ended without restoring brightness (crash, kill, power loss).
let uncleanPreviousExit = false;
// Guard so the restore-on-exit path runs at most once per process.
let brightnessRestored = false;

// --- Auto-dim (content-adaptive dimming) -----------------------------------------
// Parallel to softwareOverlays: display id, the slider's floor, and the sampler's level.
let overlayDisplayIds = [];
let manualOpacity = [];
let autoOpacity = [];
let lastLuma = [];   // glare score (fraction of bright pixels)
let lastMean = [];   // mean brightness, readout only
let currentOpacity = [];   // what each overlay is actually showing right now (animated)
let displayTrims = {};     // per-panel calibration offset, keyed by display id (A6)
let manualDims = {};       // persisted slider floor, keyed by display id (A7)
let autoDimTimer = null;
let animTimer = null;
let lastChangeAt = 0;

const AUTO = {
  enabled: true,
  // Adaptive sampling. A full-screen capture of two 1440p panels is not cheap: running
  // it flat out at 4 Hz measured ~80% of one core, which is far too much to leave running
  // all night. The screen is static almost all the time, so sample fast only while
  // something is actually changing and back off hard once it settles.
  activeMs: 250,       // 4 Hz  — while content is changing / the envelope is still moving
  mediumMs: 1000,      // 1 Hz  — recently changed, watching for more
  idleMs: 2500,        // 0.4Hz — nothing happening
  activeWindowMs: 3000,
  mediumWindowMs: 15000,
  changeThreshold: 0.02,   // score delta that counts as "something happened"
  thumbW: 64, thumbH: 36,
  brightPixel: 0.62,   // a pixel above this counts as "glaring"
  // A8 — the original knee/full pair was calibrated against a near-fullscreen PDF and it
  // silently ignored the common case. Measured on this 2560x1440 panel: a dark desktop
  // scores 0.004, and a PDF in an ordinary (not maximised) window scores 0.045 — which
  // fell INSIDE the old 0.06 dead zone, so the one thing the app exists to catch produced
  // no dimming at all. A maximised PDF still saturates the range, so widening downward
  // costs nothing at the top end.
  knee: 0.02,          // <2% of screen bright -> leave it alone (dark desktop reads 0.004)
  full: 0.12,          // >=12% of screen bright -> full auto dim (a windowed PDF reads ~0.045)
  maxOpacity: 0.80,    // ceiling for auto dimming on its own
  // Easing is expressed in opacity-units PER SECOND and applied by a separate animation
  // timer. Doing it per-sample was the bug behind the visible pulsing: the sampler's rate
  // varies from 250ms to 2500ms, so a fixed per-tick step became a large discrete jump
  // once sampling backed off. Time-based easing looks identical at every sampling rate.
  attackPerSec: 1.30,  // dim fast  (0 -> 0.8 in ~0.6s) — clamps strobes and white pages
  releasePerSec: 0.10, // undim slow (0.8 -> 0 in ~8s) — no flicker when scrolling
  animMs: 60,          // ~16fps easing; cheap, it only calls setOpacity
  deadband: 0.004
};

// Glare score for a downscaled frame (desktopCapturer gives BGRA).
//
// We deliberately do NOT use mean brightness. Measured on a real 2560x1440 desktop, a
// large white window only moved the mean from 0.048 to 0.159 — browser chrome, page
// margins and the dark surroundings drag it down, so any threshold high enough to ignore
// a dark desktop is also high enough to ignore a white PDF. What actually hurts is how
// MUCH of the screen is glaring, so score on the fraction of genuinely bright pixels and
// keep the mean only as a readout.
function frameStats(bitmap) {
  let sum = 0, bright = 0, n = 0;
  for (let i = 0; i < bitmap.length; i += 4) {
    const l = (0.2126 * bitmap[i + 2] + 0.7152 * bitmap[i + 1] + 0.0722 * bitmap[i]) / 255;
    sum += l;
    if (l > AUTO.brightPixel) bright++;
    n++;
  }
  return n ? { mean: sum / n, bright: bright / n } : { mean: 0, bright: 0 };
}

// Bright-area fraction -> dimming, with a dead zone so a dark IDE or the rain video is
// left completely alone.
function lumaToOpacity(brightFraction) {
  const t = (brightFraction - AUTO.knee) / (AUTO.full - AUTO.knee);
  return Math.max(0, Math.min(1, t)) * AUTO.maxOpacity;
}

async function autoDimTick() {
  if (!AUTO.enabled || !activeFeatures.dimmer || softwareOverlays.length === 0) return;
  let sources;
  try {
    sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: AUTO.thumbW, height: AUTO.thumbH }
    });
  } catch (e) {
    return; // capture unavailable this tick; leave opacities untouched
  }

  for (const src of sources) {
    let idx = overlayDisplayIds.indexOf(String(src.display_id));
    if (idx === -1) {
      // Single-display fallback when display_id isn't reported.
      if (sources.length === 1 && softwareOverlays.length === 1) idx = 0;
      else continue;
    }
    let stats;
    try { stats = frameStats(src.thumbnail.toBitmap()); } catch (e) { continue; }
    const luma = stats.bright;                 // the glare score drives the envelope
    const prevLuma = lastLuma[idx] === undefined ? luma : lastLuma[idx];
    lastLuma[idx] = luma;
    lastMean[idx] = stats.mean;

    // Any real change in content, or an envelope still travelling toward its target,
    // keeps the sampler in its fast mode.
    if (Math.abs(luma - prevLuma) > AUTO.changeThreshold) lastChangeAt = Date.now();

    // The sampler only publishes a TARGET; the animator eases toward it in real time.
    const target = lumaToOpacity(luma);
    if (Math.abs(target - (autoOpacity[idx] || 0)) > AUTO.deadband) lastChangeAt = Date.now();
    autoOpacity[idx] = target;
  }
}

// Pick the next sampling delay from how long it's been since anything moved.
function nextAutoDelay() {
  const since = Date.now() - lastChangeAt;
  if (since < AUTO.activeWindowMs) return AUTO.activeMs;
  if (since < AUTO.mediumWindowMs) return AUTO.mediumMs;
  return AUTO.idleMs;
}

function scheduleAutoDim() {
  if (!AUTO.enabled) return;
  autoDimTimer = setTimeout(async () => {
    try { await autoDimTick(); } catch (e) { /* keep the loop alive */ }
    if (AUTO.enabled) scheduleAutoDim();
  }, nextAutoDelay());
}

function startAutoDim() {
  startAnimator();          // easing runs whenever Halo does; it is cheap
  if (autoDimTimer) return;
  lastChangeAt = Date.now(); // start responsive, then settle
  scheduleAutoDim();
}

function stopAutoDim() {
  if (autoDimTimer) { clearTimeout(autoDimTimer); autoDimTimer = null; }
  // Clear the auto contribution and let the animator ease back down to the manual floor.
  for (let i = 0; i < autoOpacity.length; i++) autoOpacity[i] = 0;
}

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
//
// A1 — the snapshot is persisted to disk, not just held in memory. DDC/CI brightness
// lives in the monitor's own controller, so it survives a crash, a reboot, the BIOS
// screen and the sign-in screen. If Halo dies without restoring, the panels stay
// wherever it left them and nothing else will ever put them back — so the only copy
// of the user's original brightness must outlive the process.
async function applyStartupDim() {
  if (!activeFeatures.dimmer) return;
  const displays = await runBrightnessScript(['get']);
  const prev = state.read();

  if (prev.sessionActive && Array.isArray(prev.preHaloBrightness) && prev.preHaloBrightness.length > 0) {
    // Previous session never exited cleanly. Whatever the monitors read RIGHT NOW is
    // Halo's own dimmed value, not the user's — so do NOT overwrite the good snapshot.
    uncleanPreviousExit = true;
    initialBrightnessSnapshot = JSON.parse(JSON.stringify(prev.preHaloBrightness));
    // Deliberately NOT auto-restoring: that would slam the panels bright, which is the
    // opposite of what someone running a dimmer at 4am wants. The value is preserved and
    // exposed so it can be restored on demand (see 'restore-hardware').
  } else if (displays.length > 0) {
    initialBrightnessSnapshot = JSON.parse(JSON.stringify(displays)); // deep copy snapshot
  }

  if (initialBrightnessSnapshot.length > 0) {
    state.patch({
      preHaloBrightness: initialBrightnessSnapshot,
      sessionActive: true,
      snapshotTakenAt: new Date().toISOString()
    });
  }

  await runBrightnessScript(['set_master', sliderToHardware(STARTUP_SLIDER)]);

  // A7 — restore the saved manual floor; fall back to STARTUP_SLIDER only on a first run.
  //
  // Hardware brightness cannot stand in for this. sliderToHardware() maps EVERY slider
  // position at or below 50 to hardware 0, so once the process restarts a floor of 0.4 and
  // a floor of 0 are indistinguishable from the panels — and the UI, which derives the
  // slider from hardware brightness, resolved both to 50 (= no overlay). The effect was
  // that all software dimming was silently discarded on every launch and the only thing
  // left was the A6 trim, which is why a white document could come back glaring.
  //
  // Written through applyOverlayOpacity rather than setOpacity so the trim and any auto-dim
  // level are folded in, instead of being stamped over with a bare floor value.
  const startupFloor = sliderToOverlay(STARTUP_SLIDER);
  for (let i = 0; i < softwareOverlays.length; i++) {
    const saved = manualDims[overlayDisplayIds[i]];
    manualOpacity[i] = typeof saved === 'number' ? saved : startupFloor;
    applyOverlayOpacity(i);
  }
}

// Fire-and-forget restore of the brightness we captured at launch. Runs detached so it
// completes even while the app is tearing down.
function restoreBrightnessOnExit() {
  if (brightnessRestored) return;
  brightnessRestored = true;
  if (initialBrightnessSnapshot.length === 0) {
    state.patch({ sessionActive: false, lastExitAt: new Date().toISOString() });
    return;
  }
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
    // Mark the session closed so the next launch knows this exit was clean and can
    // safely take a fresh snapshot instead of preserving the old one.
    state.patch({ sessionActive: false, lastExitAt: new Date().toISOString() });
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
      skipTaskbar: true, hasShadow: false, focusable: false,
      backgroundColor: '#000000',
      webPreferences: { contextIsolation: true }
    });
    win.setIgnoreMouseEvents(true);
    win.setOpacity(0); // Start fully transparent
    win.loadURL(`data:text/html,<body style="margin: 0; overflow: hidden; background: black; cursor: none;"></body>`);

    // A4 — Windows clamps a new window to the work area, which leaves the taskbar strip
    // (48px here) undimmed. Re-asserting the full display bounds after creation fixes it;
    // the screen-saver level keeps the overlay above the taskbar in z-order.
    win.setBounds({ x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height });
    win.setAlwaysOnTop(true, 'screen-saver');

    // Auto-dim depends on this: it excludes the overlay from desktopCapturer, so the
    // sampler measures the CONTENT's brightness rather than its own dimming. Without it
    // the loop feeds back on itself and oscillates. Measured: 99.6% exclusion.
    try { win.setContentProtection(true); } catch (e) { /* older Electron: fall back to compensation */ }

    softwareOverlays.push(win);
    overlayDisplayIds.push(String(display.id));
    manualOpacity.push(0);
    autoOpacity.push(0);
    currentOpacity.push(0);
  });
}

// A5 — displays were enumerated exactly once, at startup, and the overlays were never
// looked at again. Windows relocates a window off any monitor that sleeps, changes mode
// or gets re-arranged, and it never moves it back. Observed on a two-panel setup with the
// secondary at x=-2560: after a topology change BOTH overlays sat at 0,0 on the primary,
// so the second panel had no overlay at all while its dimming was being applied to a
// window on the first. Auto-dim looked correct in the UI and did nothing on screen.
//
// Re-assert geometry on every topology change. Reposition rather than recreate whenever
// the display COUNT is unchanged: a destroy/recreate drops the overlay to zero opacity
// for a frame, which is a visible flash of the very glare this app exists to prevent.
function syncOverlaysToDisplays() {
  if (!activeFeatures.dimmer || softwareOverlays.length === 0) return;
  const displays = screen.getAllDisplays();

  if (displays.length !== softwareOverlays.length) {
    rebuildSoftwareOverlays();
    return;
  }

  displays.forEach((display, i) => {
    const win = softwareOverlays[i];
    if (!win || win.isDestroyed()) return;
    overlayDisplayIds[i] = String(display.id);
    const b = display.bounds;
    const cur = win.getBounds();
    if (cur.x !== b.x || cur.y !== b.y || cur.width !== b.width || cur.height !== b.height) {
      win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
      // Re-assert the z-order level too: a monitor change can drop the window out of the
      // screen-saver band, which would leave it below full-screen content (A4).
      win.setAlwaysOnTop(true, 'screen-saver');
    }
  });
}

// Only used when the display COUNT changes and the 1:1 overlay mapping no longer holds.
// Carries the current opacity across so the new overlay comes up already dimmed.
function rebuildSoftwareOverlays() {
  const carryShown  = currentOpacity.slice();   // what is on screen right now
  const carryManual = manualOpacity.slice();    // the slider's floor, which must survive
  const old = softwareOverlays;
  softwareOverlays = [];
  overlayDisplayIds = [];
  manualOpacity = [];
  autoOpacity = [];
  currentOpacity = [];
  createSoftwareOverlays();
  for (let i = 0; i < softwareOverlays.length; i++) {
    const win = softwareOverlays[i];
    if (!win || win.isDestroyed()) continue;
    // Prefer the persisted floor for THIS panel — keyed by display id, so a re-arrange
    // keeps each panel's own value rather than whatever landed at the same array index.
    // Fall back to the carried array, then to the first panel's floor for a new panel.
    const savedFloor = manualDims[overlayDisplayIds[i]];
    manualOpacity[i] = typeof savedFloor === 'number'
      ? savedFloor
      : (carryManual[i] !== undefined ? carryManual[i] : (carryManual[0] || 0));
    // Come up at the level the old overlay was showing so the swap is invisible; the
    // animator then eases to max(manual, auto) as usual once the sampler republishes.
    const shown = carryShown[i] !== undefined ? carryShown[i] : (carryShown[0] || 0);
    currentOpacity[i] = shown;
    win.setOpacity(shown);
  }
  for (const win of old) {
    try { if (!win.isDestroyed()) win.destroy(); } catch (e) { /* best effort */ }
  }
  lastChangeAt = Date.now();       // sample fast until the new geometry settles
}

// Where the overlay should end up: the darker of the manual floor and the auto-dim level.
// Auto can only ever add darkness on top of the slider, never lighten it.
function desiredOpacity(i) {
  const base = Math.max(manualOpacity[i] || 0, autoOpacity[i] || 0);
  return Math.max(0, Math.min(0.95, base + trimFor(i)));
}

// A6 — per-panel calibration trim.
//
// Two different monitors do not produce the same luminance at the same setting: DDC
// brightness 0 is each panel's OWN minimum, and an LG QHD sits visibly brighter than an
// HP Pavilion32 at that floor. The dimmer's per-monitor slider could not fix this,
// because it sets a FLOOR and the final value is max(floor, auto) — the moment auto-dim
// rose above the floor the correction was swallowed and the panels diverged again,
// precisely when a bright document was on screen.
//
// The trim is therefore ADDITIVE and applied after the max(), so it survives auto-dim and
// holds the two panels matched in every state. Keyed by display id rather than array
// index so it survives the overlay rebuild in A5.
function trimFor(i) {
  const v = displayTrims[overlayDisplayIds[i]];
  return typeof v === 'number' ? v : 0;
}

// Push a value to the window immediately (used by the animator and by manual slider moves).
function applyOverlayOpacity(i) {
  const win = softwareOverlays[i];
  if (!win || win.isDestroyed()) return;
  currentOpacity[i] = desiredOpacity(i);
  win.setOpacity(currentOpacity[i]);
}

// Smoothly ease each overlay toward its desired opacity, independently of how often the
// (expensive) sampler runs. This is what makes dimming look continuous instead of stepped.
function animateOverlays() {
  const dt = AUTO.animMs / 1000;
  for (let i = 0; i < softwareOverlays.length; i++) {
    const win = softwareOverlays[i];
    if (!win || win.isDestroyed()) continue;
    const want = desiredOpacity(i);
    const cur = currentOpacity[i] || 0;
    const diff = want - cur;
    if (Math.abs(diff) < AUTO.deadband) {
      if (cur !== want) { currentOpacity[i] = want; win.setOpacity(want); }
      continue;
    }
    const rate = diff > 0 ? AUTO.attackPerSec : AUTO.releasePerSec;
    const step = Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
    currentOpacity[i] = cur + step;
    win.setOpacity(currentOpacity[i]);
  }
}

function startAnimator() {
  if (animTimer) return;
  animTimer = setInterval(animateOverlays, AUTO.animMs);
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
      webSecurity: false,
      // Halo's windows are always-on-top overlays that are rarely the FOCUSED window, so Chromium
      // throttles their renderers (~1fps + coarse timers) → clicks and updates react slowly. Disabling
      // background throttling keeps the widget, clock, and popouts instantly responsive.
      backgroundThrottling: false
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
      webSecurity: false,
      // Halo's windows are always-on-top overlays that are rarely the FOCUSED window, so Chromium
      // throttles their renderers (~1fps + coarse timers) → clicks and updates react slowly. Disabling
      // background throttling keeps the widget, clock, and popouts instantly responsive.
      backgroundThrottling: false
    }
  });
  clockWindow.setIgnoreMouseEvents(true);

  const targetUrl = isDev ? 'http://localhost:5173/#/clock' : 'app://localhost/index.html#/clock';
  clockWindow.loadURL(targetUrl);
}

// A2 — a second launch surfaces the existing widget instead of starting a rival instance.
app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return; // secondary instance: create nothing, own nothing

  // Halo is launched on demand from its pinned taskbar icon, not at logon. This runs on every
  // start, so leaving it `true` silently re-armed autostart even after it was turned off in
  // Settings → Startup Apps; `false` makes each launch actively clear the Run entry instead.
  app.setLoginItemSettings({
    openAtLogin: false,
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

  // Preferences are loaded BEFORE applyStartupDim, because it needs the saved manual floor
  // to decide whether the first-run STARTUP_SLIDER default applies at all (A7).
  const persisted = state.read();
  if (typeof persisted.autoDimEnabled === 'boolean') AUTO.enabled = persisted.autoDimEnabled;
  if (typeof persisted.autoDimMaxOpacity === 'number') AUTO.maxOpacity = persisted.autoDimMaxOpacity;
  if (persisted.displayTrims && typeof persisted.displayTrims === 'object') {
    displayTrims = persisted.displayTrims;   // keyed by display id, so it survives A5 rebuilds
  }
  if (persisted.manualDims && typeof persisted.manualDims === 'object') {
    manualDims = persisted.manualDims;       // same key scheme, same reason
  }

  // Put the restored dim on screen straight away. applyStartupDim() has to await a python
  // round-trip for the brightness snapshot before it touches the overlays, and leaving them
  // clear until that returns is a visible flash of the glare this app exists to prevent.
  for (let i = 0; i < softwareOverlays.length; i++) {
    const saved = manualDims[overlayDisplayIds[i]];
    if (typeof saved === 'number') manualOpacity[i] = saved;
    applyOverlayOpacity(i);
  }

  applyStartupDim();

  // A5 — keep the overlays glued to the panels for the life of the process. Monitor
  // sleep/wake, a resolution change and a re-arrange all fire these, and any one of them
  // could previously orphan an overlay onto the primary and silently stop dimming the
  // other panel. The periodic re-assert is the backstop: Windows can move a window
  // without Electron reporting a display event at all.
  screen.on('display-added', syncOverlaysToDisplays);
  screen.on('display-removed', syncOverlaysToDisplays);
  screen.on('display-metrics-changed', syncOverlaysToDisplays);
  setInterval(syncOverlaysToDisplays, 5000);

  // Preferences were restored above, before the startup dim. Start the sampler; it is
  // active whenever Halo runs.
  if (AUTO.enabled) startAutoDim();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// A1 — cover the exit paths that mainWindow's 'closed' handler misses: tray/menu quit,
// Windows shutdown, SIGINT from a console launch. Each is a chance to hand the monitors
// back; without them a quit that doesn't route through the widget leaves the panels dimmed.
app.on('before-quit', () => {
  if (gotSingleInstanceLock) restoreBrightnessOnExit();
});
app.on('will-quit', () => {
  if (gotSingleInstanceLock) restoreBrightnessOnExit();
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
  // Falls back to the persisted snapshot, so this still works in a session that
  // inherited its snapshot from a previous run that crashed (A1).
  let snap = initialBrightnessSnapshot;
  if (!snap || snap.length === 0) {
    const persisted = state.read();
    if (Array.isArray(persisted.preHaloBrightness)) snap = persisted.preHaloBrightness;
  }
  if (snap && snap.length > 0) {
    for (const d of snap) {
      await runBrightnessScript(['set', d.id, d.brightness]);
    }
  }
  // Clear the manual FLOOR too, not just the current opacity. desiredOpacity() is
  // max(floor, auto) + trim, so zeroing only the displayed value lets the animator ease
  // straight back to the floor and "restore my monitors" looks like it did nothing — and
  // now that the floor is persisted (A7), that would survive restarts as well. The A6 trim
  // is deliberately left alone: it is a panel-matching calibration, not a dim level.
  for (let i = 0; i < softwareOverlays.length; i++) {
    manualOpacity[i] = 0;
    if (overlayDisplayIds[i] !== undefined) manualDims[overlayDisplayIds[i]] = 0;
    const win = softwareOverlays[i];
    if (win && !win.isDestroyed()) win.setOpacity(0);
  }
  state.patch({ manualDims });
  return snap || [];
});

// Lets the UI show "your last session ended unexpectedly" and offer a one-click restore,
// instead of leaving the user to work out why their monitors are stuck dark.
ipcMain.handle('get-recovery-state', () => {
  const persisted = state.read();
  return {
    uncleanPreviousExit,
    preHaloBrightness: persisted.preHaloBrightness || [],
    snapshotTakenAt: persisted.snapshotTakenAt || null,
    lastExitAt: persisted.lastExitAt || null,
    statePath: state.statePath()
  };
});

ipcMain.handle('set-software-dim', (event, index, opacity) => {
  // The slider now sets a FLOOR rather than the final value; auto-dim may darken further.
  //
  // A7 — the floor is persisted here, keyed by display id, because nothing else can
  // reconstruct it: hardware brightness collapses the whole 0-50 half of the slider to 0.
  // Keyed by id rather than index so it survives the A5 overlay rebuild and a re-arrange.
  if (index === 'master') {
    for (let i = 0; i < softwareOverlays.length; i++) {
      manualOpacity[i] = opacity;
      if (overlayDisplayIds[i] !== undefined) manualDims[overlayDisplayIds[i]] = opacity;
      applyOverlayOpacity(i);
    }
  } else {
    const idx = parseInt(index);
    if (softwareOverlays[idx] && !softwareOverlays[idx].isDestroyed()) {
      manualOpacity[idx] = opacity;
      if (overlayDisplayIds[idx] !== undefined) manualDims[overlayDisplayIds[idx]] = opacity;
      applyOverlayOpacity(idx);
    }
  }
  state.patch({ manualDims });
});

// --- Auto-dim IPC ---

ipcMain.handle('get-autodim-state', () => ({
  enabled: AUTO.enabled,
  maxOpacity: AUTO.maxOpacity,
  displays: softwareOverlays.map((_, i) => ({
    index: i,
    displayId: overlayDisplayIds[i],
    luma: Number((lastLuma[i] || 0).toFixed(4)),
    autoOpacity: Number((autoOpacity[i] || 0).toFixed(4)),
    manualOpacity: Number((manualOpacity[i] || 0).toFixed(4)),
    trim: Number(trimFor(i).toFixed(4)),
    effective: Number(desiredOpacity(i).toFixed(4))
  }))
}));

ipcMain.handle('set-autodim-enabled', (event, on) => {
  AUTO.enabled = !!on;
  if (AUTO.enabled) startAutoDim(); else stopAutoDim();
  state.patch({ autoDimEnabled: AUTO.enabled });
  return AUTO.enabled;
});

ipcMain.handle('set-autodim-strength', (event, maxOpacity) => {
  const v = Math.max(0, Math.min(0.9, Number(maxOpacity) || 0));
  AUTO.maxOpacity = v;
  state.patch({ autoDimMaxOpacity: v });
  return AUTO.maxOpacity;
});

// A6 — set the calibration trim for one panel. Capped at 0.4: this is a trim to match two
// panels, not a second dimmer, and desiredOpacity still clamps the total at 0.95.
ipcMain.handle('set-display-trim', (event, index, value) => {
  const i = parseInt(index);
  const id = overlayDisplayIds[i];
  if (id === undefined) return null;
  const v = Math.max(0, Math.min(0.4, Number(value) || 0));
  displayTrims[id] = v;
  state.patch({ displayTrims });
  applyOverlayOpacity(i);   // show it immediately rather than waiting for the animator
  return v;
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
      webSecurity: false,
      // Halo's windows are always-on-top overlays that are rarely the FOCUSED window, so Chromium
      // throttles their renderers (~1fps + coarse timers) → clicks and updates react slowly. Disabling
      // background throttling keeps the widget, clock, and popouts instantly responsive.
      backgroundThrottling: false
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
