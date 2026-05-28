/**
 * Self-update logic for Presentatool.
 *
 * Two code paths, picked based on whether the macOS app is code-signed:
 *
 * 1. `electron-updater` — for Windows NSIS builds (and a future signed +
 *    notarized macOS build). Downloads the new installer in the background
 *    and silently relaunches into it when the user agrees.
 *
 * 2. GitHub "manual" fallback — for the current unsigned macOS DMG. The
 *    Squirrel.Mac updater that `electron-updater` shells out to refuses to
 *    apply unsigned updates, so instead we just poll the GitHub Releases
 *    API ourselves, compare versions, and pop a dialog that opens the
 *    download page in the user's browser.
 *
 * Both paths are inert in dev (`app.isPackaged === false`) so running
 * `npm start` doesn't try to "update" the running tsc output.
 */

import { app, dialog, shell, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as https from 'https';
import * as semver from 'semver';

// GitHub repo that hosts the releases. Kept here rather than in settings so
// a tampered settings file can't redirect updates at a malicious server.
const RELEASES_OWNER = 'taamrove';
const RELEASES_REPO = 'presentatool';

let started = false;

/** Wire the updater into the main process. Call once after the window exists. */
export function startUpdater(win: BrowserWindow | null): void {
  if (started) return;
  started = true;

  if (!app.isPackaged) {
    console.log('[updater] dev build — skipping update check');
    return;
  }

  // Windows: full Squirrel-style auto-update via electron-updater.
  // macOS unsigned: fall back to a manual "go download" prompt.
  // macOS signed (future): use electron-updater too — set env
  //   PRESENTATOOL_MAC_AUTOUPDATE=1 or sign the app, then this branch flips.
  const macAutoUpdate =
    process.platform !== 'darwin' || !!process.env.PRESENTATOOL_MAC_AUTOUPDATE;

  if (macAutoUpdate) {
    setupAutoUpdater(win);
  } else {
    void checkManually(win);
    // Re-check every 6h while the app stays open.
    setInterval(() => { void checkManually(win); }, 6 * 60 * 60 * 1000);
  }
}

// ---------------------------------------------------------------------------
// electron-updater path (Windows now, macOS once signed)
// ---------------------------------------------------------------------------

function setupAutoUpdater(win: BrowserWindow | null): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Quiet the noisy debug log; only surface real events.
  autoUpdater.logger = {
    info: (...a: unknown[]) => console.log('[updater]', ...a),
    warn: (...a: unknown[]) => console.warn('[updater]', ...a),
    error: (...a: unknown[]) => console.error('[updater]', ...a),
    debug: () => undefined,
  } as never;

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available:', info.version);
    win?.webContents.send('updater:status', { state: 'downloading', version: info.version });
  });
  autoUpdater.on('update-not-available', () => {
    win?.webContents.send('updater:status', { state: 'up-to-date' });
  });
  autoUpdater.on('download-progress', (p) => {
    win?.webContents.send('updater:progress', { percent: p.percent });
  });
  autoUpdater.on('update-downloaded', async (info) => {
    win?.webContents.send('updater:status', { state: 'ready', version: info.version });
    const choice = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Presentatool update ready',
      message: `Version ${info.version} has been downloaded.`,
      detail: 'Restart to finish installing. Your library and settings are preserved.',
    });
    if (choice.response === 0) {
      // isSilent=true so it just installs without showing the installer UI.
      // forceRunAfter=true relaunches the app post-install.
      autoUpdater.quitAndInstall(true, true);
    }
  });
  autoUpdater.on('error', (err) => {
    console.warn('[updater] error', err);
  });

  // Don't block startup — check on a small delay so the renderer has a moment
  // to register the IPC listener for the status pings.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => console.warn('[updater] check failed', err));
  }, 5_000);

  // Periodic re-check.
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => undefined);
  }, 6 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Manual GitHub Releases path (unsigned macOS)
// ---------------------------------------------------------------------------

interface GhRelease {
  tag_name: string;
  name: string;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
}

/** One-shot: GET /releases/latest, compare version, prompt. */
async function checkManually(win: BrowserWindow | null): Promise<void> {
  try {
    const latest = await fetchLatestRelease();
    if (!latest) return;
    const tag = latest.tag_name.replace(/^v/, '');
    const current = app.getVersion();
    if (!semver.valid(tag) || !semver.gt(tag, current)) {
      console.log(`[updater] up to date (latest ${tag}, current ${current})`);
      win?.webContents.send('updater:status', { state: 'up-to-date' });
      return;
    }
    console.log(`[updater] newer version available: ${tag}`);
    win?.webContents.send('updater:status', { state: 'available', version: tag });
    const choice = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Open download page', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Presentatool update available',
      message: `Version ${tag} is available (you have ${current}).`,
      detail:
        'Automatic install on macOS requires a signed build. ' +
        'Click below to open the GitHub release and download the new DMG.',
    });
    if (choice.response === 0) {
      await shell.openExternal(latest.html_url);
    }
  } catch (err) {
    console.warn('[updater] manual check failed', err);
  }
}

function fetchLatestRelease(): Promise<GhRelease | null> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: `/repos/${RELEASES_OWNER}/${RELEASES_REPO}/releases/latest`,
        method: 'GET',
        headers: {
          'User-Agent': `Presentatool/${app.getVersion()}`,
          Accept: 'application/vnd.github+json',
        },
        timeout: 10_000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            console.log(`[updater] GitHub returned ${res.statusCode}`);
            resolve(null);
            return;
          }
          try { resolve(JSON.parse(body) as GhRelease); } catch { resolve(null); }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => {
      console.log('[updater] github request failed:', err.message);
      resolve(null);
    });
    req.end();
  });
}
