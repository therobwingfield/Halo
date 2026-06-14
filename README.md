<div align="center">
  <img src="assets/logo.png" alt="Halo Logo" width="200"/>

  # Halo Environment Control
  
  *A minimalist, frameless desktop environment orchestrator built with Electron, React, and Vite.*
</div>

---

## Features

- **Draggable UI**: A completely frameless, semi-transparent hub that can be positioned anywhere on your screen.
- **Routines Mode**: Pre-configured routines (like "Leave for Work") that automatically trigger specific environment functions sequentially.
- **Audio Control**: Manage default playback devices and master volume levels directly from the UI.
- **Screen Dimming**: Built-in screen dimmer to rapidly drop system brightness for focus or departure.
- **Modular Clock**: A detached, ultra-minimalist 24-hour clock widget that docks independently.
- **Auto-Start**: Registers directly into the Windows Startup sequence to boot instantly upon login.

## Installation

Download the official Portable Executable from the [Releases](https://github.com/therobwingfield/halo/releases) page.

1. Place `halo.exe` in your desired permanent folder (e.g., `Desktop` or `Documents`).
2. Double-click to run.
3. The app will automatically register its current location to launch seamlessly every time your PC restarts.

## Development

To build the project locally:

```bash
npm install
npm run dev
```

To compile the portable Windows executable:

```bash
npm run build
```

---
*Built for Windows 11.*
