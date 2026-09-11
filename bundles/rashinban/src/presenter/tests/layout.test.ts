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
