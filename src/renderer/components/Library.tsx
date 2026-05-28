import React from 'react';
import type { Presentation } from '../../shared/types';

interface Props {
  presentations: Presentation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (p: Presentation) => void;
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
  return (
    <div className="library">
      <header className="library-header">
        <h2>Library</h2>
        <span className="hint">Double-click to start the slideshow</span>
      </header>
      <ul className="cards">
        {presentations.map((p) => (
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
    </div>
  );
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
