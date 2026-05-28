/**
 * Per-folder identity file: `.presentatool.json` written at the root of each
 * watched folder.
 *
 * What it solves: when two peers watch the same Dropbox / OneDrive / iCloud
 * Drive folder, the cloud client syncs the .pptx files between them — but
 * each Presentatool install would otherwise mint its own UUID for the same
 * file, so the sync layer would treat them as unrelated presentations and
 * the version histories never converge.
 *
 * What it contains: a stable folder UUID and a `relativePath → presentationId`
 * map. The cloud client syncs the manifest alongside the decks, so the second
 * machine to open the folder reads existing IDs out of the manifest and uses
 * them instead of generating fresh ones. Both peers end up with the same IDs,
 * the sync protocol behaves, and editing on either side produces converging
 * version chains.
 *
 * What it intentionally does NOT contain: display name, custom labels, tags.
 * Folder names always come from the OS (basename of the path) so renaming in
 * Finder or Explorer flows through to the UI without any sync ceremony.
 * Per-presentation titles also stay in the app's own metadata — the manifest
 * is a stable identity layer, not a source of truth for editable fields.
 *
 * Concurrency caveat: if two peers add the same fresh folder at the exact
 * same moment, both will write their own manifest and Dropbox / OneDrive
 * will create a "Conflicted Copy" file. Acceptable for now — in practice
 * folders are added once per peer with some delay, and a conflicted copy
 * is loud-enough that the user notices.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';

export const MANIFEST_FILENAME = '.presentatool.json';

export interface FolderPresentationRef {
  presentationId: string;
  /** Relative path from the folder root — re-stored so it's self-documenting. */
  relativePath: string;
  /** Cached at write time; the live title may diverge. */
  title: string;
  /** Cached at write time; immutable in practice. */
  kind: string;
  addedAt: string;
  /** Peer id of whoever first registered this entry. */
  addedBy?: string;
}

export interface FolderManifest {
  /** Schema version of this file. Bump if the shape ever changes. */
  version: 1;
  /** Stable identity for this folder, independent of its on-disk path. */
  folderId: string;
  createdAt: string;
  /** Peer that first wrote the manifest. Best-effort, useful for audit. */
  createdBy?: string;
  /** Map keyed by relative-to-folder path of each tracked presentation. */
  presentations: Record<string, FolderPresentationRef>;
}

export function manifestPath(folder: string): string {
  return path.join(folder, MANIFEST_FILENAME);
}

/** Read the manifest, returning null if it doesn't exist or is unparseable. */
export function readFolderManifest(folder: string): FolderManifest | null {
  const file = manifestPath(folder);
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as FolderManifest;
    if (!parsed || typeof parsed !== 'object' || !parsed.folderId) return null;
    if (!parsed.presentations) parsed.presentations = {};
    return parsed;
  } catch (err) {
    console.warn('[folder-manifest] read failed for', folder, err);
    return null;
  }
}

/**
 * Return an existing manifest or create a fresh one. The fresh manifest is
 * written to disk immediately so the next peer that opens the folder sees
 * the same folderId.
 */
export function ensureFolderManifest(folder: string, peerId?: string): FolderManifest {
  const existing = readFolderManifest(folder);
  if (existing) return existing;
  const fresh: FolderManifest = {
    version: 1,
    folderId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    createdBy: peerId,
    presentations: {},
  };
  writeFolderManifest(folder, fresh);
  return fresh;
}

/** Serialize and write the manifest, hiding the file on Windows. */
export function writeFolderManifest(folder: string, manifest: FolderManifest): void {
  const file = manifestPath(folder);
  try {
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
  } catch (err) {
    console.warn('[folder-manifest] write failed for', folder, err);
    return;
  }
  // On Windows the dotfile prefix doesn't actually hide a file the way it
  // does on macOS / Linux — set the +H attribute so it stops showing up
  // in Explorer. Errors are non-fatal: a visible manifest file is annoying
  // but functionally fine.
  if (process.platform === 'win32') {
    execFile('attrib', ['+H', file], { windowsHide: true }, () => undefined);
  }
}

/**
 * Look up or assign a stable presentation ID for `absoluteFilePath` within
 * `folder`. Returns the manifest entry (existing or freshly written).
 */
export function upsertPresentationRef(
  folder: string,
  absoluteFilePath: string,
  fallback: { presentationId: string; title: string; kind: string; peerId?: string },
): FolderPresentationRef {
  const rel = relativeWithinFolder(folder, absoluteFilePath);
  const manifest = ensureFolderManifest(folder, fallback.peerId);
  const existing = manifest.presentations[rel];
  if (existing) return existing;
  const ref: FolderPresentationRef = {
    presentationId: fallback.presentationId,
    relativePath: rel,
    title: fallback.title,
    kind: fallback.kind,
    addedAt: new Date().toISOString(),
    addedBy: fallback.peerId,
  };
  manifest.presentations[rel] = ref;
  writeFolderManifest(folder, manifest);
  return ref;
}

/** Path relative to the folder root, with forward slashes for stability. */
export function relativeWithinFolder(folder: string, absolute: string): string {
  const rel = path.relative(folder, absolute).replace(/\\/g, '/');
  return rel;
}
