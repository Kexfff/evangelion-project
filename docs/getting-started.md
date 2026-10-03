# Getting started

[← Documentation](README.md) · [Project home](../README.md)

## Run

Requires Node.js 22.12+ (or a newer supported Node release), npm, and a desktop session with WebGL support.

```sh
npm install
npm run dev
```

On npm versions that block dependency install scripts, approve the pinned build-tool setup scripts and rebuild:

```sh
npm install-scripts approve esbuild electron-winstaller
npm rebuild esbuild electron-winstaller
```

Electron 44 downloads its runtime on first use, so the first launch needs network access if the binary is not cached. You can download it ahead of time with `node node_modules/electron/install.js`.

The first launch opens the companion and settings windows. The avatar window is frameless and transparent; drag its title bar to move it. The settings window can reopen the companion. Linux transparency and always-on-top behavior depend on the window manager/compositor, particularly on Wayland.

```sh
npm run build       # Type check, production renderer, main process and preload
npm start           # Launch the built desktop app
npm run package     # Create an unpacked app for your current platform in release/
npm run dev:ui      # Browser-only visual preview on http://127.0.0.1:5173
```

The browser preview renders the real avatar and settings, but cannot call providers, use desktop dialogs, or persist data. Its in-memory changes disappear on refresh. Use Electron for the complete application. During `npm run dev`, renderer changes hot reload; restart the command after changing main-process or preload code.

Next: [configure providers and voice](providers-and-voice.md). Current build: v0.4.6 (Minecraft allowed-unless-blocked permissions and quieter game conversation). The bundled model is [AvatarSample_B](assets.md). The packaged desktop app includes the Minecraft adapter and its runtime; it does not need a separately launched bot or system Node installation.
