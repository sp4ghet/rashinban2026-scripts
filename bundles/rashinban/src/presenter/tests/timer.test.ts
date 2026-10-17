import assert from 'node:assert/strict';
import test from 'node:test';
import { timerPresentation } from '../../graphics/presenter/timer.ts';
import { applySnapshot } from '../normalize.ts';
import { sample } from './fixtures.ts';

test('countdown follows the deadline and uses seconds through the final minute', () => {
  assert.equal(timerPresentation(60001).text, '1:01');
  assert.equal(timerPresentation(60000).text, '60');
  assert.equal(timerPresentation(39001).text, '40');
  assert.equal(timerPresentation(10001).critical, false);
  assert.equal(timerPresentation(10000).critical, true);
  assert.equal(timerPresentation(-100).text, '0');
  assert.equal(timerPresentation(null).dial, false);
  assert.equal(timerPresentation(null).critical, false);
});

test('the radial countdown follows a shortened first-guess timer and reconnects deterministically', () => {
  const round = applySnapshot(null, sample('gs2-ws-DuelStarted.json')).state!.rounds[0];
  Object.assign(round, { startAtMs: 0, timerStartAtMs: 30000, endAtMs: 45000 });
  const face = timerPresentation(12000, round);
  assert.equal(face.text, '12'); assert.equal(face.sweep, 288); assert.equal(face.dial, true);
  assert.equal(timerPresentation(15000, round).dial, false);
  assert.equal(timerPresentation(10000, round).dial, false);
  assert.deepEqual(timerPresentation(12000, round), face);
});
