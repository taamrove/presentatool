import React, { useState } from 'react';
import type { PairingToken } from '../../shared/types';

export function RemotePair(): JSX.Element {
  const [pair, setPair] = useState<PairingToken | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate(): Promise<void> {
    setLoading(true);
    try {
      const token = await window.presentatool.pairRemote();
      setPair(token);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="remote">
      <h2>Pair a remote clicker</h2>
      <p className="hint">
        Generate a one-time link, then scan the QR code with a phone on the same Wi-Fi network.
        The phone will open the Presentatool companion page and become a remote.
      </p>
      {!pair ? (
        <button className="primary" disabled={loading} onClick={generate}>
          {loading ? 'Generating…' : 'Generate pairing code'}
        </button>
      ) : (
        <div className="pair-card">
          <img src={pair.qrDataUrl} alt="Pairing QR code" />
          <div className="pair-meta">
            <div>
              <div className="label">URL</div>
              <code className="url">{pair.url}</code>
            </div>
            <div>
              <div className="label">Expires</div>
              <div>{new Date(pair.expiresAt).toLocaleTimeString()}</div>
            </div>
            <button onClick={generate}>New code</button>
          </div>
        </div>
      )}
    </div>
  );
}
