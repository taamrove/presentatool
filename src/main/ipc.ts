import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as crypto from 'crypto';
import type { ClickerCommand, AppSettings } from '@shared/types';
import { Library } from './library';
import { Server } from './server';
import { Discovery } from './discovery';
import { adapter } from './adapters';
import { readPptxOutline } from './notes';
import { getSettings, updateSettings } from './settings';

export interface IpcContext {
  library: Library;
  server: Server;
  discovery: Discovery;
  win: BrowserWindow;
}

export function registerIpc(ctx: IpcContext): void {
  ipcMain.handle('library:list', () => ctx.library.list());
  ipcMain.handle('library:import-dialog', async () => {
    const res = await dialog.showOpenDialog(ctx.win, {
      title: 'Add presentations',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Presentations', extensions: ['pptx', 'ppt', 'key', 'pdf', 'odp'] }],
    });
    if (res.canceled) return [];
    const added = [];
    for (const f of res.filePaths) {
      try { added.push(await ctx.library.importFile(f)); } catch (err) { console.warn(err); }
    }
    return added;
  });
  ipcMain.handle('library:notes', async (_e, presentationId: string) => {
    const p = ctx.library.get(presentationId);
    if (!p || (p.kind !== 'pptx')) return [];
    try { return await readPptxOutline(p.currentPath); } catch { return []; }
  });

  ipcMain.handle('present:open', async (_e, id: string) => {
    const p = ctx.library.get(id);
    if (!p) throw new Error('unknown presentation');
    await adapter().open(p);
    return true;
  });
  ipcMain.handle('present:close', async () => {
    await adapter().close();
    return true;
  });
  ipcMain.handle('present:click', async (_e, cmd: ClickerCommand) => {
    await adapter().click(cmd);
    return true;
  });
  ipcMain.handle('present:current', async () => {
    return adapter().current();
  });

  ipcMain.handle('peers:list', () => ctx.discovery.list());

  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => updateSettings(patch));

  ipcMain.handle('remote:pair', async () => ctx.server.createPairingToken());

  ipcMain.handle('remote:generate-api-token', async () => {
    const apiToken = crypto.randomBytes(24).toString('base64url');
    const next = updateSettings({ network: { ...getSettings().network, apiToken } });
    return next.network.apiToken!;
  });
}
