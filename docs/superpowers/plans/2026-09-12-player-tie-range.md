# Player Tie-Range Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent implementation/review tasks; execute browser exploration and final integration in the coordinator.

**Goal:** Deliver an installable standalone player userscript whose custom HP and multipliers match the presenter, ready to merge without changing main.

**Architecture:** A narrow pure scoring core shared by presenter and player adapters. A player REST adapter, persistent per-game state, polling controller, and script-owned HUD run without NodeCG. Preserve presenter behavior and validate against its fixtures.

**Tech Stack:** TypeScript, esbuild, Node test runner, Chrome CDP, Tampermonkey storage/menu APIs.

**Spec:** `docs/superpowers/specs/2026-09-12-player-tie-range-design.md`

## Global Constraints

- Two single-player teams; MOVE, NM, NMPZ. No NodeCG connection.
- User-selectable Off / Full / Half, captured per duel. Match the host manually.
- Scores are settled team results. Never reveal live opponent scores or answer locations.
- Full damage inside the tie band, integer tenths, half-to-even rounding, no terminal increments.
- Do not change main or the presenter's active worktree. Integrate committed presenter work only.
- User authorized autonomous implementation and live party exploration; no messages/invites to other people.
- Keep the finished branch/worktree for merge; no merge to main or public publishing.

### Task 1: Explore and capture player contracts

**Files:** `docs/geoguessr/samples/player-tie-range/`, `docs/presenter/player-tie-range.md`.

- [x] Inspect the signed-in browser's supported player-duel route and fetch response. Save only sanitized scoring fields, identity aliases, and relevant DOM structure.
- [x] Verify whether the player response exposes paired `roundResults`, multiplier settings, initial health, versions, round start identities, and completion.
- [x] Inspect HUD/results selectors from the rendered player page. Do not reuse guessed presenter selectors.
- [x] Record protocol differences and adjust the implementation interfaces below explicitly when evidence requires it.

### Task 2: Extract and verify shared health rules

**Files:** create `bundles/rashinban/src/presenter/tie-range-core.ts`; modify `tie-range.ts`; create `presenter/tests/tie-range-core.test.ts`.

**Interfaces:** Export `TieRangeInput`, `TieRangeOutput`, `foldTieRange(input, mode)`, `tieRangeBand(best, mode)`. Input is geometry-free: initialHealth, individual/mutual/delay tenths, maxRounds, two team IDs, ordered paired settled scores. Output includes initial/current HP/multipliers, per-round before/after values, damage, band verdict, mutual multiplier, and terminal outcome. Preserve public `deriveTieRange` and `deriveServerHealthReplica` behavior through adapters.

- [x] Write a failing contract test using only numeric input (no panorama): 6000 HP, +5 tenths individual, 0 mutual, delay 0; scores `[[4000,3500],[3500,4000]]`, Full => HP `[5250,5500]`, multipliers `[20,20]` tenths.
- [x] Add hardcoded tests for Half odd band, 5000/4999, exact tie, half-even rounding, delay/mutual increments, lethal damage, round-limit draw, and malformed/gapped history.
- [x] Run `node --experimental-strip-types --test bundles/rashinban/src/presenter/tests/tie-range-core.test.ts` and verify missing core causes failure.
- [x] Extract the existing arithmetic; replace presenter arithmetic with adaptation to the core, preserving settled-history validation and original return shape.
- [x] Run the core and existing presenter rule/context tests, then typecheck. Commit only owned files and provide test evidence.

### Task 3: Player decoder, context and controller

**Files:** `tampermonkey/src/tie-range-player-state.ts`, `tie-range-player-controller.ts`, colocated tests.

**Interfaces:** Decode unknown REST data to validated geometry-free inputs; `acceptPlayerSnapshot(previous, raw, configuredMode)` returns a persistent context and derived output or a diagnostic. Controller accepts injected fetch/storage/clock/view callbacks; production uses the browser APIs.

- [x] Add failing tests against captured sanitized player fixtures and literal outputs from Task 2.
- [x] Test exact routes, supported player membership, partial result rejection, unknown rule options, reversed team order, missing identity labels, duplicates, stale versions, next-duel mode capture, and serialization/reload.
- [x] Implement validation without requiring panoramas or copying server HP into custom results. Persist compact contexts, freeze settled inputs and use verified rollback evidence to release a suffix. Store at most ten games with independent keys.
- [x] Add controller tests with a controllable fetch boundary: old-game response arrives after navigation, repeated focus events do not overlap requests, failure keeps last valid HUD, stale label after ten seconds, backoff/timeout, stop on navigation.
- [x] Implement one in-flight request, immediate entry/focus refresh, 2.5s successful poll cadence and capped backoff. Terminal custom results remain observable for rollback and do not send any game actions.
- [x] Run focused tests and typecheck. Commit and review state/controller behavior before UI integration.

### Task 4: Installable HUD and browser verification

**Files:** `tampermonkey/src/rashinban-tie-range.user.ts`, `tie-range-player-ui.ts`, UI tests, generated userscript, `scripts/validate-player-tie-range.mjs`, documentation.

- [x] Write browser tests that execute real built UI against captured minimal native DOM: identity orientation, HP/multiplier replacement, round-result reveal, terminal outcome, remount, teardown, settings/next-duel mode, and unsupported-layout fallback.
- [x] Verify they fail before the HUD exists. Implement scoped native replacement, a script-owned HUD with isolated CSS, accessible settings and Tampermonkey storage/menu integration.
- [x] Integrate state/controller, build the userscript, and test its actual bootstrap with mocked external fetch and Tampermonkey APIs in a real Chrome browser.
- [x] Validate in the signed-in player's page without interfering with another live game; capture screenshots and inspect them. Exercise all movement modes through recorded replay inputs if additional real accounts are unavailable.
- [x] Document install path, matching host setting, scope, early finish, recovery, tested browser/API evidence, and any remaining live validation limits honestly.

### Task 5: Integrate, review and leave ready for merge

- [x] Merge the presenter's completed branch into the player branch, resolve only necessary conflicts, and repeat tests after any integration changes.
- [x] Run `npm test`, `npm run typecheck`, `npm run build`, the browser verification script, and `git diff --check`; inspect outputs and screenshots.
- [x] Obtain independent whole-branch code review; fix findings with regression tests and rerun affected checks.
- [x] Commit all intended player source, generated artifact, tests and docs. Preserve unrelated files. Record branch, commits, dependency/merge order and validation evidence in final response.

## Execution ledger

- Task 1/3 interface depends on observed player fields, not the spectator decoder. Task 2 core remains geometry-free to keep this independent.
- Task 2/3 share a core interface; controller and UI exchange one explicit view model after Task 3. Only one implementation agent writes at a time.
- Baseline: 269/270 tests pass; sheet fixture has checkout-only CRLF embedded newline. Restore original LF bytes locally; do not change CSV parser behavior.
- Ruling: use the already committed presenter branch as a dependency and merge subsequent presenter commits before final verification. This avoids duplicating rules or writing in the other agent's checkout.

## Completion evidence

- Shared core: 99d3a21; state/controller: 0a64b5b; completed presenter merged at baecc5c; HUD: 5bd48cb; disclosure review fix: c5495e3.
- All project tests: 360 passed. Typecheck and build passed. Chrome integration checks passed against the actual generated userscript.
- Independent final review approved after reproducing and fixing rollback disclosure, invisible initial diagnostics, and a deferred party-navigation race; 53 focused tests independently passed.
- Controlled live player test observed 2470?0 at 1.5? (3705 damage), both Full next multipliers 2?, and final custom HP 6000?2295 despite native loser HP zero.
- Live party and two temporary guest contexts were removed after capture. Main and the user's existing browser tab were preserved.
- Real Tampermonkey extension installation, live NMPZ, and successful live rollback remain explicit deployment validation limits, documented in docs/presenter/player-tie-range.md. Their related arithmetic/lifecycle cases are covered by controlled tests.
- Work is retained on sp4ghet/player-tie-range, ready for the user's merge into main; no push or main merge was performed.
