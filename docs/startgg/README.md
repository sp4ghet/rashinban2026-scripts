# start.gg integration

RASHINBAN 2026 runs its bracket on start.gg
(https://www.start.gg/tournament/rashinban-2026/details). The NodeCG
extension polls the GraphQL API and publishes a normalized bracket that
overlays render from. Nothing is written back to start.gg.

## Event structure (as of 2026-09-11)

| Phase | Type | Pools | Progressions |
| --- | --- | --- | --- |
| DAY1 (TOP64), id 2352530 | Double elimination | 4 (ids 3398035, 3410976, 3439052, 3439053) | 2 per pool (placement 2 twice: winners-side and losers-side finalist) into DAY2 |
| DAY2 (TOP8), id 2362499 | Double elimination | 1 (id 3410975) | none |

## Pieces

- `.env` holds `STARTGG_TOKEN` (Personal Access Token). See README "Secrets".
- `bundles/rashinban/src/startgg/queries.ts` - GraphQL documents.
- `bundles/rashinban/src/startgg/normalize.ts` - pure raw-to-`StartggBracket`
  conversion, unit-tested against `samples/`.
- `bundles/rashinban/src/extension/startgg.ts` - poller. Replicants:
  `startggConfig` (event slug, interval, enabled), `startggBracket`
  (normalized data), `startggStatus` (last fetch, errors, request rate).
  Messages `startgg:refresh`, `startgg:setConfig`; HTTP
  `POST /rashinban/startgg/refresh` for Companion.
- Dashboard panel "start.gg": config, status, and every fetched set with
  live ones first.
- `npm run startgg:fetch -- <event|phase-group|stream-queue> <arg> [outfile]`
  records raw responses into `samples/` (fixtures and debugging).

## What the API gives us (from the fixtures)

- `Set.round` is positive on the winners side and negative on the losers
  side; `fullRoundText` is "Winners Semi-Final", "Losers Round 1",
  "Grand Final", "Grand Final Reset", and so on. A reset set only exists
  when it is needed.
- `Set.state`: 1 created, 2 active, 3 completed, 4 ready, 5 invalid,
  6 called, 7 queued.
- `slots[].prereqType`/`prereqId`/`prereqPlacement` wire the bracket: a
  "seed" prereq is an initial placement; a "set" prereq is the set whose
  finisher at `prereqPlacement` (1 winner, 2 loser) fills the slot. In a
  phase fed by progressions, losers-round-1 slots reference sets from the
  previous phase, so `prereq.external` is true for them.
- `slots[].standing.stats.score.value` is the set score per side;
  `winnerId` is the winning entrant id; `wPlacement`/`lPlacement` are the
  placements awarded by the set.
- `phaseGroup.seeds[].progressionSource` tells which earlier pool and
  placement each seed came from.
- `tournament.streamQueue` is `null` when empty; entries are per stream with
  the queued sets.
- Rate limit 80 requests per minute, 1000 objects per request. One poll of
  RASHINBAN is about 12 requests (event, ~2 pages per pool, queue), so the
  default 30 s interval stays well inside the limit.

## Samples

- `evo-japan-2026-sf6-finals-top8.json` - completed top 8 fed by
  progressions (same shape as DAY2).
- `evo-japan-2026-sf6-semifinals-top24.json` - completed 24-player phase.
- `evo-japan-2026-sf6-round4-pool-SFM201.json` - completed 12-player pool
  that sends 3 players onward (same shape as a DAY1 pool).
- `rashinban-2026-event.json`, `rashinban-2026-day1-pool1-unstarted.json`,
  `rashinban-2026-stream-queue.json` - the real event before seeding.

Related research: BraceBracket (https://github.com/blacktails2/BraceBracket)
uses the same API from the browser with a hard-coded token and a fixed
top-8 layout; its Google Sheets mode is the unmaintained v1.
