import Bonjour from 'bonjour-service';
import { EventEmitter } from 'events';
import * as os from 'os';
import { app } from 'electron';
import type { Peer, Platform } from '@shared/types';
import { getSettings, getPeerId } from './settings';

type Service = ReturnType<InstanceType<typeof Bonjour>['publish']>;

const SERVICE_TYPE = 'presentatool';

/**
 * mDNS-based peer discovery. Each Presentatool advertises itself on the LAN
 * with its peer id, name, port and presentation count. Subscribers can
 * watch the peer list update live.
 */
export class Discovery extends EventEmitter {
  private bonjour: InstanceType<typeof Bonjour> | null = null;
  private published: Service | null = null;
  private peers = new Map<string, Peer>();
  private getPresCount: () => number = () => 0;

  start(presentationCountFn: () => number): void {
    if (!getSettings().network.enableMdns) return;
    this.getPresCount = presentationCountFn;
    this.bonjour = new Bonjour();
    const settings = getSettings();
    const peerId = getPeerId();
    this.published = this.bonjour.publish({
      name: `${settings.deviceName}-${peerId.slice(0, 6)}`,
      type: SERVICE_TYPE,
      port: settings.network.port,
      txt: {
        id: peerId,
        name: settings.deviceName,
        platform: process.platform,
        version: app.getVersion(),
        count: String(this.getPresCount()),
      },
    });
    const browser = this.bonjour.find({ type: SERVICE_TYPE });
    browser.on('up', (svc: Service) => this.onUp(svc));
    browser.on('down', (svc: Service) => this.onDown(svc));
  }

  stop(): void {
    try { this.published?.stop(() => {}); } catch {}
    try { this.bonjour?.destroy(); } catch {}
    this.bonjour = null;
    this.published = null;
    this.peers.clear();
  }

  list(): Peer[] {
    return Array.from(this.peers.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Re-broadcast presentation count when the library updates. */
  refresh(): void {
    if (!this.bonjour || !this.published) return;
    try { this.published.stop(() => {}); } catch {}
    const settings = getSettings();
    const peerId = getPeerId();
    this.published = this.bonjour.publish({
      name: `${settings.deviceName}-${peerId.slice(0, 6)}`,
      type: SERVICE_TYPE,
      port: settings.network.port,
      txt: {
        id: peerId,
        name: settings.deviceName,
        platform: process.platform,
        version: app.getVersion(),
        count: String(this.getPresCount()),
      },
    });
  }

  private onUp(svc: Service): void {
    const txt = (svc.txt as Record<string, string>) ?? {};
    const id = txt.id;
    if (!id || id === getPeerId()) return; // ignore self
    const host = svc.referer?.address ?? svc.host ?? (svc.addresses ?? [])[0] ?? '';
    if (!host || isLoopback(host)) return;
    const peer: Peer = {
      id,
      name: txt.name ?? svc.name,
      host,
      port: svc.port,
      platform: (txt.platform as Platform) ?? 'linux',
      version: txt.version ?? '0.0.0',
      presentationCount: Number(txt.count ?? '0') || 0,
      lastSeen: Date.now(),
    };
    this.peers.set(id, peer);
    this.emit('peers', this.list());
  }

  private onDown(svc: Service): void {
    const txt = (svc.txt as Record<string, string>) ?? {};
    const id = txt.id;
    if (!id) return;
    if (this.peers.delete(id)) this.emit('peers', this.list());
  }
}

function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host.startsWith('169.254.');
}

export function localAddresses(): string[] {
  const out: string[] = [];
  const interfaces = os.networkInterfaces();
  for (const list of Object.values(interfaces)) {
    if (!list) continue;
    for (const i of list) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}
