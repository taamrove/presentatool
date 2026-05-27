import React from 'react';
import type { Presentation } from '../../shared/types';

interface Props {
  presentation: Presentation;
  onChange: () => void;
}

export function Versions({ presentation }: Props): JSX.Element {
  return (
    <div className="versions">
      <h2>{presentation.title} — versions</h2>
      <p className="hint">
        Every time the source file changes on disk, or a peer syncs a new copy, a snapshot lands
        here. Each row is the full, immutable file at that point in time.
      </p>
      {presentation.versions.length === 0 ? (
        <div className="empty">No versions stored yet.</div>
      ) : (
        <table className="versions-table">
          <thead>
            <tr>
              <th>Captured</th>
              <th>Origin</th>
              <th>Size</th>
              <th>Hash</th>
            </tr>
          </thead>
          <tbody>
            {presentation.versions.map((v, idx) => (
              <tr key={v.id} className={idx === 0 ? 'current' : ''}>
                <td>
                  <div>{new Date(v.storedAt).toLocaleString()}</div>
                  {idx === 0 && <span className="badge">current</span>}
                </td>
                <td>
                  {v.origin === 'sync' ? `synced from ${v.sourcePeer ?? 'peer'}` : v.origin}
                </td>
                <td>{formatBytes(v.size)}</td>
                <td><code>{v.id}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
