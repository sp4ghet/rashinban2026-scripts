import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSeries } from '../series.ts';

const left = { id: 'left', playerId: 'player-left', name: ' Left ', handle: '@left', wins: 1 };
const right = { id: 'right', playerId: 'player-right', name: '右', handle: '', wins: 2 };

test('BO3 wins must be integers from zero through two', () => {
  const player = { id: 'a', playerId: null, name: 'A', handle: '', wins: 0 };
  assert.throws(
    () =>
      parseSeries({
        id: 's',
        source: 'manual',
        left: { ...player, wins: 3 },
        right: { ...player, id: 'b' },
      }),
    /wins/,
  );
});

test('manual side swaps preserve competitor identity, text, and wins', () => {
  const result = parseSeries({ id: 'series', source: 'manual', left: right, right: left });

  assert.deepEqual(result, { id: 'series', source: 'manual', left: right, right: left });
});

test('competitor IDs and mapped player IDs must be unique', () => {
  assert.throws(
    () => parseSeries({ id: 'series', source: 'manual', left, right: { ...right, id: left.id } }),
    /right\.id/,
  );
  assert.throws(
    () =>
      parseSeries({
        id: 'series',
        source: 'manual',
        left,
        right: { ...right, playerId: left.playerId },
      }),
    /right\.playerId/,
  );
});

test('unmapped competitors may both have null player IDs', () => {
  const result = parseSeries({
    id: 'series',
    source: 'manual',
    left: { ...left, playerId: null },
    right: { ...right, playerId: null },
  });

  assert.equal(result.left.playerId, null);
  assert.equal(result.right.playerId, null);
});

test('invalid series fields identify the rejected field', () => {
  const valid = { id: 'series', source: 'manual', left, right };
  const cases: Array<[unknown, RegExp]> = [
    [{ ...valid, id: 4 }, /id/],
    [{ ...valid, source: 'duel' }, /source/],
    [{ ...valid, left: { ...left, name: 4 } }, /left\.name/],
    [{ ...valid, right: { ...right, handle: null } }, /right\.handle/],
    [{ ...valid, right: { ...right, playerId: 4 } }, /right\.playerId/],
    [{ ...valid, right: { ...right, wins: -1 } }, /right\.wins/],
    [{ ...valid, right: { ...right, wins: 1.5 } }, /right\.wins/],
  ];

  for (const [input, expected] of cases) assert.throws(() => parseSeries(input), expected);
});
