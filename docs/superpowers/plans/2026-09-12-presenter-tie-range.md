# Presenter Tie-range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement independent tie-range health rules, next-duel configuration, and concentric result-map circles.

**Architecture:** Preserve normalized server state in an extension-owned rule context, and derive the existing public presenter state through a pure HP fold. Persist live and replay contexts separately, latch the mode per game, and supply geometric metadata to the existing map renderer.

**Tech Stack:** TypeScript, NodeCG, node:test, Google Maps JavaScript API, esbuild; existing dependencies only.

**Spec:** `docs/superpowers/specs/2026-09-12-presenter-tie-range-design.md`

## Global Constraints

- Damage still applies inside the tie band, but both teams receive the individual multiplier increment.
- Configuration belongs in Config > Duels Presenter; changes apply to the next duel.
- Series wins remain manually controlled.
- Show these overlays only when the active duel has tie-range enabled.
- No answer/score disclosure before the existing result reveal gate.
- Use half-to-even damage rounding and tenths for multiplier arithmetic.
- Preserve raw state separately from custom state; reconnect and restart retain per-duel settings.
- A confirmed rollback may remove a custom winner; ordinary later rounds or an abort cannot.
- No additional runtime dependencies; use local captures for tests.

## File and interface map

Task 1 owns `src/types/presenter.ts`, `src/presenter/protocol.ts`, new `src/presenter/tie-range.ts`, and focused rules tests. Task 2 owns `src/presenter/tie-range-context.ts`, normalization, extension registration, settings, replicant names, dashboard controls and integration tests. Task 3 owns `src/presenter/tie-range-geometry.ts`, renderer map frames, Google overlays, result labels and their tests. All source paths below are relative to `bundles/rashinban/` unless stated otherwise.

Shared contracts introduced by Task 1:

```ts
export type TieRangeMode = 'off' | 'full' | 'half';
export type TieRangeRound = { round: number; band: number; withinBand: boolean };
// Optional additions to DuelState preserve old fixture compatibility.
ruleOptions?: { individual: number; mutual: number; delay: number; maxErrorDistance: number | null };
tieRange?: { mode: Exclude<TieRangeMode, 'off'>; rounds: TieRangeRound[] };
// individual/mutual are integer tenths; delay is an integer round count.
export function deriveTieRange(state: DuelState, mode: TieRangeMode): DuelState;
export function tieRangeBand(bestScore: number, mode: TieRangeMode): number;
```

### Task 1: Pure HP rules and protocol inputs

**Files:** Modify `src/types/presenter.ts`, `src/presenter/protocol.ts`; create `src/presenter/tie-range.ts`, `src/presenter/tests/tie-range.test.ts`.

**Interfaces:** Consume existing DuelState and captured snapshots; produce the shared contracts above. `deriveTieRange` returns its input unchanged for off; enabled mode returns a detached derived state and throws a descriptive error for incomplete or invalid rule inputs/history. It must never mutate the source.

- [ ] Write failing tests using node:test and recorded fixtures. Representative boundary assertions:

```ts
assert.equal(tieRangeBand(4000, 'full'), 1000);
assert.equal(tieRangeBand(4001, 'half'), 499);
assert.equal(tieRangeBand(5000, 'full'), 0);
// With initial 6000 HP and individual 5, mutual 0, delay 1:
// rounds [4000,3000], [3000,4000] => both multipliers 2;
// blue HP 4500, red HP 5000. Damage in round 2 is 1500.
// Full 4000/3000 is within the band; 4000/2999 is decisive.
```

Cover Full/Half, exact ties, terminal increment suppression, delayed/mutual increments, 5000/4999 and double 5K, low-score bands, knockout, later server rounds, abort after knockout, abort before knockout, maximum-round HP winner/draw, missing inputs, gaps and source immutability. Test replica arithmetic against all four full captures; provide a reusable internal fold or explicit replica export if off pass-through prevents parity testing. Validate all relevant fields, not just winner.

- [ ] Run the focused tests and record expected missing-feature failure.

```powershell
node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test bundles/rashinban/src/presenter/tests/tie-range.test.ts
```

- [ ] Implement normalization of ruleOptions only when required multiplier fields are present and valid. Missing map scale becomes null and does not block HP. Ordinary off-mode snapshots must remain usable without new fields. Implement the pure fold in round order with initial multipliers 10 tenths:

```ts
const scaled = difference * multiplierTenths;
const integer = Math.floor(scaled / 10);
const remainder = scaled % 10;
const damage = integer + (remainder > 5 || (remainder === 5 && integer % 2 !== 0) ? 1 : 0);
```

Update result healthBefore/After, damageDealt, multiplier, player current HP/multiplier, round mutual multiplier as needed. Store tie metadata per completed round. Terminal derived state uses the actual custom final round, status Finished, winnerTeamId/isDraw, aborted false, and no later rounds/guesses/results. The final answer panorama must remain available. A pre-knockout abort is still aborted. At the completed round limit compare HP, with equality a draw.

- [ ] Run focused rules/normalization tests and typecheck; record results and review the diff for spec compliance.
- [ ] Commit only this task's files with `feat: calculate presenter tie-range health rules`.

### Task 2: Persisted rule context and Config controls

**Files:** Create `src/presenter/tie-range-context.ts`, `src/presenter/tests/tie-range-context.test.ts`, `src/presenter/tests/tie-range-register.test.ts`; modify `src/presenter/normalize.ts`, `src/extension/presenter/register.ts`, `src/presenter/settings.ts`, `src/types/replicants.ts`, `src/dashboard/presenter-control.ts`, `dashboard/presenter-control.html`, settings/normalization tests.

**Interfaces:** Consume Task 1 deriveTieRange and types. Add `PresenterSettings.tieRange: {enabled:boolean; mode:'full'|'half'}`. Add persistent `presenterRuleContexts` with independent live/replay context slots, each holding `{mode:TieRangeMode, source:DuelState}`. Export:

```ts
export type RuleContext = { mode: TieRangeMode; source: DuelState };
export function updateRuleContext(previous: RuleContext | null, source: DuelState,
  configured: TieRangeMode, rollbackRound?: number): RuleContext;
```

- [ ] Write failing tests for defaults/migration, invalid fields, latching on Created, off/full/half next-game changes, same-game reconnect, persisted restart, replay restart, repeated snapshots, frozen scores and actual rollback.

```ts
const first = updateRuleContext(null, source, 'full');
assert.equal(updateRuleContext(first, {...source, version: source.version + 1}, 'half').mode, 'full');
assert.equal(updateRuleContext(first, {...source, gameId: 'next'}, 'half').mode, 'half');
const old = {...DEFAULT_SETTINGS}; delete (old as any).tieRange;
assert.deepEqual(parseSettings(old).tieRange, {enabled:false, mode:'full'});
```

- [ ] Run focused tests to establish missing behavior.
- [ ] Implement context capture/freezing of paired settled result inputs. Use the existing rollback criteria (decreasing round, reset start on DuelNewRound, reduced results/guesses), extracted to a reusable helper if necessary. Discard settled inputs at/after rollback target. Preserve previous option fields on snapshots that omit them. Use detached objects across NodeCG Replicant ownership.
- [ ] Integrate raw versus derived state into register: normalizer and telemetry consume raw state; timeline/public duel consume derived state. Preserve context through reconnect/reset; explicitly clear replay context on replay restart only. Restore same-game history and mode from persistent live context on initial attachment. Rejected malformed or obsolete messages do not alter public state. Derivation failure adds a sanitized diagnostic and withholds custom presentation instead of replacing it with server HP.
- [ ] Add dashboard inputs and show active versus configured mode. Example control markup:

```html
<fieldset><legend>Tie range</legend>
<label><input id="tie-range-enabled" type="checkbox"> Enable tie-range</label>
<label>Range<select id="tie-range-mode"><option value="full">Full</option><option value="half">Half</option></select></label>
<p id="tie-range-status"></p><p>Changes apply to the next duel.</p>
</fieldset>
```

Use textContent for status and the existing settings submission/message route. Include active off mode via context when public state has no tieRange metadata. Clear stale diagnostics after recovery.
- [ ] Exercise integration via injected connection/replay dependencies. Assert custom early finish and abort retention through published Replicants/timeline, settings edits during active rounds, restart state restoration, reconnect and undo. Run focused settings/context/register tests and typecheck.
- [ ] Commit only task files with `feat: configure and persist tie-range per duel`.

### Task 3: Geographic circles, result copy and visual acceptance

**Files:** Create `src/presenter/tie-range-geometry.ts`, `src/presenter/tests/tie-range-geometry.test.ts`; modify `src/graphics/presenter/renderer.ts`, `src/graphics/presenter/google.ts`, result label rendering/HTML/CSS as needed, renderer/scene tests; update `docs/presenter/validation.md` and spec status.

**Interfaces:** Consume derived DuelState.ruleOptions/tieRange from Task 1. Extend MapFrame with optional geometry and label data. Keep geographic calculation pure and separately testable. No change to scoreCalculation's exact-tie flag.

- [ ] Write failing geometry tests for the rounded score inversion:

```ts
const expected = -(14999250 / 10) * Math.log(2999.5 / 5000);
// best=4000, Full => threshold 3000 and outer radius expected.
// best=5000 => one 5K circle at max(25, -M/10*log(4999.5/5000)).
// best<=2500, Full => no finite outer boundary.
```

Include missing scale/guess, equal scores/distances, antimeridian, polar/world bounds, effective 25m floor, 5K/double 5K copy, off-mode absence, and no visible overlays before result reveal. Run focused tests and observe failure.
- [ ] Implement circle/annulus generation from result state, player side mapping and answer. Preserve radius accuracy on the sphere. Use native Circle for suitable outlines; a geodesic sampled path can provide dashed outlines and an annular polygon with an inner hole. Do not use the deprecated drawing library or add dependencies. Include geometry in overlay cache identity and cleanup.
- [ ] Keep markers and existing lines above subtle fill; color the inner outline by display side, use dashed neutral outer boundary, and one gold circle with no annulus for 5K. Display `5K required to tie`, `Both 5K`, or `All guesses within tie range` where appropriate. The ordinary result label names the score band and multiplier outcome. Show only after the answer gate.
- [ ] Include finite circle extents and pins in framing, account for dateline/poles, use world framing for global coverage. Omit the calculated circle on invalid map scale; preserve score explanation. Avoid obscuring markers/scoreboard.
- [ ] Run geometry/renderer/scene tests, full suite, typecheck and build. Inspect local browser replay or a faithful renderer harness at 1920x1080 for ordinary, 5K, unbounded and boundary-crossing cases; record screenshots/results in ignored artifacts. Report any unavailable actual Google imagery separately.
- [ ] Update validation documentation with actual commands/results and remaining material limitations; mark the approved design as accepted. Commit with `feat: visualize tie-range on the results map`.

### Task 4: Integration review and delivery

**Files:** Focused fixes only in files from Tasks 1-3; completion notes in this plan and validation document.

- [ ] Review the whole diff against every spec section, checking reconnect persistence, raw-state isolation, animation timing, geographic thresholds, and configuration scope.
- [ ] Address review findings with focused regression tests before changes; rerun affected tests and full required checks after final changes.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check`; record evidence and final commit IDs.
- [ ] Deliver the feature branch/worktree and validation summary. Do not publish or change live game controls.
