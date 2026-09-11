import assert from 'node:assert/strict';
import test from 'node:test';
import { canPlayCue, interactionCues, pinCue, applyPinCues } from '../cues.ts';
import { advanceTimeline, DEFAULT_TIMING, finishEffect } from '../timeline.ts';
import { applySnapshot } from '../normalize.ts';
import { sample } from './fixtures.ts';
import type { Cue, DuelState } from '../../types/presenter.ts';
const guess: Cue = { id: 'g/1/a/guess', kind: 'guess', atMs: 1000, untilMs: 1250, playerId: 'a' };
function live(): DuelState { const s = applySnapshot(null, sample('gs2-ws-DuelPlayerGuessed-5k.json')).state!; s.players.forEach(p => { p.pin = null; p.guesses = []; p.results = []; }); s.rounds.find(r => r.number === s.round)!.startAtMs = 0; s.rounds.find(r => r.number === s.round)!.endAtMs = null; return s; }
test('late join ignores expired or already played one-shots but accepts future cues', () => {
  assert.equal(canPlayCue(guess, 2000, new Set()), false);
  assert.equal(canPlayCue(guess, 1100, new Set([guess.id])), false);
  assert.equal(canPlayCue(guess, 500, new Set()), true);
  assert.equal(canPlayCue({ ...guess, kind: 'damage', untilMs: 2000 }, 1300, new Set()), false);
  assert.equal(canPlayCue({ ...guess, kind: 'count', untilMs: 2000 }, 1300, new Set()), true);
});
test('pin drag compares coordinates and throttles for 150ms without delayed replay', () => {
  assert.equal(pinCue('a', null, { lat: 1, lng: 2 }, 1000, 1149, 'g'), null);
  assert.equal(pinCue('a', { lat: 1, lng: 2 }, { lat: 1, lng: 2 }, 0, 2000, 'g'), null);
  assert.equal(pinCue('a', null, null, 0, 2000, 'g'), null);
  assert.equal(pinCue('a', null, { lat: 1, lng: 2 }, 1000, 1150, 'g')?.kind, 'pin');
});
test('submission identity is stable across repeated state versions and never inferred from timeout', () => {
  const before = live(); const next = structuredClone(before); const fixture = applySnapshot(null, sample('gs2-ws-DuelPlayerGuessed-5k.json')).state!;
  next.players[1].guesses = fixture.players[1].guesses;
  const cues = interactionCues(before, next, 1000); assert.equal(cues.filter(c=>c.kind==='guess').length, 1);
  assert.equal(interactionCues(before, next, 2000)[0].id, cues[0].id);
  assert.deepEqual(interactionCues(next, next, 2000), []);
  assert.deepEqual(interactionCues(before, before, 2000), []);
  const initial = advanceTimeline(null, before, 500, true, DEFAULT_TIMING);
  const submitted = advanceTimeline(initial, next, 1000, false, DEFAULT_TIMING);
  assert.deepEqual(submitted.cues.filter(c => c.kind === 'guess'), [{ id: `${next.gameId}/${next.round}/${next.players[1].id}/guess`, kind: 'guess', playerId: next.players[1].id, atMs: 1200, untilMs: 1450 }]);
  assert.equal(advanceTimeline(initial, next, 2000, false, DEFAULT_TIMING).cues.find(c => c.kind === 'guess')!.id, cues[0].id);
  assert.equal(advanceTimeline(submitted, next, 2000, false, DEFAULT_TIMING).cues.filter(c => c.kind === 'guess').length, 0);
  assert.equal(advanceTimeline(initial, before, 2000, false, DEFAULT_TIMING).cues.filter(c => c.kind === 'guess').length, 0);
  assert.equal(advanceTimeline(submitted, next, 2000, true, DEFAULT_TIMING).cues.filter(c => c.kind === 'guess').length, 0);
});
test('state and telemetry share pin history even when a timer tick sees an unchanged snapshot', () => {
  const state = live(); const id = state.players[0].id;
  let t = advanceTimeline(null, state, 1000, true, DEFAULT_TIMING);
  t = applyPinCues(t, { [id]: { lat: 1, lng: 2 } }, 1200, DEFAULT_TIMING);
  assert.equal(t.cues.filter(c => c.kind === 'pin').length, 1);
  t = advanceTimeline(t, state, 1400, false, DEFAULT_TIMING);
  const next = structuredClone(state); next.players[0].pin = { lat: 1, lng: 2 };
  t = advanceTimeline(t, next, 1401, false, DEFAULT_TIMING);
  assert.equal(t.cues.filter(c => c.kind === 'pin').length, 1);
  t = applyPinCues(t, { [id]: { lat: 2, lng: 3 } }, 1402, DEFAULT_TIMING);
  assert.equal(t.cues.filter(c => c.kind === 'pin').length, 2);
  t = advanceTimeline(t, next, 1403, true, DEFAULT_TIMING);
  assert.equal(t.cues.filter(c => c.kind === 'pin' || c.kind === 'guess').length, 0);
});
test('deadline shortening replaces a pending continuous countdown', () => {
  const state = live(); const round = state.rounds.find(r=>r.number===state.round)!;
  round.startAtMs = 0; round.timerStartAtMs = 0; round.endAtMs = 40000;
  let t = advanceTimeline(null, state, 1000, true, DEFAULT_TIMING);
  assert.deepEqual(t.cues.map(c=>c.atMs), [25000]);
  round.endAtMs = 10000; round.timerStartAtMs = 7500;
  t = advanceTimeline(t, state, 7500, false, DEFAULT_TIMING);
  assert.deepEqual(t.cues.map(c=>[c.atMs,c.offsetS]), [[7500,12.5]]);
  assert.equal(new Set(t.cues.map(c=>c.id)).size, 1);
  t = advanceTimeline(t, state, 10000, false, DEFAULT_TIMING); assert.deepEqual(t.cues, []);
});
test('no health loss suppresses damage both normal and five-k completion paths', () => {
  const state = applySnapshot(null, sample('gs2-ws-DuelRoundTimedOut-nopin.json')).state!;
  state.players.forEach(p=>p.results.forEach(r=>{ r.healthAfter = r.healthBefore; r.score = 4000; }));
  let t = advanceTimeline(null, state, 1000, false, DEFAULT_TIMING);
  assert.equal(t.cues.some(c=>c.kind==='damage'), false);
  state.players.forEach(p=>p.results.forEach(r=>r.score=5000));
  t = advanceTimeline(null, state, 1000, false, DEFAULT_TIMING);
  t = finishEffect(t, t.generation, 2000, DEFAULT_TIMING);
  assert.equal(t.cues.some(c=>c.kind==='damage'), false);
});
