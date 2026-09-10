# Task 2 implementation report

## Implemented

- Extended the presenter model with `Bounds`, `PlayerView`, `Views`,
  `Competitor`, and `SeriesState` using the requested public interfaces.
- Added `seedViews`, which initializes an independent view for each duel
  player from the current round panorama and current pin.
- Added structural decoding for nested `LiveStreamSamples` messages covering
  `MapDisplay`, `MapBoundingBox`, `PinPosition`, `GuessWithLatLng`,
  `PanoPosition`, `PanoPov`, and `PanoZoom`.
- Tracked timestamps independently per player and sample type. Stale samples,
  samples before a known round start, unknown players/types, and malformed or
  non-finite payloads are ignored without changing accepted state.
- Reset all view telemetry on game or round changes. Player maps remain
  independent, and antimeridian-crossing bounds retain their original east
  and west values.
- Applied movement position, POV, and zoom in MOVE; fixed the round position
  in NM while accepting POV/zoom; fixed the complete round panorama in NMPZ.
- Added field-specific manual series parsing. It requires unique competitor
  IDs and unique non-null mapped player IDs, preserves text and explicit side
  order, validates BO3 wins as integers from zero through two, and never
  derives or changes wins.

## TDD evidence

### RED: required invalid-wins regression

The requested regression was written before `series.ts`. Its first run was:

```text
node --experimental-strip-types --test bundles/rashinban/src/presenter/tests/series.test.ts
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/presenter/series.ts'
# tests 1
# pass 0
# fail 1
```

After adding only the public types and a minimal pass-through parser stub, the
same command reached the required behavior and failed for the expected reason:

```text
# Subtest: BO3 wins must be integers from zero through two
not ok 1 - BO3 wins must be integers from zero through two
error: 'Missing expected exception.'
# tests 1
# pass 0
# fail 1
```

The minimal range check then made that single regression pass (`1/1`).

### RED: expanded series and telemetry behavior

The expanded series suite ran against the range-only parser. The required wins
test and value-preservation cases passed, while missing uniqueness and field
validation failed as expected:

```text
# tests 5
# pass 3
# fail 2
error: 'Missing expected exception.'
```

The telemetry test first failed with `ERR_MODULE_NOT_FOUND`. After adding only
minimal `seedViews`/`applyTelemetry` stubs, the real behavioral suite ran and
failed on absent seeded players, movement state, map state, and reset state:

```text
# tests 8
# pass 1
# fail 7
```

The one passing test was the no-op unknown-input case supplied by the stub;
the seven state-changing behaviors all failed on their intended assertions.

### GREEN

Final focused command:

```text
node --experimental-strip-types --test bundles/rashinban/src/presenter/tests/series.test.ts bundles/rashinban/src/presenter/tests/telemetry.test.ts
# tests 13
# pass 13
# fail 0
```

Full verification:

```text
npm test
# tests 27
# pass 27
# fail 0

npm run typecheck
> tsc --noEmit
(exit 0)
```

The Node test commands emit the known pre-existing
`MODULE_TYPELESS_PACKAGE_JSON` warning. Direct focused commands also emit
Node's experimental strip-types warning; the repository test script suppresses
that warning. Neither warning indicates a Task 2 failure.

## Files changed

- `bundles/rashinban/src/types/presenter.ts`
- `bundles/rashinban/src/presenter/series.ts`
- `bundles/rashinban/src/presenter/telemetry.ts`
- `bundles/rashinban/src/presenter/tests/series.test.ts`
- `bundles/rashinban/src/presenter/tests/telemetry.test.ts`
- `.superpowers/sdd/2026-09-11-custom-presenter/task-2-report.md`

## Self-review

- Rechecked every Task 2 brief item against the implementation and tests.
- Added an explicit game-change reset assertion after noticing the original
  reset case exercised only the round-change half of the requirement.
- Added negative-win coverage after checking the lower BO3 boundary mutation.
- Corrected synthetic telemetry timestamps to be after the captured round
  start so the ordering tests exercise per-type ordering rather than the
  start-time filter, including the unknown-player no-op case.
- Confirmed every accepted telemetry payload is structurally decoded, all
  number fields used by a view are finite, invalid samples do not advance
  timestamps, and accepted updates do not mutate the input view object.
- Confirmed the explicit side swap round-trips competitor identity and wins
  without sorting, inference, or incrementing.
- Confirmed unrelated controller edits to the design and plan remain unstaged.

## Concerns

- No implementation concerns. Test output is non-pristine only because of the
  pre-existing module-type warning documented in Task 1.
