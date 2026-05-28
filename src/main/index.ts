import { app, BrowserWindow, globalShortcut, Menu } from 'electron';
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
    companionDir: app.isPackaged
      ? path.join(process.resourcesPath, 'companion')
      : path.join(__dirname, '..', '..', 'dist', 'companion'),
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
    title: 'Presentool',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  const devUrl = process.env.PRESENTOOL_DEV_URL;
  if (devUrl) {
    win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }
}

app.whenReady().then(async () => {
  await bootstrap();
  createWindow();
  if (win) registerIpc({ library, server, discovery, win });
  registerHotkeys();

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
  }
});

app.on('will-quit', cleanup);

function cleanup(): void {
  globalShortcut.unregisterAll();
  if (slideTimer) clearInterval(slideTimer);
  slideTimer = null;
  try { sync?.stop(); } catch {}
  try { relay?.stop(); } catch {}
  try { discovery?.stop(); } catch {}
  try { server?.stop(); } catch {}
  try { library?.stop(); } catch {}
}

Menu.setApplicationMenu(null);
