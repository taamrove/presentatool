import React, { useEffect, useMemo, useState } from 'react';
import type { Presentation, SlideInfo, Peer, AppSettings } from '../shared/types';
import { Library } from './components/Library';
import { Clicker } from './components/Clicker';
import { Versions } from './components/Versions';
import { Peers } from './components/Peers';
import { RemotePair } from './components/RemotePair';
import { QuickSwitch } from './components/QuickSwitch';
import { Notes } from './components/Notes';
import { SettingsPanel } from './components/SettingsPanel';

type Tab = 'library' | 'clicker' | 'versions' | 'peers' | 'remote' | 'settings';

export function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('library');
  const [presentations, setPresentations] = useState<Presentation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [slide, setSlide] = useState<SlideInfo | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);

  const selected = useMemo(
    () => presentations.find((p) => p.id === selectedId) ?? null,
    [presentations, selectedId],
  );

  async function refreshLibrary(): Promise<void> {
    const list = await window.presentatool.listPresentations();
    setPresentations(list);
    if (!selectedId && list.length > 0) setSelectedId(list[0].id);
  }

  async function refreshPeers(): Promise<void> {
    setPeers(await window.presentatool.peers());
  }

  useEffect(() => {
    refreshLibrary();
    refreshPeers();
    window.presentatool.settings().then(setSettings);
    const offSlide = window.presentatool.onSlide(setSlide);
    const offQuick = window.presentatool.onQuickSwitch(() => setQuickOpen(true));
    const offPeers = window.presentatool.onPeersUpdate(refreshPeers);
    const t = setInterval(refreshLibrary, 4000);
    return () => { offSlide(); offQuick(); offPeers(); clearInterval(t); };
  }, []);

  async function importFiles(): Promise<void> {
    await window.presentatool.importDialog();
    await refreshLibrary();
  }

  async function openPresentation(p: Presentation): Promise<void> {
    setSelectedId(p.id);
    await window.presentatool.open(p.id);
    setTab('clicker');
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="dot" />
          <span>Presentatool</span>
        </div>
        <nav>
          <NavButton active={tab === 'library'}    onClick={() => setTab('library')}>Library</NavButton>
          <NavButton active={tab === 'clicker'}    onClick={() => setTab('clicker')}>Clicker</NavButton>
          <NavButton active={tab === 'versions'}   onClick={() => setTab('versions')}>Versions</NavButton>
          <NavButton active={tab === 'remote'}     onClick={() => setTab('remote')}>Remote</NavButton>
          <NavButton active={tab === 'peers'}      onClick={() => setTab('peers')}>Peers</NavButton>
          <NavButton active={tab === 'settings'}   onClick={() => setTab('settings')}>Settings</NavButton>
        </nav>
        <button className="primary" onClick={importFiles}>+ Add presentations</button>
        <div className="footer">
          {selected && (
            <div className="current">
              <div className="label">Selected</div>
              <div className="title">{selected.title}</div>
              <div className="meta">{selected.kind.toUpperCase()} · {selected.versions.length} versions</div>
            </div>
          )}
        </div>
      </aside>
      <main className="main">
        {tab === 'library' && (
          <Library
            presentations={presentations}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onOpen={openPresentation}
          />
        )}
        {tab === 'clicker' && (
          <Clicker presentation={selected} slide={slide} />
        )}
        {tab === 'versions' && selected && (
          <Versions presentation={selected} onChange={refreshLibrary} />
        )}
        {tab === 'remote' && (
          <RemotePair />
        )}
        {tab === 'peers' && (
          <Peers peers={peers} />
        )}
        {tab === 'settings' && settings && (
          <SettingsPanel settings={settings} onChange={setSettings} />
        )}
        {tab === 'clicker' && selected && (
          <Notes presentation={selected} slide={slide} />
        )}
      </main>
      {quickOpen && (
        <QuickSwitch
          presentations={presentations}
          onClose={() => setQuickOpen(false)}
          onPick={(p) => { setQuickOpen(false); openPresentation(p); }}
        />
      )}
    </div>
  );
}

function NavButton(props: { active: boolean; onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button className={`nav${props.active ? ' active' : ''}`} onClick={props.onClick}>
      {props.children}
    </button>
  );
}
