import WebSocket from 'ws';
import { InstanceStatus } from '@companion-module/base';
import type { PresentoolInstance } from './main';
import type { ClickerCommand, ModuleConfig, PresentationSummary, SlideInfo, WireMessage } from './types';

/**
 * Holds the live WebSocket to the Presentool desktop. Auto-reconnects with
 * exponential backoff, parses incoming slide / presentation messages and
 * exposes a `send()` so actions can post clicker commands.
 */
export class Connection {
  private ws: WebSocket | null = null;
  private retry = 0;
  private stopped = false;
  private pingTimer: NodeJS.Timeout | null = null;

  slide: SlideInfo | null = null;
  presentations: PresentationSummary[] = [];
  hostName = '';
  connected = false;

  constructor(private instance: PresentoolInstance) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    try { this.ws?.close(); } catch {}
    this.ws = null;
  }

  send(msg: WireMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try { this.ws.send(JSON.stringify(msg)); } catch {}
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
    if (!cfg?.host || !cfg.port || !cfg.token) {
      this.instance.updateStatus(InstanceStatus.BadConfig, 'host / port / token required');
      return;
    }
    this.instance.updateStatus(InstanceStatus.Connecting);
    const url = `ws://${cfg.host}:${cfg.port}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => {
      this.retry = 0;
      this.send({ kind: 'hello', role: 'controller', token: cfg.token });
      this.pingTimer = setInterval(() => this.send({ kind: 'ping' }), 20_000);
    });

    ws.on('message', (raw) => {
      let msg: WireMessage;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      switch (msg.kind) {
        case 'welcome':
          this.connected = true;
          this.hostName = msg.peer.name;
          this.instance.updateStatus(InstanceStatus.Ok);
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
          this.instance.log('error', `Presentool: ${msg.message}`);
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

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
    setTimeout(() => this.connect(), delay);
  }
}
