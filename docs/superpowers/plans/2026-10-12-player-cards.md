# Player Cards Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add manually selected Profile, Results, and Compact player cards, showing one player at a time on stream.

**Architecture:** Extend the existing broadcast preview/program state and switcher. A pure results model reads completed start.gg sets; the shared card renderer uses it for both stream and LED outputs.

**Tech Stack:** TypeScript, NodeCG, existing HTML/CSS, node:test, Chrome CDP for visual verification.

**Spec:** Updated conversation of 2026-10-12: Page 1 unchanged; Page 2 shows the latest five completed tournament matches; Compact contains Age, Rating, Favorite Mode, Strengths, and the latest three completed matches. Both histories are newest first across all dates, before the selected current match. Operators choose modes manually. Stream shows one selected player; LED retains both. No date or history-page controls. Existing Preview/Take semantics remain.

## Global Constraints

- Preserve unrelated working-tree edits and all live runtime state.
- Reuse the existing card colors, positioning, profile fields, and Google Sheet rating field.
- Do not automate mode selection or mutate the bracket or spreadsheet.
- Keep the legacy `stats` page key and Companion route compatible, labeling it Results in the UI.
- Implement in the requested checkout; leave changes uncommitted for review.

## Review Focus

- Recent games must span dates and select only this player's latest five or three eligible matches.
- Scores must be oriented to the displayed player, including losses and DQs.
- Current/future matches, byes, and incomplete results must not appear as played matches.
- Old persisted broadcast state must receive safe defaults; controls must not bypass TAKE.
- Long Japanese names, missing profiles, and many result rows must remain legible and bounded.

### Task 1: Results model and broadcast controls

**Files:** `src/broadcast/player-card-results.ts`, `state.ts`, `switcher-model.ts`, `src/dashboard/switcher.ts`, and broadcast tests under `bundles/rashinban/`.

**Interfaces:** `playerCardResults(bracket, player, profiles, currentSetId, limit, now)` returns newest-first results plus availability state, limited to five or three. Card state gains `player: left|right` and `page: compact`. Persisted obsolete date/page fields are discarded.

- [x] Add failing tests for recent games across dates, identity joins, score orientation, missing data, and current/future exclusions.
- [x] Add broadcast tests for manual controls, persistence migration, and Preview/Take.
- [x] Implement the model and extend the switcher with Mode and Player (stream only).
- [x] Run `node --experimental-strip-types --test bundles/rashinban/src/broadcast/tests/*.test.ts`; expect all passing.

### Task 2: Cards, integration, and verification

**Files:** `src/graphics/layers/player-cards.ts`, `src/graphics/info-stream.ts`, `src/graphics/info-led.ts`, `graphics/info.css`, `src/extension/broadcast.ts`, `scripts/validate-player-cards.mjs`, and `docs/player-cards.md`.

**Interfaces:** `mountPlayerCards(host, output)` uses the broadcast state from Task 1 and subscribes to match, player directory, and bracket replicants.

- [x] Replace old statistics with result rows; add Compact by reusing the profile core fields.
- [x] Stream hides the unselected card; LED retains both. Clear stale content when the match disappears.
- [x] Add compatible Companion controls and document the operator workflow.
- [x] Verify actual stream/LED and switcher bundles in headless Chrome, including long text, many rows, missing data, mode/player selection, and TAKE; save screenshots.
- [x] Run `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check`; expect success.
- [x] Request one independent code review and address material findings with regression coverage.

## Execution Notes

- Baseline: 562 tests passed before edits.
- Execution choice: implement inline in the current checkout, as authorized by the user; no branch, commit, live-state write, or deployment is needed.
- Latest revision replaces the original previous-day filter and manual pagination with automatic recent games: five on Results and three on Compact. History selection runs only for visible results cards; Profile and hidden cards skip it.
- Review: found tag-only manually selected profiles could not resolve bracket history. Added unique tag/name fallback with ambiguity protection and a failing regression test before the fix. Existing exact entrant IDs retain precedence.
- Browser verification uses bundled fallback fonts; Adobe's externally served font is not required by the offline test. Long Japanese opponent names and missing-profile text were added to the fixture coverage.
- Latest revision: 574 tests passed; TypeScript, build, and diff checks passed. Browser checks verify newest-first five/three results, ignored obsolete settings, real EVO data, and Preview/Program iframe contents across TAKE.
