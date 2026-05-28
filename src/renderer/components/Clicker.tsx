import React, { useEffect } from 'react';
import type { Presentation, SlideInfo } from '../../shared/types';

interface Props {
  presentation: Presentation | null;
  slide: SlideInfo | null;
}

export function Clicker({ presentation, slide }: Props): JSX.Element {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') click({ type: 'next' });
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') click({ type: 'prev' });
      if (e.key === 'Home') click({ type: 'first' });
      if (e.key === 'End') click({ type: 'last' });
      if (e.key.toLowerCase() === 'b') click({ type: 'blank' });
      if (e.key === 'Escape') click({ type: 'end' });
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function click(cmd: Parameters<typeof window.presentool.click>[0]): void {
    window.presentool.click(cmd);
  }

  return (
    <div className="clicker">
      <header className="clicker-header">
        <h2>{presentation ? presentation.title : 'No presentation selected'}</h2>
        {slide && (
          <div className="slide-pos">
            Slide {slide.index} / {slide.total}
            {slide.title && <span className="slide-title">— {slide.title}</span>}
          </div>
        )}
      </header>
      <div className="big-buttons">
        <button className="btn prev" onClick={() => click({ type: 'prev' })}>◀ Previous</button>
        <button className="btn next" onClick={() => click({ type: 'next' })}>Next ▶</button>
      </div>
      <div className="row">
        <button className="btn small" onClick={() => click({ type: 'first' })}>⏮ First</button>
        <button className="btn small" onClick={() => click({ type: 'blank' })}>● Blank</button>
        <button className="btn small" onClick={() => click({ type: 'last' })}>Last ⏭</button>
        <button className="btn small danger" onClick={() => click({ type: 'end' })}>Exit</button>
      </div>
      <p className="hint">
        Arrow keys, space and Page Up/Down also work — and the global hotkeys you set in Settings
        drive the slideshow even when this window is in the background.
      </p>
    </div>
  );
}
