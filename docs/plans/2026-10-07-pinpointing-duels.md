# Pinpointing Duels Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the first-to-7 Pinpointing Duels ruleset to the NodeCG presenter (dashboard toggle, derived points, verdict choreography, point counters) and to the player userscript (settings toggle, points HUD).

**Architecture:** A pure rules core (`pinpointing-core.ts`) folds settled rounds into points, mirroring `tie-range-core.ts`. The extension captures the rule per game in the existing rule context, derives a `DuelState` with `pinpointing` metadata and a custom finish, and the timeline/projection/graphic consume a new `verdict` scoring stage. The userscript reuses its transport and context persistence, adding guess timings and a pinpointing display branch.

**Tech Stack:** TypeScript (strict, `.ts` imports, type stripping), `node:test` + `node:assert/strict`, esbuild bundles, NodeCG Replicants, Tampermonkey userscript.

Design: `docs/superpowers/specs/2026-10-07-pinpointing-duels-design.md`.

Run all commands from the worktree root. Test command for one file:
`node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test <file>`.
Finish every task with `npm run typecheck`. Commit after each task with the
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer.

---

### Task 1: Shared rules core

**Files:**
- Create: `bundles/rashinban/src/presenter/pinpointing-core.ts`
- Test: `bundles/rashinban/src/presenter/tests/pinpointing-core.test.ts`

**Step 1: Write failing tests** covering: solo 5K gives 2; both 5K gives 1 to the earlier time, nothing on equal or null time; closest gives 1 with band 0; Full band makes 4000 vs 3000 a tie and 4000 vs 2999 a point; Half band; equal scores tie; totals accumulate; match point at 5; terminal when a side reaches 7 including 6 → 8 via solo 5K; rounds after terminal ignored; validation errors for gaps, bad scores, bad team IDs.

**Step 2: Run** the test file. Expected: FAIL (module not found).

**Step 3: Implement**

```ts
import { tieRangeBand, type TieRangeBandMode } from './tie-range-core.ts';

export const FIRST_TO = 7;
export type PinpointingReason = 'fastest-5k' | 'solo-5k' | 'closest' | 'tie';
export type PinpointingSettledRound = { round: number; scores: [number, number]; guessedAtMs: [number | null, number | null] };
export type PinpointingInput = { teamIds: [string, string]; tieRange: TieRangeBandMode; rounds: PinpointingSettledRound[] };
export type PinpointingRoundOutput = PinpointingSettledRound & {
  points: [number, number]; totalsBefore: [number, number]; totalsAfter: [number, number];
  winner: 0 | 1 | null; reason: PinpointingReason; band: number; withinBand: boolean; fiveKs: 0 | 1 | 2;
};
export type PinpointingOutput = {
  teamIds: [string, string]; firstTo: number; tieRange: TieRangeBandMode; rounds: PinpointingRoundOutput[];
  totals: [number, number]; matchPoint: [boolean, boolean]; terminal: { round: number; winnerTeamId: string } | null;
};
export function foldPinpointing(input: PinpointingInput): PinpointingOutput { /* validate, fold, stop at FIRST_TO */ }
```

Validation mirrors `validateInput` in `tie-range-core.ts` plus `guessedAtMs` entries being `null` or finite numbers, and `tieRange` one of off/full/half.

**Step 4: Run tests.** Expected: PASS. **Step 5: Commit** `feat(presenter): add pinpointing rules core`.

### Task 2: Settings and configuration schema

**Files:**
- Modify: `bundles/rashinban/src/presenter/settings.ts` (add `pinpointing: { enabled: boolean }` to type, defaults, parse with migration default, unknown-key rejection)
- Modify: `bundles/rashinban/src/config/schema.ts:58` (allowlist `pinpointing` → `['enabled']`)
- Test: `bundles/rashinban/src/presenter/tests/settings.test.ts` (migration keeps other fields; rejects `{ enabled: 1 }`, extra keys, null)
- Modify: `docs/configuration.md` example to include `"pinpointing": { "enabled": false }`.

TDD as in Task 1. Commit `feat(presenter): add Pinpointing Duels setting`.

### Task 3: Rule context captures pinpointing

**Files:**
- Modify: `bundles/rashinban/src/presenter/tie-range-context.ts`: `RuleContext = { mode; pinpointing: boolean; source }`; `updateRuleContext(previous, source, configured: { mode: TieRangeMode; pinpointing: boolean }, rollbackRound?)`. Latch both on new game. Freeze settled rounds when `previous.mode !== 'off' || previous.pinpointing`. Read `previous.pinpointing ?? false` for old persisted contexts.
- Modify callers: `extension/presenter/register.ts:217-218`, `dashboard/presenter-control.ts:144-151` (status shows `Pinpointing Duels` and tie-range per active/next duel).
- Test: `bundles/rashinban/src/presenter/tests/tie-range-context.test.ts` (update signature; add: pinpointing latches, old context without field reads false, frozen with pinpointing on and tie range off).

Commit `feat(presenter): capture Pinpointing Duels per duel`.

### Task 4: Presenter derivation

**Files:**
- Modify: `bundles/rashinban/src/types/presenter.ts`: `DuelState.pinpointing?: { firstTo: number; totals: [number, number]; matchPoint: [boolean, boolean]; rounds: PinpointingRoundOutput[] }`.
- Create: `bundles/rashinban/src/presenter/pinpointing.ts` exporting `derivePinpointing(state, mode: TieRangeMode): DuelState`. Reuse the completed-round validation from `tie-range.ts` (export `validatedCompletedRounds` there, or move it to a shared helper). Guess time per side: earliest `guesses[].createdAtMs` with `round === n` and `createdAtMs < rounds[n].endAtMs`; `endAtMs` must be non-null for completed rounds. Set `tieRange` metadata from the fold when mode != off; custom finish/truncation as in `deriveHealth`; server-finished-before-7 → `winnerTeamId = null`, `isDraw = false`, and export a `pinpointingWarnings(derived, raw)` helper or return `{ state, warning }`.
- Test: `bundles/rashinban/src/presenter/tests/pinpointing.test.ts` using the synthetic `state()` builder pattern from `tie-range.test.ts` plus `gs2-ws-full-duel-sequence.json` replay (assert the expected per-round reasons and totals computed from the captured scores and guess times; derive expected values by hand from the fixture and hard-code them).

Commit `feat(presenter): derive Pinpointing Duels state`.

### Task 5: Extension wiring and warnings

**Files:**
- Modify: `bundles/rashinban/src/extension/presenter/register.ts` `present()`: choose derivation by `context.pinpointing`; warning text `Pinpointing calculation unavailable: check complete round history.`; add the server-finished-before-7 warning to `ruleWarnings`.
- Test: `bundles/rashinban/src/presenter/tests/pinpointing-register.test.ts` modelled on `tie-range-register.test.ts` (`settings` helper takes `{ tieRange, pinpointing }`): latch per duel and survive restart; custom finish at 7 survives abort; missing history withholds and recovers.

Commit `feat(presenter): publish Pinpointing Duels state`.

### Task 6: Scoring sequence and projection

**Files:**
- Modify: `bundles/rashinban/src/types/presenter.ts`: `ScoreStage` adds `'verdict'`; `ScoreCalculation.pinpointing?: { points: [number, number]; reason: PinpointingReason; totalsBefore; totalsAfter; matchPoint }`; `ScoreSequence.verdictAtMs: number | null`; `ScoreProjection.verdictProgress: number`; `VisiblePlayer.points?: number; matchPoint?: boolean`.
- Modify: `bundles/rashinban/src/presenter/scoring.ts`: `scoreCalculation` pinpointing branch from `state.pinpointing.rounds`; `scoreSequence` pinpointing branch (`verdictAtMs = subtractAtMs`, `completeAtMs = verdictAtMs + duration(2500)`, flight/impact/multiplier null, `healthEndAtMs = verdictAtMs`); `scoreProjection` stage `verdict` when `verdictAtMs !== null && now >= verdictAtMs`.
- Modify: `bundles/rashinban/src/presenter/timeline.ts:56`: cue kind `collision` when a point is scored, `tie` otherwise (already follows `scoring.tied`); `hasDamage` false for pinpointing.
- Modify: `bundles/rashinban/src/presenter/projection.ts`: `points`/`matchPoint` per player from `state.pinpointing` (totalsBefore until verdict starts, totalsAfter after; outside results use `totals`).
- Tests: `scoring.test.ts`, `timeline.test.ts`, add projection assertions.

Commit `feat(presenter): verdict choreography for Pinpointing Duels`.

### Task 7: Graphic

**Files:**
- Modify: `bundles/rashinban/graphics/presenter.html` (add `<b id="verdict" hidden></b>` inside `#scoring-layer`), `presenter.css` (`body[data-ruleset="pinpointing"]` styles: counters, match point, verdict banner), `bundles/rashinban/src/graphics/presenter.ts` (`document.body.dataset.ruleset`; counters from `player.points` and `state.pinpointing.firstTo`; labels), `bundles/rashinban/src/graphics/presenter/scoring.ts` (verdict stage paints banner and hides tokens).
- Test: extend `bundles/rashinban/src/presenter/tests/scoring.test.ts` or a DOM-free helper `verdictLabel(calculation)` in `graphics/presenter/layout.ts` with unit tests (`+2 SOLO 5K`, `+1 FASTEST 5K`, `+1 CLOSEST`, `TIE · NO POINT`).

Commit `feat(graphics): Pinpointing Duels counters and verdict`.

### Task 8: Dashboard

**Files:**
- Modify: `bundles/rashinban/dashboard/presenter-control.html` (fieldset **Pinpointing Duels**, checkbox `pinpointing-enabled`, status `pinpointing-status`, help text), `bundles/rashinban/src/dashboard/presenter-control.ts` (apply/submit/status).

Commit `feat(dashboard): Pinpointing Duels toggle`.

### Task 9: Player state and decoder

**Files:**
- Modify: `tampermonkey/src/tie-range-player-state.ts`: `PLAYER_TIE_RANGE_RULES_VERSION = 2`; `PlayerGameContext.pinpointing: boolean`; settled rounds carry `guessedAtMs`; decode guesses (`teams[].players[].guesses[]` optional; `created` ISO parsed; compare with `rounds[].endTime`); `acceptPlayerSnapshot(previous, raw, configured: { mode, pinpointing })`; `outputFor` returns HP output only when `!pinpointing && mode !== 'off'`; new `pinpointingFor(context)`; migrate schema 1 contexts; `sameRound` compares timings.
- Test: `tampermonkey/src/tie-range-player-state.test.ts` (update signature; add timing decode, missing guesses → null, migration).

Commit `feat(player): decode guess timings and capture Pinpointing Duels`.

### Task 10: Player controller and view model

**Files:**
- Modify: `tampermonkey/src/tie-range-player-controller.ts`: `getConfiguredRules(): { mode; pinpointing }`; view gains `pinpointing`, `capturedPinpointing`, `configuredPinpointing`; `appliesToNextDuel` considers both; `ready` when either output exists; `off` when both off.
- Modify: `tampermonkey/src/tie-range-player-view-model.ts`: pinpointing branch (teams with `points`, `firstTo`, `matchPoint`; result with points/reason; terminal `You win 7–4`).
- Tests: controller and view-model test files.

Commit `feat(player): Pinpointing Duels view model`.

### Task 11: Player UI, animation, entry point

**Files:**
- Modify: `tampermonkey/src/tie-range-player-ui.ts` (settings panel checkbox, labels, points rendering, summary replacement with points), `tie-range-player-animation.ts` (pinpointing branch: count, verdict text, done at 3000 ms, no flight), `tie-range-player-map.ts` (band from pinpointing rounds when pinpointing), `rashinban-tie-range.user.ts` (storage key `rb-tie-range:pinpointing`, menu name, version 0.2.0, description).
- Test: `tie-range-player-animation.test.ts` for the pinpointing phase table.

Commit `feat(player): Pinpointing Duels HUD`.

### Task 12: Docs, build, final verification

- Create `docs/presenter/pinpointing.md`; update `docs/presenter/player-tie-range.md`, `docs/presenter/tie-range.md`, `README.md` pointer.
- `npm test`, `npm run typecheck`, `npm run build`; commit the rebuilt `tampermonkey/rashinban-tie-range.user.js`.

Commit `docs: Pinpointing Duels`.
