import assert from 'node:assert/strict';
import test from 'node:test';
import { FIRST_TO, foldPinpointing, type PinpointingInput, type PinpointingSettledRound } from '../pinpointing-core.ts';

type RoundSpec = [number, number] | [number, number, number | null, number | null];

function rounds(specs: RoundSpec[]): PinpointingSettledRound[] {
  return specs.map(([blue, red, blueAt, redAt], index) => ({
    round: index + 1,
    scores: [blue, red],
    guessedAtMs: [blueAt === undefined ? 1000 : blueAt, redAt === undefined ? 2000 : redAt],
  }));
}

function input(specs: RoundSpec[], tieRange: PinpointingInput['tieRange'] = 'off'): PinpointingInput {
  return { teamIds: ['blue-team', 'red-team'], tieRange, rounds: rounds(specs) };
}

test('first to is seven', () => {
  assert.equal(FIRST_TO, 7);
  assert.equal(foldPinpointing(input([])).firstTo, 7);
});

test('a solo 5K scores two points', () => {
  const output = foldPinpointing(input([[5000, 4999]]));
  assert.deepEqual(output.rounds[0].points, [2, 0]);
  assert.equal(output.rounds[0].reason, 'solo-5k');
  assert.equal(output.rounds[0].winner, 0);
  assert.equal(output.rounds[0].fiveKs, 1);
  assert.deepEqual(output.totals, [2, 0]);
});

test('a double 5K scores one point for the earlier guess', () => {
  const output = foldPinpointing(input([[5000, 5000, 3000, 2500]]));
  assert.deepEqual(output.rounds[0].points, [0, 1]);
  assert.equal(output.rounds[0].reason, 'fastest-5k');
  assert.equal(output.rounds[0].winner, 1);
  assert.equal(output.rounds[0].fiveKs, 2);
});

test('a double 5K with equal or unknown guess times scores nothing', () => {
  for (const [blueAt, redAt] of [[1000, 1000], [null, 1000], [1000, null], [null, null]] as const) {
    const output = foldPinpointing(input([[5000, 5000, blueAt, redAt]]));
    assert.deepEqual(output.rounds[0].points, [0, 0]);
    assert.equal(output.rounds[0].reason, 'fastest-5k');
    assert.equal(output.rounds[0].winner, null);
  }
});

test('the closer guess scores one point without tie range', () => {
  const output = foldPinpointing(input([[4000, 4001]]));
  assert.deepEqual(output.rounds[0].points, [0, 1]);
  assert.equal(output.rounds[0].reason, 'closest');
  assert.equal(output.rounds[0].band, 0);
  assert.equal(output.rounds[0].withinBand, false);
});

test('equal scores below 5K are a tie', () => {
  const output = foldPinpointing(input([[0, 0], [3210, 3210]]));
  for (const round of output.rounds) {
    assert.deepEqual(round.points, [0, 0]);
    assert.equal(round.reason, 'tie');
    assert.equal(round.winner, null);
    assert.equal(round.withinBand, true);
  }
});

test('full tie range withholds the point inside the band and awards it outside', () => {
  const output = foldPinpointing(input([[4000, 3000], [4000, 2999]], 'full'));
  assert.equal(output.rounds[0].band, 1000);
  assert.equal(output.rounds[0].reason, 'tie');
  assert.equal(output.rounds[0].withinBand, true);
  assert.deepEqual(output.rounds[0].points, [0, 0]);
  assert.equal(output.rounds[1].reason, 'closest');
  assert.deepEqual(output.rounds[1].points, [1, 0]);
});

test('half tie range halves the band', () => {
  const output = foldPinpointing(input([[4000, 3500], [4000, 3499]], 'half'));
  assert.equal(output.rounds[0].band, 500);
  assert.equal(output.rounds[0].reason, 'tie');
  assert.equal(output.rounds[1].reason, 'closest');
  assert.deepEqual(output.totals, [1, 0]);
});

test('tie range never affects 5K rounds', () => {
  const output = foldPinpointing(input([[5000, 4999], [5000, 5000, 1, 2]], 'full'));
  assert.deepEqual(output.rounds[0].points, [2, 0]);
  assert.deepEqual(output.rounds[1].points, [1, 0]);
  assert.equal(output.rounds[0].band, 0);
});

test('totals accumulate and match point starts at five', () => {
  const output = foldPinpointing(input([[5000, 0], [5000, 0], [4000, 3000]]));
  assert.deepEqual(output.rounds[2].totalsBefore, [4, 0]);
  assert.deepEqual(output.rounds[2].totalsAfter, [5, 0]);
  assert.deepEqual(output.matchPoint, [true, false]);
  assert.equal(output.terminal, null);
  const earlier = foldPinpointing(input([[5000, 0], [5000, 0]]));
  assert.deepEqual(earlier.matchPoint, [false, false]);
});

test('reaching seven ends the game and ignores later rounds', () => {
  const output = foldPinpointing(input([[5000, 0], [5000, 0], [5000, 0], [4000, 3000], [0, 5000], [0, 5000]]));
  assert.deepEqual(output.terminal, { round: 4, winnerTeamId: 'blue-team' });
  assert.equal(output.rounds.length, 4);
  assert.deepEqual(output.totals, [7, 0]);
});

test('a solo 5K from six finishes at eight', () => {
  const output = foldPinpointing(input([[5000, 0], [5000, 0], [5000, 0], [5000, 0]]));
  assert.deepEqual(output.terminal, { round: 4, winnerTeamId: 'blue-team' });
  assert.deepEqual(output.totals, [8, 0]);
});

test('the opponent can win', () => {
  const specs: RoundSpec[] = Array.from({ length: 7 }, () => [100, 200]);
  const output = foldPinpointing(input(specs));
  assert.deepEqual(output.terminal, { round: 7, winnerTeamId: 'red-team' });
  assert.deepEqual(output.matchPoint, [false, false], 'a winner is no longer on match point');
  assert.deepEqual(foldPinpointing(input(specs.slice(0, 6))).matchPoint, [false, true]);
});

test('output copies team ids and tie range', () => {
  const output = foldPinpointing(input([], 'half'));
  assert.deepEqual(output.teamIds, ['blue-team', 'red-team']);
  assert.equal(output.tieRange, 'half');
  assert.deepEqual(output.totals, [0, 0]);
  assert.deepEqual(output.rounds, []);
});

test('invalid input is rejected', () => {
  const valid = input([[1, 2]]);
  const gap = { ...valid, rounds: [{ ...valid.rounds[0], round: 2 }] };
  assert.throws(() => foldPinpointing(gap), /gap/);
  assert.throws(() => foldPinpointing({ ...valid, rounds: [{ ...valid.rounds[0], scores: [5001, 0] }] }), /score/);
  assert.throws(() => foldPinpointing({ ...valid, rounds: [{ ...valid.rounds[0], scores: [0.5, 0] }] }), /score/);
  assert.throws(() => foldPinpointing({ ...valid, rounds: [{ ...valid.rounds[0], guessedAtMs: [NaN, null] }] }), /guess time/);
  assert.throws(() => foldPinpointing({ ...valid, teamIds: ['same', 'same'] }), /team/);
  assert.throws(() => foldPinpointing({ ...valid, tieRange: 'third' as never }), /tie range/i);
});
