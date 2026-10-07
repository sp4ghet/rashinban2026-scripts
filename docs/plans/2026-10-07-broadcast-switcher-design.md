# RASHINBAN 2026 — Broadcast Pages and Switcher Design

Date: 2026-10-07

## Goal

Collapse the eight graphic pages into four output pages that match the real
broadcast scenes, and give each output's operator a video-switcher style
panel: a preview bus they edit freely, a program bus that is on air, and a
TAKE button that cuts preview onto program atomically.

Two people operate the show: one for the stream, one for the venue LED.
They need separate workspaces, but content such as the current match,
caster names and ban-pick picks is shared and edited once.

## Outputs

| Page | Size | Content |
| --- | --- | --- |
| `presenter.html` | 1920x1080 | Stream presenter, unchanged |
| `presenter-led.html` | 1920x1080, top 1920x576 used | LED presenter layout, same `presenter.js` logic, own CSS |
| `info-stream.html` | 1920x1080 | Player cards, lower third, casters title bar + nameplates, ban & pick |
| `info-led.html` | 1920x1080 | Player cards, ban & pick |

Removed pages: `player-cards.html`, `casters.html`, `banpick-stream.html`,
`banpick-led.html`. Unchanged: `banpick-player.html`, `brackets-finals.html`,
`presenter-audio.html`.

Every page accepts `?channel=preview`; the default is `program`. The channel
selects which bus the page renders. Presenter pages keep `?role=`; the
switcher's monitors open them as `role=preview` so they never take the
program lease or emit audio.

## Layers

Each overlay becomes a module in `bundles/rashinban/src/graphics/layers/`:
`player-cards.ts`, `lower-third.ts`, `casters.ts`, `banpick.ts`. A layer
module mounts into a host element, subscribes to its content replicants
(`matchResolved`, `casters`, `banPick`), and exposes one `apply(state)` call
that sets visibility and per-layer options. The info pages are thin: they
compose the layers, pick the output's accent styling, and bind the bus.
The ban & pick board markup and the caster card markup move out of the
deleted pages into the layer modules unchanged.

The lower third is new. In `match` mode it shows left vs right names,
handles, flags and the match label from `matchResolved`. In `text` mode it
shows an operator-typed title and subtitle.

## Bus state

One new replicant, `broadcast`:

```ts
type StreamLayers = {
  playerCards: { visible: boolean; page: 'profile' | 'stats' };
  lowerThird: { visible: boolean; mode: 'match' | 'text'; title: string; subtitle: string };
  casters: { titleBar: boolean; slots: [boolean, boolean] };
  banpick: { visible: boolean };
};
type LedLayers = {
  playerCards: { visible: boolean; page: 'profile' | 'stats' };
  banpick: { visible: boolean };
  presenter: { visible: boolean }; // blank the LED presenter between matches
};
type Broadcast = {
  stream: { program: StreamLayers; preview: StreamLayers };
  led: { program: LedLayers; preview: LedLayers };
};
```

Defaults: everything hidden, lower third in `match` mode, caster title bar on.

Messages, handled by a pure reducer in `bundles/rashinban/src/broadcast/`:

| Message | Payload | Effect |
| --- | --- | --- |
| `broadcast:setPreview` | `{ output, patch }` | Deep-merge a validated partial into that output's preview |
| `broadcast:take` | `{ output }` | `program = preview` for that output, in one replicant write |
| `broadcast:revertPreview` | `{ output }` | `preview = program` for that output |

Visibility leaves the content replicants: `banPick.visible` and the
`playerCards` replicant are removed, and `castersState` keeps only the chosen
names per slot. The existing Companion routes (`/banpick/show|hide|toggle`,
`/playercards/*`, `/casters/N/show|hide|toggle`) stay and act on the stream
**program** bus directly, as a cut. They are joined by
`POST /rashinban/broadcast/:output/take` and `/revert`.

## Dashboard

| Workspace | Panels |
| --- | --- |
| Stream | Stream switcher (fullbleed) |
| LED | LED switcher (fullbleed) |
| Shared | Current Match, Ban & Pick (board, names, undo, reset), Casters (name selection only), Bracket |
| Config | Duels Presenter, start.gg, Google Sheets (as today) |

Both switcher panels are the same entry, `switcher.ts`, parameterised by the
output in the panel URL. The panel has two parts.

**Multiview.** PREVIEW on the left, PROGRAM on the right. Each monitor stacks
two iframes, the info page over the presenter page, scaled with a CSS
transform to about 480x270. The LED presenter monitor shows the 576px band
and the black below it. The presenter iframes load Google Maps, so they are
off by default behind a "Presenter monitors" checkbox remembered in
localStorage.

**Layer strip.** One row per layer with its toggle and options (player card
page, lower third mode and text, caster slot buttons and title bar, LED
presenter visibility). Every control edits preview only. Rows whose preview
differs from program are highlighted so the operator can see what TAKE will
change. A large TAKE button and a smaller Revert preview button close the
strip. Space or Enter on the focused panel triggers TAKE.

## LED presenter layout

`presenter-led.html` loads `presenter.js` and `presenter-led.css`. The page
sets `data-output="led"` on `body`; presenter logic is unchanged except
where it reads that attribute to pick the client role.

Everything lives in the top 1920x576; the rest is solid black.

- Top band, y 0 to 96, left to right: left name and handle, left wins, left
  HP bar (with its damage multiplier inside), round / game / mode block,
  right HP bar, right wins, right name.
- Two POV windows of 940x460 at y 104 with a 16px gutter, each with its lock
  badge and, in rendered mode, its guess map. No camera slots, no footer.
- Results: the map centred at 1000x440 with the two score panels beside it.
- Timer under the round block, inside the band.
- 5K video at 1920x576 with `object-fit: contain`.

## Presenter client roles

`clientRole` gains `led`. An `led` client plays video cues on its own clock,
never owns audio, never reports effect completion, and is listed in the
Duels Presenter source list as "LED". The extension's role validation
accepts it. Cues are consumed by `program` and `led` clients; the audio lease
logic is unchanged.

## Migration and docs

- Bundle manifest: remove the deleted graphics and panels, add the four
  pages, two switcher panels and the new workspaces.
- Nothing persisted needs migrating; the dropped visibility fields default
  to hidden on first start.
- `docs/presenter/obs.md` and `docs/presenter/setup.md` get the new source
  URLs. A new `docs/broadcast.md` documents the switcher, the buses and the
  Companion routes.

## Testing

- `bundles/rashinban/src/broadcast/tests/`: reducer defaults, `setPreview`
  patch validation per output (unknown keys rejected, wrong types rejected),
  `take` atomicity, `revertPreview`, Companion routes acting on program.
- `presenter/tests/client.test.ts`: the `led` role plays cues but never
  completes effects or holds the audio lease.
- Pure parts of layer modules (lower-third text resolution, caster card
  model) get unit tests; DOM rendering stays thin.
- Manual: both info pages and both presenters in OBS and in a plain browser,
  preview versus program, and TAKE from each workspace.
