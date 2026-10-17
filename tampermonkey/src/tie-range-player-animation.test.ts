import assert from 'node:assert/strict';
import test from 'node:test';
import { pinpointingPhase, scoringPhase } from './tie-range-player-animation.ts';

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
test('Pinpointing Duels counts, announces the verdict at the collision beat, and never deals damage', () => {
  assert.equal(pinpointingPhase(375).count, .5);
  assert.equal(pinpointingPhase(750).count, 1);
  assert.equal(pinpointingPhase(1749).verdict, false);
  assert.equal(pinpointingPhase(1750).verdict, true);
  assert.equal(pinpointingPhase(2999).done, false);
  assert.equal(pinpointingPhase(3000).done, false);
  assert.equal(pinpointingPhase(4250).done, true);
});


test('keeps the impact tail visible after HP settles, matching the presenter', () => {
  assert.equal(scoringPhase(4400, false, false).health, 1);
  assert.equal(scoringPhase(4400, false, false).done, false);
  assert.equal(scoringPhase(5600, false, false).done, true);
  assert.equal(scoringPhase(4900, true, false).done, false);
  assert.equal(scoringPhase(6100, true, false).done, true);
});

test('uses spring HP and a faster bar instead of linear interpolation', () => {
  const phase = scoringPhase(3800, false, false);
  assert.ok(phase.health > .7 && phase.health < .8);
  assert.ok(phase.bar > phase.health);
});

test('score travel anticipates the collision and continues through impact', () => {
  assert.ok(scoringPhase(1850, false, false).motion.travel < 0);
  const before = scoringPhase(3599.99, false, false).motion;
  const impact = scoringPhase(3600, false, false).motion;
  assert.ok(impact.flight < 1);
  assert.ok(Math.abs(before.flight - impact.flight) < .001);
  assert.equal(scoringPhase(3650, false, false).motion.flight, 1);
});

test('a zero-damage result never flies toward or flashes the health bar', () => {
  const phase = scoringPhase(4000, true, false, false);
  assert.equal(phase.flight, 0);
  assert.equal(phase.health, 0);
  assert.equal(phase.done, true);
});
