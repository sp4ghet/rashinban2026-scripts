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
- Dummy graphic (OBS browser source, 1920×1080):
  http://localhost:9090/bundles/rashinban/graphics/dummy.html
- Ban & Pick overlays (1920×1080): `graphics/banpick-stream.html` (stream),
  `graphics/banpick-led.html` (venue LED). Same data, separate CSS.
- Player cards (1920×1080): `graphics/player-cards.html`. Two cards for the
  current match, filled from the Google Sheet players tab joined to the
  start.gg entrants. Configure the sheet, pick the match (auto from start.gg,
  a chosen set, or two players picked from the sheet), and flip profile/stats in the
  "Player Cards" dashboard panel. Column spec in
  [docs/sheet/README.md](docs/sheet/README.md). Flags are local PNGs under
  `graphics/assets/images/flags/` (refresh with `node scripts/fetch-flags.mjs`)
  and Noto Sans JP / Oswald are vendored OFL files under `graphics/assets/fonts/`
  (`node scripts/fetch-fonts.mjs`). The heading font kaneda-gothic loads from
  the 2025 Adobe Fonts kit (its licence forbids self-hosting); Oswald is the
  offline fallback.
- Ban & Pick player tablet: `graphics/banpick-player.html` (append
  `?player=A` or `?player=B` to lock a tablet to one player). Operator panel
  "Ban & Pick" on the dashboard. Design notes in
  [docs/superpowers/specs/2026-09-11-banpick-design.md](docs/superpowers/specs/2026-09-11-banpick-design.md).

Other scripts: `npm run build` (one-shot build), `npm start` (NodeCG only,
requires a prior build), `npm run typecheck`.

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

Credentials never go in the repo. Copy `.env.example` to `.env` in the repo
root and fill in what you need; the extension loads it into `process.env` at
startup (Node's built-in `process.loadEnvFile`, no dotenv). `.env`, `.env.*`,
and `.secrets/` are gitignored. Restart NodeCG after editing it.

- `STARTGG_TOKEN` — a start.gg **Personal Access Token** from
  https://start.gg/admin/profile/developer (expires after one year; use an
  account that is an admin of the tournament so hidden brackets are visible).
- `GEOGUESSR_NCFA` — the `_ncfa` cookie for the presenter connection.

## Companion / Stream Deck

The extension mounts plain HTTP endpoints for Bitfocus Companion's
**Generic HTTP** module (method POST, no body needed):

- `POST /rashinban/lower-third/toggle` (also `/show`, `/hide`)
- `POST /rashinban/round/increment`
- `POST /rashinban/round/decrement`
- `POST /rashinban/banpick/{show,hide,toggle,undo,reset}`
- `POST /rashinban/startgg/refresh`
- `POST /rashinban/sheet/refresh`
- `POST /rashinban/playercards/{show,hide,toggle,profile,stats,flip}`
- `POST /rashinban/match/auto` (return current-match selection to automatic)

Point Companion at `http://<this-machine>:9090/rashinban/...`.
