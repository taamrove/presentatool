// Minimal reference cloud relay. Run with `node relay-server.example.js`.
// Forwards every "click" message arriving from a companion to whichever
// desktop has registered for the same peer id. Not production grade -- no
// auth beyond a shared token, no TLS (terminate that at your reverse proxy).
//
// Wire it up in the Presentool desktop's Settings > Network as:
//   Relay URL:  wss://your.domain/ws
//   Relay token: <shared secret>
//
// And in your companion link, append &relay=wss://your.domain/ws.

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const TOKEN = process.env.RELAY_TOKEN || 'change-me';

const desktops = new Map(); // peerId -> ws

const server = http.createServer();
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const token = url.searchParams.get('token');
  const peerId = url.searchParams.get('peer');
  const role = url.searchParams.get('role') ?? 'peer';
  if (token !== TOKEN || !peerId) { ws.close(1008, 'auth'); return; }

  if (role === 'peer') {
    desktops.set(peerId, ws);
    ws.on('close', () => { if (desktops.get(peerId) === ws) desktops.delete(peerId); });
  }

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.kind === 'click') {
      const desk = desktops.get(peerId);
      if (desk && desk.readyState === desk.OPEN) {
        desk.send(JSON.stringify(msg));
      }
    }
  });
});

server.listen(PORT, () => console.log(`relay listening on :${PORT}`));
