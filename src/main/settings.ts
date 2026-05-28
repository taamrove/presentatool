import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { settingsFile, peerIdFile, defaultLibraryPaths } from './paths';
import type { AppSettings } from '@shared/types';

let cached: AppSettings | null = null;

export function getSettings(): AppSettings {
  if (cached) return cached;
  const file = settingsFile();
  if (fs.existsSync(file)) {
    try {
      cached = JSON.parse(fs.readFileSync(file, 'utf8')) as AppSettings;
      // Backfill any missing fields after upgrades.
      cached = { ...defaultSettings(), ...cached };
      return cached;
    } catch {
      // fall through to defaults
    }
  }
  cached = defaultSettings();
  saveSettings(cached);
  return cached;
}

export function saveSettings(next: AppSettings): void {
  cached = next;
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch };
  saveSettings(next);
  return next;
}

function defaultSettings(): AppSettings {
  return {
    libraryPaths: defaultLibraryPaths(),
    deviceName: os.hostname(),
    hotkeys: {
      next: 'CommandOrControl+Shift+Right',
      prev: 'CommandOrControl+Shift+Left',
      blank: 'CommandOrControl+Shift+B',
      quickSwitch: 'CommandOrControl+Shift+P',
    },
    network: {
      port: 4711,
      enableMdns: true,
      enableRelay: false,
      trustLanControllers: true,
      staticPeers: [],
    },
    autoSync: true,
  };
}

export function getPeerId(): string {
  const file = peerIdFile();
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const id = crypto.randomUUID();
  fs.writeFileSync(file, id);
  return id;
}
