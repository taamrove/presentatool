import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, ClickerCommand, PairingToken, Peer, Presentation, SlideInfo } from '../shared/types';

const api = {
  listPresentations: (): Promise<Presentation[]> => ipcRenderer.invoke('library:list'),
  importDialog: (): Promise<Presentation[]> => ipcRenderer.invoke('library:import-dialog'),
  presentationNotes: (id: string): Promise<{ title?: string; notes?: string }[]> => ipcRenderer.invoke('library:notes', id),

  open: (id: string): Promise<boolean> => ipcRenderer.invoke('present:open', id),
  close: (): Promise<boolean> => ipcRenderer.invoke('present:close'),
  click: (cmd: ClickerCommand): Promise<boolean> => ipcRenderer.invoke('present:click', cmd),
  current: (): Promise<SlideInfo | null> => ipcRenderer.invoke('present:current'),

  peers: (): Promise<Peer[]> => ipcRenderer.invoke('peers:list'),
  settings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke('settings:set', patch),

  pairRemote: (): Promise<PairingToken> => ipcRenderer.invoke('remote:pair'),
  generateApiToken: (): Promise<string> => ipcRenderer.invoke('remote:generate-api-token'),
  installFirewallRule: (): Promise<{ ok: boolean; reason?: string; status?: string }> =>
    ipcRenderer.invoke('network:install-firewall-rule'),

  onSlide: (cb: (info: SlideInfo) => void) => {
    const fn = (_: unknown, info: SlideInfo) => cb(info);
    ipcRenderer.on('slide:update', fn);
    return () => ipcRenderer.removeListener('slide:update', fn);
  },
  onQuickSwitch: (cb: () => void) => {
    const fn = () => cb();
    ipcRenderer.on('ui:quick-switch', fn);
    return () => ipcRenderer.removeListener('ui:quick-switch', fn);
  },
  onPeersUpdate: (cb: () => void) => {
    const fn = () => cb();
    ipcRenderer.on('peers:update', fn);
    return () => ipcRenderer.removeListener('peers:update', fn);
  },
};

contextBridge.exposeInMainWorld('presentatool', api);

export type PresentatoolApi = typeof api;
declare global {
  interface Window { presentatool: PresentatoolApi }
}
