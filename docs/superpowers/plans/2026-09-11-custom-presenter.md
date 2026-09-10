# Custom GeoGuessr Presenter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Default to inline execution with executing-plans unless the user chooses delegation.

**Goal:** Deliver the approved custom presenter, operator controls, and synchronized audio for RASHINBAN 2026 1v1 Duels.

**Architecture:** A server-side GeoGuessr subscriber feeds a pure normalizer and presentation coordinator. Typed NodeCG Replicants supply a presenter graphic and an audio source, while persistent series state stays independent of individual games. Recorded traffic drives offline development through the same processing path as live traffic.

**Tech Stack:** Existing TypeScript, NodeCG, vanilla HTML/CSS, esbuild, Node test runner; Web Audio and browser video for media; Google Maps JavaScript rendering behind an adapter. Add explicit `ws` runtime dependency and `@types/google.maps` development dependency when their tasks need them, resolving compatible versions at execution time.

**Spec:** [Approved presenter design](../specs/2026-09-11-custom-presenter-design.md). Also read [protocol notes](../../geoguessr/presenter-protocol.md) before implementing transport or normalization.

## Global Constraints

- Scope is 1v1 Duels in MOVE, NM, and NMPZ, with no healing rounds.
- The operator continues to start rounds and perform all game-control actions in GeoGuessr's UI.
- One global rendered/chroma-key setting applies to both players.
- External player feeds replace the entire player view, including Street View and the guess map.
- Rendered NMPZ uses one shared fixed panorama and two independent player maps.
- Chroma-key NMPZ uses two full player-feed windows, like the other modes.
- Two keyed camera windows remain visible during live play and round results.
- Target a 1920 x 1080 OBS browser source.
- No avatar containers are reserved.
- Series state is independent of duel health, team colors, and lobby lifetime.
- No playback-rate modulation, pitch shifting, time stretching, or browser retuning is used.
- 5K plays at round results, never immediately on guess submission.
- One celebration per round; single-5K and double-5K have separate assets.
- Score counting and damage animations/sounds begin after the 5K effect finishes.
- Separate browser sources are not assumed to be frame-perfect; validate in OBS and use embedded audio if needed.
- Never publish the GeoGuessr cookie in Replicants, browser payloads, diagnostics, or logs.
- Preserve the dummy overlay, existing Companion routes, and capture userscript.

## Execution context and milestones

The starting repository has a dummy overlay, a dashboard, and capture fixtures;
there is no production presenter implementation to extend. This is one integrated
plan with three runnable checkpoints, rather than separately designed products:

1. **Tasks 1–5:** replay/live state and a keyed presenter controlled by NodeCG.
2. **Tasks 6–8:** rendered maps/panoramas and synchronized round-result video.
3. **Tasks 9–11:** authored audio support and validated OBS operation.

Do not require media assets or credentials to run unit/replay validation. Do
not report live rendering or OBS acceptance as passed without exercising them.
Missing external inputs leave those specific checks pending, not silently
waived. At execution start apply the worktree skill; inspect existing workspace
isolation before creating anything. Do not create a worktree just to write this plan.

Use explicit relative `.ts` imports in new modules that run through Node's
type stripping. Keep helpers in subdirectories: `scripts/build.mjs` bundles
every top-level `.ts` inside `src/graphics` and `src/dashboard` as an entry.
Tests belong under `src/presenter/tests`, never next to those entry files.

Except where shown in full, regression snippets use the same `node:test` and
`node:assert/strict` imports as Task 1 plus the named exports from that task's
implementation file. Interfaces are contract sketches to place in the named
modules, not ambient declarations to paste into runnable implementation files.
Focused test commands use this pattern with the task's actual filename:

```powershell
node --experimental-strip-types --test bundles/rashinban/src/presenter/tests/telemetry.test.ts
```

## File map

All bundle paths below start at `bundles/rashinban/`.

| Files | Responsibility |
| --- | --- |
| `src/types/presenter.ts`, existing `src/types/replicants.ts` | Shared normalized types and Replicant names. |
| `src/presenter/protocol.ts`, `normalize.ts`, `telemetry.ts` | Raw validation, full-state replacement, per-player samples. |
| `src/presenter/timeline.ts`, `projection.ts`, `series.ts`, `settings.ts` | Pure scheduling, visible state, persistent data validation. |
| `src/extension/presenter/connection.ts`, `register.ts`, `routes.ts`, `replay.ts` | GeoGuessr lifecycle, NodeCG wiring, controls, isolated fixture playback. |
| `src/presenter/media.ts`, `clock.ts`, `cues.ts` | Media contract, shared time conversion, cue lifecycle. |
| `src/graphics/presenter.ts`, `presenter-audio.ts` | Browser entry points. |
| `src/graphics/presenter/layout.ts`, `renderer.ts`, `google.ts`, `video.ts`, `audio.ts`, `client.ts` | Layout, render adapter, Google implementation, video, audio engine, NodeCG session/clock client. |
| `src/dashboard/presenter-control.ts` | Operator UI entry. |
| `graphics/presenter.html`, `presenter.css`, `presenter-audio.html`, `dashboard/presenter-control.html` | Static UI and composition. |
| `src/presenter/tests/*.test.ts`, `fixtures.ts` | Unit, fixture, fake transport, and clock tests. |
| `docs/presenter/{setup,media,obs,validation}.md` at repository root | Operator setup, asset requirements, composition, recorded acceptance evidence. |

Modify root `package.json`, `package-lock.json`, `.gitignore`, bundle
`package.json`, and existing `src/extension/index.ts` as the tasks below require.
Add `cfg/rashinban.example.json` as a sanitized example and ignore the real
`cfg/rashinban.json`. Audio/video live beneath NodeCG's already ignored
`assets/` directory, not in Git or inline in Replicants.

## Task 1: Normalize captured duel state with replayable tests

**Files:** Create `src/types/presenter.ts`, `src/presenter/{protocol,normalize}.ts`,
`src/presenter/tests/{fixtures,normalize.test}.ts`. Modify root `package.json`.

**Interfaces:**

```ts
export type Mode = 'MOVE' | 'NM' | 'NMPZ';
export type Point = { lat: number; lng: number };
export type Panorama = Point & {
  panoId: string; heading: number; pitch: number; zoom: number;
};
export type Guess = Point & {
  round: number; score: number; distanceM: number; createdAtMs: number;
};
export type RoundResult = {
  round: number; score: number; bestGuess: Guess | null;
  healthBefore: number; healthAfter: number; damageDealt: number;
  multiplier: number;
};
export type DuelPlayer = {
  id: string; teamId: string; teamColor: 'blue' | 'red'; health: number;
  multiplier: number; pin: Point | null; guesses: Guess[];
  results: RoundResult[];
};
export type Round = {
  number: number; panorama: Panorama; startAtMs: number | null;
  timerStartAtMs: number | null; endAtMs: number | null;
  multiplier: number;
};
export type DuelState = {
  gameId: string; version: number; round: number; mode: Mode;
  status: 'Created' | 'Ongoing' | 'Finished'; paused: boolean;
  initialHealth: number; players: [DuelPlayer, DuelPlayer]; rounds: Round[];
  aborted: boolean; winnerTeamId: string | null; isDraw: boolean;
};
export type ApplyResult = {
  state: DuelState | null; accepted: boolean; warnings: string[];
};
export function applySnapshot(previous: DuelState | null, message: unknown): ApplyResult;
// Fixture helper resolves repository docs/geoguessr/samples by import.meta.url.
export function sample(name: string): unknown;
```

- [ ] Extend the existing test command to discover both existing capture tests
  and `bundles/rashinban/src/presenter/tests/**/*.test.ts`, retaining Node's
  existing strip-types flags. Use `node:assert/strict` and `node:test`.

```json
"test": "node --experimental-strip-types --disable-warning=ExperimentalWarning --test \"tampermonkey/src/**/*.test.ts\" \"bundles/rashinban/src/presenter/tests/**/*.test.ts\""
```
- [ ] Add fixture loader and this failing regression first:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { applySnapshot } from '../normalize.ts';
import { sample } from './fixtures.ts';
test('repeated snapshot does not become another accepted transition', () => {
  const input = sample('gs2-ws-DuelStarted.json');
  const first = applySnapshot(null, input);
  assert.ok(first.state);
  const again = applySnapshot(first.state, input);
  assert.equal(again.accepted, false);
  assert.deepEqual(again.state, first.state);
});
```

- [ ] Run `node --experimental-strip-types --test bundles/rashinban/src/presenter/tests/normalize.test.ts`;
  expect the missing module/export failure before implementation.
- [ ] Implement structural validation of only consumed protocol fields; do not
  use unchecked casts as validation. Flatten the two single-player teams,
  parse ISO times, map `movementOptions` using actual fixture field names,
  and map round-numbered guesses/results. Preserve `bestGuess: null`.
  Reject unsupported team counts/modes with sanitized warnings.

```ts
// State replacement guard after decoding and validating the message:
if (previous?.gameId === next.gameId && next.version <= previous.version) {
  return { state: previous, accepted: false, warnings: [] };
}
```

- [ ] Add named cases for lower version, new game with lower version, Created
  with null times, abort versus finish, and no-pin versus zero-score guess.
  Feed each `{receivedAt, message}` entry from the full-sequence fixture
  through `applySnapshot`; assert final state and per-round results against
  fixture data, not a snapshot copied from the implementation.
- [ ] Run the focused test, `npm test`, and `npm run typecheck`. Commit explicit
  Task 1 paths with message `feat: normalize captured presenter duel state`.

## Task 2: Track player views and source-independent series state

**Files:** Create `src/presenter/{telemetry,series}.ts`,
`src/presenter/tests/{telemetry,series}.test.ts`; extend `src/types/presenter.ts`.

**Interfaces:**

```ts
export type Bounds = { north: number; east: number; south: number; west: number };
export type PlayerView = {
  panorama: Panorama; mapBounds: Bounds | null; pin: Point | null;
  mapActive: boolean; mapSticky: boolean; mapSize: number;
  lastByType: Record<string, number>;
};
export type Views = { gameId: string; round: number; players: Record<string, PlayerView> };
export function seedViews(state: DuelState): Views;
export function applyTelemetry(views: Views, state: DuelState, message: unknown): Views;
export type Competitor = { id: string; playerId: string | null; name: string; handle: string; wins: number };
export type SeriesState = { id: string; source: 'manual'; left: Competitor; right: Competitor };
export function parseSeries(input: unknown): SeriesState; // throws a field-specific Error
```

- [ ] Write the invalid-wins regression and run its file expecting failure:

```ts
test('BO3 wins must be integers from zero through two', () => {
  const player = { id: 'a', playerId: null, name: 'A', handle: '', wins: 0 };
  assert.throws(() => parseSeries({ id: 's', source: 'manual',
    left: { ...player, wins: 3 }, right: { ...player, id: 'b' } }), /wins/);
});
```

- [ ] Implement telemetry decoding for MapDisplay, MapBoundingBox,
  PinPosition, GuessWithLatLng, PanoPosition, PanoPov, and PanoZoom using
  nested sample payloads. Ignore unknown players/types; compare timestamps
  per sample type, not globally, so independent fields are not lost.
  Clear views on game/round change; reject samples predating a known start.
  The connection task supplies the active socket generation to reject old lobbies.
- [ ] Keep a fixed round panorama position for NM and fixed complete panorama
  for NMPZ; do not copy one player's map onto the other. Validate finite
  coordinates/POV values; preserve antimeridian-crossing bounds.
- [ ] Implement series validation separately; unique competitor IDs and mapped
  player IDs, names treated as text, integer wins, explicit left/right swap.
  Never update wins as a consequence of normalization.
- [ ] Test movement-trace position changes, out-of-order POV/map samples,
  two independent maps, round reset, and fixed NMPZ POV. Use
  `gs2-ws-LiveStreamSamples.json` and the movement-trace fixture.
- [ ] Run both focused test files and typecheck. Commit Task 2 files with
  `feat: track player views and independent series state`.

## Task 3: Implement the direct authenticated spectator connection

**Files:** Create `src/extension/presenter/connection.ts`,
`src/presenter/tests/connection.test.ts`, `cfg/rashinban.example.json`,
`docs/presenter/setup.md`. Modify root dependency/lock files and `.gitignore`.

**Interfaces:**

```ts
export type ConnectionConfig = { cookie: string; partyId: string | null; clientVersion: string };
export type ConnectionStatus = {
  state: 'disconnected' | 'connecting' | 'live' | 'stale' | 'auth-error' | 'unsupported';
  partyId: string | null; gameId: string | null; lastUpdateMs: number | null;
  error: string | null; serverOffsetMs: number;
};
export type ConnectionSink = {
  onMessage(message: unknown, receivedAtMs: number, bootstrap: boolean): void;
  onStatus(status: ConnectionStatus): void;
};
export type SocketPort = {
  send(text: string): void; close(): void;
  onOpen(callback: () => void): void;
  onMessage(callback: (text: string) => void): void;
  onClose(callback: (code: number) => void): void;
};
export type ConnectionDeps = {
  fetch: typeof fetch; openSocket(url: string, cookie: string): SocketPort;
  now(): number; schedule(callback: () => void, delayMs: number): () => void;
};
export function createConnection(config: ConnectionConfig, sink: ConnectionSink,
  deps: ConnectionDeps): { start(): void; stop(): void; reconnect(): void };
```

- [ ] Add `ws` explicitly with `npm install ws` and use the existing ws types.
  Read current primary documentation for NodeCG config access and ws headers
  before writing adapters; do not copy a credential into test fixtures.
- [ ] Write fake fetch/socket/time ports. First regression checks failed auth
  causes no socket opening or automatic retry loop:

```ts
test('authentication failure stops discovery', async () => {
  let status: ConnectionStatus | undefined;
  const pending: Array<() => void> = [];
  const connection = createConnection({ cookie: 'test-only', partyId: 'p', clientVersion: 'fixture' }, {
    onMessage() {}, onStatus(value) { status = value; },
  }, {
    fetch: async () => new Response('', { status: 401 }),
    openSocket() { throw new Error('must not open'); }, now: () => 1000,
    schedule(fn) { pending.push(fn); return () => {}; },
  });
  connection.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(status?.state, 'auth-error');
  assert.equal(pending.length, 0);
  connection.stop();
});
```

- [ ] Run the connection test expecting failure, then implement the captured
  REST sequence and 5-second party poll. Use explicit cookie headers and
  `X-Client` only for the documented GeoGuessr hosts; reject unexpected redirects
  rather than forwarding credentials. Resolve subscription player identity
  from the authenticated account, not an arbitrary competitor.
- [ ] Subscribe to lobby/live stream on open; heartbeat every 15 seconds.
  Treat the initial spectator snapshot and first reconnect snapshot as
  bootstrap data. Use a lifecycle generation plus cancellation to ignore
  responses from replaced lobbies. Keep client version configurable.
  Wrap the REST spectator state into the same validated envelope consumed by
  `applySnapshot`, using the actual captured REST root shape; do not require
  REST responses to already be WebSocket messages.
- [ ] Implement transient backoff starting at 1 second and capped at 30
  seconds with jitter, 4100 as stopped/error, 1012 as reconnect, normal ended
  session as party discovery. Stop all timers/sockets on shutdown. Estimate
  GeoGuessr server offset from valid X-ServerTime responses and request midpoint.
- [ ] Add fake-clock tests for subscribe contents, heartbeat, transient close,
  stopped session, new lobby while old fetch completes, and redacted errors.
  Ignore real `cfg/rashinban.json`; example contains empty cookie and a
  configurable client version, never a copied production credential.
- [ ] Run focused tests and typecheck; commit `feat: subscribe directly to GeoGuessr spectator state`.

## Task 4: Build the authoritative presentation timeline and projection

**Files:** Create `src/presenter/{timeline,projection}.ts`,
`src/presenter/tests/timeline.test.ts`; extend shared types.

**Interfaces:**

```ts
export type Phase = 'waiting-game' | 'waiting-host' | 'pre-round' | 'live'
  | 'results-transition' | 'results-reveal' | 'between-rounds' | 'finished' | 'aborted';
export type MusicContext = 'idle' | 'round' | 'urgent' | 'results';
export type EffectKind = 'none' | 'single-5k' | 'double-5k';
export type CueKind = 'pin' | 'guess' | 'countdown' | 'results' | 'count' | 'damage' | 'five-k';
export type Cue = { id: string; kind: CueKind; atMs: number; untilMs: number; playerId: string | null };
export type Timeline = {
  generation: string; gameId: string | null; round: number | null; phase: Phase;
  musicEpochMs: number; music: MusicContext; effect: EffectKind;
  effectDeadlineMs: number | null; revealAtMs: number | null;
  damageAtMs: number | null; holdAtMs: number | null; cues: Cue[];
};
export type Timing = { leadMs: number; countMs: number; damageMs: number; effectWatchdogMs: number };
export function effectFor(scores: readonly number[]): EffectKind;
export function advanceTimeline(previous: Timeline | null, state: DuelState | null,
  nowMs: number, bootstrap: boolean, timing: Timing): Timeline;
export function finishEffect(timeline: Timeline, generation: string, nowMs: number, timing: Timing): Timeline;
export type VisiblePlayer = { id: string; health: number; locked: boolean; score: number | null; distanceM: number | null };
export type Projection = { phase: Phase; remainingMs: number | null; answer: Panorama | null; players: VisiblePlayer[] };
export function project(state: DuelState | null, timeline: Timeline, nowMs: number): Projection;
```

- [ ] Start with the double-5K classification regression and run the file red:

```ts
test('two perfect scores select one double celebration', () => {
  assert.equal(effectFor([5000, 5000]), 'double-5k');
  assert.equal(effectFor([5000, 4999]), 'single-5k');
  assert.equal(effectFor([4999, 4999]), 'none');
});
```

- [ ] Implement pure phase transitions from complete results, status, and
  timestamps. No round resolution on timer expiry alone. Default timing:
  lead 200 ms, count 1200 ms, damage 800 ms, watchdog 10 seconds; settings
  can override these values. Schedule follow-up ticks for timestamp boundaries
  even when no WebSocket message arrives.
- [ ] Freeze resolved results by reading the timeline's round number from
  state; show healthBefore until damage stage, then interpolate to healthAfter.
  Hide score, distance, and answer in live projection despite early guesses.
  Return to waiting for the host after resolved manual-start rounds.
- [ ] Preserve a pending final-round sequence when Finished arrives immediately
  after resolution. Abort cancels it. A new round/game replaces the generation
  and all pending cues. Bootstrap snapshots restore the current phase with
  final values and no historical celebration/counting cues.

```ts
export function effectFor(scores: readonly number[]): EffectKind {
  const perfect = scores.filter(score => score === 5000).length;
  return perfect === 2 ? 'double-5k' : perfect === 1 ? 'single-5k' : 'none';
}
```

- [ ] Add regression cases using manual-round/max-time/abort/full-sequence
  fixtures: future start, first guess, deadline zero without results, no-pin,
  duplicate result, early-score hiding, stale video callback, final result
  before winner, watchdog, and next round overtaking a video. Construct double
  5K by cloning a normalized resolved state and setting both matching round
  results to 5000; never edit committed original captures.
- [ ] Run focused tests, full unit suite, and typecheck; commit
  `feat: coordinate presenter phases and result reveals`.

## Task 5: Wire NodeCG controls, isolated replay, and the keyed graphic

**Files:** Create `src/presenter/settings.ts`,
`src/extension/presenter/{register,routes,replay}.ts`,
`src/graphics/presenter.ts`, `src/graphics/presenter/layout.ts`,
`src/dashboard/presenter-control.ts`, `graphics/{presenter.html,presenter.css}`,
`dashboard/presenter-control.html`, `src/presenter/tests/{settings,replay}.test.ts`.
Modify existing extension index, Replicant types/names, and bundle manifest.

**Interfaces:**

```ts
export type PresenterSettings = {
  viewSource: 'rendered' | 'chroma'; keyColor: '#00ff00' | '#ff00ff';
  audioOutput: 'separate' | 'embedded'; muted: boolean;
  musicGain: number; effectsGain: number; timing: Timing;
};
export function parseSettings(input: unknown): PresenterSettings;
export function replayRows(input: unknown): Array<{ receivedAt: number; message: unknown }>;
export function layoutKind(mode: Mode, source: PresenterSettings['viewSource']): 'shared' | 'dual';
export function registerPresenter(nodecg: import('@nodecg/types').ServerAPI): void;
```

- [ ] Write the key-layout regression before wiring DOM and run it red:

```ts
test('chroma NMPZ uses two complete player windows', () => {
  assert.equal(layoutKind('NMPZ', 'chroma'), 'dual');
  assert.equal(layoutKind('NMPZ', 'rendered'), 'shared');
});
```

- [ ] Add Replicants `presenterConnection`, `presenterDuel`, `presenterViews`,
  `presenterSeries`, `presenterSettings`, and `presenterTimeline`. Persist only
  series/settings; runtime state bootstraps afresh. Validate server-side edits
  through message/HTTP handlers before assigning Replicants.
  Convert GeoGuessr absolute timestamps to NodeCG's clock once at ingestion
  using the connection's offset. All normalized runtime timestamps and timeline
  timestamps then use NodeCG milliseconds; fixture-only normalizer tests retain
  fixture time. Browser clients apply only their NodeCG offset, never the
  GeoGuessr offset a second time.
- [ ] Mount presentation routes under `/rashinban/presenter`: `POST /view/chroma`,
  `/view/rendered`, `/mute`, `/unmute`, `/reconnect`, `/series` (JSON body), and
  `/settings` (JSON body). Reject invalid bodies with 400 and current-state
  response on success. Preserve the existing routes.
- [ ] Register presenter HTML as 1920 x 1080 and dashboard panel width 3.
  Bind name fields with `textContent`. Show editable series wins, side mapping,
  global view/key selection, gains/output mode, reconnect, and status.
  Mapping gaps display an operator warning instead of silently swapping players.
- [ ] Add isolated replay mode selected by server config `presenter.input`:
  `live` or `replay`. Live and replay are mutually exclusive; the dashboard
  labels replay prominently. Replay allowlists repository fixture names and
  converts their recorded times to the current clock while preserving intervals
  in both messages and telemetry. Do not expose arbitrary filesystem reads.
- [ ] Build keyed live layout, scoreboard, timer, health, and lock indicators.
  Cameras remain at fixed bottom left/right positions during results. Draw
  a results area with score/distance labels now; Task 6 supplies its actual map.

```css
:root { --key-color: #ff00ff; }
html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; }
.key-slot { background: var(--key-color); }
.camera { position: absolute; bottom: 40px; width: 340px; height: 192px; }
.camera.left { left: 60px; }
.camera.right { right: 60px; }
```

- [ ] Test settings reject invalid gains/key/source and replay preserves
  relative timing. Run build, typecheck, tests; open the replay graphic and
  dashboard and verify both key colors, manual waiting, series edits, lock-in,
  countdown, results cameras, finished/abort states. Record screenshots in
  ignored local artifacts, not captured credentials. Commit
  `feat: add controlled keyed presenter with offline replay`.

## Task 6: Render live maps, Street View, and the results map

**Files:** Create `src/graphics/presenter/{renderer,google}.ts`,
`src/presenter/tests/renderer.test.ts`; modify presenter entry/layout,
setup documentation, config example, dependency/lock files.

**Interfaces:**

```ts
export type RenderFrame = { state: DuelState; views: Views; projection: Projection; source: 'rendered' | 'chroma' };
export interface GameRenderer {
  render(frame: RenderFrame): void;
  dispose(): void;
}
export type RendererPlan = { panoramas: 0 | 1 | 2; playerMaps: 0 | 2; resultsMap: boolean };
export function rendererPlan(mode: Mode, source: 'rendered' | 'chroma', phase: Phase): RendererPlan;
export function createGoogleRenderer(root: HTMLElement, apiKey: string,
  onError: (message: string) => void): Promise<GameRenderer>;
```

- [ ] Read current official Google Maps JavaScript documentation for panorama
  loading, POV/zoom, API-key setup, disabled navigation, attribution, and map
  bounds. Add Google types; document that the browser key is public and must
  be appropriately restricted, unlike the server-side GeoGuessr cookie.
- [ ] Write the instance-count regression and run it red:

```ts
test('shared NMPZ renders one panorama and two player maps', () => {
  assert.deepEqual(rendererPlan('NMPZ', 'rendered', 'live'), {
    panoramas: 1, playerMaps: 2, resultsMap: false,
  });
  assert.deepEqual(rendererPlan('NMPZ', 'chroma', 'results-reveal'), {
    panoramas: 0, playerMaps: 0, resultsMap: true,
  });
});
```

- [ ] Implement one API loader and adapter-owned instances, mounting only
  instances required by `rendererPlan`. Dispose listeners/instances on global
  source or layout changes. Retain loading/error slots and scoreboard/cameras
  when Maps is unavailable; publish sanitized readiness to the dashboard.
- [ ] Apply panorama ID and POV/zoom from normalized telemetry for MOVE/NM;
  use round initial panorama exclusively for NMPZ. Investigate captured pano-ID
  format against a real API request. Do not silently fall back to nearest
  coordinates if that changes the image; expose failure if exact pano resolution
  cannot be established. Keep local navigation disabled and attribution visible.
- [ ] Fit player maps to independent bounds, respect active/sticky display,
  and show independent pins. Results map uses answer and actual best guesses,
  connection lines, and antimeridian-aware fit. No-pin results have no invented
  marker. Results map is enabled in both source modes only after reveal.
- [ ] Test adapter orchestration with fake map/panorama objects: required
  instance counts, disposal, fixed NMPZ POV, independent bounds, no early answer,
  and map failure. Verify live fidelity in a test party once a key/cookie exists;
  record unresolved compatibility honestly if inputs are absent.
- [ ] Run focused tests, typecheck, build; commit
  `feat: render player maps panoramas and round results`.

## Task 7: Synchronize browser clocks and establish program ownership

**Files:** Create `src/presenter/clock.ts`,
`src/graphics/presenter/client.ts`, `src/presenter/tests/clock.test.ts`;
modify extension register/routes, shared types, presenter entry/dashboard.

**Interfaces:**

```ts
export type ClockSample = { sentMs: number; receivedMs: number; serverMs: number };
export function clockOffset(samples: readonly ClockSample[]): number;
export type Lease = { clientId: string; expiresAtMs: number };
export type ClientRole = 'program' | 'preview' | 'audio';
export type ClientReady = { clientId: string; role: ClientRole; ready: boolean };
export function eligibleCompletion(lease: Lease | null, clientId: string, nowMs: number): boolean;
```

- [ ] Write and run the clock regression red:

```ts
test('clock offset uses request midpoint', () => {
  assert.equal(clockOffset([{ sentMs: 1000, receivedMs: 1020, serverMs: 1110 }]), 100);
});
```

- [ ] Add a NodeCG ping/reply message carrying NodeCG server time. Collect
  five initial samples, estimate offset from the lowest-RTT sample, refresh
  every 10 seconds. Use a monotonic browser elapsed-time base anchored to that
  offset; keep GeoGuessr server offset conversion separate and applied once.
- [ ] Add `presenterClients` nonpersistent Replicant for readiness and leases.
  Program registration renews every 2 seconds and expires after 6 seconds;
  default URLs are preview-safe unless explicitly marked `?role=program`.
  Preview never receives audible ownership or sends effective completion.
  A second program client remains inactive until the existing lease expires
  or the operator explicitly transfers program ownership.
- [ ] Reject completion unless client lease, generation, and active effect
  all match. Disconnect clears ownership after expiry; timeline watchdog
  still completes results. On bootstrap, sources adopt current phase without
  replaying expired one-shot cues.
- [ ] Test RTT selection, stale samples, expired leases, duplicate clients,
  preview callbacks, and ownership transfer. Run typecheck/build and focused
  tests; commit `feat: synchronize presenter clients and program ownership`.

## Task 8: Add configurable single/double-5K videos and reveal sequencing

**Files:** Create `src/presenter/media.ts`, `src/graphics/presenter/video.ts`,
`src/presenter/tests/{media,video}.test.ts`, `docs/presenter/media.md`;
modify extension registration, presenter entry, dashboard, timeline.

**Interfaces:**

```ts
export type Stem = { id: string; url: string; loopStartS: number; loopEndS: number;
  gains: Record<MusicContext, number> };
export type EffectAsset = { url: string; watchdogMs: number;
  soundtrack: 'embedded' | 'cue' | 'silent' };
export type MediaManifest = {
  stems: Stem[]; fadeMs: Record<MusicContext, number>;
  sounds: Partial<Record<CueKind, string>>;
  fiveK: { single: EffectAsset | null; double: EffectAsset | null };
};
export function parseMedia(input: unknown): MediaManifest;
export type VideoPort = { play(): Promise<void>; stop(): void; onEnded(fn: () => void): void; onError(fn: () => void): void };
export function playCelebration(port: VideoPort, generation: string,
  complete: (generation: string, failed: boolean) => void): () => void;
```

- [ ] Write the completion-once regression with a fake port and run red:

```ts
test('video ended followed by error completes only once', async () => {
  let ended = () => {}; let error = () => {}; let calls = 0;
  playCelebration({ play: async () => {}, stop() {},
    onEnded(fn) { ended = fn; }, onError(fn) { error = fn; } }, 'g', () => calls++);
  ended(); error();
  assert.equal(calls, 1);
});
```

- [ ] Add NodeCG asset categories for music, effects, and video using current
  NodeCG primary docs; dashboard chooses assets via the public asset inventory.
  Persist validated manifest separately as `presenterMedia`. Accept only local
  served asset URLs; reject missing IDs, invalid gains/loops, and unsupported
  soundtrack combinations. Empty manifest is valid and silent.
- [ ] Render one full-screen topmost video, preloaded on selection. Guard
  play rejection/error/end/cancel with a completion-once closure. Report to
  NodeCG only as active program client. Track asset metadata duration and use
  bounded per-asset watchdog; a missing or invalid video skips to results.
- [ ] Connect effective completion to `finishEffect`; schedule reveal/count
  and then damage cues with shared timestamps. A double 5K never falls back
  to playing two singles. If the double asset is missing, reveal normally
  and report missing media to the operator.
- [ ] Verify both variants using temporary local test videos, no-asset mode,
  autoplay failure, new-round cancellation, and cameras covered during video
  then restored on results. Document accepted OBS video formats based on
  actual playback testing, not assumed desktop-browser support.
- [ ] Run focused tests, build/typecheck; commit
  `feat: sequence custom single and double 5K celebrations`.

## Task 9: Implement continuous authored stems and separate audio output

**Files:** Create `src/graphics/presenter/audio.ts`,
`src/graphics/presenter-audio.ts`, `graphics/presenter-audio.html`,
`src/presenter/tests/audio.test.ts`; modify manifest, media docs, register/client,
and presenter entry for embedded fallback.

**Interfaces:**

```ts
export function stemOffset(epochMs: number, nowMs: number, loopStartS: number, loopEndS: number): number;
export interface PresenterAudio {
  load(manifest: MediaManifest): Promise<void>;
  sync(timeline: Timeline, settings: PresenterSettings, serverNowMs: number): void;
  stop(): void;
}
export function createAudio(context: AudioContext, fetchAsset: typeof fetch): PresenterAudio;
```

- [ ] Write loop-phase recovery regression and run red:

```ts
test('reloaded stem rejoins the shared loop phase', () => {
  assert.equal(stemOffset(1000, 13500, 2, 10), 6.5);
});
```

- [ ] Decode all configured stems, validate finite loop bounds against decoded
  duration and common loop duration, and create looping sources sharing one
  scheduled start. Late decoding joins at the epoch-derived loop offset.
  Use gain nodes for context fades; muted stems keep advancing. Keep playback
  rate exactly 1. Never resample timing by speeding a stem up/down.

```ts
export function stemOffset(epochMs: number, nowMs: number, start: number, end: number): number {
  const length = end - start;
  return start + (((nowMs - epochMs) / 1000 % length) + length) % length;
}
```

- [ ] Apply authored `round`, `urgent`, `results`, and `idle` gains and
  per-context fade times; do not restart loops on round transitions. Fade out
  at abort/finished hold; a new game establishes a new epoch. Stop old nodes
  only when replacing assets/session or releasing audio ownership.
- [ ] Use one expiring audio lease tied to client ID and selected output mode.
  Make output-mode handoff acknowledge old-source mute before new-source
  activation; expiry handles a missing source. Previews and duplicate audio
  pages remain silent. Embedded fallback imports this same engine.
- [ ] Report decode errors, suspended AudioContext, and readiness to dashboard;
  provide a browser-local unlock action if activation is needed during testing.
  No audio asset should block graphics. Missing layers are silent with status.
- [ ] Test gain scheduling, shared starts, muted-layer continuity, asset reload
  cleanup, epoch recovery, output ownership, and missing buffers with fake audio
  ports; exercise actual Web Audio in browser. Run tests/typecheck/build and
  commit `feat: play synchronized authored presenter stems`.

## Task 10: Add synchronized interaction and result sound cues

**Files:** Create `src/presenter/cues.ts`, `src/presenter/tests/cues.test.ts`;
modify timeline, telemetry integration, audio engine, media dashboard.

**Interfaces:**

```ts
export function canPlayCue(cue: Cue, nowMs: number, played: ReadonlySet<string>): boolean;
export function interactionCues(previous: DuelState, next: DuelState, nowMs: number): Cue[];
export function pinCue(playerId: string, previous: Point | null, next: Point | null,
  lastCueMs: number, nowMs: number, generation: string): Cue | null;
```

- [ ] Write late-join suppression regression and run red:

```ts
test('late join does not replay an expired submission sound', () => {
  const cue: Cue = { id: 'g/1/a/guess', kind: 'guess', atMs: 1000,
    untilMs: 1250, playerId: 'a' };
  assert.equal(canPlayCue(cue, 2000, new Set()), false);
  assert.equal(canPlayCue(cue, 1100, new Set([cue.id])), false);
});
```

- [ ] Deduplicate guess cues by game/round/player; pin cues compare actual
  coordinates and use 150 ms rate limiting. Route state/telemetry pin changes
  through one shared previous-pin cache to avoid two sounds for one action.
  Bootstrap clears history without producing sounds.
- [ ] Schedule countdown cues at remaining 3, 2, 1 seconds, once per deadline
  generation. No timer sound at null deadline; no missed-tick burst after resume.
  Results/count/damage cues come only from presentation stage times.
  Do not generate a damage sound when neither player loses health.
- [ ] Map cue timestamps to AudioContext time using the shared clock. Count
  sound loops only until `damageAtMs`; stop/cancel on generation replacement.
  Short one-shots expire after 250 ms if unscheduled, while active interval
  sounds join only their remaining duration. Bound played-ID storage to the
  active game and current/prior round.
- [ ] Enforce 5K soundtrack ownership: embedded selects video audio only;
  cue selects muted video and the `five-k` sound; silent selects neither.
  Cancel associated audio when the video is interrupted. Add dashboard
  preview controls that target preview audio explicitly and cannot mutate
  live game/timeline state.
- [ ] Test repeated state and telemetry, pin drag throttling, first guess,
  no-pin timeout, countdown shortening, score-loop cancellation, zero damage,
  and reconnection. Run focused/full tests, typecheck/build; commit
  `feat: synchronize presenter interaction and reveal sounds`.

## Task 11: Validate browser recovery and the actual OBS composition

**Files:** Create `docs/presenter/{obs,validation}.md`; update
`docs/presenter/{setup,media}.md` and root `README.md`. Fix only implementation
files implicated by observed failures, with focused regressions where useful.

**Interfaces:** Delivered URLs:

```text
http://localhost:9090/bundles/rashinban/graphics/presenter.html?role=program
http://localhost:9090/bundles/rashinban/graphics/presenter.html?role=preview
http://localhost:9090/bundles/rashinban/graphics/presenter-audio.html
http://localhost:9090/  (presenter dashboard)
```

- [ ] Run `npm test`, `npm run typecheck`, and `npm run build`; record commands,
  date, and actual results. Confirm the dummy graphic and existing Companion
  actions still work. Confirm no secret-bearing config or generated media is staged.
- [ ] Use replay mode to inspect every mode/source combination at 1920 x 1080,
  both key colors, created/pre-round/live/results/finished/aborted phases,
  long names, wins 0/1/2, no-pin N/A, and one/double-5K transitions. Verify
  no hidden result leaks visually before reveal. Save representative screenshots
  and references to them in the validation log without committing private images.
- [ ] Configure OBS player feeds and cameras below the presenter, cropped to
  their documented fixed rectangles. Verify regional keying/crop arrangement
  preserves green/magenta pixels in real game maps and 5K video. If the selected
  OBS workflow cannot key regions safely, record the failing composition and
  resolve the source/mask arrangement before declaring it ready; do not silently
  switch the product to transparent slots contrary to the design.
- [ ] Keep the dedicated audio source active across scenes, disable shutdown
  and refresh-on-activation, and mute native GeoGuessr/player-feed audio to
  prevent doubling. Document separate versus embedded ownership and video audio.
- [ ] Record a local test with temporary synchronized flash/click cues using
  the real timeline and audio scheduler. Measure audio onset versus visual frame
  at start, middle, and end of a 30-minute session. Target absolute alignment
  within 50 ms, no accumulating drift, and no duplicate playback. Repeat after
  graphic refresh, audio refresh, scene switching, and output-mode change.
  If separate-source timing fails, select embedded mode and repeat the checks.
- [ ] Test live cookie expiry/replacement, lost spectator socket, host-aborted
  duel, manual next round, and new lobby with stable series scores. Observe
  actual Google panorama/POV/map fidelity and map attribution. Mark unavailable
  credential/media/live-party checks as pending with the precise needed input.
- [ ] Document operator startup, replay/live selection, program ownership,
  series reset, chroma switching, media selection, missing-asset fallback,
  reconnect behavior, and recovery from audio activation failures. Include
  actual layout rectangle coordinates from the final CSS.
- [ ] Commit docs and validated fixes as `docs: document presenter operation and OBS validation`.
  Summarize what passed, what remains externally unverified, and any chosen
  embedded-audio fallback. Do not claim event readiness while required live/OBS
  checks are pending.

## Coverage and review checklist

| Design requirement | Tasks |
| --- | --- |
| Direct cookie connection, discovery, reconnect, no game-control commands | 1, 3, 5, 11 |
| Version guards, bootstrap, manual timing, abort/finish | 1, 4, 7 |
| Independent maps, MOVE/NM telemetry, shared rendered NMPZ | 2, 6 |
| Global full-feed chroma and persistent keyed cameras | 5, 6, 11 |
| Independent BO3 state and future adapter boundary | 2, 5 |
| No early score/answer reveal, no-pin N/A, animated damage | 1, 4, 5, 6 |
| Single/double-5K, one-time completion, interruption/watchdog | 4, 7, 8 |
| Continuous authored stems and no browser tuning | 8, 9 |
| Separate/embedded ownership, clock and cue sync | 7, 9, 10, 11 |
| Pin/guess/countdown/results/count/damage sounds | 10 |
| Credential/media failures and offline fixtures | 1, 3, 5, 8, 9, 11 |
| Google compatibility and actual OBS acceptance | 6, 11 |

Before execution, check all type names/signatures across task boundaries and
read the approved spec. At each task boundary, review the diff, run that task's
meaningful checks, and commit its explicit files. Do not add tests that merely
assert CSS literals or duplicate implementation structure. Broaden checks at
the indicated milestones or when failures justify it.
