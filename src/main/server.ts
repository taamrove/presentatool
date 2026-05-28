import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
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

  /** Port we actually ended up bound to (may differ from settings if there was a conflict). */
  boundPort: number | null = null;

  start(): void {
    const settings = getSettings();
    this.http = http.createServer((req, res) => this.handleHttp(req, res));
    this.wss = new WebSocketServer({ server: this.http, path: '/ws' });
    this.wss.on('connection', (ws, req) => this.handleSocket(ws, req));

    // If the configured port is in use, fall back to an OS-assigned ephemeral
    // port rather than crashing the whole app (EADDRINUSE used to bubble up
    // as an uncaught exception and kill the main process on Windows).
    const tryListen = (port: number, attempt = 0): void => {
      const onError = (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attempt < 1) {
          console.warn(`[server] port ${port} in use, falling back to an ephemeral port`);
          this.http?.removeListener('error', onError);
          // Re-create the server: a failed-to-bind http.Server can't be re-listened reliably.
          this.http?.close();
          this.http = http.createServer((req, res) => this.handleHttp(req, res));
          this.wss = new WebSocketServer({ server: this.http, path: '/ws' });
          this.wss.on('connection', (ws, req) => this.handleSocket(ws, req));
          tryListen(0, attempt + 1);
          return;
        }
        console.error('[server] failed to start', err);
        this.emit('listen-error', err);
      };
      this.http!.once('error', onError);
      this.http!.listen(port, () => {
        const addr = this.http!.address();
        this.boundPort = typeof addr === 'object' && addr ? addr.port : port;
        console.log(`[server] listening on :${this.boundPort}`);
        this.http!.removeListener('error', onError);
        this.emit('listening', this.boundPort);
      });
    };
    tryListen(settings.network.port);
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
    const port = this.boundPort ?? getSettings().network.port;
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
          version: app.getVersion(),
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

  private handleSocket(ws: WebSocket, req: http.IncomingMessage): void {
    let role: 'companion' | 'peer' | null = null;
    // Stash the remote address so the hello handler can decide whether the
    // client is on the local LAN (trusted) or coming from outside (needs token).
    (ws as any).__remoteAddr = req.socket.remoteAddress ?? '';
    ws.on('message', (raw) => this.handleMessage(ws, raw, (r) => { role = r; }));
    ws.on('close', () => { this.remotes.delete(ws); void role; });
  }

  private async handleMessage(ws: WebSocket, raw: import('ws').RawData, setRole?: (r: 'companion' | 'peer') => void): Promise<void> {
    let msg: WireMessage;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    switch (msg.kind) {
      case 'hello': {
        if (msg.role === 'companion' || msg.role === 'controller') {
          const settings = getSettings();
          const apiToken = settings.network.apiToken;
          const trustLan = settings.network.trustLanControllers !== false; // default true
          const remoteAddr = (ws as any).__remoteAddr as string | undefined;
          const isApi = msg.role === 'controller' && !!apiToken && msg.token === apiToken;
          const isPair = !!msg.token && this.tokens.has(msg.token!) && (this.tokens.get(msg.token!)! > Date.now());
          // A controller (Bitfocus Companion, scripts, etc.) reaching us from
          // a private LAN address gets in without auth — this is the common
          // "Stream Deck + a handful of presenter laptops on the same network"
          // setup where requiring a per-machine API token is just friction.
          // Phone remotes (`role: 'companion'`) still need a paired token.
          const isTrustedLan = msg.role === 'controller' && trustLan && isPrivateAddress(remoteAddr);
          if (!isApi && !isPair && !isTrustedLan) { trySend(ws, { kind: 'error', message: 'invalid or expired token' }); ws.close(); return; }
          if (isPair) this.tokens.delete(msg.token!);
          setRole?.(msg.role === 'controller' ? 'companion' : msg.role);
          this.remotes.add(ws);
          const welcome: WireMessage = {
            kind: 'welcome',
            peer: {
              id: getPeerId(),
              name: getSettings().deviceName,
              host: '',
              port: getSettings().network.port,
              platform: process.platform as any,
              version: app.getVersion(),
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

/**
 * True for addresses we treat as "the LAN" — loopback, link-local, and the
 * RFC1918 private IPv4 ranges, plus IPv6 loopback / link-local / unique-local
 * ranges. Anything else (public IPs, relay-tunneled clients) requires an API
 * token. IPv4-mapped IPv6 (`::ffff:10.0.0.1`) is unwrapped and re-checked.
 */
function isPrivateAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  let a = addr.toLowerCase();
  // Strip IPv6 zone identifier (`fe80::1%en0`)
  const pct = a.indexOf('%');
  if (pct >= 0) a = a.slice(0, pct);
  // IPv4-mapped IPv6
  if (a.startsWith('::ffff:')) a = a.slice(7);
  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(a)) {
    const [o1, o2] = a.split('.').map((n) => parseInt(n, 10));
    if (o1 === 127) return true;                        // 127.0.0.0/8 loopback
    if (o1 === 10) return true;                         // 10.0.0.0/8
    if (o1 === 192 && o2 === 168) return true;          // 192.168.0.0/16
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true; // 172.16.0.0/12
    if (o1 === 169 && o2 === 254) return true;          // 169.254.0.0/16 link-local
    return false;
  }
  // IPv6
  if (a === '::1') return true;                         // loopback
  if (a.startsWith('fe80:')) return true;               // link-local
  // Unique local addresses fc00::/7  (fc00–fdff)
  if (/^f[cd][0-9a-f]{2}:/.test(a)) return true;
  return false;
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
