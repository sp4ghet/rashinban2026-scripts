import assert from 'node:assert/strict';
import test from 'node:test';
import { clockOffset, eligibleCompletion } from '../clock.ts';

test('clock offset uses request midpoint', () => {
  assert.equal(clockOffset([{ sentMs: 1000, receivedMs: 1020, serverMs: 1110 }]), 100);
});
test('lowest RTT wins, ignoring invalid and samples over 30 seconds older than newest', () => {
  assert.equal(clockOffset([
    { sentMs: 0, receivedMs: 1, serverMs: 400 },
    { sentMs: 40000, receivedMs: 40080, serverMs: 41000 },
    { sentMs: 40100, receivedMs: 40120, serverMs: 40210 },
    { sentMs: 40200, receivedMs: 40199, serverMs: 90000 },
    { sentMs: NaN, receivedMs: 50000, serverMs: 80000 },
  ]), 100);
  assert.equal(clockOffset([]), 0);
});
test('only the unexpired lease holder can complete, including the exact expiry boundary', () => {
  const lease = { clientId: 'a', expiresAtMs: 6000 };
  assert.equal(eligibleCompletion(lease, 'a', 5999), true);
  assert.equal(eligibleCompletion(lease, 'a', 6000), false);
  assert.equal(eligibleCompletion(lease, 'b', 1000), false);
  assert.equal(eligibleCompletion(null, 'a', 1000), false);
});
