import { app, BrowserWindow, globalShortcut, Menu, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { Library } from './library';
import { Server } from './server';
import { Discovery } from './discovery';
import { Sync } from './sync';
import { Relay } from './relay';
import { adapter } from './adapters';
import { registerIpc } from './ipc';
import { getSettings } from './settings';
import { startUpdater } from './updater';
import { ensureWindowsFirewallException } from './firewall-win';
import type { ClickerCommand } from '@shared/types';

let win: BrowserWindow | null = null;
let library: Library;
let server: Server;
let discovery: Discovery;
let sync: Sync;
let relay: Relay;
let slideTimer: NodeJS.Timeout | null = null;

async function bootstrap(): Promise<void> {
  library = new Library();
  await library.start();

  discovery = new Discovery();
  discovery.start(() => library.list().length);

  server = new Server({
    // Both packaged and dev: renderer/companion are built under <projectRoot>/dist.
    // __dirname here is dist/main/main (tsc keeps src/main/ under outDir),
    // so the companion bundle lives at ../../companion.
    companionDir: path.join(__dirname, '..', '..', 'companion'),
    onClick: (cmd) => handleClick(cmd),
    onSelect: async (id) => {
      const p = library.get(id);
      if (p) await adapter().open(p);
    },
    presentationsForRemote: () => library.summaries(),
    syncOffers: () => library.syncOffers(),
    readVersion: (pid, vid) => {
      const file = library.versionPath(pid, vid);
      if (!file) return null;
      try { return fs.readFileSync(file); } catch { return null; }
    },
    onSyncChunks: async (pid, vid, title, kind, sourcePeer, full) => {
      await library.importVersion({ presentationId: pid, versionId: vid, title, kind: kind as any, data: full, sourcePeer });
      server.broadcastPresentations();
    },
  });
  server.start();

  sync = new Sync(library, server, discovery);
  sync.start();

  relay = new Relay(handleClick);
  relay.start();

  library.on('changed', () => {
    discovery.refresh();
    server.broadcastPresentations();
  });
  discovery.on('peers', () => {
    win?.webContents.send('peers:update');
  });
}

function handleClick(cmd: ClickerCommand): void {
  adapter().click(cmd).catch((err) => console.warn('[click] failed', err));
}

function registerHotkeys(): void {
  const hk = getSettings().hotkeys;
  globalShortcut.unregisterAll();
  const safe = (accel: string, action: () => void) => {
    if (!accel) return;
    try { globalShortcut.register(accel, action); } catch (err) { console.warn('[hotkey]', accel, err); }
  };
  safe(hk.next, () => handleClick({ type: 'next' }));
  safe(hk.prev, () => handleClick({ type: 'prev' }));
  safe(hk.blank, () => handleClick({ type: 'blank' }));
  safe(hk.quickSwitch, () => win?.webContents.send('ui:quick-switch'));
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#0f1115',
    title: 'Presentatool',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  const devUrl = process.env.PRESENTATOOL_DEV_URL;
  if (devUrl) {
    win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
  }
}

// Only allow one running instance. Without this, double-clicking the icon
// (or some installer flows) can spawn a second Presentatool process that
// fights the first for port 4711 and then never fully exits — Task Manager
// shows nothing because Electron's child processes get grouped under a
// collapsed entry. Second launches just focus the existing window.
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
  app.exit(0);
}
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

app.whenReady().then(async () => {
  await bootstrap();
  createWindow();
  if (win) registerIpc({ library, server, discovery, sync, win });
  registerHotkeys();
  startUpdater(win);
  // Fire and forget — opens a dialog on Windows only, and only on first launch.
  void ensureWindowsFirewallException();

  // Poll the platform adapter for live slide info and broadcast to remotes.
  slideTimer = setInterval(async () => {
    try {
      const info = await adapter().current();
      if (info) {
        server.broadcastSlide(info);
        win?.webContents.send('slide:update', info);
      }
    } catch {}
  }, 1500);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    cleanup();
    app.quit();
    // Belt-and-braces force-exit. mDNS sockets, chokidar's fsevents/inotify
    // helper, and lingering WebSocket peers have all historically kept the
    // Electron event loop alive after app.quit(), leaving an invisible
    // Presentatool.exe sitting in Task Manager. If a clean shutdown hasn't
    // completed in 2s, kill the process ourselves.
    // 800ms is short enough to beat electron-updater's ~1s wait before
    // launching the NSIS installer — otherwise the installer hits a file
    // lock on Presentatool.exe and pops "Cannot be closed, please close
    // it manually and click Retry."
    setTimeout(() => process.exit(0), 800).unref();
  }
});

app.on('will-quit', () => {
  cleanup();
  // Same fallback — guards against `Quit` from the dock / `Cmd+Q` paths and
  // against an auto-update relaunch where the old process needs to vacate
  // quickly so the new one can bind port 4711.
  setTimeout(() => process.exit(0), 2_000).unref();
});

function cleanup(): void {
  try { globalShortcut.unregisterAll(); } catch {}
  if (slideTimer) clearInterval(slideTimer);
  slideTimer = null;
  try { sync?.stop(); } catch {}
  try { relay?.stop(); } catch {}
  try { discovery?.stop(); } catch {}
  try { server?.stop(); } catch {}
  try { library?.stop(); } catch {}
}

Menu.setApplicationMenu(null);

// Keep the app alive on unexpected background errors (e.g. a network port we
// can't bind, an mDNS hiccup) — log + show a non-fatal dialog instead of the
// stock Electron crash dialog that quits the process.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  try {
    if (app.isReady()) {
      dialog.showErrorBox('Presentatool – background error', String(err?.stack ?? err));
    }
  } catch {}
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
