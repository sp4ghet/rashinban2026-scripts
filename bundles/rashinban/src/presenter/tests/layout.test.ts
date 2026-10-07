import assert from 'node:assert/strict';
import test from 'node:test';
import { multiplierLabel, distanceLabel } from '../../graphics/presenter/layout.ts';
import { applySnapshot } from '../normalize.ts';
import { advanceTimeline, DEFAULT_TIMING } from '../timeline.ts';
import { sample } from './fixtures.ts';

test('unequal multipliers follow series sides and keep the displayed result round', () => {
  const state = applySnapshot(null, sample('gs2-ws-DuelRoundTimedOut-nopin.json')).state!;
  const timeline = advanceTimeline(null, state, 1000, true, DEFAULT_TIMING);
  const [a, b] = state.players;
  a.multiplier = 9; b.multiplier = 8;
  a.results.find(r => r.round === timeline.round)!.multiplier = 3;
  b.results.find(r => r.round === timeline.round)!.multiplier = 1.5;
  const sides = { left: b.id, right: a.id };
  assert.equal(multiplierLabel(state, timeline, sides), 'L ×1.5 · R ×3');
  state.round += 1;
  assert.equal(multiplierLabel(state, timeline, sides), 'L ×1.5 · R ×3');
  assert.equal(multiplierLabel(state, { ...timeline, phase: 'live' }, sides), 'L ×8 · R ×9');
  a.multiplier = b.multiplier = 2;
  assert.equal(multiplierLabel(state, { ...timeline, phase: 'live' }, sides), '×2');
  assert.equal(multiplierLabel(state, timeline, { left: null, right: a.id }), 'L — · R ×3');
});

test('resolved no-pin distance is N/A while unrevealed and unmapped results stay blank', () => {
  assert.equal(distanceLabel(null, 0), 'N/A');
  assert.equal(distanceLabel(null, null), '—');
  assert.equal(distanceLabel(undefined, undefined), '—');
  assert.equal(distanceLabel(12345, 0), '12.3 km');
});

test('Pinpointing Duels verdict and points labels', async () => {
  const { verdictLabel, pointsLabel } = await import('../../graphics/presenter/layout.ts');
  const verdict = (reason: 'fastest-5k' | 'solo-5k' | 'closest' | 'tie', points: [number, number]) =>
    ({ reason, points, totalsBefore: [0, 0] as [number, number], totalsAfter: points, matchPoint: [false, false] as [boolean, boolean] });
  assert.equal(verdictLabel(verdict('solo-5k', [2, 0])), '+2 · SOLO 5K');
  assert.equal(verdictLabel(verdict('fastest-5k', [0, 1])), '+1 · FASTEST 5K');
  assert.equal(verdictLabel(verdict('fastest-5k', [0, 0])), 'DOUBLE 5K · NO POINT');
  assert.equal(verdictLabel(verdict('closest', [1, 0])), '+1 · CLOSEST');
  assert.equal(verdictLabel(verdict('tie', [0, 0])), 'TIE · NO POINT');
  assert.equal(pointsLabel(false, 7), 'FIRST TO 7');
  assert.equal(pointsLabel(true, 7), 'MATCH POINT');
  assert.equal(pointsLabel(false, 7, 8), 'WINNER');
});
