import React, { useEffect, useState } from 'react';
import type { AppSettings } from '../../shared/types';

export function SettingsPanel({ settings, onChange }: { settings: AppSettings; onChange: (s: AppSettings) => void }): JSX.Element {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [updaterStatus, setUpdaterStatus] = useState<string>('idle');
  const [updaterChecking, setUpdaterChecking] = useState(false);
  const [updaterPercent, setUpdaterPercent] = useState<number | null>(null);
  /** Version that's been fully downloaded and is ready to install. */
  const [updaterReadyVersion, setUpdaterReadyVersion] = useState<string | null>(null);
  const [updaterError, setUpdaterError] = useState<string | null>(null);

  // Subscribe to background updater pings so the UI reflects state changes
  // that didn't originate from the Check button (downloads finishing, etc.).
  useEffect(() => {
    const offStatus = window.presentatool.onUpdaterStatus((s) => {
      if (s.state === 'error') {
        setUpdaterError(s.error ?? 'unknown error');
        setUpdaterStatus('error');
        setUpdaterPercent(null);
      } else if (s.state === 'downloading') {
        setUpdaterStatus(`downloading ${s.version ?? ''}`.trim());
        setUpdaterError(null);
      } else if (s.state === 'ready') {
        setUpdaterStatus(`ready to install → ${s.version}`);
        setUpdaterReadyVersion(s.version ?? null);
        setUpdaterPercent(100);
        setUpdaterError(null);
      } else if (s.state === 'up-to-date') {
        setUpdaterStatus('up to date');
        setUpdaterPercent(null);
        setUpdaterError(null);
      } else {
        setUpdaterStatus(s.version ? `${s.state} → ${s.version}` : s.state);
      }
    });
    const offProgress = window.presentatool.onUpdaterProgress((p) => {
      setUpdaterPercent(Math.round(p.percent));
    });
    return () => { offStatus(); offProgress(); };
  }, []);

  async function checkForUpdates(): Promise<void> {
    setUpdaterChecking(true);
    setUpdaterError(null);
    try {
      const res = await window.presentatool.checkForUpdates();
      if (res.state === 'error') {
        setUpdaterError(res.error ?? 'unknown error');
        setUpdaterStatus('error');
      } else if (res.state === 'up-to-date') {
        setUpdaterStatus(`up to date (${res.version})`);
        setUpdaterPercent(null);
      } else if (res.state === 'available') {
        // electron-updater's autoDownload kicks off immediately; the
        // 'downloading' / progress / 'ready' status pings will roll in
        // from the IPC subscriptions above as the bytes flow.
        setUpdaterStatus(`update available → ${res.version} (downloading…)`);
        setUpdaterPercent(0);
      } else if (res.state === 'checked') {
        setUpdaterStatus(`checked (${res.version})`);
      } else if (res.state === 'dev') {
        setUpdaterStatus('dev build — auto-update disabled');
      } else {
        setUpdaterStatus(res.state);
      }
    } finally {
      setUpdaterChecking(false);
    }
  }

  async function installNow(): Promise<void> {
    await window.presentatool.applyUpdate();
  }

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const next = await window.presentatool.saveSettings(draft);
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
        <h3>Library folders</h3>
        <p className="hint">
          Each folder is watched live — drop in a <code>.pptx / .key / .pdf</code> and it
          shows up in the Library. Works the same for local folders, Dropbox, OneDrive,
          and iCloud Drive — pick the folder where the cloud client syncs files to
          your machine.
        </p>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {draft.libraryPaths.length === 0 && (
            <li className="hint">No folders yet. Click below to add one.</li>
          )}
          {draft.libraryPaths.map((p) => (
            <li key={p} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
              <code style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p}>{p}</code>
              <button
                onClick={async () => {
                  const next = await window.presentatool.removeLibraryFolder(p);
                  setDraft(next);
                  onChange(next);
                }}
              >Remove</button>
            </li>
          ))}
        </ul>
        <button
          style={{ marginTop: 8 }}
          onClick={async () => {
            const next = await window.presentatool.addLibraryFolderDialog();
            setDraft(next);
            onChange(next);
          }}
        >+ Add folder…</button>
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
        {/* Windows-only firewall control. Hidden on Mac/Linux. */}
        {(navigator.platform || '').toLowerCase().includes('win') && (
          <>
            <h4>Windows Firewall</h4>
            <p className="hint">
              Status: <code>{draft.network.firewallPromptStatus ?? 'not yet asked'}</code>.
              If your other devices can't see this machine on the LAN, allow Presentatool
              through Windows Firewall — a one-time UAC prompt that adds an inbound rule
              for Presentatool.exe on Private + Domain networks.
            </p>
            <button onClick={async () => {
              const res = await window.presentatool.installFirewallRule();
              if (res.ok && res.status) {
                setDraft({ ...draft, network: { ...draft.network, firewallPromptStatus: res.status as never } });
              }
            }}>Allow through firewall…</button>
          </>
        )}
        <h4>Static peers</h4>
        <p className="hint">
          One peer per line as <code>host</code> or <code>host:port</code> (port defaults to 4711).
          Use this when mDNS isn't reaching a machine — most often because Windows Defender
          Firewall is dropping inbound multicast, or when peers are on different subnets / VLANs.
          Entries are tried in addition to whatever mDNS finds.
        </p>
        <textarea
          rows={3}
          placeholder={'192.168.1.216\nlaptop.lan:4711'}
          value={(draft.network.staticPeers ?? []).join('\n')}
          onChange={(e) => setDraft({
            ...draft,
            network: {
              ...draft.network,
              staticPeers: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
            },
          })}
        />
      </section>
      <section>
        <h3>Bitfocus Companion / API token</h3>
        <p className="hint">
          On the same LAN as the controller (Stream Deck, scripts, etc.) you don't need an API
          token — Presentatool trusts controller connections from private network addresses by
          default. Turn that off below if you'd rather require a token everywhere, or generate
          one for off-LAN / cloud-relay use.
        </p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={draft.network.trustLanControllers !== false}
            onChange={(e) => setDraft({ ...draft, network: { ...draft.network, trustLanControllers: e.target.checked } })}
          />
          Trust controllers connecting from the LAN (no token required)
        </label>
        <label>
          API token
          <input
            value={draft.network.apiToken ?? ''}
            placeholder="(none generated)"
            readOnly
          />
        </label>
        <button onClick={async () => {
          const token = await window.presentatool.generateApiToken();
          setDraft({ ...draft, network: { ...draft.network, apiToken: token } });
        }}>Generate new token</button>
      </section>
      <section>
        <h3>Updates</h3>
        <p className="hint">
          Auto-checks every 5 minutes while open. On Windows, downloads run in
          the background and an installer launches when you click "Restart &
          install" below. On macOS (unsigned builds), an "open download page"
          dialog appears instead — install requires a signed DMG.
        </p>
        <p>
          Status: <code>{updaterStatus}</code>
          {updaterPercent != null && updaterReadyVersion == null && (
            <> &nbsp;·&nbsp; <strong>{updaterPercent}%</strong></>
          )}
        </p>
        {updaterError && (
          <p className="hint" style={{ color: '#ff6b6b' }}>
            Error: <code>{updaterError}</code>
          </p>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={updaterChecking} onClick={checkForUpdates}>
            {updaterChecking ? 'Checking…' : 'Check for updates now'}
          </button>
          {updaterReadyVersion && (
            <button className="primary" onClick={installNow}>
              Restart &amp; install {updaterReadyVersion}
            </button>
          )}
        </div>
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
