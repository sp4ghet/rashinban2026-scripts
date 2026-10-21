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
| `info-stream.html` | stream | Fullscreen player camera, player cards, lower third, caster nameplates, Ban & Pick, Interval, Bracket |
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
`stream.program`; **SWAP** exchanges preview and program, keeping the old program
ready in preview. **Clear preview** hides every preview layer while retaining
names, card settings, relay and text. **Revert preview** restores preview from program.
Companion routes cut Stream Program directly. Only the card page selection
(`profile`, `stats` for Results, or `compact`) also changes the LED cards.
Legacy `led` bus fields and routes no longer affect any LED source.

Live **content** is not in the buses and changes on air immediately from the
Shared tab: the current match (players, round), the finals
bracket, and the Ban & Pick state (picks, bans, next game, undo, reset). Only visibility is
switched.

Stream defaults: every layer hidden.
LED defaults: sources are always on; cards show Profile until a Stream
Program page is selected. Missing match data still clears and hides cards. Text fields
accept up to 120 characters. Invalid patches are rejected and nothing changes.

### Monitor startup recovery

If an embedded monitor finishes loading without the NodeCG client API, the
switcher reloads only that monitor, up to twice. A persistent failure shows
**Reload monitor**. Recovery does not send TAKE, change broadcast state, or
reload the OBS graphic. Intentional NodeCG busy/killed pages remain visible.
External font stylesheets load without blocking graphic startup.

### Layers

| Output | Layer | Controls |
| --- | --- | --- |
| stream | Player cameras | Player Camera 1 / Player Camera 2; relay name |
| stream | Player cards | visible; page `profile` / `stats` / `compact`; player; position |
| stream | Lower third | visible; mode `match` / `scores` / `text`; Coming up (match mode); title/subtitle (text mode) |
| stream | Casters | L/R Caster toggle, Left dropdown, Right dropdown, Center Card toggle, Center dropdown |
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

### Lower thirds

In **Stream → Lower third**, select the mode, turn **Visible** on, inspect
Preview, then **TAKE**. Visibility, mode and **Coming up** are staged together;
**Revert preview** restores all three from Program.

- **Between games · Scores**: the designer's two 698×81 rows at the bottom
  left. P1/current-match left is red, P2/right is blue. Names, handles and
  series wins update live from **Shared → Current Match**. Empty handles disappear.
- **Between matches · Matchup**: the supplied compass SVG, current match
  label above the matchup, with no scores. **Coming up** independently shows
  the upcoming matchup at the bottom right, using the **Next Match** selection.
  It is hidden by default and only appears in this mode.
- **Free text** uses the same compass, typography and positioning as Between
  matches, with the operator's title and subtitle in place of the match data.

Both designer layouts are transparent overlays for `info-stream.html`, using
Kaneda Gothic from the existing Adobe Fonts kit. Long labels and names compress
horizontally to fit. The supplied `Vector.svg` is stored unchanged as
`graphics/assets/logos/lower-third-compass.svg`. Match content is live shared
data; TAKE stages the layout controls, not a snapshot of the players or scores.
Restart NodeCG after building so the extension accepts the new score mode and
Coming up field, then refresh the switcher and OBS browser source.

Visual and control validation (requires the Adobe font kit to load):
`node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/validate-player-cards.mjs --lower-thirds-only --adobe-fonts`.
Screenshots are written to `artifacts/lower-thirds/`; the check covers both
designs, coming-up visibility, score updates, long names, missing data, and
the real switcher's Preview/TAKE/Revert flow. OBS compositing still needs a
production check.

### Fullscreen player cameras

In **Stream > Player cameras**, select **Player Camera 1** or **Player Camera 2**,
check the Preview placeholder and overlay layout, then press **TAKE**. Each
camera fills 1920x1080 with a centered crop. Selecting a camera deselects the other in Preview;
clicking the selected camera again hides it and its player card. **Revert preview**
restores Program's camera, card settings, and relay name. There is no side-by-side mode here.

Camera selection and player cards are linked in the dashboard: enabling Camera 1
shows P1's card, and enabling Camera 2 shows P2's card. The card's **Visible**
control shows/hides its matching camera, and its **Player** selector changes the
camera while preserving visibility. These changes are staged together until TAKE.

Switching from **P1 / Left / Page 2** to P2 defaults to **P2 / Right / Page 1**.
Switching from **P1 / Left / Compact** to P2 defaults to **P2 / Right / Compact**.
Both the camera buttons and card player selector default position to **Left for
P1** and **Right for P2** whenever the selected player changes. The **Position**
dropdown remains available for emergency overrides; an override lasts until the
next player swap. Other page selections are preserved.

Start the existing [capture relay](presenter/video-inputs.md#share-inputs-through-the-webrtc-relay)
and assign **Left player camera** for Camera 1 and **Right player camera**
for Camera 2. Keep its capture page open. The switcher's **Relay** field
must match that page's room (default `main`; 1-64 letters, digits, underscores
or hyphens). Relay changes are also staged until TAKE.

The cameras are the bottom layer of `info-stream.html`: cards, lower thirds,
caster graphics, Ban & Pick, Interval and Bracket all remain above them.
Both dashboard monitors show a labeled **Player Camera 1** or **Player Camera 2**
placeholder: **magenta for P1/red**, **cyan for P2/blue**. The solid colors make
full-frame opacity obvious. They use `cameraMode=placeholder` and never subscribe to the
camera relay, avoiding the extra encoding, network and decoding work of two
more receivers. Placeholders show the selected layout, not camera availability;
check the actual output or capture page to verify the camera feed.

The actual `info-stream.html` graphic receives live video by default. Both
cameras stay connected and play silently in the background while it is open.
Camera toggles, TAKE and Revert only change visibility, so a ready
feed is revealed without a fresh connection. Hiding both cameras keeps them
warm; changing the relay or unloading the page releases the old feeds.
Keep the OBS browser source loaded to retain this preloading.
Cameras only receive relay video; they do not open devices or take the
presenter program/audio lease.
Missing feeds show a neutral placeholder and reconnect when available.
Both cameras default to hidden in existing saved broadcasts.

After building, restart NodeCG to load the extended broadcast schema and
refresh the Stream panel and info-stream browser source. The presenter
camera layouts and LED sources keep their existing behavior.

For a local browser check with synthetic cameras:

```powershell
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/validate-info-cameras.mjs
```

The check verifies that both switcher iframes stay free of camera relay
subscriptions while showing full-frame placeholders through TAKE/Revert and
relay changes. It also checks live output negotiation, preloading, overlay
ordering and publisher recovery. Evidence is in
`artifacts/presenter-validation/info-cameras/`.
Physical camera/OBS acceptance remains an event-machine check.

### Caster nameplates

Choose **Left**, **Right**, and **Center** in the Stream controller's Casters
row. The options come from the Google Sheet casters tab. **L/R Caster** toggles
both side cards together; **Center Card** toggles the center independently.
Check Preview, then press **TAKE** or **SWAP**. Names and visibility are staged
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
(765, 729). The caster title bar and sponsor banner have been removed.
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
The stream column starts at **(73, 77)** and is **450px** wide. The LED
column starts at **(540, 24)** and is **840px** wide, centered between the
player cards at x=36 and x=1404 with 24px gutters. Its 50px header is followed
by a 32px gap and 80px rows separated by 12px gaps. The full five-row Game 3
stack ends at **y=554**, within the
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
strip, **Clear preview**, **Revert preview**, **SWAP** and **TAKE**. The monitors are scaled iframes of
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

The Stream startup regression is
`node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/validate-info-cameras.mjs --startup-only`.
It holds external font stylesheets pending while verifying both dashboard monitors
render and accept Preview/TAKE changes, then checks that late styles still apply.
Screenshots and results are saved under `artifacts/presenter-validation/info-startup/`.

The missing-API recovery regression is
`node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/validate-info-cameras.mjs --recovery-only`.
It injects the missing NodeCG constructor, verifies automatic and manual recovery,
checks the retry limit and intentional redirects, and confirms that Preview and
broadcast state remain unchanged while Program recovers. Results and screenshots
are saved under `artifacts/presenter-validation/info-recovery/`.
