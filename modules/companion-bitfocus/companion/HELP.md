# Presentool

Drive [Presentool](https://github.com/taamrove/presentool) presentations from Bitfocus Companion.

## Setup

1. In the Presentool desktop app, open **Settings → Bitfocus Companion / API token** and click *Generate new token*.
2. Copy the token.
3. In Companion, add a new connection of type **Presentool**.
4. Fill in:
   - **Host** — IP or hostname of the machine running Presentool (often `127.0.0.1` if Companion runs on the same box).
   - **Port** — `4711` unless you changed it in Presentool's Settings → Network.
   - **API token** — the token you just generated.
5. Save. The status should turn green within a couple of seconds.

## Actions

| Action | Description |
|---|---|
| Next slide | Advance one slide |
| Previous slide | Go back one slide |
| First slide | Jump to the first slide |
| Last slide | Jump to the last slide |
| Blank screen | Toggle a black slide |
| Go to slide… | Jump to a specific slide number |
| Exit slideshow | Leave presentation mode |
| Start slideshow | Enter presentation mode |
| Switch presentation | Select another presentation from the library |

## Variables

| Variable | Description |
|---|---|
| `$(presentool:connected)` | `true` / `false` |
| `$(presentool:host)` | Connected Presentool device name |
| `$(presentool:slide_index)` | Current slide number |
| `$(presentool:slide_total)` | Total slides |
| `$(presentool:slide_title)` | Current slide's title |
| `$(presentool:slide_notes)` | Current slide's presenter notes |
| `$(presentool:next_title)` | Next slide's title |
| `$(presentool:presentation_title)` | Title of the currently-selected presentation |

## Feedbacks

- **Connected** — colours a button while the module is connected to Presentool.

## Presets

A starter button pack is included: Next, Previous, Blank, Exit. Drag them onto your Stream Deck.
