import { WebSocket } from 'ws';
import type { Peer, SyncOffer } from '@shared/types';
import { Library } from './library';
import { Server, trySend } from './server';
import { Discovery } from './discovery';
import { getSettings } from './settings';

/**
 * Sync. For each newly-discovered peer, opens a WebSocket, exchanges
 * offers, and pulls any presentation versions we don't already have.
 */
export class Sync {
  private connections = new Map<string, WebSocket>();
  private incomingExpected = new Map<string, { title: string; kind: string; sourcePeer: string }>();

  constructor(private library: Library, private server: Server, private discovery: Discovery) {}

  start(): void {
    this.discovery.on('peers', (peers: Peer[]) => this.reconcile(peers));
    this.server.on('sync-offer', (offers: SyncOffer[], ws: WebSocket) => this.handleOffers(offers, ws));
  }

  stop(): void {
    for (const ws of this.connections.values()) { try { ws.close(); } catch {} }
    this.connections.clear();
  }

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
