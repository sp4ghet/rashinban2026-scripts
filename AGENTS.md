# Repository Guidelines

## Project Structure & Module Organization

This repository provides NodeCG overlays and controls for the RASHINBAN 2026 GeoGuessr tournament.

- `bundles/rashinban/src/`: TypeScript extension, dashboard, graphics, shared types, and domain modules (`banpick`, `match`, `presenter`, `sheet`, `startgg`).
- `bundles/rashinban/graphics/` and `dashboard/`: HTML/CSS entry pages; graphic assets live in `graphics/assets/`.
- `tampermonkey/src/`: capture userscript sources and tests.
- `scripts/`: builds, asset downloads, and data utilities.
- `docs/`: integration notes, sample fixtures, designs, and presenter validation procedures.
- `cfg/`: NodeCG configuration and example bundle settings.

## Build, Test, and Development Commands

Run commands from the repository root. Use Node.js 22 or a compatible newer release supporting the test script's type-stripping flags.

- `npm install`: install dependencies.
- `npm run dev`: build, then run esbuild watch and NodeCG together; dashboard: `http://localhost:9090/`.
- `npm run build`: generate browser bundles, the server extension, and Tampermonkey userscripts.
- `npm start`: start NodeCG after building.
- `npm run typecheck`: check strict TypeScript without emitting files.
- `npm test`: run the configured Node.js test suites.

## Testing Guidelines

Tests use `node:test` and `node:assert/strict`. Test files are named `*.test.ts` in domain `tests/` directories and `tampermonkey/src/`. The `npm test` command lists suite globs explicitly in `package.json`; extend these when adding a suite elsewhere. Recorded fixtures live under `docs/`. Presenter validation procedures are documented in `docs/presenter/validation.md`.

## Configuration

Copy `.env.example` to `.env` for local credentials; the extension loads it at startup, so restart NodeCG after changes. `.env`, `.secrets/`, and local `cfg/rashinban.json` are gitignored. `cfg/nodecg.json` configures NodeCG on port 9090.

## Local Orca CLI (Windows)

The Codex sandbox PATH can differ from the user's system PATH. If `orca` is not found, use the verified installed CLI directly in PowerShell:

```powershell
& 'C:/Users/sp4ghet/AppData/Local/Programs/orca/resources/bin/orca.cmd' skills get orca-cli --json
```

Use that full path for subsequent Orca commands. Access to the installation may require sandbox escalation; a sandbox access-denied error does not mean Orca is missing. Respect `ORCA_CLI_COMMAND` or `ORCA_DEV_REPO_ROOT` when supplied by a session.
