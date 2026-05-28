import React from 'react';
import type { Presentation } from '../../shared/types';

interface Props {
  presentations: Presentation[];
  /** Folders the user has explicitly told the app to watch. We render a
   *  section for each one even if no decks live there yet, so a freshly
   *  added Dropbox folder reads as "ready and waiting" instead of
   *  invisible until the first file arrives. */
  watchedFolders: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (p: Presentation) => void;
  onAddFolder: () => void;
}

interface FolderGroup {
  /** Absolute folder, or '' for "no source folder" (synced / imported). */
  folder: string;
  label: string;
  presentations: Presentation[];
  /** ISO timestamp of the most recent updatedAt in the group, or '' if empty. */
  mostRecent: string;
  /** True if the folder is in the user's configured watch list. */
  configured: boolean;
}

export function Library({
  presentations, watchedFolders, selectedId, onSelect, onOpen, onAddFolder,
}: Props): JSX.Element {
  const groups = groupByFolder(presentations, watchedFolders);

  return (
    <div className="library">
      <header className="library-header">
        <h2>Library</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="hint">Double-click a card to start the slideshow</span>
          <button onClick={onAddFolder}>+ Add folder…</button>
        </div>
      </header>
      {groups.length === 0 && (
        <div className="empty">
          <h2>No folders yet</h2>
          <p>
            Click <strong>+ Add folder…</strong> and pick any directory — local, Dropbox,
            OneDrive, iCloud Drive. Presentatool will watch it, snapshot every change,
            and sync versions across your other devices.
          </p>
        </div>
      )}
      {groups.map((g) => (
        <section key={g.folder || '__nofolder__'} className="library-group">
          <header className="library-group-header">
            <span className="library-group-name">{g.label}</span>
            <span className="hint" title={g.folder}>
              {g.presentations.length} item{g.presentations.length === 1 ? '' : 's'}
              {g.folder && ` · ${g.folder}`}
            </span>
          </header>
          {g.presentations.length === 0 ? (
            <p className="hint" style={{ marginTop: 8 }}>
              {g.configured
                ? 'No decks here yet — drop a .pptx / .key / .pdf in this folder.'
                : 'No items in this group.'}
            </p>
          ) : (
            <ul className="cards">
              {g.presentations.map((p) => (
                <li
                  key={p.id}
                  className={`card${p.id === selectedId ? ' selected' : ''}`}
                  onClick={() => onSelect(p.id)}
                  onDoubleClick={() => onOpen(p)}
                >
                  <div className="card-kind">{p.kind.toUpperCase()}</div>
                  <div className="card-title">{p.title}</div>
                  <div className="card-meta">
                    <span>{p.versions.length} version{p.versions.length === 1 ? '' : 's'}</span>
                    <span>·</span>
                    <span title={p.updatedAt}>{relative(p.updatedAt)}</span>
                  </div>
                  <div className="card-actions">
                    <button onClick={(e) => { e.stopPropagation(); onOpen(p); }}>Open</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

/**
 * Build folder groups from configured watch paths first (so empty folders
 * still render), then absorb any presentations into matching groups. Anything
 * that doesn't match a configured folder (synced from a peer, picker-imported)
 * goes into a "Synced / imported" group.
 *
 * Group order:
 *  - configured folders sorted by most-recently-updated
 *  - "Synced / imported" group at the bottom
 *  - configured folders with no content stay visible but sink below ones that
 *    have something in them
 */
function groupByFolder(presentations: Presentation[], watchedFolders: string[]): FolderGroup[] {
  const map = new Map<string, FolderGroup>();

  // Seed with configured folders so empty ones still appear.
  for (const folder of watchedFolders) {
    if (!folder) continue;
    map.set(normalize(folder), {
      folder,
      label: basename(folder) || folder,
      presentations: [],
      mostRecent: '',
      configured: true,
    });
  }

  // Bucket each presentation into its source folder (or "synced/imported").
  for (const p of presentations) {
    if (!p.watchPath) {
      placeIn(map, '', 'Synced / imported', p, false);
      continue;
    }
    const parent = parentDir(p.watchPath);
    // Find the configured folder that contains this file (longest match).
    const owner = pickOwningFolder(parent, watchedFolders);
    if (owner) {
      const key = normalize(owner);
      let g = map.get(key);
      if (!g) {
        g = { folder: owner, label: basename(owner) || owner, presentations: [], mostRecent: '', configured: true };
        map.set(key, g);
      }
      g.presentations.push(p);
      if (p.updatedAt > g.mostRecent) g.mostRecent = p.updatedAt;
    } else {
      // Lives outside any configured root — show it under its actual parent.
      placeIn(map, parent, basename(parent) || parent, p, false);
    }
  }

  for (const g of map.values()) {
    g.presentations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  return [...map.values()].sort((a, b) => {
    // "Synced / imported" sinks to the bottom; among configured folders,
    // ones with recent activity float up; empty configured folders below
    // populated ones but above the synced group.
    if (a.folder === '' && b.folder !== '') return 1;
    if (b.folder === '' && a.folder !== '') return -1;
    if (a.mostRecent && !b.mostRecent) return -1;
    if (b.mostRecent && !a.mostRecent) return 1;
    return b.mostRecent.localeCompare(a.mostRecent);
  });
}

function placeIn(
  map: Map<string, FolderGroup>,
  folder: string,
  label: string,
  p: Presentation,
  configured: boolean,
): void {
  const key = normalize(folder);
  let g = map.get(key);
  if (!g) {
    g = { folder, label, presentations: [], mostRecent: '', configured };
    map.set(key, g);
  }
  g.presentations.push(p);
  if (p.updatedAt > g.mostRecent) g.mostRecent = p.updatedAt;
}

/** Returns the longest configured folder that's a prefix of `parent`. */
function pickOwningFolder(parent: string, watchedFolders: string[]): string | null {
  const normParent = normalize(parent);
  let best: string | null = null;
  let bestLen = -1;
  for (const f of watchedFolders) {
    const n = normalize(f);
    if (n === normParent || normParent.startsWith(n + '/')) {
      if (n.length > bestLen) { best = f; bestLen = n.length; }
    }
  }
  return best;
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function parentDir(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  if (i <= 0) return '';
  return filePath.slice(0, i);
}

function basename(folderPath: string): string {
  const norm = folderPath.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i < 0 ? folderPath : folderPath.slice(i + 1);
}

function relative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
