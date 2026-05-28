import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import chokidar, { FSWatcher } from 'chokidar';
import { EventEmitter } from 'events';
import { metadataFile, versionsRoot, libraryRoot } from './paths';
import { getSettings, getPeerId } from './settings';
import { MANIFEST_FILENAME, upsertPresentationRef } from './folder-manifest';
import type { Presentation, PresentationKind, PresentationVersion, PresentationSummary, SyncOffer } from '@shared/types';

const EXT_TO_KIND: Record<string, PresentationKind> = {
  '.pptx': 'pptx',
  '.ppt': 'ppt',
  '.key': 'key',
  '.pdf': 'pdf',
  '.odp': 'odp',
};

/**
 * Filenames Office / LibreOffice / Keynote spew while a deck is open. Treating
 * them as presentations was why the Library kept growing fake ~$1 / ~$2 cards.
 *
 *   ~$Foo.pptx     PowerPoint / Word / Excel lock file
 *   .~lock.X.pptx#  LibreOffice lock file
 *   ._Foo.pptx     macOS resource fork dotfile on non-HFS volumes
 */
function isJunkFilename(name: string): boolean {
  return name.startsWith('~$') || name.startsWith('.~lock.') || name.startsWith('._');
}

/** True for filenames we want to import as presentations. */
function isPresentationFile(filename: string): boolean {
  const base = path.basename(filename);
  if (isJunkFilename(base)) return false;
  if (base.startsWith('.')) return false; // any other dotfile
  const ext = path.extname(base).toLowerCase();
  return ext in EXT_TO_KIND;
}

/**
 * The Library is the source of truth for what presentations exist on this
 * device. It watches the user's library paths, copies each new or modified
 * file into our managed storage as a new immutable version, and exposes
 * everything to the renderer + sync layer.
 */
export class Library extends EventEmitter {
  private presentations = new Map<string, Presentation>();
  private watchers: FSWatcher[] = [];
  private byWatchPath = new Map<string, string>(); // absolute path -> presentation id

  async start(): Promise<void> {
    this.load();
    this.cleanupJunkPresentations();
    await this.rescan();
    this.watch();
  }

  /**
   * Stop watchers, re-scan from settings, and start fresh watchers. Called
   * when the user adds or removes a folder so the change takes effect
   * without an app restart.
   */
  async refreshFolders(): Promise<void> {
    for (const w of this.watchers) { try { await w.close(); } catch { /* noop */ } }
    this.watchers = [];
    await this.rescan();
    this.watch();
    this.emit('changed');
  }

  /**
   * Remove tracked "presentations" that were actually Office lock files
   * ingested before the filter landed. Runs once per launch — harmless if
   * the library is already clean.
   */
  private cleanupJunkPresentations(): void {
    let removed = 0;
    for (const [id, p] of this.presentations) {
      const base = p.watchPath ? path.basename(p.watchPath) : `${p.title}${extForKind(p.kind)}`;
      if (!isJunkFilename(base)) continue;
      this.presentations.delete(id);
      if (p.watchPath) this.byWatchPath.delete(p.watchPath);
      // We deliberately leave the managed library dir on disk — the next sweep
      // can pick it up if the user wants, and a 165-byte stub is harmless.
      removed++;
    }
    if (removed > 0) {
      console.log(`[library] removed ${removed} stale lock-file entries`);
      this.persist();
    }
  }

  stop(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
  }

  list(): Presentation[] {
    return Array.from(this.presentations.values())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): Presentation | undefined {
    return this.presentations.get(id);
  }

  summaries(): PresentationSummary[] {
    return this.list().map((p) => ({
      id: p.id,
      title: p.title,
      kind: p.kind,
      latestVersionId: p.versions[0]?.id ?? '',
      updatedAt: p.updatedAt,
    }));
  }

  syncOffers(): SyncOffer[] {
    return this.list().flatMap((p) => {
      const v = p.versions[0];
      if (!v) return [];
      return [{
        presentationId: p.id,
        title: p.title,
        versionId: v.id,
        size: v.size,
        kind: p.kind,
      }];
    });
  }

  /** Path on disk for a given stored version (used for sync transfers + opening). */
  versionPath(presentationId: string, versionId: string): string | null {
    const p = this.presentations.get(presentationId);
    if (!p) return null;
    const v = p.versions.find((vv) => vv.id === versionId);
    if (!v) return null;
    const ext = path.extname(p.currentPath);
    return path.join(versionsRoot(presentationId), `${v.id}${ext}`);
  }

  /** Apply an incoming sync chunk. Returns the new version when complete. */
  async importVersion(opts: {
    presentationId: string;
    versionId: string;
    title: string;
    kind: PresentationKind;
    data: Buffer;
    sourcePeer?: string;
  }): Promise<PresentationVersion> {
    let p = this.presentations.get(opts.presentationId);
    const ext = extForKind(opts.kind);
    if (!p) {
      const id = opts.presentationId;
      const dir = path.join(libraryRoot(), id);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const currentPath = path.join(dir, `current${ext}`);
      p = {
        id,
        title: opts.title,
        kind: opts.kind,
        currentPath,
        versions: [],
        tags: [],
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      this.presentations.set(id, p);
    }
    return this.addVersionBuffer(p, opts.data, opts.sourcePeer ? 'sync' : 'import', opts.sourcePeer, opts.versionId);
  }

  /** Manually import a file the user picked. */
  async importFile(filePath: string): Promise<Presentation> {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const kind = EXT_TO_KIND[ext] ?? 'unknown';
    const title = path.basename(filePath, ext);
    const id = crypto.randomUUID();
    const dir = path.join(libraryRoot(), id);
    fs.mkdirSync(dir, { recursive: true });
    const currentPath = path.join(dir, `current${ext}`);
    const p: Presentation = {
      id,
      title,
      kind,
      currentPath,
      watchPath: filePath,
      versions: [],
      tags: [],
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    this.presentations.set(id, p);
    this.byWatchPath.set(filePath, id);
    await this.addVersionBuffer(p, data, 'local');
    return p;
  }

  // -------------------------------------------------------------------------

  private async addVersionBuffer(
    p: Presentation,
    data: Buffer,
    origin: 'local' | 'sync' | 'import',
    sourcePeer?: string,
    forcedId?: string,
  ): Promise<PresentationVersion> {
    const id = forcedId ?? crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
    if (p.versions.some((v) => v.id === id)) {
      // Already have it — no-op.
      return p.versions.find((v) => v.id === id)!;
    }
    const ext = path.extname(p.currentPath);
    const versionPath = path.join(versionsRoot(p.id), `${id}${ext}`);
    fs.writeFileSync(versionPath, data);
    // Update the "current" copy too.
    fs.writeFileSync(p.currentPath, data);
    const v: PresentationVersion = {
      id,
      storedAt: new Date().toISOString(),
      size: data.byteLength,
      origin,
      sourcePeer,
    };
    p.versions.unshift(v);
    p.updatedAt = v.storedAt;
    this.persist();
    this.emit('changed', p);
    return v;
  }

  private async rescan(): Promise<void> {
    const settings = getSettings();
    for (const root of settings.libraryPaths) {
      await this.scanDir(root);
    }
  }

  private async scanDir(dir: string): Promise<void> {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        await this.scanDir(full);
      } else if (entry.isFile()) {
        if (!isPresentationFile(entry.name)) continue;
        if (this.byWatchPath.has(full)) continue;
        try {
          await this.adoptFile(full);
        } catch (err) {
          console.warn('[library] failed to import', full, err);
        }
      }
    }
  }

  /** Either creates a new presentation or links the file to an existing one. */
  private async adoptFile(filePath: string): Promise<void> {
    const stat = fs.statSync(filePath);
    if (stat.size > 500 * 1024 * 1024) return; // skip files > 500MB
    // Skip 0-byte files — most often these are Dropbox / OneDrive "online-only"
    // placeholders that haven't materialised on disk yet. We'll pick them up
    // when they're hydrated and grow past zero bytes (chokidar fires `change`).
    if (stat.size === 0) return;
    // Have we ever ingested this exact path before?
    for (const p of this.presentations.values()) {
      if (p.watchPath === filePath) {
        this.byWatchPath.set(filePath, p.id);
        return;
      }
    }
    const ext = path.extname(filePath).toLowerCase();
    const kind = EXT_TO_KIND[ext] ?? 'unknown';
    const title = path.basename(filePath, ext);

    // If this file lives under a configured library folder, consult that
    // folder's `.presentatool.json` manifest. If a peer has already minted
    // an ID for this exact file (because they're sharing a Dropbox / iCloud
    // folder with us), reuse it so the sync layer recognises the two as
    // the same presentation. Otherwise write a fresh ID into the manifest
    // so the next peer to mount the folder sees ours.
    const owningFolder = findOwningLibraryFolder(filePath);
    let id: string;
    if (owningFolder) {
      // Don't try to track our own manifest file as a presentation —
      // shouldn't reach here (chokidar ignores it) but belt and braces.
      if (path.basename(filePath) === MANIFEST_FILENAME) return;
      const candidateId = crypto.randomUUID();
      const ref = upsertPresentationRef(owningFolder, filePath, {
        presentationId: candidateId,
        title,
        kind,
        peerId: getPeerId(),
      });
      id = ref.presentationId;
      // If we already have a Presentation row with this id (e.g. synced in
      // from a peer earlier and we're now adopting the local file copy),
      // attach the watchPath to the existing row instead of creating a
      // duplicate.
      const existing = this.presentations.get(id);
      if (existing) {
        existing.watchPath = filePath;
        this.byWatchPath.set(filePath, id);
        this.persist();
        const data = fs.readFileSync(filePath);
        await this.addVersionBuffer(existing, data, 'local');
        return;
      }
    } else {
      id = crypto.randomUUID();
    }

    const data = fs.readFileSync(filePath);
    const dir = path.join(libraryRoot(), id);
    fs.mkdirSync(dir, { recursive: true });
    const currentPath = path.join(dir, `current${ext}`);
    const p: Presentation = {
      id,
      title,
      kind,
      currentPath,
      watchPath: filePath,
      versions: [],
      tags: [],
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    this.presentations.set(id, p);
    this.byWatchPath.set(filePath, id);
    await this.addVersionBuffer(p, data, 'local');
  }

  private watch(): void {
    const settings = getSettings();
    for (const root of settings.libraryPaths) {
      const watcher = chokidar.watch(root, {
        // Skip dotfiles, node_modules, Office / LibreOffice / macOS lock files.
        // A function lets us run isJunkFilename on every basename rather than
        // trying to express both the dotfile and ~$ rules in one regex.
        ignored: (testPath: string) => {
          const base = path.basename(testPath);
          if (base === 'node_modules') return true;
          if (base.startsWith('.') && base.length > 1) return true;
          if (isJunkFilename(base)) return true;
          return false;
        },
        ignoreInitial: true,
        // Wait for writes to settle before snapshotting — PowerPoint writes
        // .pptx in multiple steps, we don't want a half-written intermediate.
        awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
        depth: 6,
        // Poll the filesystem rather than relying purely on native FS events.
        // Cloud-sync clients (Dropbox, OneDrive, iCloud Drive) often don't
        // emit FSEvents / inotify when a remote-sourced file arrives, so a
        // 3-second poll catches "the client just dropped a deck in the
        // Dropbox folder" reliably across all storage backends.
        usePolling: true,
        interval: 3000,
        binaryInterval: 5000,
      });
      watcher.on('add', (p) => this.onFsAdd(p));
      watcher.on('change', (p) => this.onFsChange(p));
      this.watchers.push(watcher);
    }
  }

  private async onFsAdd(filePath: string): Promise<void> {
    if (!isPresentationFile(filePath)) return;
    if (this.byWatchPath.has(filePath)) return;
    try { await this.adoptFile(filePath); } catch (err) { console.warn(err); }
  }

  private async onFsChange(filePath: string): Promise<void> {
    const id = this.byWatchPath.get(filePath);
    if (!id) return;
    const p = this.presentations.get(id);
    if (!p) return;
    try {
      const data = fs.readFileSync(filePath);
      await this.addVersionBuffer(p, data, 'local');
    } catch (err) {
      console.warn('[library] failed to snapshot change for', filePath, err);
    }
  }

  private load(): void {
    const file = metadataFile();
    if (!fs.existsSync(file)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Presentation[];
      for (const p of raw) {
        this.presentations.set(p.id, p);
        if (p.watchPath) this.byWatchPath.set(p.watchPath, p.id);
      }
    } catch (err) {
      console.warn('[library] failed to read metadata, starting fresh', err);
    }
  }

  private persist(): void {
    const all = Array.from(this.presentations.values());
    fs.writeFileSync(metadataFile(), JSON.stringify(all, null, 2));
  }
}

/**
 * Find the configured library folder that contains `filePath`. Longest match
 * wins, so a deck inside `~/Dropbox/Clients/Acme/archive/` correctly belongs
 * to `~/Dropbox/Clients/Acme/archive` if both that and `~/Dropbox/Clients`
 * are watched. Returns null if no configured folder is an ancestor.
 */
function findOwningLibraryFolder(filePath: string): string | null {
  const folders = getSettings().libraryPaths;
  const normTarget = path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
  let best: string | null = null;
  let bestLen = -1;
  for (const f of folders) {
    const normFolder = path.resolve(f).replace(/\\/g, '/').toLowerCase();
    if (normTarget === normFolder) continue; // we shouldn't match a folder itself
    if (normTarget.startsWith(normFolder + '/') && normFolder.length > bestLen) {
      best = f;
      bestLen = normFolder.length;
    }
  }
  return best;
}

function extForKind(kind: PresentationKind): string {
  switch (kind) {
    case 'pptx': return '.pptx';
    case 'ppt': return '.ppt';
    case 'key': return '.key';
    case 'pdf': return '.pdf';
    case 'odp': return '.odp';
    default: return '';
  }
}
