// Subset of Presentatool's wire protocol that the Companion module cares about.
// Kept in sync by hand with src/shared/types.ts in the parent project.

export type ClickerCommand =
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'first' }
  | { type: 'last' }
  | { type: 'blank' }
  | { type: 'goto'; index: number }
  | { type: 'start' }
  | { type: 'end' };

export interface SlideInfo {
  index: number;
  total: number;
  title?: string;
  notes?: string;
  nextTitle?: string;
}

export interface PresentationSummary {
  id: string;
  title: string;
  kind: string;
  latestVersionId: string;
  updatedAt: string;
}

export type WireMessage =
  | { kind: 'hello'; role: 'controller'; token?: string }
  | { kind: 'welcome'; peer: { id: string; name: string; platform: string; version: string } }
  | { kind: 'slide'; info: SlideInfo; presentationId?: string }
  | { kind: 'presentations'; list: PresentationSummary[] }
  | { kind: 'click'; command: ClickerCommand }
  | { kind: 'select'; presentationId: string }
  | { kind: 'ping' }
  | { kind: 'pong' }
  | { kind: 'error'; message: string };

export interface ModuleConfig {
  host: string;
  port: number;
  /** Optional. Only required when Presentatool is off-LAN or LAN trust is off. */
  token?: string;
}
