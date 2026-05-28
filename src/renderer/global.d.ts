import type {
  AppSettings,
  ClickerCommand,
  PairingToken,
  Peer,
  Presentation,
  SlideInfo,
} from '../shared/types';

interface PresentatoolApi {
  listPresentations(): Promise<Presentation[]>;
  importDialog(): Promise<Presentation[]>;
  presentationNotes(id: string): Promise<{ title?: string; notes?: string }[]>;

  open(id: string): Promise<boolean>;
  close(): Promise<boolean>;
  click(cmd: ClickerCommand): Promise<boolean>;
  current(): Promise<SlideInfo | null>;

  peers(): Promise<Peer[]>;
  settings(): Promise<AppSettings>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  addLibraryFolderDialog(): Promise<AppSettings>;
  removeLibraryFolder(folder: string): Promise<AppSettings>;

  pairRemote(): Promise<PairingToken>;
  generateApiToken(): Promise<string>;
  installFirewallRule(): Promise<{ ok: boolean; reason?: string; status?: string }>;
  checkForUpdates(): Promise<{ state: string; version?: string; error?: string }>;
  applyUpdate(): Promise<boolean>;
  onUpdaterStatus(cb: (s: { state: string; version?: string; error?: string }) => void): () => void;
  onUpdaterProgress(cb: (p: { percent: number }) => void): () => void;

  onSlide(cb: (info: SlideInfo) => void): () => void;
  onQuickSwitch(cb: () => void): () => void;
  onPeersUpdate(cb: () => void): () => void;
}

declare global {
  interface Window {
    presentatool: PresentatoolApi;
  }
}

export {};
