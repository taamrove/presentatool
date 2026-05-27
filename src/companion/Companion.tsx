import React, { useEffect, useRef, useState } from 'react';
import type { ClickerCommand, PresentationSummary, SlideInfo, WireMessage } from '../shared/types';

type Status = 'connecting' | 'open' | 'closed' | 'error';

export function Companion(): JSX.Element {
  const [status, setStatus] = useState<Status>('connecting');
  const [host, setHost] = useState<string>('');
  const [slide, setSlide] = useState<SlideInfo | null>(null);
  const [presentations, setPresentations] = useState<PresentationSummary[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const token = new URLSearchParams(location.search).get('token') ?? '';
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => {
      setStatus('open');
      send(ws, { kind: 'hello', role: 'companion', token });
    };
    ws.onclose = () => setStatus('closed');
    ws.onerror = () => setStatus('error');
    ws.onmessage = (ev) => {
      let msg: WireMessage;
      try { msg = JSON.parse(ev.data); } catch { return; }
      switch (msg.kind) {
        case 'welcome': setHost(msg.peer.name); break;
        case 'slide': setSlide(msg.info); break;
        case 'presentations': setPresentations(msg.list); break;
      }
    };
    return () => ws.close();
  }, []);

  function click(cmd: ClickerCommand): void {
    if (navigator.vibrate) navigator.vibrate(15);
    const ws = wsRef.current;
    if (!ws) return;
    send(ws, { kind: 'click', command: cmd });
  }

  function pick(id: string): void {
    const ws = wsRef.current;
    if (!ws) return;
    send(ws, { kind: 'select', presentationId: id });
  }

  return (
    <div className={`comp status-${status}`}>
      <header>
        <div className="who">{host || '...'}</div>
        <div className={`pill ${status}`}>{status}</div>
      </header>

      {slide && (
        <section className="now">
          <div className="counter">{slide.index} / {slide.total}</div>
          {slide.title && <div className="title">{slide.title}</div>}
          {slide.nextTitle && <div className="next">Next: {slide.nextTitle}</div>}
          {slide.notes && <pre className="notes">{slide.notes}</pre>}
        </section>
      )}

      <section className="pad">
        <button className="prev" onClick={() => click({ type: 'prev' })}>◀</button>
        <button className="next" onClick={() => click({ type: 'next' })}>▶</button>
      </section>

      <section className="row">
        <button onClick={() => click({ type: 'first' })}>⏮</button>
        <button onClick={() => click({ type: 'blank' })}>●</button>
        <button onClick={() => click({ type: 'last' })}>⏭</button>
        <button className="danger" onClick={() => click({ type: 'end' })}>Exit</button>
      </section>

      {presentations.length > 0 && (
        <section className="switch">
          <h3>Switch presentation</h3>
          <ul>
            {presentations.map((p) => (
              <li key={p.id} onClick={() => pick(p.id)}>
                <span>{p.title}</span>
                <span className="kind">{p.kind}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function send(ws: WebSocket, msg: WireMessage): void {
  if (ws.readyState !== ws.OPEN) return;
  try { ws.send(JSON.stringify(msg)); } catch {}
}
