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
| `info-led.html` | LED | Player cards, Ban & Pick, finals bracket; composite it over `presenter-led.html` |

Unchanged: `banpick-player.html` (tablet), `brackets-finals.html`,
`presenter-audio.html`. Removed: `banpick-stream.html`, `banpick-led.html`,
`player-cards.html`, `casters.html`.

## Bus model

The `broadcast` replicant holds `{ stream, led }`, each with `program` (on
air) and `preview` (what the operator is lining up). Everything in the buses
is **visibility and presentation**: which layers show, which card page, the
lower third mode and text, caster selections and visibility. The switcher edits preview
only; **TAKE** copies preview to program; **Revert preview** copies program
back to preview. Companion routes have no preview and cut program directly.

Live **content** is not in the buses and changes on air immediately from the
Shared tab: the current match (players, round), the finals
bracket, and the Ban & Pick state (picks, bans, next game, undo, reset). Only visibility is
switched.

Defaults: every layer hidden except the caster title bar (on). Text fields
accept up to 120 characters. Invalid patches are rejected and nothing changes.

### Layers

| Output | Layer | Controls |
| --- | --- | --- |
| stream | Player cards | visible; page `profile` / `stats` |
| stream | Lower third | visible; mode `match` (current match) / `text`; title; subtitle |
| stream | Casters | title bar + sponsor banner; left/right/center visibility and name dropdowns |
| stream | Ban & Pick | visible |
| LED | Presenter | visible (off = opaque black over `presenter-led.html`) |
| LED | Player cards | visible; page `profile` / `stats` |
| LED | Ban & Pick | visible |
| LED | Bracket | visible; fills the top 1920x576 LED band |

To show the bracket on the wall, enable **Bracket → Visible** in the LED
switcher and press **TAKE**. Hide Player cards and Ban & Pick in the same
preview if you want an unobstructed bracket; those layers draw above it.
The bracket starts hidden, including when upgrading saved broadcast state.
Choose its live start.gg or recorded sample data in **Shared → Bracket**.
The dedicated `brackets-finals.html` graphic remains available at 1920x1080
and uses the same data independently of the LED visibility toggle.

### Caster nameplates

Choose **Left**, **Right**, and **Center** in the Stream controller's Casters
row. The options come from the Google Sheet casters tab. Enable each card's
button, check Preview, and press **TAKE**. Names and visibility are staged
together; **Revert preview** restores both. Choose **none** to clear a slot.
The Center slot is an independent single nameplate in the lower center of
the picture, so it can be used alone or alongside the two upper cards.

Cards reveal outward from their center with white leading edges: name first,
role 200ms later, handle 600ms later. Each colored strip follows its leading
edge by 100ms. The quick opening eases into a 3-second settling tail; there
is no opening black wait. Cards hold until hidden (a short 220ms collapse).
Changing the selected name replays its reveal; sheet polling and unrelated
TAKE operations do not. Reduced-motion clients show/hide immediately.
Blank roles and handles are omitted. A name missing from the sheet stays
marked **not in sheet** in the dropdown and its card is hidden.

On a 1920x1080 output, the 390px cards start at (330, 180), (1200, 180), and
(765, 729). The title bar and sponsor banner retain their separate control.
Existing left/right selections migrate from `castersState` into both buses
once; the center starts empty and hidden. Restart NodeCG after updating to
remove the old Shared Casters panel, then refresh the controller and graphics.

Local reference clips live in `references/local/casters/` (`day5_kai_stephen.mov`
and `day5_sd.mov`). That directory is Git-ignored. Run `npm run build` then
`npm run validate:casters` for isolated browser checks; captures are saved in
the ignored `artifacts/casters/` directory. Add `-- --adobe-fonts` to check
with the existing Adobe Kaneda Gothic kit instead of the offline fallback.

### Ban & Pick stack

Both info pages show only the current game's selections, newest first.
The stream column starts at **(60, 60)** and is **440px** wide. The LED
column starts at **(552, 24)** and is **816px** wide, centered between the
player cards. Its full five-row Game 3 stack ends at **y=544**, within the
1920x576 LED band. Map names and labels use uppercase Kaneda Gothic, with
map names fitted to their row when necessary.

Use **Shared → Ban & Pick → Next game** after playing each game:

| Stage | Selections shown | When ready |
| --- | --- | --- |
| Game 1 | P1 ban, P2 ban, P1 pick (steps 1–3) | Play Game 1, then Next game |
| Game 2 | P2 pick (step 4) | Play Game 2; advance only at 1–1 |
| Game 3 | P2 ban, P1 ban, P1 ban, P2 ban (steps 5–8), automatic decider | Play Game 3 |

**Next game** immediately clears the on-air stack for the new stage. All
earlier choices remain unavailable on the tablet and operator board.
Input pauses after each pick until the operator advances; a 2–0 match
ends on Game 2 without advancing. The remaining Game 3 option appears at
the top, labeled **DECIDER · AUTO**, above the four bans.

On `banpick-player.html`, tap or click an option once to select it, then
tap or click the same option again to confirm. Selecting a different
option changes the pending choice. The bottom Confirm/Cancel controls
remain available; input is disabled while a confirmation is being sent.

**Undo** reverses the latest selection; on an empty newly advanced stage,
it returns to the preceding game's completed stack without removing its
pick. **Reset** clears the whole procedure and returns to Game 1.
Existing saved procedures resume on the game most recently selected.
Visibility still uses each output's Preview/TAKE controls independently.

Companion can advance with `POST /rashinban/banpick/next-game`; an unfinished
stage or completed Game 3 returns HTTP 409 without changing state.

## Dashboard

NodeCG lists workspaces alphabetically:

| Tab | Panels | Operator |
| --- | --- | --- |
| Config | Duels Presenter, start.gg, Google Sheets | setup and connection recovery |
| LED | LED switcher (fullbleed) | LED operator |
| Shared | Current Match, Ban & Pick, Bracket | content operator; changes are live on both outputs |
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

The Ban & Pick panel no longer has a show/hide overlay button. Caster names
and visibility are both controlled from Stream; there is no Shared Casters panel.

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
| `/casters/1/show|hide|toggle`, `/casters/2/show|hide|toggle`, `/casters/3/show|hide|toggle` | stream program caster card 1 (left) / 2 (right) / 3 (center) |

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
  unused and safe to delete. `castersState` is now read only for the one-time
  name migration; `banPick.visible` is scrubbed on boot.
- Companion responses changed: `/banpick/show|hide|toggle` now return the
  whole stream program layer set, and `/banpick/undo|reset` no longer
  include `visible`. Update any Companion feedback that parsed those bodies.
