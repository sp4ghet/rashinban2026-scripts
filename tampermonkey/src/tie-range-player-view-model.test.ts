import assert from 'node:assert/strict';
import test from 'node:test';
import type { TieRangeOutput } from '../../bundles/rashinban/src/presenter/tie-range-core.ts';
import type { PlayerTieRangeView } from './tie-range-player-controller.ts';
import type { PlayerGameContext } from './tie-range-player-state.ts';
import { derivePlayerTieRangeDisplay } from './tie-range-player-view-model.ts';

const context: PlayerGameContext = {
  schemaVersion: 1,
  gameId: 'game-1',
  mode: 'full',
  sourceVersion: 8,
  currentRoundNumber: 2,
  sourceStatus: 'Ongoing',
  teamIds: ['blue-team', 'red-team'],
  teamLabels: ['blue', 'red'],
  playerIds: ['blue-player', 'red-player'],
  roundStarts: [],
  input: {
    initialHealth: 6000,
    individual: 5,
    mutual: 5,
    delay: 1,
    maxRounds: 10,
    teamIds: ['blue-team', 'red-team'],
    rounds: [{ round: 1, scores: [0, 0] }, { round: 2, scores: [2470, 0] }],
  },
};

const output: TieRangeOutput = {
  teamIds: ['blue-team', 'red-team'],
  initialHealth: [6000, 6000],
  currentHealth: [6000, 2295],
  initialMultiplierTenths: [10, 10],
  currentMultiplierTenths: [20, 20],
  initialMutualMultiplierTenths: 10,
  currentMutualMultiplierTenths: 15,
  rounds: [{
    round: 1,
    scores: [0, 0],
    healthBefore: [6000, 6000],
    healthAfter: [6000, 6000],
    damageDealt: [0, 0],
    multiplierTenths: [10, 10],
    nextMultiplierTenths: [15, 15],
    band: 5000,
    withinBand: true,
    mutualMultiplierTenths: 10,
    nextMutualMultiplierTenths: 15,
  }, {
    round: 2,
    scores: [2470, 0],
    healthBefore: [6000, 6000],
    healthAfter: [6000, 2295],
    damageDealt: [3705, 0],
    multiplierTenths: [15, 15],
    nextMultiplierTenths: [20, 20],
    band: 2530,
    withinBand: true,
    mutualMultiplierTenths: 15,
    nextMutualMultiplierTenths: 20,
  }],
  terminal: null,
};

function view(overrides: Partial<PlayerTieRangeView> = {}): PlayerTieRangeView {
  return {
    status: 'ready',
    gameId: 'game-1',
    configuredMode: 'full',
    capturedMode: 'full',
    appliesToNextDuel: false,
    localTeamId: null,
    context,
    output,
    diagnostic: null,
    message: null,
    ...overrides,
  };
}

test('orients the display to the local red team and otherwise uses Blue/Red', () => {
  const local = derivePlayerTieRangeDisplay(view({ localTeamId: 'red-team' }), false);
  assert.deepEqual(local.teams!.map(team => [team.teamId, team.label, team.side]), [
    ['red-team', 'You', 'red'],
    ['blue-team', 'Opponent', 'blue'],
  ]);

  const neutral = derivePlayerTieRangeDisplay(view(), false);
  assert.deepEqual(neutral.teams!.map(team => [team.teamId, team.label]), [
    ['blue-team', 'Blue'],
    ['red-team', 'Red'],
  ]);
});

test('holds current-round HP and multipliers at their pre-result values until native disclosure', () => {
  const hidden = derivePlayerTieRangeDisplay(view({
    context: { ...context, currentRoundNumber: 2 },
  }), false);
  assert.deepEqual(hidden.teams!.map(team => [team.health, team.multiplierTenths]), [
    [6000, 15],
    [6000, 15],
  ]);
  assert.equal(hidden.result, null);

  const revealed = derivePlayerTieRangeDisplay(view({
    context: { ...context, currentRoundNumber: 2 },
  }), true);
  assert.deepEqual(revealed.teams!.map(team => [team.health, team.multiplierTenths]), [
    [6000, 20],
    [2295, 20],
  ]);
  assert.deepEqual(revealed.result, {
    round: 2,
    scores: [2470, 0],
    damageDealt: [3705, 0],
    usedMultiplierTenths: [15, 15],
    nextMultiplierTenths: [20, 20],
    band: 2530,
    withinBand: true,
  });
});

test('reveals a settled result after the source advances to a later round', () => {
  const display = derivePlayerTieRangeDisplay(view({
    context: { ...context, currentRoundNumber: 3 },
  }), false);
  assert.equal(display.result, null);
  assert.deepEqual(display.teams!.map(team => team.health), [6000, 2295]);
});

test('pins an oriented custom terminal result after native UI disappears', () => {
  const terminalOutput: TieRangeOutput = {
    ...output,
    terminal: { round: 2, winnerTeamId: 'red-team', isDraw: false },
  };
  const display = derivePlayerTieRangeDisplay(view({
    status: 'ended',
    localTeamId: 'red-team',
    output: terminalOutput,
  }), false);
  assert.equal(display.terminal?.headline, 'You win');
  assert.equal(display.terminal?.round, 2);
  assert.equal(display.showHud, true);
  assert.equal(display.suppressNative, true);
  assert.deepEqual(display.teams!.map(team => team.health), [2295, 6000]);
});

test('keeps terminal HP disclosed after its matching result portal unmounts', () => {
  const terminalOutput: TieRangeOutput = {
    ...output,
    terminal: { round: 2, winnerTeamId: 'blue-team', isDraw: false },
  };
  const display = derivePlayerTieRangeDisplay(view({ output: terminalOutput }), false, 2);
  assert.equal(display.terminal?.headline, 'Blue wins');
  assert.deepEqual(display.teams!.map(team => team.health), [6000, 2295]);
  assert.equal(display.result, null);
});

test('uses neutral terminal labels and represents a round-limit draw', () => {
  const winner = derivePlayerTieRangeDisplay(view({
    status: 'ended',
    output: { ...output, terminal: { round: 2, winnerTeamId: 'blue-team', isDraw: false } },
  }), false);
  assert.equal(winner.terminal?.headline, 'Blue wins');

  const draw = derivePlayerTieRangeDisplay(view({
    status: 'ended',
    output: { ...output, terminal: { round: 2, winnerTeamId: null, isDraw: true } },
  }), false);
  assert.equal(draw.terminal?.headline, 'Draw');
});

test('shows an ended source without inventing a winner', () => {
  const display = derivePlayerTieRangeDisplay(view({
    status: 'ended',
    context: { ...context, sourceStatus: 'Finished' },
    diagnostic: { code: 'source-ended', message: 'Source duel ended before custom HP reached zero' },
  }), false);
  assert.deepEqual(display.terminal, {
    headline: 'Duel ended',
    detail: 'No custom winner was determined',
    round: null,
  });
});

test('keeps verified numbers with a diagnostic while stale and restores native UI when off', () => {
  const stale = derivePlayerTieRangeDisplay(view({
    status: 'stale',
    message: 'HP may be out of date',
  }), false);
  assert.equal(stale.showHud, true);
  assert.equal(stale.suppressNative, true);
  assert.equal(stale.diagnostic, 'HP may be out of date');

  const off = derivePlayerTieRangeDisplay(view({ status: 'off', capturedMode: 'off' }), true);
  assert.equal(off.showHud, false);
  assert.equal(off.suppressNative, false);
});

test('leaves native UI intact when the current account is not one of the players', () => {
  const display = derivePlayerTieRangeDisplay(view({
    status: 'unavailable',
    localTeamId: null,
    message: 'Current account is not a player in this duel',
  }), true);
  assert.equal(display.showHud, false);
  assert.equal(display.suppressNative, false);
  assert.equal(display.diagnostic, 'Current account is not a player in this duel');
});
