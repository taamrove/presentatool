# presentool — Bitfocus Companion module

Drives [Presentool](../../) from [Bitfocus Companion](https://bitfocus.io/companion) so you can
advance slides, switch presentations, blank the screen, etc. from a Stream Deck or any other
Companion-supported surface.

## Build

```bash
cd modules/companion-bitfocus
npm install
npm run build
```

## Install in Companion

Companion 3.x supports loading developer modules from a local path. In Companion:

1. **Settings → Developer modules path** → point at this directory's parent (`modules/`).
2. Restart Companion.
3. Add a new connection of type **Presentool**.
4. Fill in:
   - Host (e.g. `127.0.0.1`)
   - Port (`4711` default)
   - API token (from Presentool's Settings → *Bitfocus Companion / API token*)

See [companion/HELP.md](companion/HELP.md) for the full list of actions, variables and feedbacks.

## How it works

The module opens a WebSocket to the Presentool desktop on `/ws` and sends a `hello` message
with `role: "controller"` and the configured API token. From then on it sends `click` messages
for every button press and receives `slide` / `presentations` updates which it surfaces as
Companion variables. The wire protocol is documented in [`docs/PROTOCOL.md`](../../docs/PROTOCOL.md).
