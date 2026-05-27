import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';
import QRCode from 'qrcode';
import { getSettings, getPeerId } from './settings';
import { localAddresses } from './discovery';
import type { ClickerCommand, PairingToken, WireMessage, Peer, SyncOffer } from '@shared/types';

export interface ServerOptions {
  /** Absolute path of the built companion static assets. */
  companionDir: string;
  /** Called when a remote sends a clicker command. */
  onClick: (cmd: ClickerCommand) => void;
  /** Called when a remote asks to switch presentations. */
  onSelect: (presentationId: string) => void;
  /** Snapshot the library, used in welcome messages and sync offers. */
  presentationsForRemote: () => { id: string; title: string; kind: string; latestVersionId: string; updatedAt: string }[];
  /** Sync offer list (one entry per latest version). */
  syncOffers: () => SyncOffer[];
  /** Stream the bytes of a stored version (used to satisfy sync-request). */
  readVersion: (presentationId: string, versionId: string) => Buffer | null;
  /** Hook to apply an incoming sync transfer. */
  onSyncChunks: (presentationId: string, versionId: string, title: string, kind: string, sourcePeer: string, full: Buffer) => Promise<void>;
}

export class Server extends EventEmitter {
  private http: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private tokens = new Map<string, number>(); // token -> expiry
  private remotes = new Set<WebSocket>();
  private inFlight = new Map<string, { chunks: Buffer[]; expected: number; title: string; kind: string; sourcePeer: string }>();

  constructor(private opts: ServerOptions) { super(); }

  start(): void {
    const settings = getSettings();
    this.http = http.createServer((req, res) => this.handleHttp(req, res));
    this.wss = new WebSocketServer({ server: this.http, path: '/ws' });
    this.wss.on('connection', (ws, req) => this.handleSocket(ws, req));
    this.http.listen(settings.network.port, () => {
      console.log(`[server] listening on :${settings.network.port}`);
    });
  }

  stop(): void {
    this.wss?.close();
    this.http?.close();
    this.http = null;
    this.wss = null;
    this.remotes.clear();
    this.tokens.clear();
  }

  /** Broadcast a slide-change to all connected remotes. */
  broadcastSlide(info: { index: number; total: number; title?: string; notes?: string; nextTitle?: string }, presentationId?: string): void {
    const msg: WireMessage = { kind: 'slide', info, presentationId };
    for (const ws of this.remotes) trySend(ws, msg);
  }

  /** Push an updated presentation list to all remotes. */
  broadcastPresentations(): void {
    const msg: WireMessage = { kind: 'presentations', list: this.opts.presentationsForRemote() as any };
    for (const ws of this.remotes) trySend(ws, msg);
  }

  /** Build a fresh single-use pairing token + companion URL + QR code. */
  async createPairingToken(): Promise<PairingToken> {
    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + 5 * 60 * 1000;
    this.tokens.set(token, expiresAt);
    const addrs = localAddresses();
    const host = addrs[0] ?? '127.0.0.1';
    const port = getSettings().network.port;
    const url = `http://${host}:${port}/?token=${token}`;
    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320 });
    return { token, expiresAt, url, qrDataUrl };
  }

  /** Open an outbound peer connection (used by Sync). */
  connectPeer(peer: Peer): WebSocket {
    const ws = new WebSocket(`ws://${peer.host}:${peer.port}/ws`);
    ws.on('open', () => {
      const hello: WireMessage = {
        kind: 'hello',
        role: 'peer',
        peer: {
          id: getPeerId(),
          name: getSettings().deviceName,
          host: '',
          port: getSettings().network.port,
          platform: process.platform as any,
          version: '0.1.0',
          presentationCount: this.opts.presentationsForRemote().length,
        },
      };
      trySend(ws, hello);
      const offer: WireMessage = { kind: 'sync-offer', presentations: this.opts.syncOffers() };
      trySend(ws, offer);
    });
    ws.on('message', (raw) => this.handleMessage(ws, raw));
    return ws;
  }

  // ----------------- HTTP -----------------

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, peerId: getPeerId() }));
      return;
    }
    // Serve the companion static bundle.
    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = path.normalize(path.join(this.opts.companionDir, rel));
    if (!filePath.startsWith(this.opts.companionDir)) { res.writeHead(403).end(); return; }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': contentType(filePath) });
      res.end(data);
    });
  }

  // ----------------- WS -----------------

  private handleSocket(ws: WebSocket, _req: http.IncomingMessage): void {
    let role: 'companion' | 'peer' | null = null;
    ws.on('message', (raw) => this.handleMessage(ws, raw, (r) => { role = r; }));
    ws.on('close', () => { this.remotes.delete(ws); void role; });
  }

  private async handleMessage(ws: WebSocket, raw: import('ws').RawData, setRole?: (r: 'companion' | 'peer') => void): Promise<void> {
    let msg: WireMessage;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    switch (msg.kind) {
      case 'hello': {
        if (msg.role === 'companion') {
          const ok = msg.token && this.tokens.has(msg.token) && (this.tokens.get(msg.token)! > Date.now());
          if (!ok) { trySend(ws, { kind: 'error', message: 'invalid or expired pairing token' }); ws.close(); return; }
          this.tokens.delete(msg.token!);
          setRole?.('companion');
          this.remotes.add(ws);
          const welcome: WireMessage = {
            kind: 'welcome',
            peer: {
              id: getPeerId(),
              name: getSettings().deviceName,
              host: '',
              port: getSettings().network.port,
              platform: process.platform as any,
              version: '0.1.0',
              presentationCount: this.opts.presentationsForRemote().length,
            },
          };
          trySend(ws, welcome);
          trySend(ws, { kind: 'presentations', list: this.opts.presentationsForRemote() as any });
        } else if (msg.role === 'peer') {
          setRole?.('peer');
          this.emit('peer-hello', msg.peer);
          // Reciprocate with our own offer so syncs flow both ways.
          const offer: WireMessage = { kind: 'sync-offer', presentations: this.opts.syncOffers() };
          trySend(ws, offer);
        }
        return;
      }
      case 'click':
        this.opts.onClick(msg.command);
        return;
      case 'select':
        this.opts.onSelect(msg.presentationId);
        return;
      case 'sync-offer':
        this.emit('sync-offer', msg.presentations, ws);
        return;
      case 'sync-request': {
        const data = this.opts.readVersion(msg.presentationId, msg.versionId);
        if (!data) { trySend(ws, { kind: 'error', message: 'unknown version' }); return; }
        const chunkSize = 256 * 1024;
        const total = Math.ceil(data.length / chunkSize);
        for (let i = 0; i < total; i++) {
          const slice = data.subarray(i * chunkSize, Math.min(data.length, (i + 1) * chunkSize));
          trySend(ws, {
            kind: 'sync-chunk',
            presentationId: msg.presentationId,
            versionId: msg.versionId,
            index: i,
            total,
            data: slice.toString('base64'),
          });
        }
        trySend(ws, { kind: 'sync-done', presentationId: msg.presentationId, versionId: msg.versionId });
        return;
      }
      case 'sync-chunk': {
        const key = `${msg.presentationId}:${msg.versionId}`;
        const entry = this.inFlight.get(key) ?? { chunks: [], expected: msg.total, title: '', kind: '', sourcePeer: '' };
        entry.chunks[msg.index] = Buffer.from(msg.data, 'base64');
        entry.expected = msg.total;
        this.inFlight.set(key, entry);
        return;
      }
      case 'sync-done': {
        const key = `${msg.presentationId}:${msg.versionId}`;
        const entry = this.inFlight.get(key);
        if (!entry) return;
        const full = Buffer.concat(entry.chunks);
        this.inFlight.delete(key);
        await this.opts.onSyncChunks(msg.presentationId, msg.versionId, entry.title, entry.kind, entry.sourcePeer, full);
        return;
      }
      case 'ping':
        trySend(ws, { kind: 'pong' });
        return;
      default:
        return;
    }
  }

  /** Used by Sync when issuing a request to a peer, lets us label the chunks. */
  primeIncoming(presentationId: string, versionId: string, title: string, kind: string, sourcePeer: string, expected: number): void {
    this.inFlight.set(`${presentationId}:${versionId}`, { chunks: [], expected, title, kind, sourcePeer });
  }
}

export function trySend(ws: WebSocket, msg: WireMessage): void {
  if (ws.readyState !== ws.OPEN) return;
  try { ws.send(JSON.stringify(msg)); } catch {}
}

function contentType(file: string): string {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.png': return 'image/png';
    case '.svg': return 'image/svg+xml';
    case '.woff2': return 'font/woff2';
    default: return 'application/octet-stream';
  }
}
