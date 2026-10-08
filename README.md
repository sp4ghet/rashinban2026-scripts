# RASHINBAN 2026 Scripts

Overlays and control stack for the RASHINBAN 2026 GeoGuessr tournament.
Successor to [rashinban2025](https://github.com/Zashness/rashinban2025), with
[NodeCG](https://www.nodecg.dev/) as the control layer instead of
Google-Sheets-only control. See
[docs/plans/2026-09-10-nodecg-stack-design.md](docs/plans/2026-09-10-nodecg-stack-design.md)
for the design.

## Setup

```sh
npm install
```

## Development

```sh
npm run dev     # esbuild watch + NodeCG together
```

- Dashboard: http://localhost:9090/
  - **Config**: Duels Presenter, start.gg, and Google Sheets for setup and connection recovery.
  - **LED**: the LED switcher (preview/program, TAKE) for the venue wall.
  - **Shared**: Current Match, Ban & Pick, Casters, and Bracket; content that is live on both outputs.
  - **Stream**: the stream switcher (preview/program, TAKE) for OBS.
  - Restart NodeCG after changing dashboard workspace assignments.
- Info overlays (1920×1080): `graphics/info-stream.html` (player cards, lower
  third, casters, Ban & Pick) and `graphics/info-led.html` (player cards and
  Ban & Pick, transparent over the LED presenter). Layer visibility is switched
  per output from the Stream and LED tabs; see [docs/broadcast.md](docs/broadcast.md).
  Player cards are filled from the Google Sheet players tab joined to the
  start.gg entrants. Select players or load an upcoming start.gg match in the
  "Current Match" panel; the cards, Ban & Pick and Presenter share that match.
  Column spec in [docs/sheet/README.md](docs/sheet/README.md). Flags are local PNGs under
  `graphics/assets/images/flags/` (refresh with `node scripts/fetch-flags.mjs`)
  and Noto Sans JP / Oswald are vendored OFL files under `graphics/assets/fonts/`
  (`node scripts/fetch-fonts.mjs`). The heading font kaneda-gothic loads from
  the 2025 Adobe Fonts kit (its licence forbids self-hosting); Oswald is the
  offline fallback.
- DAY2 bracket (1920×1080): `graphics/brackets-finals.html`, the top-8 layout
  ported from [rashinban2026](https://github.com/Zashness/rashinban2026). The
  "Bracket" panel picks the data: live start.gg (DAY2 group, auto-detected) or,
  for testing, a recorded phase-group sample from `docs/startgg/samples/`
  (record one with `npm run startgg:fetch`), mapped the same way.
  `POST /rashinban/bracket/refresh` re-reads it.
- Ban & Pick player tablet: `graphics/banpick-player.html` (append
  `?player=A` or `?player=B` to lock a tablet to one player). Operator panel
  "Ban & Pick" on the dashboard. Design notes in
  [docs/superpowers/specs/2026-09-11-banpick-design.md](docs/superpowers/specs/2026-09-11-banpick-design.md).

Other scripts: `npm run build` (one-shot build), `npm start` (NodeCG only,
requires a prior build), `npm run typecheck`.

Use `npm run preview -- --port 9091` in a worktree for a replay preview, or add
`--input live` for spectator testing. Worktrees inherit the main checkout's
configuration, credentials and media. Config workspace saves create local
overrides. See [configuration and migration](docs/configuration.md).

## Duels presenter

The custom 1v1 presenter supports MOVE, NM and NMPZ, whole-feed chroma or
rendered views, manual BO3 scores, round results, 5K celebrations and authored
music/cue assets. Start rounds in GeoGuessr. Replay fixtures work without a
live cookie; rendered Google imagery and live spectator acceptance require
your credentials.

- [Operator setup and recovery](docs/presenter/setup.md)
- [Media and soundtrack ownership](docs/presenter/media.md)
- [OBS rectangles, regional keying and audio](docs/presenter/obs.md)
- [Direct player video inputs and OBS setup](docs/presenter/video-inputs.md)
- [Validation evidence and outstanding event checks](docs/presenter/validation.md)

Program: `http://localhost:9090/bundles/rashinban/graphics/presenter.html?role=program`.
Separate audio: `http://localhost:9090/bundles/rashinban/graphics/presenter-audio.html?role=audio`.
LED wall: `http://localhost:9090/bundles/rashinban/graphics/presenter-led.html`
(no role parameter; always silent, top 1920×576 band). See [docs/broadcast.md](docs/broadcast.md).
Use `?role=preview` for silent graphic inspection. The dashboard includes
party selection/reconnect, side mapping, media, mute and output-mode controls.

## Player tie-range userscript

Players can use [RASHINBAN Player Tie-Range](tampermonkey/rashinban-tie-range.user.js)
to display the same custom HP and multipliers as the presenter, or the same
Pinpointing Duels points. Choose matching Off / Full / Half and Pinpointing
Duels settings before the duel; no NodeCG connection is required.
See [installation and supported games](docs/presenter/player-tie-range.md) and
[Pinpointing Duels](docs/presenter/pinpointing.md).
Build with `npm run build`; run the Chrome integration check with
`npm run validate:player`.

## Layout

- `bundles/rashinban/` — the NodeCG bundle. TypeScript sources live in
  `src/{extension,graphics,dashboard,types}`; esbuild emits JS next to the
  HTML in `graphics/`, `dashboard/`, and `extension/`.
- `cfg/nodecg.json` — NodeCG config (port 9090).
- `overlays/`, `tampermonkey/` — non-NodeCG overlays and userscripts.
- `docs/startgg/` — start.gg bracket integration notes and recorded API
  samples (`README.md`, `samples/`).
- `docs/sheet/` — Google Sheet column spec for human-authored data
  (`README.md`, `samples/players-sample.csv`).
- `docs/geoguessr/` — reverse-engineered presenter-mode protocol
  (`presenter-protocol.md`, raw captures in `samples/`) and research on the
  GeoClassics "Pinpointing Duels" ruleset (`pinpointing-duels-userscripts.md`,
  vendored scripts in `reference/`).

To add an overlay: create `src/graphics/<name>.ts` + `graphics/<name>.html`
(with `<script src="<name>.js"></script>`), and register it in the `nodecg`
section of `bundles/rashinban/package.json`. Same pattern for dashboard
panels.

## Secrets

Credentials never go in the repo. Copy `.env.example` to `.env` in the main
checkout and fill in what you need; the extension loads this shared file at
startup for the main checkout and worktrees. Process environment values take
precedence. `.env`, `.env.*`, and `.secrets/` are gitignored. Restart NodeCG
after editing credentials. Legacy `.secrets/geoguessr.json` is retained as a
migration backup; new setup uses `.env` for secrets.

- `STARTGG_TOKEN` — a start.gg **Personal Access Token** from
  https://start.gg/admin/profile/developer (expires after one year; use an
  account that is an admin of the tournament so hidden brackets are visible).
- `GEOGUESSR_NCFA` — the `_ncfa` cookie for the presenter connection.

## Companion / Stream Deck

The extension mounts plain HTTP endpoints for Bitfocus Companion's
**Generic HTTP** module (method POST, no body needed):

- `POST /rashinban/broadcast/{stream,led}/{take,revert}`
- `POST /rashinban/banpick/{show,hide,toggle,undo,reset}`
- `POST /rashinban/playercards/{show,hide,toggle,profile,stats,flip}`
- `POST /rashinban/casters/{1,2}/{show,hide,toggle}`
- `POST /rashinban/startgg/refresh`
- `POST /rashinban/sheet/refresh`

The show/hide/toggle routes cut the stream program directly; the LED output
takes from its switcher tab or `/broadcast/led/take`. Details in
[docs/broadcast.md](docs/broadcast.md). Point Companion at
`http://<this-machine>:9090/rashinban/...`.
