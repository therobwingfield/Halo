# Celera Halo

A sleek, robust, and frameless Windows desktop control pad built with Electron, React, and Vite. Designed for ultra-minimalist environment control.

Halo replaces the legacy Python-based Celera Control Pad, completely eliminating audio stutters and crashes by leveraging Electron's rock-solid Chromium media engine, while providing a stunning glassmorphism interface that floats natively on your desktop.

## Features

- **Headless UI**: Entirely frameless, click-through capable, and designed to snap programmatically to your monitors without any Windows OS borders.
- **Rock-Solid Audio**: Built-in HTML5 media engine ensures background routines never stutter or crash.
- **Hardware Dimmer**: Real-time DDC/CI external monitor brightness control powered by a bundled Python utility.
- **Routines**:
  - **Morning**: Safely lowers system volume to 30%, dims all monitors to 40%, spawns a transparent click-through Clock overlay, and begins playing local audio. Displays a "Work" toggle to end the routine.
  - **Nap**: Instantly begins audio and spawns a giant, floating red "STOP" button so audio can be easily disabled upon waking.
- **Persistent Audio**: Select any local MP3 file via the built-in file browser, and Halo will permanently remember it for all future routines.

## Architecture

- **Frontend**: React 18, Vite, Vanilla CSS
- **Backend**: Node.js (Electron Main Process)
- **Hardware Integrations**: `loudness` (Node.js volume control), `screen-brightness-control` (Python DDC/CI integration)

## Installation & Development

### Prerequisites
- Node.js (v20+)
- Python (for `screen-brightness-control` hardware hooks)

### Setup
```powershell
# Install dependencies
npm install

# Run locally in development mode
npm run dev

# Build for production (creates a standalone Windows executable)
npm run build
```

## Structure
- `src/`: React frontend UI, CSS styling, and grid layout.
- `electron/`: Node.js main process, IPC handlers, and frameless window configuration.
- `scripts/`: Python bridging scripts for deep Windows hardware integration.
- `public/`: Drop your default static assets (like `rain.mp3`) here.

## Attribution
**Celera Halo** was created and designed by **Rob Wingfield**.
