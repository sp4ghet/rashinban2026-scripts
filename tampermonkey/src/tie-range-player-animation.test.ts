import assert from 'node:assert/strict';
import test from 'node:test';
import { scoringPhase } from './tie-range-player-animation.ts';

test('matches documented cue offsets relative to COUNT_DAMAGE, not REST arrival', () => {
  assert.equal(scoringPhase(0, false, false).count, 0);
  assert.equal(scoringPhase(375, false, false).count, .5);
  assert.equal(scoringPhase(750, false, false).count, 1);
  assert.equal(scoringPhase(1749, false, false).collision, 0);
  assert.equal(scoringPhase(2100, false, false).difference, true);
  assert.equal(scoringPhase(2749, true, false).multiplied, false);
  assert.equal(scoringPhase(2750, true, false).multiplied, true);
  assert.equal(scoringPhase(3599, false, false).health, 0);
  assert.ok(scoringPhase(3601, false, false).health > 0);
  assert.equal(scoringPhase(4099, true, false).health, 0);
  assert.ok(scoringPhase(4101, true, false).health > 0);
});
test('tie collision has no multiplier, damage flight, or HP loss', () => {
  const tie = scoringPhase(2200, true, true);
  assert.equal(tie.difference, false);
  assert.equal(tie.multiplied, false);
  assert.equal(tie.flight, 0);
  assert.equal(tie.health, 0);
});
