import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import type { ClickerCommand, SlideInfo, Presentation } from '@shared/types';
import type { PlatformAdapter } from './index';

const execFileP = promisify(execFile);

/**
 * Linux adapter. No standard scriptable presenter API exists across desktops,
 * so we use xdotool to send keyboard events to the active window. We try
 * libreoffice --show first for office formats, then evince for PDFs.
 */
export class LinuxAdapter implements PlatformAdapter {
  private currentPresentation: Presentation | null = null;
  private spawned: ReturnType<typeof spawn> | null = null;

  async open(p: Presentation): Promise<void> {
    this.currentPresentation = p;
    if (p.kind === 'pptx' || p.kind === 'ppt' || p.kind === 'odp') {
      this.spawned = spawn('libreoffice', ['--show', p.currentPath], { detached: true, stdio: 'ignore' });
      this.spawned.unref();
    } else if (p.kind === 'pdf') {
      this.spawned = spawn('xdg-open', [p.currentPath], { detached: true, stdio: 'ignore' });
      this.spawned.unref();
    } else {
      this.spawned = spawn('xdg-open', [p.currentPath], { detached: true, stdio: 'ignore' });
      this.spawned.unref();
    }
  }

  async close(): Promise<void> {
    // Best-effort: send Escape, then forget.
    await this.sendKey('Escape').catch(() => {});
    this.currentPresentation = null;
    this.spawned = null;
  }

  async click(cmd: ClickerCommand): Promise<void> {
    const key = keyForCommand(cmd);
    if (key) await this.sendKey(key).catch(() => {});
  }

  async current(): Promise<SlideInfo | null> {
    // Live introspection isn't possible without compositor-specific APIs.
    // The companion / desktop UI will fall back to its own counter when this
    // returns null.
    return null;
  }

  private async sendKey(key: string): Promise<void> {
    try {
      await execFileP('xdotool', ['key', '--clearmodifiers', key]);
    } catch {
      // xdotool not installed — try wtype for Wayland, otherwise give up silently.
      try { await execFileP('wtype', ['-k', key]); } catch {}
    }
  }
}

function keyForCommand(cmd: ClickerCommand): string | null {
  switch (cmd.type) {
    case 'next': return 'Right';
    case 'prev': return 'Left';
    case 'first': return 'Home';
    case 'last': return 'End';
    case 'blank': return 'b';
    case 'end': return 'Escape';
    case 'start': return 'F5';
    case 'goto': return `${cmd.index} Return`;
    default: return null;
  }
}
