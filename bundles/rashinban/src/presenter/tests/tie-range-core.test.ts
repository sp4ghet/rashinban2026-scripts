import assert from 'node:assert/strict';
import test from 'node:test';

import {
  foldTieRange,
  tieRangeBand,
  type TieRangeInput,
} from '../tie-range-core.ts';

function input(
  rounds: TieRangeInput['rounds'],
  overrides: Partial<TieRangeInput> = {},
): TieRangeInput {
  return {
    initialHealth: 6000,
    individual: 5,
    mutual: 0,
    delay: 0,
    maxRounds: null,
    teamIds: ['blue-team', 'red-team'],
    rounds,
    ...overrides,
  };
}

test('folds paired numeric scores without panorama data', () => {
  const output = foldTieRange(input([
    { round: 1, scores: [4000, 3500] },
    { round: 2, scores: [3500, 4000] },
  ]), 'full');

  assert.deepEqual(output.teamIds, ['blue-team', 'red-team']);
  assert.deepEqual(output.initialHealth, [6000, 6000]);
  assert.deepEqual(output.initialMultiplierTenths, [10, 10]);
  assert.equal(output.initialMutualMultiplierTenths, 10);
  assert.deepEqual(output.currentHealth, [5250, 5500]);
  assert.deepEqual(output.currentMultiplierTenths, [20, 20]);
  assert.deepEqual(output.rounds.map(round => ({
    healthBefore: round.healthBefore,
    healthAfter: round.healthAfter,
    damageDealt: round.damageDealt,
    multiplierTenths: round.multiplierTenths,
    nextMultiplierTenths: round.nextMultiplierTenths,
  })), [
    {
      healthBefore: [6000, 6000], healthAfter: [6000, 5500], damageDealt: [500, 0],
      multiplierTenths: [10, 10], nextMultiplierTenths: [15, 15],
    },
    {
      healthBefore: [6000, 5500], healthAfter: [5250, 5500], damageDealt: [0, 750],
      multiplierTenths: [15, 15], nextMultiplierTenths: [20, 20],
    },
  ]);
});

test('half mode floors an odd score deficit before applying the inclusive band', () => {
  assert.equal(tieRangeBand(4001, 'half'), 499);
  const output = foldTieRange(input([
    { round: 1, scores: [4001, 3502] },
    { round: 2, scores: [4001, 3501] },
  ], { initialHealth: 20000 }), 'half');

  assert.deepEqual(output.rounds.map(round => ({ band: round.band, withinBand: round.withinBand })), [
    { band: 499, withinBand: true },
    { band: 499, withinBand: false },
  ]);
  assert.deepEqual(output.currentMultiplierTenths, [20, 15]);
});

test('a 5000 to 4999 result is outside the zero band and still deals damage', () => {
  const output = foldTieRange(input([{ round: 1, scores: [5000, 4999] }]), 'full');

  assert.deepEqual(output.rounds[0], {
    round: 1,
    scores: [5000, 4999],
    healthBefore: [6000, 6000],
    healthAfter: [6000, 5999],
    damageDealt: [1, 0],
    multiplierTenths: [10, 10],
    nextMultiplierTenths: [15, 10],
    band: 0,
    withinBand: false,
    mutualMultiplierTenths: 10,
    nextMutualMultiplierTenths: 10,
  });
});

test('an exact tie deals no damage and increments both multipliers', () => {
  const output = foldTieRange(input([{ round: 1, scores: [251, 251] }]), 'full');

  assert.deepEqual(output.currentHealth, [6000, 6000]);
  assert.deepEqual(output.rounds[0].damageDealt, [0, 0]);
  assert.deepEqual(output.currentMultiplierTenths, [15, 15]);
});

test('damage uses half-to-even rounding for both half cases', () => {
  const rounds: TieRangeInput['rounds'] = [
    { round: 1, scores: [5000, 5000] },
    { round: 2, scores: [4000, 3813] },
  ];
  const down = foldTieRange(input(rounds, { initialHealth: 20000 }), 'full');
  assert.equal(down.rounds[1].damageDealt[0], 280);

  const up = foldTieRange(input([
    { round: 1, scores: [5000, 5000] },
    { round: 2, scores: [4000, 135] },
  ], { initialHealth: 20000 }), 'half');
  assert.equal(up.rounds[1].damageDealt[0], 5798);
});

test('delay and mutual increments carry into later round multipliers', () => {
  const output = foldTieRange(input([
    { round: 1, scores: [4000, 2999] },
    { round: 2, scores: [2999, 4000] },
    { round: 3, scores: [4000, 2999] },
  ], { individual: 5, mutual: 5, delay: 2 }), 'full');

  assert.deepEqual(output.rounds.map(round => round.mutualMultiplierTenths), [10, 10, 15]);
  assert.deepEqual(output.rounds.map(round => round.multiplierTenths), [[10, 10], [10, 10], [15, 20]]);
  assert.deepEqual(output.currentMultiplierTenths, [25, 25]);
  assert.equal(output.currentMutualMultiplierTenths, 20);
});

test('lethal damage remains unclamped and stops before terminal increments', () => {
  const output = foldTieRange(input([
    { round: 1, scores: [5000, 0] },
    { round: 2, scores: [5000, 0] },
    { round: 3, scores: [0, 5000] },
  ]), 'full');

  assert.equal(output.rounds.length, 2);
  assert.deepEqual(output.rounds[1].damageDealt, [7500, 0]);
  assert.deepEqual(output.currentHealth, [6000, 0]);
  assert.deepEqual(output.currentMultiplierTenths, [15, 10]);
  assert.deepEqual(output.terminal, { round: 2, winnerTeamId: 'blue-team', isDraw: false });
});

test('equal health at the completed round limit is a draw', () => {
  const output = foldTieRange(input([
    { round: 1, scores: [4000, 4000] },
    { round: 2, scores: [3000, 3000] },
    { round: 3, scores: [5000, 0] },
  ], { maxRounds: 2 }), 'full');

  assert.equal(output.rounds.length, 2);
  assert.deepEqual(output.currentMultiplierTenths, [15, 15]);
  assert.deepEqual(output.terminal, { round: 2, winnerTeamId: null, isDraw: true });
});

test('rejects malformed or gapped settled history', () => {
  assert.throws(() => foldTieRange(input([
    { round: 1, scores: [4000, 3000] },
    { round: 3, scores: [3000, 4000] },
  ]), 'full'), /gap.*round 2/i);
  assert.throws(() => foldTieRange(input([
    { round: 1, scores: [5001, 3000] },
  ]), 'full'), /score.*round 1/i);
  assert.throws(() => foldTieRange(input([
    { round: 1, scores: [4000] as unknown as [number, number] },
  ]), 'full'), /score.*round 1/i);
  assert.throws(() => foldTieRange(input([
    { round: 0, scores: [4000, 3000] },
  ]), 'full'), /round/i);
});
