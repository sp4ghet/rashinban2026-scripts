import assert from 'node:assert/strict';
import test from 'node:test';
import { applySnapshot } from '../normalize.ts';
import { advanceTimeline, DEFAULT_TIMING, finishEffect } from '../timeline.ts';
import { project } from '../projection.ts';
import { sample } from './fixtures.ts';

function result(multiplier = 1, tied = false) {
  const state = structuredClone(applySnapshot(null, sample('gs2-ws-DuelRoundTimedOut-nopin.json')).state!);
  state.status = 'Ongoing'; state.manualRoundStart = false;
  const scores = tied ? [4500, 4500] : [4788, 4732];
  state.players.forEach((player, i) => {
    player.results = [{ round: state.round, score: scores[i], bestGuess: null, healthBefore: i ? 5784 : 6000,
      healthAfter: i && !tied ? 5784 - 56 * multiplier : i ? 5784 : 6000, damageDealt: i || tied ? 0 : 56 * multiplier, multiplier: i ? 2 : multiplier }];
  });
  return state;
}

test('ordinary scoring explains count, subtraction, difference, flight and delayed authoritative HP impact', () => {
  const state = result(); const t = advanceTimeline(null, state, 10000, false, DEFAULT_TIMING);
  assert.equal(t.revealAtMs, 10200);
  assert.equal(t.scoring?.countAtMs, 11410); assert.equal(t.scoring?.countEndAtMs, 12160);
  assert.equal(t.scoring?.subtractAtMs, 13160); assert.equal(t.scoring?.differenceAtMs, 13510);
  assert.equal(t.scoring?.flightAtMs, 14660); assert.equal(t.damageAtMs, 15010); assert.equal(t.holdAtMs, 17010);
  const at = (now: number) => project(state, advanceTimeline(t, state, now, false, DEFAULT_TIMING), now);
  assert.equal(at(10200).scoring?.stage, 'entry');
  assert.deepEqual(at(11410).players.map(p => p.score), [0, 0]);
  assert.deepEqual(at(11785).players.map(p => p.score), [2394, 2366]);
  assert.equal(at(12160).scoring?.stage, 'score-hold');
  assert.equal(at(13160).scoring?.stage, 'subtract');
  assert.equal(at(13510).scoring?.stage, 'difference');
  assert.equal(at(13510).scoring?.difference, 56);
  assert.equal(at(14660).scoring?.stage, 'flight');
  assert.equal(at(15009).players[1].health, 5784);
  assert.equal(at(15010).scoring?.stage, 'impact');
  assert.ok(at(15410).players[1].health < 5784 && at(15410).players[1].health > 5728);
  assert.equal(at(15810).players[1].health, 5728);
  assert.equal(at(17010).phase, 'between-rounds');
  assert.deepEqual(t.cues.map(c => [c.kind, c.atMs]), [['results', 10200], ['count', 11410], ['collision', 13410], ['damage', 15010]]);
});

test('multiplier stage uses the attacking player multiplier and server damage, including capped HP loss', () => {
  const state = result(1.5); const t = advanceTimeline(null, state, 10000, false, DEFAULT_TIMING);
  assert.equal(t.scoring?.multiplierAtMs, 14160); assert.equal(t.scoring?.flightAtMs, 15160); assert.equal(t.damageAtMs, 15510);
  const p = project(state, advanceTimeline(t, state, 14160, false, DEFAULT_TIMING), 14160);
  assert.equal(p.scoring?.stage, 'multiplier'); assert.equal(p.scoring?.multiplier, 1.5); assert.equal(p.scoring?.damage, 84);
  assert.ok(t.cues.some(c => c.kind === 'multiplier' && c.atMs === 14160));
  state.players[0].results[0].damageDealt = 900;
  state.players[1].results[0].healthBefore = 100; state.players[1].results[0].healthAfter = 0;
  const overkill = advanceTimeline(null, state, 10000, false, DEFAULT_TIMING);
  assert.equal(overkill.scoring?.damage, 900, 'display server damage rather than recalculating score difference or capped loss');
  assert.equal(project(state, advanceTimeline(overkill, state, 19000, false, DEFAULT_TIMING), 19000).players[1].health, 0);
});

test('tie preserves original scores, collides centrally and never schedules flight or health loss', () => {
  const state = result(1, true); const t = advanceTimeline(null, state, 10000, false, DEFAULT_TIMING);
  assert.equal(t.scoring?.tied, true); assert.equal(t.scoring?.flightAtMs, null); assert.equal(t.damageAtMs, null);
  assert.equal(t.holdAtMs, 13860);
  const p = project(state, advanceTimeline(t, state, 13510, false, DEFAULT_TIMING), 13510);
  assert.equal(p.scoring?.stage, 'tie'); assert.deepEqual(p.players.map(p => p.score), [4500, 4500]);
  assert.deepEqual(p.players.map(p => p.health), [6000, 5784]);
  assert.ok(t.cues.some(c => c.kind === 'tie' && c.atMs === 13510));
  assert.equal(t.cues.some(c => c.kind === 'damage' || c.kind === 'multiplier'), false);
});

test('5K gate shifts the complete sequence and reconnect restores final state without old stages or sounds', () => {
  const state = result(); state.players[0].results[0].score = 5000;
  const pending = advanceTimeline(null, state, 10000, false, DEFAULT_TIMING);
  assert.ok(pending.scoring); assert.equal(project(state, pending, 11000).scoring, undefined);
  const done = finishEffect(pending, pending.generation, 12000, DEFAULT_TIMING);
  assert.equal(done.revealAtMs, 12000); assert.equal(done.damageAtMs, 16810);
  assert.deepEqual(done.scoring, pending.scoring);
  const restored = advanceTimeline(done, state, 14000, true, DEFAULT_TIMING);
  assert.equal(restored.scoring, null); assert.deepEqual(restored.cues, []);
  assert.equal(project(state, restored, 14000).players[0].score, 5000);
});

test('configured count duration is honored without compressing the explanation stages', () => {
  const state = result(1.5); const t = advanceTimeline(null, state, 10000, false, { ...DEFAULT_TIMING, countMs: 1200 });
  assert.equal(t.scoring?.countEndAtMs, 12610); assert.equal(t.damageAtMs, 15960);
});
