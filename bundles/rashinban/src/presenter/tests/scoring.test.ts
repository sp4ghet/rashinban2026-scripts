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

function pinpointing(tied = false) {
  const state = result(1, tied);
  const scores = state.players.map(player => player.results[0].score) as [number, number];
  state.pinpointing = {
    teamIds: [state.players[0].teamId, state.players[1].teamId], firstTo: 7, tieRange: 'off', totals: tied ? [2, 1] : [3, 1],
    matchPoint: [false, false], terminal: null,
    rounds: [{ round: state.round, scores, guessedAtMs: [1, 2], points: tied ? [0, 0] : [1, 0], totalsBefore: [2, 1],
      totalsAfter: tied ? [2, 1] : [3, 1], winner: tied ? null : 0, reason: tied ? 'tie' : 'closest', band: 0, withinBand: tied, fiveKs: 0 }],
  };
  return state;
}

test('Pinpointing Duels scoring counts, then shows the verdict with the new totals and no damage stages', () => {
  const state = pinpointing(); const t = advanceTimeline(null, state, 10000, false, DEFAULT_TIMING);
  assert.equal(t.scoring?.countAtMs, 11410); assert.equal(t.scoring?.countEndAtMs, 12160);
  assert.equal(t.scoring?.verdictAtMs, 13160); assert.equal(t.holdAtMs, 15660);
  assert.equal(t.scoring?.flightAtMs, null); assert.equal(t.scoring?.impactAtMs, null); assert.equal(t.scoring?.multiplierAtMs, null);
  assert.equal(t.damageAtMs, null); assert.equal(t.hasDamage, false);
  assert.equal(t.scoring?.pinpointing?.reason, 'closest'); assert.deepEqual(t.scoring?.pinpointing?.points, [1, 0]);
  assert.equal(t.scoring?.winnerId, state.players[0].id); assert.equal(t.scoring?.loserId, state.players[1].id);
  const at = (now: number) => project(state, advanceTimeline(t, state, now, false, DEFAULT_TIMING), now);
  assert.equal(at(12160).scoring?.stage, 'score-hold');
  assert.deepEqual(at(12160).players.map(p => p.points), [2, 1]);
  assert.deepEqual(at(12160).players.map(p => p.score), [4788, 4732]);
  assert.equal(at(13159).scoring?.stage, 'score-hold');
  assert.equal(at(13160).scoring?.stage, 'verdict');
  assert.equal(at(13160).scoring?.verdictProgress, 0);
  assert.deepEqual(at(13160).players.map(p => p.points), [3, 1]);
  assert.equal(at(13560).scoring?.verdictProgress, 1);
  assert.equal(at(15659).scoring?.stage, 'verdict');
  assert.equal(at(15660).scoring?.stage, 'complete');
  assert.equal(at(15660).phase, 'between-rounds');
  assert.deepEqual(at(15660).players.map(p => p.health), [6000, 5784], 'server HP is passed through, never animated');
  assert.deepEqual(t.cues.map(c => [c.kind, c.atMs]), [['results', 10200], ['count', 11410], ['collision', 13160]]);
});

test('a Pinpointing Duels tie keeps the totals and plays the tie cue at the verdict', () => {
  const state = pinpointing(true); const t = advanceTimeline(null, state, 10000, false, DEFAULT_TIMING);
  assert.equal(t.scoring?.tied, true); assert.equal(t.scoring?.winnerId, null);
  const p = project(state, advanceTimeline(t, state, 13160, false, DEFAULT_TIMING), 13160);
  assert.equal(p.scoring?.stage, 'verdict'); assert.equal(p.scoring?.pinpointing?.reason, 'tie');
  assert.deepEqual(p.players.map(p => p.points), [2, 1]);
  assert.ok(t.cues.some(c => c.kind === 'tie' && c.atMs === 13160));
});

test('points and match point are visible outside results', () => {
  const state = pinpointing(); state.pinpointing!.matchPoint = [true, false];
  for (const player of state.players) player.results = [];
  const t = advanceTimeline(null, state, 10000, true, DEFAULT_TIMING);
  const p = project(state, t, 10000);
  assert.deepEqual(p.players.map(player => [player.points, player.matchPoint]), [[3, true], [1, false]]);
  assert.equal(project(result(), advanceTimeline(null, result(), 10000, true, DEFAULT_TIMING), 10000).players[0].points, undefined);
});
