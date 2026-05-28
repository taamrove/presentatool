import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import type { ClickerCommand, SlideInfo, Presentation } from '@shared/types';
import type { PlatformAdapter } from './index';

const execFileP = promisify(execFile);

/**
 * macOS adapter. Drives Keynote and PowerPoint via AppleScript. For PDF
 * it opens in Preview and falls back to global keystrokes via System Events.
 */
export class MacAdapter implements PlatformAdapter {
  private currentPresentation: Presentation | null = null;

  async open(p: Presentation): Promise<void> {
    this.currentPresentation = p;
    if (p.kind === 'key') {
      await osa(`
        tell application "Keynote"
          activate
          set thisDoc to open POSIX file "${p.currentPath}"
          delay 0.3
          start thisDoc from first slide of thisDoc
        end tell
      `);
    } else if (p.kind === 'pptx' || p.kind === 'ppt') {
      await osa(`
        tell application "Microsoft PowerPoint"
          activate
          open POSIX file "${p.currentPath}"
          delay 0.3
          run slide show slide show settings of active presentation
        end tell
      `);
    } else {
      spawn('open', [p.currentPath], { detached: true, stdio: 'ignore' }).unref();
    }
  }

  async close(): Promise<void> {
    const p = this.currentPresentation;
    if (p?.kind === 'key') {
      await osa(`tell application "Keynote" to stop the front document`).catch(() => {});
    } else if (p?.kind === 'pptx' || p?.kind === 'ppt') {
      await osa(`tell application "Microsoft PowerPoint" to exit slide show slide show window 1`).catch(() => {});
    }
    this.currentPresentation = null;
  }

  async click(cmd: ClickerCommand): Promise<void> {
    const p = this.currentPresentation;
    if (p?.kind === 'key') {
      const action = keynoteCommand(cmd);
      if (action) { await osa(`tell application "Keynote" to ${action}`).catch(() => {}); return; }
    }
    if (p?.kind === 'pptx' || p?.kind === 'ppt') {
      const action = pptCommand(cmd);
      if (action) {
        await osa(`tell application "Microsoft PowerPoint" to ${action}`).catch(() => {});
        return;
      }
    }
    // Fallback: send a keystroke to the frontmost app.
    const key = systemEventsKey(cmd);
    if (key) {
      await osa(`tell application "System Events" to ${key}`).catch(() => {});
    }
  }

  async current(): Promise<SlideInfo | null> {
    const p = this.currentPresentation;
    if (p?.kind === 'key') {
      const out = await osa(`
        tell application "Keynote"
          if not (exists front document) then return ""
          set d to front document
          set i to slide number of current slide of d
          set total to count of slides of d
          set t to ""
          try
            set t to title of current slide of d
          end try
          set n to ""
          try
            set n to presenter notes of current slide of d
          end try
          set nt to ""
          if i < total then
            try
              set nt to title of slide (i + 1) of d
            end try
          end if
          return (i as text) & "|" & (total as text) & "|" & t & "|" & n & "|" & nt
        end tell
      `).catch(() => '');
      return parsePipe(out);
    }
    if (p?.kind === 'pptx' || p?.kind === 'ppt') {
      const out = await osa(`
        tell application "Microsoft PowerPoint"
          try
            set w to slide show window 1
            set v to view of w
            set i to current show position of v
            set pres to presentation of w
            set total to count of slides of pres
            set s to slide i of pres
            set t to ""
            try
              set t to (get content of placeholder 1 of s)
            end try
            return (i as text) & "|" & (total as text) & "|" & t & "||"
          on error
            return ""
          end try
        end tell
      `).catch(() => '');
      return parsePipe(out);
    }
    return null;
  }
}

function keynoteCommand(cmd: ClickerCommand): string | null {
  switch (cmd.type) {
    case 'next': return 'show next of front document';
    case 'prev': return 'show previous of front document';
    case 'first': return 'show slide 1 of front document';
    case 'last': return 'show slide ((count of slides of front document)) of front document';
    case 'goto': return `show slide ${Math.max(1, cmd.index | 0)} of front document`;
    case 'end': return 'stop the front document';
    case 'start': return 'start the front document';
    default: return null;
  }
}

function pptCommand(cmd: ClickerCommand): string | null {
  switch (cmd.type) {
    case 'next': return 'go to next slide slide show view of slide show window 1';
    case 'prev': return 'go to previous slide slide show view of slide show window 1';
    case 'goto': return `go to slide slide show view of slide show window 1 number ${Math.max(1, cmd.index | 0)}`;
    case 'end': return 'exit slide show slide show window 1';
    default: return null;
  }
}

function systemEventsKey(cmd: ClickerCommand): string | null {
  switch (cmd.type) {
    case 'next': return 'key code 124'; // right arrow
    case 'prev': return 'key code 123'; // left arrow
    case 'first': return 'key code 115'; // home
    case 'last': return 'key code 119';  // end
    case 'blank': return 'keystroke "b"';
    case 'end': return 'key code 53';    // esc
    case 'start': return 'key code 96';  // F5
    case 'goto': return `keystroke "${cmd.index}" & key code 36`;
    default: return null;
  }
}

async function osa(script: string): Promise<string> {
  const { stdout } = await execFileP('osascript', ['-e', script], { maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

function parsePipe(s: string): SlideInfo | null {
  if (!s) return null;
  const parts = s.split('|');
  if (parts.length < 2) return null;
  const index = Number(parts[0]);
  const total = Number(parts[1]);
  if (!Number.isFinite(index) || !Number.isFinite(total)) return null;
  return {
    index,
    total,
    title: parts[2] || undefined,
    notes: parts[3] || undefined,
    nextTitle: parts[4] || undefined,
  };
}
