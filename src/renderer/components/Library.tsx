import React from 'react';
import type { Presentation } from '../../shared/types';

interface Props {
  presentations: Presentation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (p: Presentation) => void;
}

/**
 * Returned by `groupByFolder` — one group per source folder, in the order
 * we want them rendered (most-recently-updated folder first).
 */
interface FolderGroup {
  /** Absolute parent directory, or '' for "no source folder" (synced, etc.) */
  folder: string;
  /** Display name — basename of the folder, or "Synced from peers". */
  label: string;
  presentations: Presentation[];
  /** ISO timestamp of the most recent updatedAt in the group, for ordering. */
  mostRecent: string;
}

export function Library({ presentations, selectedId, onSelect, onOpen }: Props): JSX.Element {
  if (presentations.length === 0) {
    return (
      <div className="empty">
        <h2>No presentations yet</h2>
        <p>
          Drop your <code>.pptx</code>, <code>.key</code> or <code>.pdf</code> files in your
          Documents folder, or click <strong>+ Add presentations</strong> in the sidebar.
        </p>
        <p>Presentatool will watch the folder and snapshot every change as a new version.</p>
      </div>
    );
  }

  const groups = groupByFolder(presentations);

  return (
    <div className="library">
      <header className="library-header">
        <h2>Library</h2>
        <span className="hint">Double-click to start the slideshow</span>
      </header>
      {groups.map((g) => (
        <section key={g.folder || '__nofolder__'} className="library-group">
          <header className="library-group-header">
            <span className="library-group-name">{g.label}</span>
            <span className="hint" title={g.folder}>
              {g.presentations.length} item{g.presentations.length === 1 ? '' : 's'}
              {g.folder && ` · ${g.folder}`}
            </span>
          </header>
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
        </section>
      ))}
    </div>
  );
}

/**
 * Bucket presentations by the folder they were imported from. A presentation
 * with no `watchPath` (came in via sync from a peer, or imported via the file
 * picker without a watched root) goes into a "Synced / imported" group.
 *
 * Within each group, presentations stay sorted by updatedAt desc — matches
 * the original ungrouped behaviour. Groups themselves are ordered by the
 * most-recent updatedAt of anything inside, so wherever you're actively
 * editing floats to the top.
 */
function groupByFolder(presentations: Presentation[]): FolderGroup[] {
  const map = new Map<string, FolderGroup>();
  for (const p of presentations) {
    const folder = p.watchPath ? parentDir(p.watchPath) : '';
    let group = map.get(folder);
    if (!group) {
      group = {
        folder,
        label: folder ? basename(folder) : 'Synced / imported',
        presentations: [],
        mostRecent: p.updatedAt,
      };
      map.set(folder, group);
    }
    group.presentations.push(p);
    if (p.updatedAt > group.mostRecent) group.mostRecent = p.updatedAt;
  }
  for (const g of map.values()) {
    g.presentations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return [...map.values()].sort((a, b) => b.mostRecent.localeCompare(a.mostRecent));
}

/** Cross-platform path parent. We can't use Node's `path` from the renderer. */
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
