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

Other scripts: `npm run build` (one-shot build), `npm start` (NodeCG only,
requires a prior build), `npm run typecheck`.

## Layout

- `bundles/rashinban/` — the NodeCG bundle. TypeScript sources live in
  `src/{extension,graphics,dashboard,types}`; esbuild emits JS next to the
  HTML in `graphics/`, `dashboard/`, and `extension/`.
- `cfg/nodecg.json` — NodeCG config (port 9090).
- `overlays/`, `tampermonkey/` — non-NodeCG overlays and userscripts.
- `docs/geoguessr/` — reverse-engineered presenter-mode protocol
  (`presenter-protocol.md`, raw captures in `samples/`) and research on the
  GeoClassics "Pinpointing Duels" ruleset (`pinpointing-duels-userscripts.md`,
  vendored scripts in `reference/`).

To add an overlay: create `src/graphics/<name>.ts` + `graphics/<name>.html`
(with `<script src="<name>.js"></script>`), and register it in the `nodecg`
section of `bundles/rashinban/package.json`. Same pattern for dashboard
panels.

## Companion / Stream Deck

The extension mounts plain HTTP endpoints for Bitfocus Companion's
**Generic HTTP** module (method POST, no body needed):

- `POST /rashinban/lower-third/toggle` (also `/show`, `/hide`)
- `POST /rashinban/round/increment`
- `POST /rashinban/round/decrement`

Point Companion at `http://<this-machine>:9090/rashinban/...`.
