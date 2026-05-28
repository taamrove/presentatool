import React, { useEffect, useRef, useState } from 'react';
import type { Presentation } from '../../shared/types';

interface Props {
  presentations: Presentation[];
  onClose: () => void;
  onPick: (p: Presentation) => void;
}

export function QuickSwitch({ presentations, onClose, onPick }: Props): JSX.Element {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  const filtered = presentations.filter((p) =>
    p.title.toLowerCase().includes(query.toLowerCase()),
  ).slice(0, 12);

  function onKey(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowDown') setActive((a) => Math.min(filtered.length - 1, a + 1));
    if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
    if (e.key === 'Enter') {
      const p = filtered[active];
      if (p) onPick(p);
    }
  }

  return (
    <div className="quick-mask" onClick={onClose}>
      <div className="quick-panel" onClick={(e) => e.stopPropagation()}>
        <input
          ref={ref}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={onKey}
          placeholder="Switch to a presentation…"
        />
        <ul>
          {filtered.map((p, i) => (
            <li
              key={p.id}
              className={i === active ? 'active' : ''}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(p)}
            >
              <span className="quick-title">{p.title}</span>
              <span className="quick-kind">{p.kind}</span>
            </li>
          ))}
          {filtered.length === 0 && <li className="quick-empty">No matches</li>}
        </ul>
      </div>
    </div>
  );
}
