import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

/** Root directory for all persistent state. */
export function dataRoot(): string {
  const root = app.getPath('userData');
  ensureDir(root);
  return root;
}

export function libraryRoot(): string {
  const p = path.join(dataRoot(), 'library');
  ensureDir(p);
  return p;
}

export function versionsRoot(presentationId: string): string {
  const p = path.join(libraryRoot(), presentationId, 'versions');
  ensureDir(p);
  return p;
}

export function metadataFile(): string {
  return path.join(dataRoot(), 'presentations.json');
}

export function settingsFile(): string {
  return path.join(dataRoot(), 'settings.json');
}

export function peerIdFile(): string {
  return path.join(dataRoot(), 'peer-id');
}

export function ensureDir(p: string): void {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

/** Default user-facing folders to scan for presentations. */
export function defaultLibraryPaths(): string[] {
  const docs = app.getPath('documents');
  const desktop = app.getPath('desktop');
  return [docs, desktop].filter((p) => {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  });
}
