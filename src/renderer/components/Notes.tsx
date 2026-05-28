import React, { useEffect, useState } from 'react';
import type { Presentation, SlideInfo } from '../../shared/types';

interface Props {
  presentation: Presentation;
  slide: SlideInfo | null;
}

export function Notes({ presentation, slide }: Props): JSX.Element {
  const [outline, setOutline] = useState<{ title?: string; notes?: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (presentation.kind === 'pptx') {
      window.presentool.presentationNotes(presentation.id).then((o) => {
        if (!cancelled) setOutline(o);
      });
    } else {
      setOutline([]);
    }
    return () => { cancelled = true; };
  }, [presentation.id, presentation.kind]);

  // Prefer live data from the native app; fall back to the parsed outline.
  let title = slide?.title;
  let notes = slide?.notes;
  let nextTitle = slide?.nextTitle;
  if (slide && outline.length >= slide.index) {
    const cur = outline[slide.index - 1];
    title = title || cur?.title;
    notes = notes || cur?.notes;
    if (!nextTitle && outline.length > slide.index) nextTitle = outline[slide.index]?.title;
  }

  if (!slide) {
    return (
      <div className="notes-panel">
        <h3>Presenter view</h3>
        <p className="hint">Open a presentation to see live notes and the next slide.</p>
      </div>
    );
  }

  return (
    <div className="notes-panel">
      <h3>Now <span className="muted">slide {slide.index} of {slide.total}</span></h3>
      {title && <div className="now-title">{title}</div>}
      {notes && <pre className="notes-body">{notes}</pre>}
      {nextTitle && (
        <div className="next">
          <div className="muted">Up next</div>
          <div className="next-title">{nextTitle}</div>
        </div>
      )}
    </div>
  );
}
