# Broadcast switcher, info pages and LED presenter

Two outputs leave the venue: the **stream** (OBS) and the **LED** wall. Each
has its own preview/program bus, switcher tab and pair of graphics pages.
Design: [plans/2026-10-07-broadcast-switcher-design.md](plans/2026-10-07-broadcast-switcher-design.md).

## Pages

All pages are 1920x1080 under `http://localhost:9090/bundles/rashinban/graphics/`.
Every page renders its output's **program** bus; append `?channel=preview`
to render the preview bus instead (that is what the switcher monitors do).

| Page | Output | Shows |
| --- | --- | --- |
| `presenter.html?role=program` | stream | Duels presenter (unchanged, see [presenter/obs.md](presenter/obs.md)) |
| `info-stream.html` | stream | Player cards, lower third, caster title bar / nameplates / sponsor banner, Ban & Pick |
| `presenter-led.html` | LED | Duels presenter in the LED layout (top 1920x576 band, black below) |
| `info-led.html` | LED | Player cards, Ban & Pick; transparent, composite it over `presenter-led.html` |

Unchanged: `banpick-player.html` (tablet), `brackets-finals.html`,
`presenter-audio.html`. Removed: `banpick-stream.html`, `banpick-led.html`,
`player-cards.html`, `casters.html`.

## Bus model

The `broadcast` replicant holds `{ stream, led }`, each with `program` (on
air) and `preview` (what the operator is lining up). Everything in the buses
is **visibility and presentation**: which layers show, which card page, the
lower third mode and text, caster slot visibility. The switcher edits preview
only; **TAKE** copies preview to program; **Revert preview** copies program
back to preview. Companion routes have no preview and cut program directly.

Live **content** is not in the buses and changes on air immediately from the
Shared tab: the current match (players, round), the caster names, and the
Ban & Pick board state (picks, bans, undo, reset). Only its visibility is
switched.

Defaults: every layer hidden except the caster title bar (on). Text fields
accept up to 120 characters. Invalid patches are rejected and nothing changes.

### Layers

| Output | Layer | Controls |
| --- | --- | --- |
| stream | Player cards | visible; page `profile` / `stats` |
| stream | Lower third | visible; mode `match` (current match) / `text`; title; subtitle |
| stream | Casters | title bar + sponsor banner; left card; right card |
| stream | Ban & Pick | visible |
| LED | Presenter | visible (off = opaque black over `presenter-led.html`) |
| LED | Player cards | visible; page `profile` / `stats` |
| LED | Ban & Pick | visible |

## Dashboard

NodeCG lists workspaces alphabetically:

| Tab | Panels | Operator |
| --- | --- | --- |
| Config | Duels Presenter, start.gg, Google Sheets | setup and connection recovery |
| LED | LED switcher (fullbleed) | LED operator |
| Shared | Current Match, Ban & Pick, Casters, Bracket | content operator; changes are live on both outputs |
| Stream | Stream switcher (fullbleed) | stream operator |

Each switcher tab has PREVIEW (left) and PROGRAM (right) monitors, the layer
strip, **TAKE** and **Revert preview**. The monitors are scaled iframes of
the info page; ticking **Presenter monitors** also loads the presenter page
(it loads Google Maps, so it is off by default and remembered per browser).
Rows whose preview differs from program are highlighted. **Space** or
**Enter** triggers TAKE when focus is not on an input, select, text area or
button; modifier combinations are ignored.

The monitors register as presenter clients: stream monitors open
`presenter.html?role=preview` (silent, never a program candidate) and LED
monitors open `presenter-led.html` (the `led` role). Expect them in the Duels
Presenter client list while a switcher tab is open.

The Ban & Pick panel no longer has a show/hide overlay button and the Casters
panel only selects names; visibility lives in the switcher tabs.

## Companion (Generic HTTP, POST, no body)

Mounted under `http://<this-machine>:9090/rashinban`. Each route answers with
the output's program layers as JSON, or `400 {"error": ...}` on bad input.

| Route | Effect |
| --- | --- |
| `/broadcast/stream/take`, `/broadcast/led/take` | program = preview for that output |
| `/broadcast/stream/revert`, `/broadcast/led/revert` | preview = program for that output |
| `/banpick/show`, `/banpick/hide`, `/banpick/toggle` | stream program Ban & Pick visibility |
| `/playercards/show`, `/playercards/hide`, `/playercards/toggle` | stream program player cards visibility |
| `/playercards/profile`, `/playercards/stats`, `/playercards/flip` | stream program player cards page |
| `/casters/1/show|hide|toggle`, `/casters/2/show|hide|toggle` | stream program caster card 1 (left) / 2 (right) |

The layer routes cut the **stream program bus only**. To change the LED
output from Companion, line it up in the LED switcher (or let an operator do
it) and call `/broadcast/led/take`. `/banpick/undo` and `/banpick/reset`
still edit the shared board state. `/startgg/refresh`, `/sheet/refresh` and
`/bracket/refresh` are unchanged.

## LED presenter

`presenter-led.html` shares `presenter.js` with the stream presenter and only
swaps the stylesheet (`presenter-led.css`). The wall physically shows the top
1920x576; players on stage can cover the lower part, so the HUD sits in a band:

| y | Content |
| --- | --- |
| 0-52 | player names and handles, series wins, round / game / mode |
| 52-100 | damage multipliers, HP bars, round timer (centre) |
| 104-564 | stage: the two POV windows, shared view, results, waiting / summary text |
| 576- | black (no facecams, no footer) |

The page implies the `led` client role, so no `?role=` is needed; add
`?role=preview` for a silent inspection copy. The `led` client never owns
the program or audio lease, plays the 5K celebration video muted on its own
clock and never reports effect completion, so the stream program still gates
the reveal. The LED bus **Presenter** toggle blanks the page with an opaque
black cover (the renderer keeps running underneath, so un-blanking is
instant). The Duels Presenter panel has an **LED graphic** launch link.

## Upgrading from the per-overlay pages

- Every layer starts hidden until a TAKE or a Companion cut, so after the
  update bring up the title bar and any cards in each switcher tab.
- Replace the OBS sources `banpick-stream.html`, `player-cards.html` and
  `casters.html` with `info-stream.html`; replace `banpick-led.html` with
  `info-led.html` composited over `presenter-led.html`.
- The old `playerCards` replicant row may remain in NodeCG's `db/`; it is
  unused and safe to delete. `castersState` entries lose their old `enabled`
  flag automatically, and `banPick.visible` is scrubbed on boot.
