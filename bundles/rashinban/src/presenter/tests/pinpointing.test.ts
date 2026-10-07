import assert from 'node:assert/strict';
import test from 'node:test';

import type { DuelState, Guess, RoundResult } from '../../types/presenter.ts';
import { applySnapshot } from '../normalize.ts';
import { derivePinpointing } from '../pinpointing.ts';
import { sample } from './fixtures.ts';

type RoundSpec = { scores: [number, number]; guessedAt?: [number | null, number | null] };

function guess(round: number, score: number, createdAtMs: number): Guess {
  return { round, score, lat: round, lng: -round, distanceM: 1000, createdAtMs };
}

function result(round: number, score: number, best: Guess | null): RoundResult {
  return { round, score, bestGuess: best, healthBefore: 6000, healthAfter: 6000, damageDealt: 0, multiplier: 1 };
}

/** Rounds end at 1000 * round; guess times default to 100 ms (blue) and 200 ms (red) after start. */
function state(specs: RoundSpec[], overrides: Partial<DuelState> = {}): DuelState {
  const rounds = specs.map((_, index) => ({
    number: index + 1,
    panorama: { lat: index, lng: index, panoId: `pano-${index + 1}`, heading: 0, pitch: 0, zoom: 0 },
    startAtMs: index * 1000, timerStartAtMs: index * 1000, endAtMs: (index + 1) * 1000, multiplier: 1,
  }));
  const side = (team: 0 | 1) => {
    const guesses: Guess[] = [];
    const results: RoundResult[] = [];
    specs.forEach((spec, index) => {
      const round = index + 1;
      const at = spec.guessedAt?.[team] === undefined ? index * 1000 + 100 * (team + 1) : spec.guessedAt[team];
      const best = at === null ? null : guess(round, spec.scores[team], at);
      if (best) guesses.push(best);
      results.push(result(round, spec.scores[team], best));
    });
    return guesses.length ? { guesses, results } : { guesses, results };
  };
  const blue = side(0); const red = side(1);
  return {
    gameId: 'game', version: 1, round: specs.length, mode: 'MOVE', status: 'Ongoing', paused: false,
    manualRoundStart: false, maxRounds: null, initialHealth: 6000,
    ruleOptions: { individual: 5, mutual: 0, delay: 1, maxErrorDistance: 18540198 },
    players: [
      { id: 'blue-player', teamId: 'blue-team', teamColor: 'blue', health: 6000, multiplier: 1, pin: { lat: 1, lng: 1 }, ...blue },
      { id: 'red-player', teamId: 'red-team', teamColor: 'red', health: 5000, multiplier: 1, pin: null, ...red },
    ],
    rounds, aborted: false, winnerTeamId: null, isDraw: false, ...overrides,
  };
}

function replay(name: string): DuelState {
  const rows = sample(name) as { message: unknown }[];
  let current: DuelState | null = null;
  for (const row of rows) current = applySnapshot(current, row.message).state;
  return current!;
}

test('recorded duel scores closest, solo 5K and tie rounds and keeps the server finish without a winner', () => {
  const derived = derivePinpointing(replay('gs2-ws-full-duel-sequence.json'), 'off');
  assert.ok(derived.pinpointing);
  assert.deepEqual(derived.pinpointing.rounds.map(round => [round.reason, ...round.points]),
    [['closest', 1, 0], ['closest', 1, 0], ['solo-5k', 0, 2], ['tie', 0, 0], ['closest', 0, 1]]);
  assert.deepEqual(derived.pinpointing.totals, [2, 3]);
  assert.equal(derived.pinpointing.terminal, null);
  assert.equal(derived.status, 'Finished');
  assert.equal(derived.winnerTeamId, null);
  assert.equal(derived.isDraw, false);
  assert.equal(derived.tieRange, undefined);
  // Server health is passed through untouched; the graphic does not show it.
  assert.deepEqual(derived.players.map(player => player.health), replay('gs2-ws-full-duel-sequence.json').players.map(player => player.health));
});

test('tie range withholds close rounds and publishes band metadata for the results map', () => {
  const derived = derivePinpointing(replay('gs2-ws-full-duel-sequence.json'), 'full');
  assert.deepEqual(derived.pinpointing!.rounds.map(round => round.reason), ['tie', 'tie', 'solo-5k', 'tie', 'closest']);
  assert.deepEqual(derived.pinpointing!.totals, [0, 3]);
  assert.deepEqual(derived.tieRange, { mode: 'full', rounds: [
    { round: 1, band: 760, withinBand: true }, { round: 2, band: 535, withinBand: true },
    { round: 3, band: 0, withinBand: false }, { round: 4, band: 4749, withinBand: true },
    { round: 5, band: 774, withinBand: false },
  ] });
});

test('auto-submitted timeout guesses carry no guess time', () => {
  const derived = derivePinpointing(replay('gs2-ws-full-duel-sequence-manual-rounds.json'), 'off');
  assert.deepEqual(derived.pinpointing!.rounds[0].guessedAtMs, [null, null]);
  assert.deepEqual(derived.pinpointing!.rounds[2].guessedAtMs[0], null);
  assert.equal(typeof derived.pinpointing!.rounds[2].guessedAtMs[1], 'number');
});

test('a double 5K goes to the earlier deliberate guess', () => {
  const earlier = derivePinpointing(state([{ scores: [5000, 5000], guessedAt: [900, 500] }]), 'off');
  assert.deepEqual(earlier.pinpointing!.rounds[0].points, [0, 1]);
  const late = derivePinpointing(state([{ scores: [5000, 5000], guessedAt: [1500, 500] }]), 'off');
  assert.deepEqual(late.pinpointing!.rounds[0].guessedAtMs, [null, 500]);
  assert.deepEqual(late.pinpointing!.rounds[0].points, [0, 0]);
});

test('reaching seven finishes the custom game and truncates later server rounds', () => {
  const specs: RoundSpec[] = [1, 2, 3, 4, 5, 6].map(() => ({ scores: [5000, 0] }));
  const source = state(specs, { round: 6 });
  const derived = derivePinpointing(source, 'off');
  assert.deepEqual(derived.pinpointing!.terminal, { round: 4, winnerTeamId: 'blue-team' });
  assert.deepEqual(derived.pinpointing!.totals, [8, 0]);
  assert.equal(derived.status, 'Finished');
  assert.equal(derived.aborted, false);
  assert.equal(derived.winnerTeamId, 'blue-team');
  assert.equal(derived.isDraw, false);
  assert.equal(derived.round, 4);
  assert.deepEqual(derived.rounds.map(round => round.number), [1, 2, 3, 4]);
  for (const player of derived.players) {
    assert.equal(player.pin, null);
    assert.deepEqual(player.results.map(result => result.round), [1, 2, 3, 4]);
    assert.ok(player.guesses.every(item => item.round <= 4));
  }
  assert.deepEqual(source.rounds.map(round => round.number), [1, 2, 3, 4, 5, 6]);
});

test('match point is reported from five points', () => {
  const derived = derivePinpointing(state([{ scores: [5000, 0] }, { scores: [5000, 0] }, { scores: [100, 0] }]), 'off');
  assert.deepEqual(derived.pinpointing!.matchPoint, [true, false]);
  assert.equal(derived.status, 'Ongoing');
});

test('an unresolved current round is not scored', () => {
  const source = state([{ scores: [4000, 3000] }, { scores: [0, 0] }], { round: 2 });
  for (const player of source.players) player.results = player.results.filter(result => result.round === 1);
  const derived = derivePinpointing(source, 'off');
  assert.equal(derived.pinpointing!.rounds.length, 1);
  assert.deepEqual(derived.pinpointing!.totals, [1, 0]);
});

test('an abort before seven stays an aborted game', () => {
  const derived = derivePinpointing(state([{ scores: [5000, 0] }], { aborted: true }), 'off');
  assert.equal(derived.aborted, true);
  assert.deepEqual(derived.pinpointing!.totals, [2, 0]);
});

test('missing history or deadlines are rejected', () => {
  const noDeadline = state([{ scores: [4000, 3000] }]);
  noDeadline.rounds[0].endAtMs = null;
  assert.throws(() => derivePinpointing(noDeadline, 'off'), /deadline/i);
  const gap = state([{ scores: [4000, 3000] }, { scores: [1, 2] }]);
  for (const player of gap.players) player.results = player.results.filter(result => result.round !== 1);
  assert.throws(() => derivePinpointing(gap, 'off'), /gap/i);
  const invalid = state([{ scores: [5001, 3000] }]);
  assert.throws(() => derivePinpointing(invalid, 'off'), /score/i);
  const noPanorama = state([{ scores: [4000, 3000] }]);
  noPanorama.rounds = [];
  assert.throws(() => derivePinpointing(noPanorama, 'off'));
});
