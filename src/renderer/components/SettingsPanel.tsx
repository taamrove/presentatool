import React, { useState } from 'react';
import type { AppSettings } from '../../shared/types';

export function SettingsPanel({ settings, onChange }: { settings: AppSettings; onChange: (s: AppSettings) => void }): JSX.Element {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const next = await window.presentool.saveSettings(draft);
      onChange(next);
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings">
      <h2>Settings</h2>
      <section>
        <h3>Device</h3>
        <label>
          Device name
          <input value={draft.deviceName} onChange={(e) => setDraft({ ...draft, deviceName: e.target.value })} />
        </label>
      </section>
      <section>
        <h3>Library paths</h3>
        <p className="hint">Folders scanned for presentations. Add one per line.</p>
        <textarea
          rows={5}
          value={draft.libraryPaths.join('\n')}
          onChange={(e) => setDraft({ ...draft, libraryPaths: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
        />
      </section>
      <section>
        <h3>Hotkeys</h3>
        {(['next', 'prev', 'blank', 'quickSwitch'] as const).map((k) => (
          <label key={k}>
            {k}
            <input
              value={draft.hotkeys[k]}
              onChange={(e) => setDraft({ ...draft, hotkeys: { ...draft.hotkeys, [k]: e.target.value } })}
            />
          </label>
        ))}
      </section>
      <section>
        <h3>Network</h3>
        <label>
          Port
          <input
            type="number"
            value={draft.network.port}
            onChange={(e) => setDraft({ ...draft, network: { ...draft.network, port: Number(e.target.value) } })}
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={draft.network.enableMdns}
            onChange={(e) => setDraft({ ...draft, network: { ...draft.network, enableMdns: e.target.checked } })}
          />
          Advertise via mDNS (LAN discovery)
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={draft.network.enableRelay}
            onChange={(e) => setDraft({ ...draft, network: { ...draft.network, enableRelay: e.target.checked } })}
          />
          Connect to a cloud relay (use when remotes are on a different network)
        </label>
        <label>
          Relay URL (wss://…)
          <input
            value={draft.network.relayUrl ?? ''}
            placeholder="wss://relay.example.com/ws"
            onChange={(e) => setDraft({ ...draft, network: { ...draft.network, relayUrl: e.target.value || undefined } })}
          />
        </label>
        <label>
          Relay token
          <input
            value={draft.network.relayToken ?? ''}
            onChange={(e) => setDraft({ ...draft, network: { ...draft.network, relayToken: e.target.value || undefined } })}
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={draft.autoSync}
            onChange={(e) => setDraft({ ...draft, autoSync: e.target.checked })}
          />
          Auto-sync new presentations from peers
        </label>
      </section>
      <section>
        <h3>Bitfocus Companion / API token</h3>
        <p className="hint">
          Paste this token into the Presentool module in Bitfocus Companion to drive slides from a
          Stream Deck or any Companion-supported controller. Treat it like a password.
        </p>
        <label>
          API token
          <input
            value={draft.network.apiToken ?? ''}
            placeholder="(none generated)"
            readOnly
          />
        </label>
        <button onClick={async () => {
          const token = await window.presentool.generateApiToken();
          setDraft({ ...draft, network: { ...draft.network, apiToken: token } });
        }}>Generate new token</button>
      </section>
      <div className="actions">
        <button className="primary" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {savedAt && <span className="saved">Saved {new Date(savedAt).toLocaleTimeString()}</span>}
      </div>
    </div>
  );
}
