# RASHINBAN 2026 — NodeCG Stack Design

Date: 2026-09-10

## Goal

Replace last year's Google-Sheets-only control scheme with NodeCG as the
control layer for stream graphics. Google Sheets stays as the data source
(scores, player info); operational controls (visibility toggles, round
advancement) move to NodeCG replicants, driven by the NodeCG dashboard or by
Bitfocus Companion (Stream Deck) via HTTP endpoints.

## Decisions

- **NodeCG as an npm dependency.** The repo root is the NodeCG "install":
  `package.json` + `cfg/` + `bundles/`. One `npm install` reproduces the whole
  stack; `npx nodecg start` runs it.
- **TypeScript** for extension, dashboard, and graphics code. Replicant shapes
  are declared once in `bundles/rashinban/src/types/` and shared across all
  three contexts.
- **Vanilla HTML/CSS/JS graphics** (no framework), matching rashinban2025's
  overlay style so last year's overlays can be ported page by page.
- **esbuild** builds everything: browser entries → IIFE bundles, extension →
  CommonJS. `npm run dev` runs esbuild watch + NodeCG concurrently.
- **Companion integration from day one:** the extension mounts an Express
  router (`nodecg.Router()` / `nodecg.mount`) with plain HTTP endpoints that
  Companion's Generic HTTP module can trigger.

## Layout

```
rashinban2026-scripts/
├── package.json            # nodecg dep; dev/build/start scripts
├── tsconfig.json
├── scripts/build.mjs       # esbuild driver (--watch supported)
├── cfg/nodecg.json         # NodeCG config
├── bundles/rashinban/
│   ├── package.json        # NodeCG bundle manifest (graphics, dashboard panels)
│   ├── src/
│   │   ├── types/          # shared replicant types + browser global decls
│   │   ├── extension/      # server: replicant defaults, HTTP router
│   │   ├── graphics/       # one TS entry per overlay
│   │   └── dashboard/      # one TS entry per panel
│   ├── graphics/           # HTML + built JS (OBS browser sources)
│   ├── dashboard/          # HTML + built JS (dashboard panels)
│   └── extension/          # built server code (gitignored)
├── overlays/               # non-NodeCG/legacy overlays
└── tampermonkey/           # userscripts
```

Built JS is gitignored; `npm run build` regenerates it.

## Dummy overlay (pipeline proof)

- Graphic `dummy.html` (1920×1080, transparent): lower-third with tournament
  name + round counter, animates in/out.
- Replicants: `lowerThirdVisible: boolean`, `round: number`.
- Dashboard panel: show/hide toggle, round +/−.
- HTTP endpoints (for Companion):
  - `POST /rashinban/lower-third/toggle`
  - `POST /rashinban/round/increment` and `/round/decrement`

This exercises every control path real overlays will use:
dashboard → replicant → graphic, and Companion/HTTP → replicant → graphic.

## Later (out of scope here)

- Google Sheets sync into replicants (extension-side poller).
- Porting real overlays (score, brackets, interval, interview).
- A dedicated Companion NodeCG module if plain HTTP proves limiting.
