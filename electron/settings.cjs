// Small JSON state store for Halo, kept in the per-user data dir.
// Used so the pre-Halo brightness snapshot survives a crash: Halo writes brightness
// straight to the monitor over DDC/CI, and that value persists in the monitor itself
// through a reboot, so if Halo dies without restoring, nothing else will put it back.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function statePath() {
  return path.join(app.getPath('userData'), 'halo-state.json');
}

function read() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch (e) {
    return {};
  }
}

function write(obj) {
  try {
    const file = statePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // write-then-rename so a crash mid-write can't leave a truncated file
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    return false;
  }
}

function patch(partial) {
  const next = Object.assign({}, read(), partial);
  write(next);
  return next;
}

module.exports = { read, write, patch, statePath };
