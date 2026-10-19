# Stream switcher and separate LED graphics

The **Stream** tab controls stream Preview/Program. The LED operator switches
four independent, always-on browser sources in OBS/ATEM: presenter,
player cards + Ban & Pick, interval, and bracket. There is no LED controller dashboard.
Shared match, player, ban/pick and bracket data still updates both outputs.

## Pages

All pages are 1920x1080 under `http://localhost:9090/bundles/rashinban/graphics/`.
`info-stream.html` renders Stream **Program** by default; append
`?channel=preview` for the Stream switcher monitor. LED pages are always on.
LED cards follow Stream **Program** pagination even with an old
`?channel=preview` URL; neither Stream visibility nor player/position selection
affects the LED layout.

| Page | Output | Shows |
| --- | --- | --- |
| `presenter.html?role=program` | stream | Duels presenter (unchanged, see [presenter/obs.md](presenter/obs.md)) |
| `info-stream.html` | stream | Player cards, lower third, caster title bar / nameplates / sponsor banner, Ban & Pick, Interval, Bracket |
| `presenter-led.html` | LED | Duels presenter in the LED layout (top 1920x576 band, black below) |
| `info-led.html` | LED | Both player cards + Ban & Pick, always on |
| `bracket-led.html` | LED | Finals bracket, always on; embedded KV video with translucent red/blue tint |
| `interval-led.html` | LED | Interval with embedded KV video, always on |
| `brackets-finals.html` | stream | Standalone finals bracket with embedded KV video, always on |

Unchanged: `banpick-player.html` (tablet),
`presenter-audio.html`. Removed: `banpick-stream.html`, `banpick-led.html`,
`player-cards.html`, `casters.html`.

## Bus model

The `broadcast` replicant retains `{ stream, led }` for persisted-state and
API compatibility, but only the **stream** bus controls these graphics.
The Stream switcher edits `stream.preview`; **TAKE** copies it to
`stream.program`; **Revert preview** restores preview from program.
Companion routes cut Stream Program directly. Only the card page selection
(`profile`, `stats` for Results, or `compact`) also changes the LED cards.
Legacy `led` bus fields and routes no longer affect any LED source.

Live **content** is not in the buses and changes on air immediately from the
Shared tab: the current match (players, round), the finals
bracket, and the Ban & Pick state (picks, bans, next game, undo, reset). Only visibility is
switched.

Stream defaults: every layer hidden except the caster title bar (on).
LED defaults: sources are always on; cards show Profile until a Stream
Program page is selected. Missing match data still clears and hides cards. Text fields
accept up to 120 characters. Invalid patches are rejected and nothing changes.

### Layers

| Output | Layer | Controls |
| --- | --- | --- |
| stream | Player cards | visible; page `profile` / `stats` / `compact`; player; position |
| stream | Lower third | visible; mode `match` (current match) / `text`; title; subtitle |
| stream | Casters | title bar + sponsor banner; left/right/center visibility and name dropdowns |
| stream | Ban & Pick | visible |
| stream | Interval | visible; minutes, Start, Pause/Resume, Clear, live countdown |
| stream | Bracket | visible |
| LED | Presenter | always on, selected in OBS/ATEM |
| LED | Player cards + Ban & Pick | always on; both cards follow Stream Program page |
| LED | Bracket | always on; top 1920x576 band |

Use separate 1920x1080 browser sources for LED; the wall maps the top
1920x576 pixels. Switch between them in OBS/ATEM. Keep sources running when
hidden if the next screen needs to be ready immediately.

Use **Stream → Interval** or **Stream → Bracket**, inspect Preview, then press **TAKE**. Selecting either fullscreen scene turns the other off in Preview. Existing overlays remain staged underneath. The Interval row has a minutes field, **Start**, **Pause/Resume**, **Clear**, and a live countdown. These timer buttons apply immediately to both outputs without changing scene visibility. Content and bracket source settings remain in **Shared → Interval** and **Shared → Bracket**; there are no expandable control panels in the switcher.

Interval and bracket embed the muted, looping `assets/videos/KV/RASHINBAN2026_loop_001.mp4`. Hidden scenes pause the video. NodeCG serves the existing local file at `/rashinban/media/background/kv.mp4`; restart after building to register this route. Worktrees inherit the shared installation's file when no local copy exists. No separate OBS video source is needed for these scenes.

`bracket-led.html` keeps its top 1920x576 layout and transparency below the band, cropping the video to fill that band. Stream uses the original 1920x1080 designer layout in both `info-stream.html` and standalone `brackets-finals.html`. Bracket backgrounds retain the 50% black scrim and 10% red/blue bands; match boxes, text and connectors stay fully opaque. Choose live start.gg or recorded sample data in **Shared → Bracket**.

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
| Shared | Current Match, Ban & Pick, Bracket | content operator; changes are live on both outputs |
| Stream | Stream switcher (fullbleed) | stream operator |

The Stream switcher tab has PREVIEW (left) and PROGRAM (right) monitors, the layer
strip, **TAKE** and **Revert preview**. The monitors are scaled iframes of
the info page; ticking **Presenter monitors** also loads the presenter page
(it loads Google Maps, so it is off by default and remembered per browser).
Rows whose preview differs from program are highlighted. **Space** or
**Enter** triggers TAKE when focus is not on an input, select, text area or
button; modifier combinations are ignored.

Presenter monitors open `presenter.html?role=preview` (silent, never a
program candidate). Expect them in the Duels Presenter client list while
Presenter monitors are enabled in the Stream switcher.

The Ban & Pick panel no longer has a show/hide overlay button. Caster names
and visibility are both controlled from Stream; there is no Shared Casters panel.

## Companion (Generic HTTP, POST, no body)

Mounted under `http://<this-machine>:9090/rashinban`. Each route answers with
the output's program layers as JSON, or `400 {"error": ...}` on bad input.

| Route | Effect |
| --- | --- |
| `/broadcast/stream/take` | Stream Program = Preview; also updates LED card pagination |
| `/broadcast/stream/revert` | Stream Preview = Program |
| `/banpick/show`, `/banpick/hide`, `/banpick/toggle` | stream program Ban & Pick visibility |
| `/playercards/show`, `/playercards/hide`, `/playercards/toggle` | stream program player cards visibility |
| `/playercards/profile`, `/playercards/stats`, `/playercards/flip` | stream program player cards page |
| `/casters/1/show|hide|toggle`, `/casters/2/show|hide|toggle`, `/casters/3/show|hide|toggle` | stream program caster card 1 (left) / 2 (right) / 3 (center) |

The layer routes cut **Stream Program**. Card page changes also appear on
LED; Stream show/hide and player/position changes do not. Legacy
`/broadcast/led/take` and `/broadcast/led/revert` still update the saved LED
bus for compatibility but have no effect on the graphics. `/banpick/undo`
and `/banpick/reset` still edit shared content. `/startgg/refresh`,
`/sheet/refresh` and `/bracket/refresh` are unchanged.

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
the reveal. The page stays on regardless of the old LED visibility state;
use OBS/ATEM to select or blank the venue output. The Duels Presenter panel
has an **LED graphic** launch link.

## Upgrading LED sources

- Restart NodeCG and refresh the dashboard to remove the LED switcher panel
  and register `bracket-led.html` in the graphics list.
- Keep `presenter-led.html` and `info-led.html`, but use them as independent
  sources. Add `bracket-led.html` as the third LED source with the background
  video underneath it. Bracket is no longer part of `info-led.html`.
- Existing saved LED visibility settings can remain; they do not blank the
  pages. Prepare the card page in Stream Preview and TAKE it to update both
  LED cards. Page changes work even while Stream cards are hidden.
- Stream setup and shared content controls retain their existing behavior.

## Validation

Run `npm run typecheck`, `npm test`, `npm run build`, then
`node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/validate-player-cards.mjs`.
Use `--led-only` for the focused LED check. It exercises built browser pages
with isolated fixtures and saves screenshots under `artifacts/player-cards/`.
Actual OBS/ATEM compositing and LED-wall acceptance still need a venue check.
