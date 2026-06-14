<div align="center">
  <img src="assets/logo.png" alt="Halo Logo" width="200"/>

  # Halo Environment Control
  
  *A sleek, modular, and fully frameless desktop environment orchestrator designed to optimize your workflow and transition you into different mindsets throughout your day.*
</div>

---

## What is Halo?

Halo is a personalized desktop utility built specifically for Windows. Unlike standard applications, Halo operates completely without traditional window frames or borders, floating seamlessly over your wallpaper. It serves as a unified control hub for manipulating your physical environment through your PC—managing your screen brightness, adjusting system volume, swapping audio output devices, and playing ambient soundscapes to help you focus or wind down.

## Key Features & How It Works

### 1. Modular Interface
Halo allows you to drag the control hub anywhere on your screen. You can independently toggle specific environmental controls on or off without activating a full routine.
- **Clock Widget**: A standalone, minimalist 24-hour clock that docks itself quietly on your screen.
- **Screen Dimmer**: Instantly drops your system brightness to create a moody, low-light environment or prepare you to step away from your desk.
- **Audio Routing**: Quickly override system volume and default playback devices.

### 2. Routine Automation
Halo excels at grouping environmental triggers into one-click "Routines". 
- **"Leave for Work" Routine**: With a single click, Halo will automatically fade down your system brightness, pause your current audio, swap your playback device, and initialize your departure sequence so you don't have to manually adjust your PC before leaving the room.

### 3. Custom Ambient Soundscapes
Halo is designed to play continuous environmental audio (like rain, coffee shop sounds, or white noise) when you trigger focus modes. 
- **Adding Your Audio**: You can easily customize the ambient audio by placing your favorite track (for example, your favorite `rain.mp3` or background lofi track) directly into the app directory. Halo will automatically detect and loop it to build your perfect atmosphere.

## Installation

Download the official Portable Executable from the [Releases](https://github.com/therobwingfield/halo/releases) page.

1. Download the `halo 0.0.1.exe` file and move it to your desired permanent folder (e.g., your `Desktop` or `Documents` folder).
2. Double-click the file to launch the application.
3. **Auto-Start**: The moment you run Halo for the first time, it automatically registers its exact location into the Windows Startup sequence. It will seamlessly launch in the background every time you turn on your PC!

## Development

Halo is built with **Electron**, **React**, and **Vite** to ensure a lightning-fast UI with deep native system access.

To build the project locally on your machine:

```bash
# Install dependencies
npm install

# Run locally in development mode
npm run dev
```

To compile your own portable Windows executable:

```bash
npm run build
```

---

## Attribution & License

- **Concept, Design, & Architecture**: Rob Wingfield

Copyright (c) 2026 Rob Wingfield. All Rights Reserved.

*Built exclusively for Windows 11.*
