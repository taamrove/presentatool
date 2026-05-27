// Shared types used by main, renderer, and companion.

export type Platform = 'win32' | 'darwin' | 'linux';

export type PresentationKind = 'pptx' | 'ppt' | 'key' | 'pdf' | 'odp' | 'unknown';

export interface PresentationVersion {
  id: string;          // content hash
  storedAt: string;    // ISO timestamp
  size: number;
  origin: 'local' | 'sync' | 'import';
  sourcePeer?: string; // peer id if origin === 'sync'
  note?: string;
}

export interface Presentation {
  id: string;                // stable id (uuid v4)
  title: string;
  kind: PresentationKind;
  currentPath: string;       // path to the latest copy on disk
  watchPath?: string;        // path being watched for changes (the original source)
  versions: PresentationVersion[];
  tags: string[];
  updatedAt: string;
  createdAt: string;
}

export interface SlideInfo {
  index: number;             // 1-based
  total: number;
  title?: string;
  notes?: string;
  nextTitle?: string;
}

export type ClickerCommand =
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'first' }
  | { type: 'last' }
  | { type: 'blank' }
  | { type: 'goto'; index: number }
  | { type: 'start' }
  | { type: 'end' };

export interface Peer {
  id: string;
  name: string;
  host: string;
  port: number;
  platform: Platform;
  version: string;
  presentationCount: number;
  lastSeen: number;
}

export interface PairingToken {
  token: string;
  expiresAt: number;         // epoch ms
  url: string;               // companion URL with token
  qrDataUrl: string;         // PNG data url
}

// Messages exchanged over the WebSocket between the desktop and any
// remote (companion app, peer desktop, or cloud relay).
export type WireMessage =
  | { kind: 'hello'; role: 'companion' | 'peer'; token?: string; peer?: Omit<Peer, 'lastSeen'> }
  | { kind: 'welcome'; peer: Omit<Peer, 'lastSeen'>; current?: SlideInfo; presentation?: { id: string; title: string } }
  | { kind: 'click'; command: ClickerCommand }
  | { kind: 'slide'; info: SlideInfo; presentationId?: string }
  | { kind: 'presentations'; list: PresentationSummary[] }
  | { kind: 'select'; presentationId: string }
  | { kind: 'sync-offer'; presentations: SyncOffer[] }
  | { kind: 'sync-request'; presentationId: string; versionId: string }
  | { kind: 'sync-chunk'; presentationId: string; versionId: string; index: number; total: number; data: string }
  | { kind: 'sync-done'; presentationId: string; versionId: string }
  | { kind: 'ping' }
  | { kind: 'pong' }
  | { kind: 'error'; message: string };

export interface PresentationSummary {
  id: string;
  title: string;
  kind: PresentationKind;
  latestVersionId: string;
  updatedAt: string;
}

export interface SyncOffer {
  presentationId: string;
  title: string;
  versionId: string;
  size: number;
  kind: PresentationKind;
}

export interface AppSettings {
  libraryPaths: string[];
  deviceName: string;
  hotkeys: {
    next: string;
    prev: string;
    blank: string;
    quickSwitch: string;
  };
  network: {
    port: number;
    enableMdns: boolean;
    enableRelay: boolean;
    relayUrl?: string;          // wss://... when user wires up a domain
    relayToken?: string;
  };
  autoSync: boolean;
}
