<div align="center">
  <img src="assets/logo.png" alt="Halo Logo" width="200"/>

  # Halo Environment Control

  *A sleek, frameless desktop utility for dimming your monitors and showing a quiet clock — floating over your wallpaper, out of the way.*
</div>

---

## What is Halo?

Halo is a personalized desktop utility built specifically for Windows. Unlike standard applications, Halo operates completely without traditional window frames or borders, floating seamlessly over your wallpaper. It is a focused control hub for two things: managing your screen brightness across every monitor, and displaying a minimalist clock.

## Key Features & How It Works

### Modular Interface
Drag the control hub anywhere on your screen. The two controls toggle independently.
- **Clock Widget**: A standalone, minimalist 24-hour clock that docks itself quietly on your screen. Move it left, center, or right.
- **Screen Dimmer**: Drops brightness across one or all of your monitors. It lowers hardware brightness where supported, and for anything darker than the panel allows it fades in a soft black overlay per display — so it dims every screen even when the monitor has no hardware brightness control.

Halo snapshots each monitor's brightness when it launches and restores it on exit, so closing the app never leaves your screens stuck dim or blasts them to full brightness.

## Installation

Download the official Portable Executable from the [Releases](https://github.com/therobwingfield/halo/releases) page.

1. Download the `halo 0.1.0.exe` file and move it to your desired permanent folder (e.g., your `Desktop` or `Documents` folder).
2. Double-click the file to launch the application.
3. **Auto-Start**: On first run Halo registers itself into the Windows Startup sequence and launches in the background every time you sign in.

> **Note:** Hardware brightness control relies on Python with the [`screen-brightness-control`](https://pypi.org/project/screen-brightness-control/) package available on the machine (`pip install screen-brightness-control`). Without it, the software-overlay dimming still works on every monitor.

## Development

Halo is built with **Electron**, **React**, and **Vite**.

```bash
# Install dependencies
npm install

# Run locally in development mode
npm run dev

# Compile the portable Windows executable
npm run build
```

---

## Attribution & License

- **Concept, Design, & Architecture**: Rob Wingfield

Copyright (c) 2026 Rob Wingfield. All Rights Reserved.

*Built exclusively for Windows 11.*
