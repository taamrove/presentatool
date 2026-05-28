# Presentatool

Cross-platform presentation manager for Windows, Linux and macOS. One place to
keep every `.pptx` / `.key` / `.pdf` you present from, advance slides from your
phone or another laptop, version each speaker's revisions automatically, and
sync everything between the machines on your network.

## Features

| Feature | Status | Notes |
|---|---|---|
| Track presentations across folders | ✅ | Watches the folders you configure, picks up `.pptx`, `.ppt`, `.key`, `.pdf`, `.odp`. |
| Quick switch between presentations | ✅ | Global hotkey (`Ctrl/Cmd+Shift+P`) opens a Spotlight-style picker. |
| Remote clicker (web companion) | ✅ | Scan a QR code with your phone, get a touch remote with next/prev/blank/exit. |
| Local clicker (on-screen + hotkeys) | ✅ | Big next/prev buttons in the UI, plus configurable global hotkeys. |
| Versioning | ✅ | Every change to the source file is stored as a content-addressed immutable version. |
| LAN sync between machines | ✅ | Peers discovered via mDNS auto-pull versions you don't already have. |
| Discovery between connected computers | ✅ | mDNS / Bonjour with peer txt records. |
| Presenter notes + current/next slide | ✅ | Native scripting on Windows (PowerPoint COM) and macOS (Keynote/PowerPoint AppleScript). PPTX notes also parsed from the file as a fallback. |
| Optional cloud relay (remote across networks) | ✅ | Point at any WebSocket relay URL in Settings → Network. |
| Bitfocus Companion module | ✅ | Drive Presentatool from a Stream Deck. See [`modules/companion-bitfocus`](modules/companion-bitfocus/). |

## Modules

There are four top-level modules:

1. **Desktop app** (`src/main` + `src/renderer`) — the Electron app the speaker runs.
2. **Phone web remote** (`src/companion`) — a touch UI served by the desktop, paired via QR.
3. **Bitfocus Companion module** (`modules/companion-bitfocus`) — Node module that lets [Bitfocus Companion](https://bitfocus.io/companion) drive Presentatool from a Stream Deck or other control surface.
4. **Discovery + sync + versioning** (`src/main/discovery.ts`, `src/main/sync.ts`, `src/main/library.ts`) — mDNS peer discovery, chunked WebSocket sync of presentation versions, and file-watcher-driven snapshotting.

Each module talks to the others through the shared types in `src/shared/types.ts`.

## Quick start

```bash
npm install
npm run dev          # starts the renderer, the companion bundle and the main process in watch mode
npm start            # launch Electron pointing at the watched build
```

To produce installers:

```bash
npm run package           # detect host platform
npm run package:win
npm run package:linux
npm run package:mac
```

## Pairing a remote

1. Open **Remote** in the sidebar and click *Generate pairing code*.
2. Scan the QR with your phone (must be on the same Wi-Fi).
3. The companion page opens and acts as a touch remote — including presenter notes and the next-slide preview when the native app exposes them.

For phones on a *different* network: set up any relay endpoint (a small WebSocket
echo server is fine), enter `wss://…` in Settings → Network → Relay URL, and
remotes that connect to that URL will drive this desktop.

## How versioning works

When you point Presentatool at a folder, every recognised presentation is copied
once into `<userData>/library/<id>/versions/<sha>.<ext>`. Each subsequent
change to the source file (detected by chokidar) becomes a new immutable
version. The current copy is mirrored to `current.<ext>` so the platform
adapter has a stable path to open. The UI's **Versions** tab shows the full
history with origin (local / synced from peer X / imported).

## How sync works

* Each install picks a stable peer-id (stored in `<userData>/peer-id`).
* The desktop advertises `_presentatool._tcp` over mDNS with name, port and presentation count.
* When a new peer is discovered, the local desktop opens a WebSocket to it and exchanges `sync-offer` messages listing every (presentationId, versionId) it has.
* Anything the other side is missing is requested with `sync-request` and streamed back in 256 KB base64 chunks.

## How notes & next-slide work

* **Windows**: PowerPoint COM via PowerShell, reads `SlideShowWindow.View.CurrentShowPosition`, the title placeholder, the notes placeholder, and the next slide's title.
* **macOS**: AppleScript queries Keynote (`presenter notes of current slide`) or PowerPoint.
* **Linux / fallback**: the `.pptx` is opened directly with JSZip; `ppt/notesSlides/notesSlideN.xml` and `ppt/slides/slideN.xml` are parsed to recover titles + notes. Slide *position* on Linux is best-effort (the click counter tracks it).

## Project layout

```
src/
  main/                 Electron main process
    adapters/           Win / Mac / Linux presentation control
    library.ts          File watcher + version store
    discovery.ts        mDNS publish/browse
    server.ts           HTTP + WS server (companion + peer protocol)
    sync.ts             Peer reconciliation
    relay.ts            Optional cloud-relay client
    notes.ts            PPTX outline extractor
    ipc.ts              Renderer <-> main bridge
  preload/              Context-isolated bridge
  renderer/             React UI for the desktop window
  companion/            React UI for the phone remote
  shared/               Wire types shared by all of the above
```
