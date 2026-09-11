import assert from 'node:assert/strict';
import test from 'node:test';

import type { DuelState, Timeline } from '../../types/presenter.ts';
import { applySnapshot } from '../normalize.ts';
import { project } from '../projection.ts';
import { advanceTimeline, DEFAULT_TIMING, effectFor, finishEffect, nextTimelineWakeAtMs } from '../timeline.ts';
import { sample } from './fixtures.ts';

const timing = DEFAULT_TIMING;
test('preview ticks follow server 3-2-1, skip elapsed ticks, and reset on changed start', () => {
  const s = structuredClone(full[0].state); const round = s.rounds.find(r => r.number === s.round)!;
  s.status = 'Ongoing'; s.players.forEach(p => { p.guesses = []; p.results = []; });
  round.startAtMs = 10000; round.timerStartAtMs = null; round.endAtMs = null;
  let t = advance(null, s, 6000, true);
  assert.deepEqual(t.cues.filter(c => c.kind === 'pre-round-tick').map(c => c.atMs), [7000,8000,9000]);
  assert.deepEqual(advance(t,s,6001).cues, t.cues);
  const late = advance(null,s,8500,true);
  assert.deepEqual(late.cues.filter(c => c.kind === 'pre-round-tick').map(c => c.atMs), [9000]);
  assert.equal(advance(null,s,10001,true).cues.some(c => c.kind === 'pre-round-tick'), false);
  round.startAtMs = 15000; t = advance(t,s,6500);
  assert.deepEqual(t.cues.filter(c => c.kind === 'pre-round-tick').map(c => c.atMs), [12000,13000,14000]);
  s.aborted = true; assert.equal(advance(t,s,6600).cues.length,0);
  s.aborted = false; s.status = 'Created'; round.startAtMs = null;
  assert.equal(advance(null,s,1000,true).cues.length,0);
});
test('continuous countdown aligns to final fifteen seconds and does not restart after a second guess', () => {
  const s = structuredClone(full[0].state); const round = s.rounds.find(r => r.number === s.round)!;
  s.status = 'Ongoing'; s.players.forEach(p => { p.guesses = []; p.results = []; });
  round.startAtMs = 1000; round.timerStartAtMs = 1000; round.endAtMs = 61000;
  let t = advance(null, s, 1000, true);
  assert.deepEqual(t.cues.filter(c => c.kind === 'countdown').map(c => [c.atMs, c.untilMs, c.offsetS]), [[46000, 61000, 0]]);
  round.timerStartAtMs = 10000; round.endAtMs = 25000;
  t = advance(t, s, 10000);
  const first = t.cues.find(c => c.kind === 'countdown')!;
  assert.equal(first.atMs, 10000);
  t = advance(t, s, 11000); assert.deepEqual(t.cues.filter(c => c.kind === 'countdown'), [first]);
  round.endAtMs = 26000; t = advance(t, s, 12000);
  assert.deepEqual(t.cues.filter(c => c.kind === 'countdown'), [first], 'deadline update during playback must not create another voice');
  round.startAtMs = 1000; round.timerStartAtMs = 1000; round.endAtMs = 11000;
  t = advance(null, s, 1000, true);
  assert.deepEqual(t.cues.filter(c => c.kind === 'countdown').map(c => [c.atMs, c.offsetS]), [[1000, 5]]);
  round.timerStartAtMs = null; round.endAtMs = null;
  assert.equal(advance(null, s, 1000, true).cues.some(c => c.kind === 'countdown'), false);
  round.startAtMs = 20000; round.timerStartAtMs = 20000; round.endAtMs = 40000;
  const restart = advance(t, s, 20000);
  assert.notEqual(restart.generation, t.generation, 'same-number rollback must create a fresh audio run');
  assert.deepEqual(restart.cues.filter(c => c.kind === 'countdown').map(c => c.atMs), [25000]);
});
function stateFrom(name: string): DuelState {
  const result = applySnapshot(null, sample(name));
  assert.ok(result.state);
  return result.state;
}
function sequence(name: string): { state: DuelState; at: number; code: string }[] {
  const entries = sample(name) as { receivedAt: number; message: { code: string } }[];
  let previous: DuelState | null = null;
  return entries.flatMap(entry => {
    const next = applySnapshot(previous, entry.message);
    previous = next.state;
    return next.accepted && next.state ? [{ state: next.state, at: entry.receivedAt, code: entry.message.code }] : [];
  });
}
const full = sequence('gs2-ws-full-duel-sequence.json');
function entry(round: number, code: string) {
  const found = full.find(item => item.state.round === round && item.code === code);
  assert.ok(found);
  return found;
}
function advance(previous: Timeline | null, state: DuelState | null, at: number, bootstrap = false): Timeline {
  return advanceTimeline(previous, state, at, bootstrap, timing);
}
function perfectState(): DuelState {
  const state = structuredClone(entry(3, 'DuelRoundTimedOut').state);
  for (const player of state.players) player.results.find(result => result.round === 3)!.score = 5000;
  return state;
}

test('two perfect scores select one double celebration', () => {
  assert.equal(effectFor([5000, 5000]), 'double-5k');
  assert.equal(effectFor([5000, 4999]), 'single-5k');
  assert.equal(effectFor([4999, 4999]), 'none');
});
test('round-start schedules at future panorama reveal once, including pre-round bootstrap', () => {
  const start = sequence('gs2-ws-full-duel-sequence-maxroundtime.json')[0];
  const at = start.state.rounds.find(round => round.number === start.state.round)!.startAtMs!;
  for (const bootstrap of [false, true]) {
    let timeline = advance(null, start.state, at - 1000, bootstrap);
    const cue = timeline.cues.find(cue => cue.kind === 'round-start')!;
    assert.equal(cue.atMs, at); assert.equal(cue.untilMs, at + 250);
    timeline = advance(timeline, start.state, at - 500);
    assert.deepEqual(timeline.cues.filter(cue => cue.kind === 'round-start'), [cue]);
    timeline = advance(timeline, start.state, at);
    assert.equal(timeline.phase, 'live'); assert.equal(timeline.cues.filter(cue => cue.kind === 'round-start').length, 1);
    timeline = advance(timeline, start.state, at + 300);
    assert.equal(timeline.cues.some(cue => cue.kind === 'round-start'), false);
    timeline = advance(timeline, start.state, at + 400);
    assert.equal(timeline.cues.some(cue => cue.kind === 'round-start'), false);
  }
  assert.equal(advance(null, start.state, at + 1, true).cues.some(cue => cue.kind === 'round-start'), false);
  assert.equal(advance(null, start.state, at + 1).cues.some(cue => cue.kind === 'round-start'), false);
});
test('round-start reschedules a changed future deadline and drops old-round or aborted cues', () => {
  const start = structuredClone(sequence('gs2-ws-full-duel-sequence-maxroundtime.json')[0]);
  const round = start.state.rounds.find(round => round.number === start.state.round)!;
  const at = round.startAtMs!;
  const original = advance(null, start.state, at - 1000);
  round.startAtMs = at + 1000;
  const moved = advance(original, start.state, at - 500);
  assert.deepEqual(moved.cues.filter(cue => cue.kind === 'round-start').map(cue => cue.atMs), [at + 1000]);
  const next = structuredClone(start.state); next.round++; next.rounds.push({ ...round, number: next.round, startAtMs: at + 5000 });
  const replaced = advance(moved, next, at);
  assert.deepEqual(replaced.cues.filter(cue => cue.kind === 'round-start').map(cue => cue.atMs), [at + 5000]);
  assert.notEqual(replaced.generation, moved.generation);
  next.aborted = true;
  assert.equal(advance(replaced, next, at + 1).cues.length, 0);
});

test('manual capture waits for host before start and after completing results', () => {
  const manual = sequence('gs2-ws-full-duel-sequence-manual-rounds.json');
  assert.equal(manual[0].state.manualRoundStart, true);
  assert.equal(full[0].state.manualRoundStart, false);
  let timeline = advance(null, manual[0].state, manual[0].at);
  assert.equal(timeline.phase, 'waiting-host');
  const result = manual.find(item => item.code === 'DuelRoundTimedOut')!;
  timeline = advance(timeline, result.state, result.at);
  assert.equal(timeline.phase, 'results-transition');
  const completeAt = timeline.holdAtMs!;
  timeline = advance(timeline, result.state, completeAt);
  assert.equal(timeline.phase, 'waiting-host');
  assert.deepEqual(project(result.state, timeline, completeAt).players.map(player => player.health), result.state.players.map(player => player.results[0].healthAfter));
});

test('future start and maximum timer wake on authoritative boundaries without another snapshot', () => {
  const start = sequence('gs2-ws-full-duel-sequence-maxroundtime.json')[0];
  let timeline = advance(null, start.state, start.at);
  assert.equal(timeline.phase, 'pre-round');
  const startMs = Date.parse('2026-09-10T13:18:54.032Z');
  assert.equal(nextTimelineWakeAtMs(timeline, start.state, start.at), startMs);
  assert.equal(project(start.state, timeline, start.at).remainingMs, startMs - start.at);
  timeline = advance(timeline, start.state, startMs);
  assert.equal(timeline.phase, 'live');
  assert.equal(timeline.music, 'round');
  assert.equal(project(start.state, timeline, startMs).remainingMs, 60000);
  assert.equal(nextTimelineWakeAtMs(timeline, start.state, startMs), startMs + 45000);
  timeline = advance(timeline, start.state, startMs + 45000);
  assert.equal(timeline.music, 'urgent');
  timeline = advance(timeline, start.state, startMs + 60000);
  assert.equal(timeline.phase, 'live');
  assert.equal(project(start.state, timeline, startMs + 60500).remainingMs, 0);
  assert.equal(timeline.effect, 'none');
  assert.equal(nextTimelineWakeAtMs(timeline, start.state, startMs + 60000), null);
});

test('first guess shortens max timer and produces one lock cue without revealing an early 5K', () => {
  const state = stateFrom('gs2-ws-DuelPlayerGuessed-5k.json');
  const before = entry(3, 'DuelNewRound');
  const now = Date.parse('2026-09-10T12:30:47.498Z');
  const previous = advance(null, before.state, now - 1, true);
  const timeline = advance(previous, state, now);
  assert.equal(timeline.music, 'urgent');
  assert.equal(timeline.effect, 'none');
  const visible = project(state, timeline, now);
  assert.equal(visible.answer, null);
  assert.equal(visible.remainingMs, 13680);
  assert.deepEqual(visible.players.map(player => [player.locked, player.score, player.distanceM]), [[false, null, null], [true, null, null]]);
  assert.equal(timeline.cues.filter(cue => cue.kind === 'guess').length, 1);
  assert.equal(timeline.cues.some(cue => cue.kind === 'five-k'), false);
  assert.deepEqual(advance(timeline, state, now), timeline);

  const max = sequence('gs2-ws-full-duel-sequence-maxroundtime.json');
  const start = max.find(item => item.state.round === 2 && item.code === 'DuelNewRound')!;
  const guess = max.find(item => item.state.round === 2 && item.code === 'DuelPlayerGuessed')!;
  const maxTimeline = advance(advance(null, start.state, start.at), guess.state, guess.at);
  assert.equal(project(guess.state, maxTimeline, guess.at).remainingMs, 13636);
  assert.equal(maxTimeline.cues.filter(cue => cue.kind === 'countdown').every(cue => cue.untilMs <= Date.parse('2026-09-10T13:20:45.292Z')), true);
});

test('pin changes deduplicate and rate limit without replaying on ticks', () => {
  const pin = entry(1, 'DuelPinPlaced');
  const start = full[0];
  const timeline = advance(advance(null, start.state, start.at), pin.state, pin.at);
  assert.equal(timeline.cues.filter(cue => cue.kind === 'pin').length, 1);
  assert.deepEqual(advance(timeline, pin.state, pin.at), timeline);
  const moved = structuredClone(pin.state);
  moved.version++;
  const pinnedPlayer = moved.players.find(player => player.pin !== null)!;
  pinnedPlayer.pin!.lat += 1;
  const limited = advanceTimeline(timeline, moved, pin.at + 10, false, { ...timing, pinRateLimitMs: 500 });
  assert.equal(limited.cues.filter(cue => cue.kind === 'pin').length, 1);
  assert.equal(advance(limited, moved, pin.at + 1000).cues.filter(cue => cue.kind === 'pin').length, 0);
});

test('results reveal counts before interpolating damage and ignores duplicate resolution', () => {
  const result = entry(1, 'DuelRoundTimedOut');
  const at = 10000;
  let timeline = advance(null, result.state, at);
  assert.equal(timeline.phase, 'results-transition');
  assert.equal(timeline.music, 'results');
  assert.equal(timeline.revealAtMs, 10200);
  assert.equal(timeline.damageAtMs, 15010);
  assert.equal(timeline.holdAtMs, 17010);
  assert.equal(nextTimelineWakeAtMs(timeline, result.state, at), 10200);
  assert.deepEqual(project(result.state, timeline, at).players.map(player => [player.health, player.score]), [[6000, null], [6000, null]]);
  assert.equal(project(result.state, timeline, at).answer, null);
  assert.deepEqual(advance(timeline, structuredClone(result.state), at), timeline);
  timeline = advance(timeline, result.state, 11785);
  assert.equal(timeline.phase, 'results-reveal');
  assert.deepEqual(project(result.state, timeline, 11785).players.map(player => [player.health, player.score]), [[6000, 2120], [6000, 2082]]);
  assert.equal(project(result.state, timeline, 11785).answer?.lat, 14.91906512738777);
  assert.equal(nextTimelineWakeAtMs(timeline, result.state, 11785), 12160);
  const duringImpact = project(result.state, timeline, 15410);
  assert.deepEqual(duringImpact.players.map(player => player.score), [4240, 4164]);
  assert.ok(duringImpact.players[1].health > 5924 && duringImpact.players[1].health < 6000);
  timeline = advance(timeline, result.state, 17010);
  assert.equal(timeline.phase, 'between-rounds');
  assert.deepEqual(project(result.state, timeline, 17010).players.map(player => player.health), [6000, 5924]);
  assert.equal(nextTimelineWakeAtMs(timeline, result.state, 17010), null);
});

test('projection uses the timeline round even if state has a newer current round', () => {
  const old = entry(1, 'DuelRoundTimedOut');
  const newer = entry(2, 'DuelRoundTimedOut');
  const timeline = advance(null, old.state, 10000, true);
  const visible = project(newer.state, timeline, 20000);
  assert.deepEqual(visible.players.map(player => [player.health, player.score]), [[6000, 4240], [5924, 4164]]);
  assert.equal(visible.answer?.lat, 14.91906512738777);
  assert.equal(project({ ...newer.state, gameId: 'other-game' }, timeline, 20000).players.length, 0);
});

test('no-pin timeout reveals zero with N/A distance and retains unlocked status', () => {
  const state = stateFrom('gs2-ws-DuelRoundTimedOut-nopin.json');
  const timeline = advance(null, state, 10000, true);
  const visible = project(state, timeline, 10000);
  assert.deepEqual(visible.players.map(player => [player.score, player.distanceM, player.locked]), [[0, null, false], [1, 12240799.314888677, true]]);
});

test('one double celebration gates all counting until matching completion plus lead', () => {
  const state = perfectState();
  let timeline = advance(null, state, 10000);
  assert.equal(timeline.effect, 'double-5k');
  assert.equal(timeline.revealAtMs, null);
  assert.equal(timeline.effectDeadlineMs, 20200);
  assert.deepEqual(timeline.cues.map(cue => cue.kind), ['five-k']);
  assert.equal(project(state, timeline, 11000).players[0].score, null);
  assert.deepEqual(finishEffect(timeline, 'stale-generation', 12000, timing), timeline);
  assert.deepEqual(finishEffect(timeline, timeline.generation, 10001, timing), timeline);
  const original = timeline;
  timeline = finishEffect(timeline, timeline.generation, 12000, timing);
  assert.equal(original.revealAtMs, null);
  assert.equal(timeline.revealAtMs, 12200);
  assert.equal(timeline.damageAtMs, 17010);
  assert.equal(timeline.holdAtMs, 19010);
  assert.equal(timeline.effect, 'none');
  assert.deepEqual(finishEffect(timeline, timeline.generation, 13000, timing), timeline);
  assert.deepEqual(timeline.cues.filter(cue => cue.kind === 'count').map(cue => [cue.atMs, cue.untilMs]), [[13410, 14160]]);
  assert.deepEqual(timeline.cues.filter(cue => cue.kind === 'damage').map(cue => [cue.atMs, cue.untilMs]), [[17010, 17810]]);
});

test('watchdog advances with unchanged state and late callback cannot reschedule stages', () => {
  const state = perfectState();
  const original = advance(null, state, 10000);
  assert.equal(nextTimelineWakeAtMs(original, state, 10200), 20200);
  const timeline = advance(original, state, 30000);
  assert.equal(timeline.effect, 'none');
  assert.equal(timeline.revealAtMs, 20400);
  assert.equal(timeline.phase, 'between-rounds');
  assert.deepEqual(finishEffect(timeline, original.generation, 31000, timing), timeline);
});

test('Finished arriving immediately preserves the final round reveal before winner', () => {
  const resolved = entry(5, 'DuelRoundTimedOut');
  const finished = entry(5, 'DuelFinished');
  let timeline = advance(null, resolved.state, 10000);
  const generation = timeline.generation;
  timeline = advance(timeline, finished.state, 10001);
  assert.equal(timeline.generation, generation);
  assert.equal(timeline.phase, 'results-transition');
  assert.equal(project(finished.state, timeline, 10001).players[0].health, 5533);
  timeline = advance(timeline, finished.state, 11800);
  assert.equal(timeline.phase, 'results-reveal');
  const completeAt = timeline.holdAtMs!;
  timeline = advance(timeline, finished.state, completeAt);
  assert.equal(timeline.phase, 'finished');
  assert.equal(timeline.music, 'idle');
  assert.equal(project(finished.state, timeline, completeAt).players[0].health, 0);
});

test('finished snapshot first seen during live also sequences its complete results', () => {
  const started = entry(5, 'DuelNewRound');
  const finished = entry(5, 'DuelFinished');
  const timeline = advance(advance(null, started.state, 10000), finished.state, 12000);
  assert.equal(timeline.phase, 'results-transition');
  assert.equal(timeline.revealAtMs, 12200);
});

test('abort, next round, and new game cancel video generations and their pending cues', () => {
  const pending = advance(null, perfectState(), 10000);
  const abort = { ...perfectState(), aborted: true, status: 'Finished' as const };
  const next = entry(4, 'DuelNewRound').state;
  const other = stateFrom('gs2-ws-DuelStarted-created-not-started.json');
  for (const [state, phase] of [[abort, 'aborted'], [next, 'pre-round'], [other, 'waiting-host']] as const) {
    const timeline = advance(pending, state, 11000);
    assert.notEqual(timeline.generation, pending.generation);
    assert.equal(timeline.phase, phase);
    assert.equal(timeline.effect, 'none');
    assert.equal(timeline.revealAtMs, null);
    assert.equal(timeline.cues.some(cue => cue.id.startsWith(pending.generation)), false);
    assert.deepEqual(finishEffect(timeline, pending.generation, 12000, timing), timeline);
  }
});

test('bootstrap restores final results without historical cues or animation and preserves music epoch', () => {
  const state = perfectState();
  const old = advance(null, state, 10000);
  const timeline = advance(old, state, 12000, true);
  assert.equal(timeline.musicEpochMs, old.musicEpochMs);
  assert.notEqual(timeline.generation, old.generation);
  assert.equal(timeline.effect, 'none');
  assert.equal(timeline.phase, 'between-rounds');
  assert.deepEqual(timeline.cues, []);
  assert.deepEqual(project(state, timeline, 12000).players.map(player => player.score), [5000, 5000]);
  assert.deepEqual(advance(timeline, state, 13000).cues, []);
  const live = stateFrom('gs2-ws-DuelPlayerGuessed-5k.json');
  const restored = advance(null, live, Date.parse('2026-09-10T12:30:50Z'), true);
  assert.equal(restored.music, 'urgent');
  assert.equal(restored.cues.some(cue => cue.kind === 'guess' || cue.kind === 'pin'), false);
  assert.equal(restored.cues.every(cue => cue.kind === 'countdown' || cue.atMs > Date.parse('2026-09-10T12:30:50Z')), true);
  assert.equal(advance(null, entry(5, 'DuelFinished').state, 10000, true).phase, 'finished');
});

test('all captured duel sequences converge without early reveal or unresolved timeout transitions', () => {
  for (const name of ['gs2-ws-full-duel-sequence.json', 'gs2-ws-full-duel-sequence-manual-rounds.json', 'gs2-ws-full-duel-sequence-maxroundtime.json', 'gs2-ws-full-duel-sequence-aborted.json']) {
    let timeline: Timeline | null = null;
    const entries = sequence(name);
    for (const item of entries) {
      timeline = advance(timeline, item.state, item.at);
      if (!item.state.players.every(player => player.results.some(result => result.round === item.state.round))) {
        assert.ok(!timeline.phase.startsWith('results'));
        assert.equal(project(item.state, timeline, item.at).answer, null);
        assert.equal(project(item.state, timeline, item.at).players.every(player => player.score === null), true);
      }
    }
    const last = entries.at(-1)!;
    timeline = advance(timeline, last.state, last.at + 30000);
    assert.equal(timeline.phase, name.includes('aborted') ? 'aborted' : 'finished');
    assert.equal(timeline.effect, 'none');
  }
});

test('no active game cancels the timeline and zero-duration overrides finish deterministically', () => {
  const initialIdle = advance(null, null, 9000);
  assert.equal(initialIdle.phase, 'waiting-game');
  assert.equal(initialIdle.musicEpochMs, 9000);
  const pending = advance(null, perfectState(), 10000);
  const idle = advance(pending, null, 11000);
  assert.equal(idle.phase, 'waiting-game');
  assert.equal(idle.music, 'idle');
  assert.deepEqual(idle.cues, []);
  assert.deepEqual(project(null, idle, 11000), { phase: 'waiting-game', remainingMs: null, answer: null, players: [] });
  const result = entry(1, 'DuelRoundTimedOut').state;
  const immediate = advanceTimeline(null, result, 10000, false, { leadMs: 0, countMs: 0, damageMs: 0, effectWatchdogMs: 0 });
  assert.equal(immediate.phase, 'between-rounds');
  assert.deepEqual(project(result, immediate, 10000).players.map(player => [player.health, player.score]), [[6000, 4240], [5924, 4164]]);
});

test('partial results cannot reveal scores, even when the deadline has passed', () => {
  const state = structuredClone(entry(1, 'DuelRoundTimedOut').state);
  state.players[1].results = [];
  const now = Date.parse('2026-09-10T12:24:00Z');
  const timeline = advance(null, state, now);
  assert.equal(timeline.phase, 'live');
  assert.equal(timeline.revealAtMs, null);
  assert.equal(project(state, timeline, now).players.every(player => player.score === null), true);
});

test('non-default media timing determines the watchdog and all subsequent stages', () => {
  const state = perfectState();
  const custom = { leadMs: 50, countMs: 400, damageMs: 200, effectWatchdogMs: 900 };
  let timeline = advanceTimeline(null, state, 10000, false, custom);
  assert.equal(timeline.effectDeadlineMs, 10950);
  timeline = advanceTimeline(timeline, state, 10950, false, custom);
  assert.equal(timeline.revealAtMs, 11000);
  assert.equal(timeline.damageAtMs, 15460);
  assert.equal(timeline.scoring?.healthEndAtMs, 15660);
  assert.equal(timeline.holdAtMs, 17460);
});
