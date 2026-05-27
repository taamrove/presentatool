import { WebSocket } from 'ws';
import type { WireMessage, ClickerCommand } from '@shared/types';
import { getSettings, getPeerId } from './settings';

/**
 * Optional cloud relay client. When the user has configured a relay URL +
 * token in settings (e.g. wss://relay.example.com), we connect outbound so
 * remotes on a different network can drive this desktop. Reconnects with
 * exponential backoff.
 */
export class Relay {
  private ws: WebSocket | null = null;
  private retry = 0;
  private stopped = false;

  constructor(private onClick: (cmd: ClickerCommand) => void) {}

  start(): void {
    const { network } = getSettings();
    if (!network.enableRelay || !network.relayUrl) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    try { this.ws?.close(); } catch {}
    this.ws = null;
  }

  send(msg: WireMessage): void {
    if (this.ws && this.ws.readyState === this.ws.OPEN) {
      try { this.ws.send(JSON.stringify(msg)); } catch {}
    }
  }

  private connect(): void {
    if (this.stopped) return;
    const { network, deviceName } = getSettings();
    const url = `${network.relayUrl}?peer=${encodeURIComponent(getPeerId())}&name=${encodeURIComponent(deviceName)}&token=${encodeURIComponent(network.relayToken ?? '')}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.on('open', () => {
      this.retry = 0;
      const hello: WireMessage = {
        kind: 'hello',
        role: 'peer',
        peer: {
          id: getPeerId(),
          name: deviceName,
          host: '',
          port: network.port,
          platform: process.platform as any,
          version: '0.1.0',
          presentationCount: 0,
        },
      };
      ws.send(JSON.stringify(hello));
    });
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as WireMessage;
        if (msg.kind === 'click') this.onClick(msg.command);
      } catch {}
    });
    ws.on('close', () => this.scheduleReconnect());
    ws.on('error', () => { try { ws.close(); } catch {} });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
    setTimeout(() => this.connect(), delay);
  }
}
