import assert from 'node:assert/strict';
import test from 'node:test';

import { applySnapshot } from '../normalize.ts';
import { sample } from './fixtures.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value));
  return value;
}

function cloneSample(name: string): Record<string, unknown> {
  return record(structuredClone(sample(name)));
}

test('repeated snapshot does not become another accepted transition', () => {
  const input = sample('gs2-ws-DuelStarted.json');
  const first = applySnapshot(null, input);
  assert.ok(first.state);
  assert.equal(first.state.mode, 'NMPZ');

  const again = applySnapshot(first.state, input);

  assert.equal(again.accepted, false);
  assert.deepEqual(again.state, first.state);
});

test('captured single-player teams flatten pins and round-numbered guesses', () => {
  const pinPlaced = applySnapshot(null, sample('gs2-ws-DuelPinPlaced.json'));
  const guessed = applySnapshot(null, sample('gs2-ws-DuelPlayerGuessed.json'));

  assert.ok(pinPlaced.state);
  assert.ok(guessed.state);
  assert.deepEqual(
    {
      id: pinPlaced.state.players[0].id,
      teamId: pinPlaced.state.players[0].teamId,
      teamColor: pinPlaced.state.players[0].teamColor,
      health: pinPlaced.state.players[0].health,
      multiplier: pinPlaced.state.players[0].multiplier,
      pin: pinPlaced.state.players[0].pin,
    },
    {
      id: '65701c932c6e4a0a9881791e',
      teamId: '1468f4f1-b836-45d6-8c35-ca3760b05a54',
      teamColor: 'blue',
      health: 6000,
      multiplier: 1,
      pin: { lat: 26.236975702581066, lng: -102.37943631727737 },
    },
  );
  assert.deepEqual(guessed.state.players[0].guesses, [
    {
      round: 1,
      score: 1640,
      distanceM: 2066247.455297334,
      createdAtMs: Date.parse('2026-09-10T12:15:34.8694115Z'),
      lat: -4.565502893940002,
      lng: -80.98434790876647,
    },
  ]);
});

test('lower version for the same game keeps the current state', () => {
  const first = applySnapshot(null, sample('gs2-ws-DuelStarted.json'));
  assert.ok(first.state);
  const lower = cloneSample('gs2-ws-DuelStarted.json');
  record(record(record(lower.duel).state)).version = 4;

  const result = applySnapshot(first.state, lower);

  assert.equal(result.accepted, false);
  assert.deepEqual(result.state, first.state);
  assert.deepEqual(result.warnings, []);
});

test('new game accepts a lower version', () => {
  const first = applySnapshot(null, sample('gs2-ws-DuelStarted.json'));
  assert.ok(first.state);

  const result = applySnapshot(first.state, sample('gs2-ws-DuelStarted-created-not-started.json'));

  assert.equal(result.accepted, true);
  assert.equal(result.state?.gameId, '6aa2c12c0c6dabd56254d73a');
  assert.equal(result.state?.version, 3);
});

test('Created snapshot preserves null round times', () => {
  const result = applySnapshot(null, sample('gs2-ws-DuelStarted-created-not-started.json'));

  assert.equal(result.accepted, true);
  assert.ok(result.state);
  assert.equal(result.state.status, 'Created');
  assert.equal(result.state.mode, 'MOVE');
  assert.deepEqual(
    {
      startAtMs: result.state.rounds[0]?.startAtMs,
      timerStartAtMs: result.state.rounds[0]?.timerStartAtMs,
      endAtMs: result.state.rounds[0]?.endAtMs,
    },
    { startAtMs: null, timerStartAtMs: null, endAtMs: null },
  );
});

test('abort and finish snapshots remain distinguishable', () => {
  const aborted = applySnapshot(null, sample('gs2-ws-DuelAborted.json'));
  const finished = applySnapshot(null, sample('gs2-ws-DuelFinished.json'));

  assert.ok(aborted.state);
  assert.ok(finished.state);
  assert.equal(aborted.state.status, 'Finished');
  assert.equal(finished.state.status, 'Finished');
  assert.equal(aborted.state.aborted, true);
  assert.equal(finished.state.aborted, false);
  assert.equal(aborted.state.winnerTeamId, 'db15d5a7-9528-4aed-8bdd-c0400a77c6d8');
  assert.equal(finished.state.winnerTeamId, '6f0f4ba0-c8ba-49d5-b69e-c2870347c36f');
  assert.equal(aborted.state.isDraw, false);
  assert.equal(finished.state.isDraw, false);
});

test('no pin stays null while a zero-score guess stays present', () => {
  const noPin = applySnapshot(null, sample('gs2-ws-DuelRoundTimedOut-nopin.json'));
  const zeroScore = applySnapshot(null, sample('gs2-ws-DuelAborted.json'));

  assert.ok(noPin.state);
  assert.ok(zeroScore.state);
  assert.equal(noPin.state.mode, 'NM');
  assert.equal(noPin.state.players[0].guesses.length, 0);
  assert.equal(noPin.state.players[0].results[0]?.bestGuess, null);
  assert.deepEqual(zeroScore.state.players[0].results[3]?.bestGuess, {
    round: 4,
    score: 0,
    distanceM: 15964173.73696271,
    createdAtMs: Date.parse('2026-09-10T14:32:42.9182774Z'),
    lat: -74.36988857577543,
    lng: 98.79147478402989,
  });
});

test('full captured sequence replays to the fixture final state and round results', () => {
  const sequence = sample('gs2-ws-full-duel-sequence.json');
  assert.ok(Array.isArray(sequence));
  let state = null;

  for (const rawEntry of sequence) {
    const entry = record(rawEntry);
    assert.equal(typeof entry.receivedAt, 'number');
    state = applySnapshot(state, entry.message).state;
  }

  assert.ok(state);
  assert.deepEqual(
    {
      gameId: state.gameId,
      version: state.version,
      round: state.round,
      mode: state.mode,
      status: state.status,
      initialHealth: state.initialHealth,
      health: state.players.map((player) => player.health),
      winnerTeamId: state.winnerTeamId,
      isDraw: state.isDraw,
      aborted: state.aborted,
    },
    {
      gameId: '6aa2a12c864d352115aefce8',
      version: 49,
      round: 5,
      mode: 'MOVE',
      status: 'Finished',
      initialHealth: 6000,
      health: [0, 5644],
      winnerTeamId: '6f0f4ba0-c8ba-49d5-b69e-c2870347c36f',
      isDraw: false,
      aborted: false,
    },
  );
  assert.equal(state.rounds.length, 5);
  assert.deepEqual(state.rounds[0], {
    number: 1,
    panorama: {
      panoId: '38504864617A4331646E69587532376F477779787951',
      lat: 14.91906512738777,
      lng: 104.72329554263634,
      heading: 68.96632228514545,
      pitch: -2.259623437131822,
      zoom: 0,
    },
    startAtMs: Date.parse('2026-09-10T12:23:14.7977702Z'),
    timerStartAtMs: Date.parse('2026-09-10T12:23:20.5524762Z'),
    endAtMs: Date.parse('2026-09-10T12:23:35.5524762Z'),
    multiplier: 1,
  });
  assert.deepEqual(
    state.players.map((player) =>
      player.results.map((result) => ({
        round: result.round,
        score: result.score,
        healthBefore: result.healthBefore,
        healthAfter: result.healthAfter,
        damageDealt: result.damageDealt,
        multiplier: result.multiplier,
        bestGuessScore: result.bestGuess?.score ?? null,
      })),
    ),
    [
      [
        { round: 1, score: 4240, healthBefore: 6000, healthAfter: 6000, damageDealt: 76, multiplier: 1, bestGuessScore: 4240 },
        { round: 2, score: 4465, healthBefore: 6000, healthAfter: 6000, damageDealt: 280, multiplier: 1.5, bestGuessScore: 4465 },
        { round: 3, score: 4533, healthBefore: 6000, healthAfter: 5533, damageDealt: 0, multiplier: 2, bestGuessScore: 4533 },
        { round: 4, score: 251, healthBefore: 5533, healthAfter: 5533, damageDealt: 0, multiplier: 2, bestGuessScore: 251 },
        { round: 5, score: 1, healthBefore: 5533, healthAfter: 0, damageDealt: 0, multiplier: 2.5, bestGuessScore: 1 },
      ],
      [
        { round: 1, score: 4164, healthBefore: 6000, healthAfter: 5924, damageDealt: 0, multiplier: 1, bestGuessScore: 4164 },
        { round: 2, score: 4278, healthBefore: 5924, healthAfter: 5644, damageDealt: 0, multiplier: 1, bestGuessScore: 4278 },
        { round: 3, score: 5000, healthBefore: 5644, healthAfter: 5644, damageDealt: 467, multiplier: 1, bestGuessScore: 5000 },
        { round: 4, score: 251, healthBefore: 5644, healthAfter: 5644, damageDealt: 0, multiplier: 1.5, bestGuessScore: 251 },
        { round: 5, score: 4226, healthBefore: 5644, healthAfter: 5644, damageDealt: 8450, multiplier: 2, bestGuessScore: 4226 },
      ],
    ],
  );
});

test('unsupported team count is rejected with a sanitized warning', () => {
  const input = cloneSample('gs2-ws-DuelStarted.json');
  const state = record(record(input.duel).state);
  state.gameId = 'sensitive-game-id';
  assert.ok(Array.isArray(state.teams));
  state.teams = [state.teams[0]];

  const result = applySnapshot(null, input);

  assert.equal(result.accepted, false);
  assert.equal(result.state, null);
  assert.deepEqual(result.warnings, ['Unsupported duel: expected exactly two single-player teams']);
  assert.doesNotMatch(result.warnings.join(' '), /sensitive-game-id/);
});

test('unsupported movement options are rejected with a sanitized warning', () => {
  const input = cloneSample('gs2-ws-DuelStarted.json');
  const options = record(record(record(input.duel).state).options);
  const movement = record(options.movementOptions);
  movement.forbidMoving = false;
  movement.forbidZooming = true;
  movement.forbidRotating = false;
  movement.secret = 'sensitive-cookie';

  const result = applySnapshot(null, input);

  assert.equal(result.accepted, false);
  assert.equal(result.state, null);
  assert.deepEqual(result.warnings, ['Unsupported duel movement mode']);
  assert.doesNotMatch(result.warnings.join(' '), /sensitive-cookie/);
});
