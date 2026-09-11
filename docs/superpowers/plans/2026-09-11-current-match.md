# Unified Current Match Implementation Plan

**Goal:** Centralize player selection and feed every overlay from the current match.
**Architecture:** Persist a match snapshot independently from the start.gg bracket.
Resolve profiles on the server and publish compatible presenter/ban-pick views.
**Tech Stack:** NodeCG, TypeScript, Node test runner, esbuild.
**Spec:** ../specs/2026-09-11-current-match-design.md

## Constraints

- Dropdown labels are username plus UID in parentheses.
- Upcoming matches appear below the selector; loading is explicit.
- No game-state changes or third-party match reporting.
- Preserve existing operator data and unrelated working-tree changes.

## Tasks

- [x] Add identity tests in `src/sheet/tests/identity.test.ts`: UID URLs normalize,
  UID-only rows parse, duplicate UID matches reject, names can change safely.
  Extend `src/sheet/players.ts` and add `src/match/identity.ts` until tests pass.
- [x] Add snapshot tests in `src/sheet/tests/current-match.test.ts`: start.gg
  imports remain stable across bracket updates, swaps retain wins, manual names
  override refreshed profiles. Implement `src/match/state.ts` pure functions.
- [x] Implement `src/extension/match.ts` with match apply/load/swap messages,
  migration from existing selection/presenter state, resolved profile publication,
  and compatible presenter/ban-pick projections. Test through a NodeCG harness.
- [x] Replace duplicated dashboard identity controls with a Current Match panel.
  Player selects use profile/registration names and UID, include manual entry,
  show upcoming matches below, and publish edits only on Apply/Load/Swap.
- [x] Query the start.gg schema and actual event registration access read-only.
  Fetch entrants with bounded pagination. Account-link fields expose no GeoGuessr
  UID for this event; use the supplied spreadsheet and document that limitation.
- [x] Update sheet schema/sample CSV and operational documentation. Run targeted
  tests, full typecheck/build/tests, and inspect the dashboard in a browser.
