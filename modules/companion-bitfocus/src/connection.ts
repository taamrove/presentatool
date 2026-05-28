import WebSocket from 'ws';
import { InstanceStatus } from '@companion-module/base';
import type { PresentatoolInstance } from './main';
import type { ClickerCommand, ModuleConfig, PresentationSummary, SlideInfo, WireMessage } from './types';
import { LanDiscovery, type DiscoveredPresentatool } from './discovery';

/**
 * Holds the live WebSocket to the Presentatool desktop. Auto-reconnects with
 * exponential backoff, parses incoming slide / presentation messages and
 * exposes a `send()` so actions can post clicker commands.
 *
 * Host is optional: leave the config field blank and the module will browse
 * the LAN via mDNS (`_presentatool._tcp`) and attach to the first desktop it
 * finds. A typed-in host always wins over the discovered one.
 */
export class Connection {
  private ws: WebSocket | null = null;
  private retry = 0;
  private stopped = false;
  private pingTimer: NodeJS.Timeout | null = null;
  private discovery: LanDiscovery | null = null;
  private discoveredPeers: DiscoveredPresentatool[] = [];
  /** Endpoint we last attempted, so we can tell when discovery surfaces a different one. */
  private connectingTo: { host: string; port: number } | null = null;

  slide: SlideInfo | null = null;
  presentations: PresentationSummary[] = [];
  hostName = '';
  connected = false;

  constructor(private instance: PresentatoolInstance) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    try { this.ws?.close(); } catch { /* noop */ }
    this.ws = null;
    try { this.discovery?.stop(); } catch { /* noop */ }
    this.discovery = null;
  }

  send(msg: WireMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try { this.ws.send(JSON.stringify(msg)); } catch { /* noop */ }
  }

  click(cmd: ClickerCommand): void {
    this.send({ kind: 'click', command: cmd });
  }

  selectPresentation(id: string): void {
    this.send({ kind: 'select', presentationId: id });
  }

  private connect(): void {
    if (this.stopped) return;
    const cfg = this.instance.config as ModuleConfig | undefined;
    const port = cfg?.port ?? 4711;
    const typedHost = cfg?.host?.trim();

    if (!typedHost) {
      // Auto-discovery path: spin up an mDNS browser and connect as soon as
      // we see a Presentatool on the LAN.
      this.ensureDiscovery();
      const first = this.discoveredPeers[0];
      if (!first) {
        this.instance.updateStatus(InstanceStatus.Connecting, 'Searching LAN for Presentatool…');
        // The discovery callback will re-trigger connect() when something
        // shows up, so we don't need a timer here. As a safety net, retry in
        // 10s in case mDNS missed the first announcement.
        setTimeout(() => { if (!this.connected) this.connect(); }, 10_000);
        return;
      }
      this.openSocket(first.host, first.port);
      return;
    }

    this.openSocket(typedHost, port);
  }

  private openSocket(host: string, port: number): void {
    this.connectingTo = { host, port };
    this.instance.updateStatus(InstanceStatus.Connecting, `${host}:${port}`);
    const cfg = this.instance.config as ModuleConfig | undefined;
    const url = `ws://${host}:${port}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => {
      this.retry = 0;
      const hello: WireMessage = { kind: 'hello', role: 'controller' };
      if (cfg?.token && cfg.token.trim()) hello.token = cfg.token.trim();
      this.send(hello);
      this.pingTimer = setInterval(() => this.send({ kind: 'ping' }), 20_000);
    });

    ws.on('message', (raw) => {
      let msg: WireMessage;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      switch (msg.kind) {
        case 'welcome':
          this.connected = true;
          this.hostName = msg.peer.name;
          this.instance.updateStatus(InstanceStatus.Ok, msg.peer.name);
          this.instance.refreshAll();
          break;
        case 'slide':
          this.slide = msg.info;
          this.instance.refreshVariables();
          break;
        case 'presentations':
          this.presentations = msg.list;
          this.instance.refreshActions();
          break;
        case 'error':
          this.instance.log('error', `Presentatool: ${msg.message}`);
          this.instance.updateStatus(InstanceStatus.AuthenticationFailure, msg.message);
          break;
      }
    });

    ws.on('close', () => {
      this.connected = false;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.instance.refreshFeedbacks();
      this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      this.instance.log('debug', `ws error: ${err.message}`);
      this.instance.updateStatus(InstanceStatus.ConnectionFailure, err.message);
    });
  }

  private ensureDiscovery(): void {
    if (this.discovery) return;
    this.discovery = new LanDiscovery((peers) => {
      this.discoveredPeers = peers;
      // If we're not connected yet and someone just appeared on the LAN, try
      // them right away. Avoids the 10s safety-net retry above.
      if (!this.connected && !this.stopped) {
        const first = peers[0];
        const target = this.connectingTo;
        const sameAsCurrent = target && first && target.host === first.host && target.port === first.port;
        if (first && !sameAsCurrent) {
          try { this.ws?.close(); } catch { /* noop */ }
          this.openSocket(first.host, first.port);
        }
      }
    });
    this.discovery.start();
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
    setTimeout(() => this.connect(), delay);
  }
}
