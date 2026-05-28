import { WebSocket } from 'ws';
import { app } from 'electron';
import type { Peer, SyncOffer } from '@shared/types';
import { Library } from './library';
import { Server, trySend } from './server';
import { Discovery } from './discovery';
import { getSettings } from './settings';

/**
 * Sync. For each newly-discovered peer, opens a WebSocket, exchanges
 * offers, and pulls any presentation versions we don't already have.
 *
 * Discovery happens two ways:
 *  - mDNS via the Discovery class (zero-config, but flaky when the network
 *    blocks multicast — Windows Defender Firewall in particular tends to
 *    drop inbound mDNS queries unless you allow it).
 *  - Static peers from settings (`network.staticPeers`) — explicit host
 *    entries that bypass mDNS. Keep one connection per entry, retry on
 *    disconnect.
 */
export class Sync {
  private connections = new Map<string, WebSocket>();
  private incomingExpected = new Map<string, { title: string; kind: string; sourcePeer: string }>();
  /** Pending reconnect timers for static peers, keyed by `host:port`. */
  private staticTimers = new Map<string, NodeJS.Timeout>();
  private stopped = false;

  constructor(private library: Library, private server: Server, private discovery: Discovery) {}

  start(): void {
    this.stopped = false;
    this.discovery.on('peers', (peers: Peer[]) => this.reconcile(peers));
    this.server.on('sync-offer', (offers: SyncOffer[], ws: WebSocket) => this.handleOffers(offers, ws));
    this.startStaticPeers();
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.staticTimers.values()) clearTimeout(t);
    this.staticTimers.clear();
    for (const ws of this.connections.values()) { try { ws.close(); } catch { /* noop */ } }
    this.connections.clear();
  }

  /** Re-read the static peer list from settings and reconnect everything. */
  refreshStaticPeers(): void {
    for (const t of this.staticTimers.values()) clearTimeout(t);
    this.staticTimers.clear();
    // Close any current static connections; they'll reopen via startStaticPeers.
    for (const [key, ws] of this.connections) {
      if (key.startsWith('static:')) { try { ws.close(); } catch { /* noop */ } this.connections.delete(key); }
    }
    this.startStaticPeers();
  }

  // ----------------- mDNS-discovered peers -----------------

  private reconcile(peers: Peer[]): void {
    if (!getSettings().autoSync) return;
    for (const p of peers) {
      if (this.connections.has(p.id)) continue;
      try {
        const ws = this.server.connectPeer(p);
        this.connections.set(p.id, ws);
        ws.on('close', () => this.connections.delete(p.id));
        ws.on('error', () => this.connections.delete(p.id));
      } catch (err) {
        console.warn('[sync] failed to connect to peer', p.name, err);
      }
    }
  }

  // ----------------- Static peers -----------------

  private startStaticPeers(): void {
    const list = getSettings().network.staticPeers ?? [];
    for (const raw of list) {
      const entry = raw.trim();
      if (entry) this.connectStatic(entry);
    }
  }

  private connectStatic(entry: string): void {
    if (this.stopped) return;
    const [host, portStr] = entry.split(':');
    const port = Number(portStr) || 4711;
    const key = `static:${host}:${port}`;
    if (this.connections.has(key)) return;
    // Synthesise a Peer so the existing server.connectPeer() machinery just
    // works. The id is the host:port — we don't know the real peerId until
    // after the welcome handshake, and it's not needed for routing.
    const fake: Peer = {
      id: key,
      name: `${host}:${port}`,
      host,
      port,
      platform: 'linux',
      version: app.getVersion(),
      presentationCount: 0,
      lastSeen: Date.now(),
    };
    let ws: WebSocket;
    try {
      ws = this.server.connectPeer(fake);
    } catch (err) {
      console.warn('[sync] static peer connect failed', entry, err);
      this.scheduleStaticRetry(entry, 10_000);
      return;
    }
    this.connections.set(key, ws);
    ws.on('close', () => {
      this.connections.delete(key);
      // Reconnect with a modest backoff so a powered-off peer doesn't spin us.
      this.scheduleStaticRetry(entry, 5_000);
    });
    ws.on('error', () => { /* close handler runs after */ });
  }

  private scheduleStaticRetry(entry: string, delayMs: number): void {
    if (this.stopped) return;
    const key = `retry:${entry}`;
    if (this.staticTimers.has(key)) return;
    const timer = setTimeout(() => {
      this.staticTimers.delete(key);
      this.connectStatic(entry);
    }, delayMs);
    this.staticTimers.set(key, timer);
  }

  // ----------------- Incoming offers -----------------

  private handleOffers(offers: SyncOffer[], ws: WebSocket): void {
    for (const offer of offers) {
      const existing = this.library.get(offer.presentationId);
      const haveVersion = existing?.versions.some((v) => v.id === offer.versionId);
      if (haveVersion) continue;
      // Prime the server's incoming buffer so chunks land in the right slot.
      this.server.primeIncoming(offer.presentationId, offer.versionId, offer.title, offer.kind, 'remote-peer', 0);
      this.incomingExpected.set(`${offer.presentationId}:${offer.versionId}`, {
        title: offer.title, kind: offer.kind, sourcePeer: 'remote-peer',
      });
      trySend(ws, { kind: 'sync-request', presentationId: offer.presentationId, versionId: offer.versionId });
    }
  }
}
