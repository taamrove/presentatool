/**
 * mDNS / Bonjour browser for the Companion module.
 *
 * The Presentatool desktop advertises itself on the LAN as `_presentatool._tcp`
 * with its host, port and a `peerId` TXT record (see src/main/discovery.ts in
 * the desktop). This module subscribes to that, so a user can leave the host
 * field blank and the Companion connection will auto-attach to the first
 * Presentatool instance it sees on the network.
 *
 * Discovery is best-effort: if mDNS is blocked or the network is locked down,
 * the user can still type a host IP manually and everything keeps working.
 */

import { Bonjour } from 'bonjour-service';

// The bonjour-service `Service` class is awkward to import as a type (it's
// a value export). We only read a handful of well-known fields off the
// objects emitted by the browser, so we describe just those.
interface BonjourService {
  name?: string;
  port: number;
  addresses?: string[];
  txt?: Record<string, unknown>;
}

export interface DiscoveredPresentatool {
  /** Friendly device name from the advertisement (the `name` field). */
  name: string;
  /** Reachable IPv4 / IPv6 address. */
  host: string;
  /** WebSocket port the desktop is listening on. */
  port: number;
  /** Stable per-install id from the TXT record, used for de-duping. */
  peerId?: string;
  /** Epoch ms of the last advertisement we saw. */
  lastSeen: number;
}

export type DiscoveryChangeHandler = (peers: DiscoveredPresentatool[]) => void;

export class LanDiscovery {
  private bonjour: InstanceType<typeof Bonjour> | null = null;
  private browser: ReturnType<InstanceType<typeof Bonjour>['find']> | null = null;
  /** Indexed by `name@host:port` because peerId TXT may be absent. */
  private peers = new Map<string, DiscoveredPresentatool>();

  constructor(private onChange: DiscoveryChangeHandler) {}

  start(): void {
    if (this.bonjour) return;
    this.bonjour = new Bonjour();
    this.browser = this.bonjour.find({ type: 'presentatool' });

    const upsert = (svc: BonjourService): void => {
      const host = pickAddress(svc);
      if (!host) return;
      const key = `${svc.name}@${host}:${svc.port}`;
      // The desktop publishes its stable per-install id as TXT `id`.
      const peerId = readTxt(svc, 'id');
      this.peers.set(key, {
        name: svc.name ?? host,
        host,
        port: svc.port,
        peerId,
        lastSeen: Date.now(),
      });
      this.emit();
    };

    // bonjour-service's `Browser` event signatures are loosely typed; cast
    // narrowly so we can subscribe to the events we care about.
    const browser = this.browser as unknown as { on(event: string, h: (s: BonjourService) => void): void };
    browser.on('up', upsert);
    // 'srv-update' fires on TTL refreshes so we keep entries alive.
    browser.on('srv-update', upsert);
    browser.on('down', (svc: BonjourService) => {
      // Remove every key that begins with this service name — we don't always
      // see the same address we registered the `up` event under.
      for (const key of this.peers.keys()) {
        if (key.startsWith(`${svc.name}@`)) this.peers.delete(key);
      }
      this.emit();
    });

    // Drop entries we haven't heard from in a while so a powered-off laptop
    // doesn't linger in the auto-connect picker forever.
    setInterval(() => this.prune(2 * 60 * 1000), 30_000).unref();
  }

  stop(): void {
    try { this.browser?.stop(); } catch { /* noop */ }
    try { this.bonjour?.destroy(); } catch { /* noop */ }
    this.browser = null;
    this.bonjour = null;
    this.peers.clear();
  }

  list(): DiscoveredPresentatool[] {
    return [...this.peers.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  }

  private prune(maxAgeMs: number): void {
    const cutoff = Date.now() - maxAgeMs;
    let changed = false;
    for (const [key, p] of this.peers) {
      if (p.lastSeen < cutoff) { this.peers.delete(key); changed = true; }
    }
    if (changed) this.emit();
  }

  private emit(): void { this.onChange(this.list()); }
}

function pickAddress(svc: BonjourService): string | undefined {
  // Prefer IPv4 — Companion connects over WebSocket and most users' phones /
  // Stream Decks live in v4 land. Fall back to v6 if that's all we got.
  const all = (svc.addresses ?? []).filter(Boolean);
  const v4 = all.find((a) => /^\d{1,3}(\.\d{1,3}){3}$/.test(a));
  return v4 ?? all[0];
}

function readTxt(svc: BonjourService, key: string): string | undefined {
  const txt = svc.txt as Record<string, unknown> | undefined;
  if (!txt) return undefined;
  const value = txt[key] ?? txt[key.toLowerCase()];
  if (value == null) return undefined;
  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
}
