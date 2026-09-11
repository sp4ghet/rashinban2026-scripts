import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { loadReplay, rebaseReplay } from '../../extension/presenter/replay.ts';
import type { DuelState, Timeline, Views } from '../../types/presenter.ts';
import { applySnapshot } from '../normalize.ts';
import { applyTelemetry, seedViews } from '../telemetry.ts';
import { advanceTimeline, DEFAULT_TIMING } from '../timeline.ts';
import { project } from '../projection.ts';

const fixture = 'gs2-ws-presenter-showcase.json';

test('showcase is reproducible and loads through the dashboard fixture allowlist', () => {
  const rows = loadReplay(fixture);
  assert.ok(rows.at(-1)!.receivedAt - rows[0].receivedAt >= 90000);
  assert.ok(rows.at(-1)!.receivedAt - rows[0].receivedAt <= 150000);
  execFileSync(process.execPath, ['scripts/generate-presenter-showcase.mjs', '--check']);
});

test('showcase ingests both players movement and maps, reverses lock order, and gates two celebrations', () => {
  const rows = rebaseReplay(loadReplay(fixture), 1000000);
  let state: DuelState | null = null;
  let timeline: Timeline | null = null;
  let views: Views = { gameId: '', round: 0, players: {} };
  const panoramas = new Map<string, Set<string>>();
  const telemetryTypes = new Map<string, Set<string>>();
  const firstLocks: string[] = [];
  const effects: string[] = [];
  const resultTimes: number[] = [];
  let health = [6000, 6000];
  let priorRound = 0;
  for (const row of rows) {
    const message = row.message as { code: string; playerId?: string; payload?: { type: string }[] };
    if (message.code === 'LiveStreamSamples') {
      assert.ok(state);
      const prior = views;
      views = applyTelemetry(views, state, row.message);
      assert.notDeepEqual(views, prior, 'every curated telemetry batch changes a player view');
      const id = message.playerId!;
      const seen = panoramas.get(id) ?? new Set<string>();
      seen.add(views.players[id]!.panorama.panoId);
      panoramas.set(id, seen);
      const types = telemetryTypes.get(id) ?? new Set<string>();
      message.payload!.forEach(item => types.add(item.type));
      telemetryTypes.set(id, types);
      continue;
    }
    const next = applySnapshot(state, row.message);
    assert.equal(next.accepted, true);
    assert.deepEqual(next.warnings, []);
    state = next.state!;
    assert.equal(state.mode, 'MOVE');
    if (state.round !== priorRound) {
      if (resultTimes.length) assert.ok(row.receivedAt - resultTimes.at(-1)! >= 25000);
      views = seedViews(state);
      priorRound = state.round;
    }
    timeline = advanceTimeline(timeline, state, row.receivedAt, false, DEFAULT_TIMING);
    const projection = project(state, timeline, row.receivedAt);
    if (message.code === 'DuelPlayerGuessed') {
      const locked = projection.players.filter(player => player.locked);
      if (locked.length === 1) {
        firstLocks.push(locked[0].id);
        assert.equal(projection.remainingMs, 15000);
        assert.equal(timeline.music, 'urgent');
        const lastSeconds = timeline.cues.filter(cue => cue.kind === 'countdown').map(cue => cue.atMs);
        for (const remaining of [1000, 2000, 3000]) assert.ok(lastSeconds.includes(row.receivedAt + 15000 - remaining));
      }
      assert.equal(projection.answer, null);
      assert.ok(projection.players.every(player => player.score === null));
      assert.equal(timeline.effect, 'none');
    }
    if (message.code === 'DuelRoundTimedOut') {
      effects.push(timeline.effect);
      resultTimes.push(row.receivedAt);
      const results = state.players.map(player => player.results.find(result => result.round === state!.round)!);
      assert.deepEqual(results.map(result => result.healthBefore), health);
      assert.deepEqual(results.map(result => result.healthAfter), state.players.map(player => player.health));
      health = state.players.map(player => player.health);
      for (let i = 0; i < 2; i++) {
        assert.equal(results[i].healthBefore - results[i].healthAfter, results[1 - i].damageDealt);
      }
      if (state.round === 1) assert.deepEqual(results.map(result => result.score), [5000, 4700]);
      else {
        assert.deepEqual(results.map(result => result.score), [5000, 5000]);
        assert.ok(results.every(result => result.healthBefore === result.healthAfter && result.damageDealt === 0));
      }
      const finishedScoring = advanceTimeline(timeline, state, row.receivedAt + 24000, false, DEFAULT_TIMING);
      assert.ok(finishedScoring.holdAtMs! <= row.receivedAt + 24000, 'even watchdog fallback finishes before next round');
    }
  }
  assert.deepEqual(firstLocks, ['6aa29a4e4752c83aa99d7655', '65701c932c6e4a0a9881791e']);
  assert.deepEqual(effects, ['single-5k', 'double-5k']);
  assert.equal(panoramas.size, 2);
  for (const seen of panoramas.values()) assert.equal(seen.size, 3);
  for (const types of telemetryTypes.values()) {
    for (const type of ['PanoPosition', 'PanoPov', 'PanoZoom', 'MapDisplay', 'MapBoundingBox', 'PinPosition', 'GuessWithLatLng']) assert.ok(types.has(type), type);
  }
  assert.equal(state!.status, 'Finished');
  assert.ok(rows.at(-1)!.receivedAt - resultTimes.at(-1)! >= 25000);
});
