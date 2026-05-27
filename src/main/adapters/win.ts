import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import type { ClickerCommand, SlideInfo, Presentation } from '@shared/types';
import type { PlatformAdapter } from './index';

const execFileP = promisify(execFile);

/**
 * Windows adapter. Uses PowerShell to drive PowerPoint via COM for real
 * presentation control (slide info + commands routed to the slide-show
 * window) and falls back to keystrokes for PDFs or when COM is unavailable.
 */
export class WinAdapter implements PlatformAdapter {
  private currentPresentation: Presentation | null = null;

  async open(p: Presentation): Promise<void> {
    this.currentPresentation = p;
    if (p.kind === 'pptx' || p.kind === 'ppt') {
      await runPS(`
        $app = New-Object -ComObject PowerPoint.Application
        $app.Visible = $true
        $pres = $app.Presentations.Open('${escape(p.currentPath)}', $false, $false, $true)
        $pres.SlideShowSettings.Run() | Out-Null
      `);
    } else {
      // PDF / odp / anything else: shell-open and rely on global keyboard.
      spawn('cmd', ['/c', 'start', '""', p.currentPath], { detached: true, stdio: 'ignore' }).unref();
    }
  }

  async close(): Promise<void> {
    if (this.currentPresentation && (this.currentPresentation.kind === 'pptx' || this.currentPresentation.kind === 'ppt')) {
      await runPS(`
        try {
          $app = [Runtime.Interopservices.Marshal]::GetActiveObject('PowerPoint.Application')
          $app.SlideShowWindows | ForEach-Object { $_.View.Exit() }
        } catch {}
      `).catch(() => {});
    }
    this.currentPresentation = null;
  }

  async click(cmd: ClickerCommand): Promise<void> {
    const p = this.currentPresentation;
    if (p && (p.kind === 'pptx' || p.kind === 'ppt')) {
      const action = pptCommand(cmd);
      if (action) {
        await runPS(`
          try {
            $app = [Runtime.Interopservices.Marshal]::GetActiveObject('PowerPoint.Application')
            $view = $app.SlideShowWindows.Item(1).View
            ${action}
          } catch {}
        `).catch(() => {});
        return;
      }
    }
    // Fallback: keystroke to focused window.
    await sendKey(keyForCommand(cmd));
  }

  async current(): Promise<SlideInfo | null> {
    const p = this.currentPresentation;
    if (!p || (p.kind !== 'pptx' && p.kind !== 'ppt')) return null;
    const out = await runPS(`
      try {
        $app = [Runtime.Interopservices.Marshal]::GetActiveObject('PowerPoint.Application')
        $win = $app.SlideShowWindows.Item(1)
        $view = $win.View
        $pres = $win.Presentation
        $i = $view.CurrentShowPosition
        $total = $pres.Slides.Count
        $slide = $pres.Slides.Item($i)
        $title = ''
        foreach ($shape in $slide.Shapes) {
          if ($shape.HasTextFrame -and $shape.TextFrame.HasText -and $shape.Name -like 'Title*') {
            $title = $shape.TextFrame.TextRange.Text
            break
          }
        }
        $notes = ''
        if ($slide.HasNotesPage) {
          foreach ($shape in $slide.NotesPage.Shapes) {
            if ($shape.HasTextFrame -and $shape.TextFrame.HasText -and $shape.PlaceholderFormat.Type -eq 2) {
              $notes = $shape.TextFrame.TextRange.Text
              break
            }
          }
        }
        $nextTitle = ''
        if ($i -lt $total) {
          $next = $pres.Slides.Item($i + 1)
          foreach ($shape in $next.Shapes) {
            if ($shape.HasTextFrame -and $shape.TextFrame.HasText -and $shape.Name -like 'Title*') {
              $nextTitle = $shape.TextFrame.TextRange.Text
              break
            }
          }
        }
        $obj = @{ index = $i; total = $total; title = $title; notes = $notes; nextTitle = $nextTitle }
        $obj | ConvertTo-Json -Compress
      } catch { '' }
    `).catch(() => '');
    return parseJsonSlide(out);
  }
}

function pptCommand(cmd: ClickerCommand): string | null {
  switch (cmd.type) {
    case 'next': return '$view.Next()';
    case 'prev': return '$view.Previous()';
    case 'first': return '$view.First()';
    case 'last': return '$view.Last()';
    case 'goto': return `$view.GotoSlide(${Math.max(1, cmd.index | 0)})`;
    case 'blank': return '$view.State = 4'; // ppSlideShowBlackScreen
    case 'start': return null;
    case 'end': return '$view.Exit()';
    default: return null;
  }
}

function keyForCommand(cmd: ClickerCommand): string {
  switch (cmd.type) {
    case 'next': return '{RIGHT}';
    case 'prev': return '{LEFT}';
    case 'first': return '{HOME}';
    case 'last': return '{END}';
    case 'blank': return 'B';
    case 'end': return '{ESC}';
    case 'start': return '{F5}';
    case 'goto': return `${cmd.index}{ENTER}`;
    default: return '';
  }
}

async function sendKey(keys: string): Promise<void> {
  if (!keys) return;
  await runPS(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${keys.replace(/'/g, "''")}')`).catch(() => {});
}

async function runPS(script: string): Promise<string> {
  const { stdout } = await execFileP('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.trim();
}

function escape(p: string): string {
  return p.replace(/'/g, "''");
}

function parseJsonSlide(s: string): SlideInfo | null {
  if (!s) return null;
  try {
    const o = JSON.parse(s);
    if (typeof o.index !== 'number' || typeof o.total !== 'number') return null;
    return { index: o.index, total: o.total, title: o.title || undefined, notes: o.notes || undefined, nextTitle: o.nextTitle || undefined };
  } catch { return null; }
}
