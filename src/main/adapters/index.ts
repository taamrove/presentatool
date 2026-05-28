import type { ClickerCommand, SlideInfo, Presentation } from '@shared/types';
import { WinAdapter } from './win';
import { MacAdapter } from './mac';
import { LinuxAdapter } from './linux';

/** Surface that each platform's adapter implements. */
export interface PlatformAdapter {
  /** Launch the file in its native app and enter slideshow mode. */
  open(p: Presentation): Promise<void>;
  /** Close any presentation we opened. */
  close(): Promise<void>;
  /** Send a clicker command (next/prev/etc) to the active presentation. */
  click(cmd: ClickerCommand): Promise<void>;
  /** Poll the current slide info, if the native app exposes it. */
  current(): Promise<SlideInfo | null>;
}

let cached: PlatformAdapter | null = null;
export function adapter(): PlatformAdapter {
  if (cached) return cached;
  switch (process.platform) {
    case 'win32': cached = new WinAdapter(); break;
    case 'darwin': cached = new MacAdapter(); break;
    default: cached = new LinuxAdapter(); break;
  }
  return cached;
}
