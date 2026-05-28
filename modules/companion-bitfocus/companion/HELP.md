# Presentatool

Drive [Presentatool](https://github.com/taamrove/presentool) presentations from Bitfocus Companion.

## Setup

1. In the Presentatool desktop app, open **Settings → Bitfocus Companion / API token** and click *Generate new token*.
2. Copy the token.
3. In Companion, add a new connection of type **Presentatool**.
4. Fill in:
   - **Host** — IP or hostname of the machine running Presentatool (often `127.0.0.1` if Companion runs on the same box).
   - **Port** — `4711` unless you changed it in Presentatool's Settings → Network.
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
| `$(presentatool:connected)` | `true` / `false` |
| `$(presentatool:host)` | Connected Presentatool device name |
| `$(presentatool:slide_index)` | Current slide number |
| `$(presentatool:slide_total)` | Total slides |
| `$(presentatool:slide_title)` | Current slide's title |
| `$(presentatool:slide_notes)` | Current slide's presenter notes |
| `$(presentatool:next_title)` | Next slide's title |
| `$(presentatool:presentation_title)` | Title of the currently-selected presentation |

## Feedbacks

- **Connected** — colours a button while the module is connected to Presentatool.

## Presets

A starter button pack is included: Next, Previous, Blank, Exit. Drag them onto your Stream Deck.
