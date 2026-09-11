import assert from 'node:assert/strict';
import test from 'node:test';

import type { DuelState, RoundResult } from '../../types/presenter.ts';
import { applySnapshot } from '../normalize.ts';
import { decodeSnapshot } from '../protocol.ts';
import { deriveServerHealthReplica, deriveTieRange, tieRangeBand } from '../tie-range.ts';
import { sample } from './fixtures.ts';

function result(round: number, score: number): RoundResult {
  return {
    round,
    score,
    bestGuess: {
      round,
      score,
      lat: round,
      lng: -round,
      distanceM: 1000 * round,
      createdAtMs: round,
    },
    healthBefore: -1,
    healthAfter: -1,
    damageDealt: -1,
    multiplier: -1,
  };
}

function state(
  scores: Array<[number, number]>,
  overrides: Partial<DuelState> = {},
  ruleOptions: DuelState['ruleOptions'] = {
    individual: 5,
    mutual: 0,
    delay: 1,
    maxErrorDistance: null,
  },
): DuelState {
  const rounds = scores.map((_, index) => ({
    number: index + 1,
    panorama: { lat: index, lng: index, panoId: `pano-${index + 1}`, heading: 0, pitch: 0, zoom: 0 },
    startAtMs: index,
    timerStartAtMs: index,
    endAtMs: index + 1,
    multiplier: -1,
  }));
  const players: DuelState['players'] = [
    {
      id: 'blue-player', teamId: 'blue-team', teamColor: 'blue', health: -1, multiplier: -1,
      pin: { lat: 99, lng: 99 }, guesses: scores.map(([score], index) => result(index + 1, score).bestGuess!),
      results: scores.map(([score], index) => result(index + 1, score)),
    },
    {
      id: 'red-player', teamId: 'red-team', teamColor: 'red', health: -1, multiplier: -1,
      pin: { lat: -99, lng: -99 }, guesses: scores.map(([, score], index) => result(index + 1, score).bestGuess!),
      results: scores.map(([, score], index) => result(index + 1, score)),
    },
  ];
  return {
    gameId: 'game', version: 1, round: scores.length, mode: 'MOVE', status: 'Ongoing', paused: false,
    manualRoundStart: false, maxRounds: null, initialHealth: 6000, ruleOptions, players, rounds,
    aborted: false, winnerTeamId: null, isDraw: false,
    ...overrides,
  };
}

test('tie-range band uses the full or half score deficit with exact 5Ks at zero', () => {
  assert.equal(tieRangeBand(4000, 'full'), 1000);
  assert.equal(tieRangeBand(4001, 'half'), 499);
  assert.equal(tieRangeBand(5000, 'full'), 0);
});

test('snapshot normalization retains valid multiplier rules and map scale', () => {
  const decoded = decodeSnapshot(sample('gs2-ws-DuelStarted.json'));

  assert.deepEqual(decoded.state?.ruleOptions, {
    individual: 5,
    mutual: 0,
    delay: 1,
    maxErrorDistance: 18540198,
  });
});

test('snapshot normalization makes a missing map scale non-blocking', () => {
  const input = structuredClone(sample('gs2-ws-DuelStarted.json')) as any;
  delete input.duel.state.options.map.maxErrorDistance;

  assert.deepEqual(decodeSnapshot(input).state?.ruleOptions, {
    individual: 5,
    mutual: 0,
    delay: 1,
    maxErrorDistance: null,
  });
});

test('snapshot normalization omits unusable HP rule options without rejecting an ordinary snapshot', () => {
  for (const mutate of [
    (options: any) => { delete options.roundWinMultiplierIncrement; },
    (options: any) => { options.multiplierIncrement = -1; },
    (options: any) => { options.roundsWithoutDamageMultiplier = 1.5; },
  ]) {
    const input = structuredClone(sample('gs2-ws-DuelStarted.json')) as any;
    mutate(input.duel.state.options);
    const decoded = decodeSnapshot(input);
    assert.ok(decoded.state);
    assert.equal(decoded.state.ruleOptions, undefined);
  }
});

test('full mode damages inside the band and increments both players', () => {
  const source = state([[4000, 3000], [3000, 4000]]);
  const derived = deriveTieRange(source, 'full');

  assert.deepEqual(derived.tieRange, {
    mode: 'full',
    rounds: [
      { round: 1, band: 1000, withinBand: true },
      { round: 2, band: 1000, withinBand: true },
    ],
  });
  assert.deepEqual(derived.players.map(player => ({ health: player.health, multiplier: player.multiplier })), [
    { health: 4500, multiplier: 2 },
    { health: 5000, multiplier: 2 },
  ]);
  assert.deepEqual(derived.players[0].results.map(({ healthBefore, healthAfter, damageDealt, multiplier }) => ({ healthBefore, healthAfter, damageDealt, multiplier })), [
    { healthBefore: 6000, healthAfter: 6000, damageDealt: 1000, multiplier: 1 },
    { healthBefore: 6000, healthAfter: 4500, damageDealt: 0, multiplier: 1.5 },
  ]);
  assert.deepEqual(derived.players[1].results.map(({ healthBefore, healthAfter, damageDealt, multiplier }) => ({ healthBefore, healthAfter, damageDealt, multiplier })), [
    { healthBefore: 6000, healthAfter: 5000, damageDealt: 0, multiplier: 1 },
    { healthBefore: 5000, healthAfter: 5000, damageDealt: 1500, multiplier: 1.5 },
  ]);
});

test('full and half modes include the exact boundary and reject one point beyond it', () => {
  assert.equal(deriveTieRange(state([[4000, 3000]]), 'full').tieRange?.rounds[0].withinBand, true);
  assert.equal(deriveTieRange(state([[4000, 2999]]), 'full').tieRange?.rounds[0].withinBand, false);
  assert.equal(deriveTieRange(state([[4000, 3500]]), 'half').tieRange?.rounds[0].withinBand, true);
  assert.equal(deriveTieRange(state([[4000, 3499]]), 'half').tieRange?.rounds[0].withinBand, false);
  assert.equal(deriveTieRange(state([[2500, 0]]), 'full').tieRange?.rounds[0].withinBand, true);
  assert.equal(deriveTieRange(state([[2500, 0]]), 'half').tieRange?.rounds[0].withinBand, false);
});

test('exact ties and double 5Ks deal no damage and increment both players', () => {
  for (const scores of [[251, 251], [5000, 5000]] as Array<[number, number]>) {
    const derived = deriveTieRange(state([scores]), 'full');
    assert.deepEqual(derived.players.map(player => ({ health: player.health, multiplier: player.multiplier, damage: player.results[0].damageDealt })), [
      { health: 6000, multiplier: 1.5, damage: 0 },
      { health: 6000, multiplier: 1.5, damage: 0 },
    ]);
  }
});

test('a 5000 to 4999 round is decisive despite its zero band', () => {
  const derived = deriveTieRange(state([[5000, 4999]]), 'full');
  assert.deepEqual(derived.tieRange?.rounds[0], { round: 1, band: 0, withinBand: false });
  assert.deepEqual(derived.players.map(player => ({ health: player.health, multiplier: player.multiplier })), [
    { health: 6000, multiplier: 1.5 },
    { health: 5999, multiplier: 1 },
  ]);
});

test('damage uses half-to-even rounding with multiplier tenths', () => {
  const down = deriveTieRange(state([[5000, 5000], [4000, 3813]], { initialHealth: 20000 }), 'full');
  assert.equal(down.players[0].results[1].damageDealt, 280);
  const up = deriveTieRange(state([[5000, 5000], [4000, 135]], { initialHealth: 20000 }), 'half');
  assert.equal(up.players[0].results[1].damageDealt, 5798);
});

test('delayed individual and mutual increments update player and round multipliers', () => {
  const derived = deriveTieRange(
    state([[4000, 2999], [2999, 4000], [4000, 2999]], {}, {
      individual: 5, mutual: 5, delay: 2, maxErrorDistance: null,
    }),
    'full',
  );
  assert.deepEqual(derived.rounds.map(round => round.multiplier), [1, 1, 1.5]);
  assert.deepEqual(derived.players.map(player => player.results.map(item => item.multiplier)), [[1, 1, 1.5], [1, 1, 2]]);
  assert.deepEqual(derived.players.map(player => player.multiplier), [2.5, 2.5]);
});

test('a knockout stops the fold, suppresses terminal increments, and keeps the final panorama', () => {
  const source = state([[5000, 0], [5000, 0], [0, 5000]], {
    status: 'Finished', aborted: true, winnerTeamId: 'red-team',
  });
  const derived = deriveTieRange(source, 'full');

  assert.equal(derived.round, 2);
  assert.equal(derived.status, 'Finished');
  assert.equal(derived.aborted, false);
  assert.equal(derived.winnerTeamId, 'blue-team');
  assert.equal(derived.isDraw, false);
  assert.deepEqual(derived.rounds.map(round => round.panorama.panoId), ['pano-1', 'pano-2']);
  assert.deepEqual(derived.players.map(player => ({ health: player.health, multiplier: player.multiplier })), [
    { health: 6000, multiplier: 1.5 },
    { health: 0, multiplier: 1 },
  ]);
  assert.deepEqual(derived.players.map(player => player.results.length), [2, 2]);
  assert.deepEqual(derived.players.map(player => player.guesses.length), [2, 2]);
});

test('an abort before custom knockout remains aborted', () => {
  const derived = deriveTieRange(state([[4000, 3000]], {
    status: 'Finished', aborted: true, winnerTeamId: 'red-team',
  }), 'full');
  assert.equal(derived.status, 'Finished');
  assert.equal(derived.aborted, true);
  assert.equal(derived.winnerTeamId, 'red-team');
});

test('the completed round limit decides a winner or draw from remaining custom HP', () => {
  const winner = deriveTieRange(state([[4000, 3000], [4000, 3000]], { maxRounds: 2 }), 'full');
  assert.deepEqual({ status: winner.status, winner: winner.winnerTeamId, draw: winner.isDraw }, {
    status: 'Finished', winner: 'blue-team', draw: false,
  });
  assert.deepEqual(winner.players.map(player => player.multiplier), [1.5, 1.5]);

  const draw = deriveTieRange(state([[4000, 4000], [3000, 3000]], { maxRounds: 2 }), 'full');
  assert.deepEqual({ status: draw.status, winner: draw.winnerTeamId, draw: draw.isDraw }, {
    status: 'Finished', winner: null, draw: true,
  });
});

test('off mode returns the original state object unchanged', () => {
  const source = state([[4000, 3000]]);
  assert.equal(deriveTieRange(source, 'off'), source);
});

test('enabled derivation is detached and never mutates its source', () => {
  const source = state([[4000, 3000]]);
  const before = structuredClone(source);
  const derived = deriveTieRange(source, 'full');
  assert.deepEqual(source, before);
  assert.notEqual(derived, source);
  assert.notEqual(derived.players[0], source.players[0]);
  assert.notEqual(derived.players[0].results[0], source.players[0].results[0]);
});

test('enabled derivation rejects missing rules, invalid scores, asymmetric history, and round gaps', () => {
  const missingRules = state([[4000, 3000]]);
  delete missingRules.ruleOptions;
  assert.throws(() => deriveTieRange(missingRules, 'full'), /rule options/i);

  const invalidScore = state([[5001, 3000]]);
  assert.throws(() => deriveTieRange(invalidScore, 'full'), /score.*round 1/i);

  const asymmetric = state([[4000, 3000]]);
  asymmetric.players[1].results = [];
  assert.throws(() => deriveTieRange(asymmetric, 'full'), /incomplete.*round 1/i);

  const gap = state([[4000, 3000], [3000, 4000]]);
  gap.players[0].results.shift();
  gap.players[1].results.shift();
  assert.throws(() => deriveTieRange(gap, 'full'), /gap.*round 1/i);
});

test('the server-health replica matches every relevant field in all four completed captures', () => {
  for (const name of [
    'gs2-ws-full-duel-sequence.json',
    'gs2-ws-full-duel-sequence-manual-rounds.json',
    'gs2-ws-full-duel-sequence-maxroundtime.json',
    'gs2-ws-full-duel-sequence-mutual-multiplier.json',
  ]) {
    let captured: DuelState | null = null;
    for (const entry of sample(name) as Array<{ message: unknown }>) {
      captured = applySnapshot(captured, entry.message).state;
    }
    assert.ok(captured, name);
    assert.deepEqual(deriveServerHealthReplica(captured), captured, name);
  }
});
