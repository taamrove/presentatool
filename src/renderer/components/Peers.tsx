import React from 'react';
import type { Peer } from '../../shared/types';

export function Peers({ peers }: { peers: Peer[] }): JSX.Element {
  return (
    <div className="peers">
      <h2>Peers on the network</h2>
      <p className="hint">
        Other Presentool installs on the same LAN show up here. When auto-sync is on, new
        presentation versions are pulled in automatically.
      </p>
      {peers.length === 0 ? (
        <div className="empty">No peers discovered yet.</div>
      ) : (
        <ul className="peer-list">
          {peers.map((p) => (
            <li key={p.id}>
              <div className="peer-name">{p.name}</div>
              <div className="peer-meta">{p.host}:{p.port} · {p.platform} · {p.presentationCount} presentations</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
