import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { predictRound, scoreAtPin, type PredictionInput } from '../prediction.ts';
import { EMPTY_PARTY_STATUS } from '../types.ts';
import { DEFAULT_SETTINGS } from '../../presenter/settings.ts';
import { applySnapshot } from '../../presenter/normalize.ts';
import { derivePinpointing } from '../../presenter/pinpointing.ts';
import { applyTelemetry, seedViews } from '../../presenter/telemetry.ts';
import type { DuelState, Point } from '../../types/presenter.ts';

const sample = (name: string) => JSON.parse(readFileSync(new URL(`../../../../../docs/geoguessr/samples/${name}`, import.meta.url), 'utf8'));
function fixture(): PredictionInput {
  const source = applySnapshot(null, sample('gs2-ws-DuelStarted-created-not-started.json')).state!;
  source.gameId = 'game'; source.partyId = 'party'; source.status = 'Ongoing'; source.version = 10;
  source.round = 1; source.maxRounds = 50; source.initialHealth = 6000;
  source.ruleOptions = { individual: 5, mutual: 0, delay: 1, maxErrorDistance: 1_000_000 };
  source.rounds = [{ ...source.rounds[0], number: 1, startAtMs: 90000, endAtMs: 150000,
    panorama: { ...source.rounds[0].panorama, lat: 0, lng: 0 } }];
  source.players.forEach((p, i) => { p.id = `player-${i}`; p.teamId = `team-${i}`; p.pin = null; p.health = 6000; p.multiplier = 1; p.results = []; p.guesses = []; });
  return { nowMs: 100000, presenter: structuredClone(source), contexts: { live: { source, mode: 'off', pinpointing: false }, replay: null },
    settings: structuredClone(DEFAULT_SETTINGS), views: null,
    connection: { input: 'live', state: 'live', partyId: 'party', gameId: 'game', controlGeneration: 'generation',
      lastUpdateMs: 100000, error: null, serverOffsetMs: 0, replayFixture: null, warnings: [] },
    status: { ...structuredClone(EMPTY_PARTY_STATUS), state: 'ready', updatedAtMs: 100000, sourceGeneration: 'generation',
      party: { partyId: 'party', gameType: 'Duels', gameState: 'Ongoing', lobbyId: 'game', owner: { userId: 'host', nick: 'Host' },
        settings: {}, gameSettings: { disableHealing: true }, joinCode: null, bannedPlayerIds: [], mutedPlayerIds: [] },
      duel: { gameId: 'game', partyId: 'party', nodeId: 'node', gameMasterId: 'host', version: 10, round: 1, status: 'Ongoing',
        paused: false, resolved: false, manual: true, startTime: 90000, endTime: 150000, map: 'World', winnerTeamId: null,
        teams: source.players.map(p => ({ id: p.teamId, name: p.teamColor, health: 999999, multiplier: 9,
          players: [{ id: p.id, guessed: false, helpRequested: false }] })) },
    },
  };
}
function pins(input: PredictionInput, scores: [number, number]) {
  input.contexts!.live!.source.players.forEach((p, i) => {
    const distance = scores[i] === 5000 ? 0 : -100000 * Math.log(scores[i] / 5000);
    p.pin = { lat: 0, lng: distance / 6371000 * 180 / Math.PI };
  });
}
function locked(input: PredictionInput, scores: [number, number]) {
  input.contexts!.live!.source.players.forEach((p, i) => p.guesses.push({ round: input.contexts!.live!.source.round,
    score: scores[i], lat: 0, lng: 0, distanceM: 0, createdAtMs: 95000 + i * 100 }));
}
function pinpointing(input: PredictionInput) {
  const context = input.contexts!.live!, source = context.source;
  context.pinpointing = true; context.mode = 'half'; source.round = 4;
  source.rounds = [1, 2, 3, 4].map(number => ({ ...source.rounds[0], number,
    startAtMs: number === 4 ? 90000 : number * 1000, endAtMs: number === 4 ? 150000 : number * 1000 + 900 }));
  source.players.forEach((p, i) => { p.results = [1, 2, 3].map(round => ({ round, score: i ? 0 : 5000, bestGuess: null,
    healthBefore: 6000, healthAfter: 6000, damageDealt: 0, multiplier: 1 })); });
  input.presenter = derivePinpointing(source, 'half'); input.status.duel!.round = 4;
}

test('one pin shows its estimated score but neither player gets an outcome until both pin', () => {
  const input = fixture();
  assert.equal(predictRound(input).state, 'waiting');
  pins(input, [4000, 3000]); input.contexts!.live!.source.players[1].pin = null;
  const prediction = predictRound(input);
  assert.deepEqual(prediction.players.map(p => p.score), [4000, null]);
  assert.equal(prediction.ending, null); assert.ok(prediction.players.every(p => p.after === null && p.outcome === null));
});

test('current presenter HP and the winning player multiplier determine a projected knockout', () => {
  const input = fixture(); pins(input, [4000, 3000]);
  input.presenter!.players[0].multiplier = 2; input.presenter!.players[1].multiplier = 9;
  input.presenter!.players[1].health = 2000;
  const before = structuredClone(input), prediction = predictRound(input);
  assert.equal(prediction.ending, true);
  assert.deepEqual(prediction.players.map(p => [p.after, p.change, p.outcome]), [[6000, 0, 'win'], [0, -2000, 'loss']]);
  assert.deepEqual(input, before, 'prediction cannot mutate captured or settled scoring');
});

test('damage uses half-even rounding at the lethal boundary', () => {
  const input = fixture(); locked(input, [4000, 3813]);
  input.presenter!.players[0].multiplier = 1.5; input.presenter!.players[1].health = 281;
  assert.equal(predictRound(input).ending, false);
  assert.equal(predictRound(input).players[1].after, 1);
  input.presenter!.players[1].health = 280;
  assert.equal(predictRound(input).ending, true);
});

test('Half tie range still deals damage and uses active rules rather than next-duel settings', () => {
  const input = fixture(); locked(input, [4000, 3500]); input.contexts!.live!.mode = 'half';
  input.presenter!.tieRange = { mode: 'half', rounds: [] };
  input.presenter!.players[0].multiplier = 2; input.presenter!.players[1].health = 1000;
  input.settings!.pinpointing.enabled = true;
  const prediction = predictRound(input);
  assert.equal(prediction.ending, true); assert.equal(prediction.unit, 'HP');
});

test('locked guesses use server scores even without a map scale or a remaining pin', () => {
  const input = fixture(); locked(input, [1234, 4321]); input.contexts!.live!.source.ruleOptions!.maxErrorDistance = null;
  const prediction = predictRound(input);
  assert.deepEqual(prediction.players.map(p => [p.score, p.locked]), [[1234, true], [4321, true]]);
  assert.equal(prediction.players[0].after, 2913);
});

test('missing score scale and invalid points never invent an outcome', () => {
  const input = fixture(); pins(input, [4000, 3000]); input.contexts!.live!.source.ruleOptions!.maxErrorDistance = null;
  assert.equal(predictRound(input).ending, null);
  assert.match(predictRound(input).message, /map.*scale/i);
  assert.equal(scoreAtPin({ lat: 0, lng: 0 }, { lat: 100, lng: 0 }, 1e6), null);
  assert.equal(scoreAtPin({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }, 1e6), 5000);
});

test('current pin telemetry updates predictions; cleared or prior-round telemetry cannot supply a pin', () => {
  const input = fixture(); pins(input, [4000, 3000]);
  input.views = seedViews(input.contexts!.live!.source);
  const blue = input.views.players['player-0']; blue.lastByType.PinPosition = 99000; blue.pin = { lat: 0, lng: 0 };
  assert.equal(predictRound(input).players[0].score, 5000);
  blue.pin = null; assert.equal(predictRound(input).state, 'waiting');
  blue.lastByType.PinPosition = 80000;
  assert.equal(predictRound(input).players[0].score, 4000, 'ignore samples predating this round or rollback');
  input.views.round = 99;
  assert.equal(predictRound(input).players[0].score, 4000);
});

test('health round limit predicts the higher remaining HP or a draw', () => {
  const input = fixture(); locked(input, [4000, 4000]); input.contexts!.live!.source.maxRounds = 1;
  assert.equal(predictRound(input).ending, true);
  assert.deepEqual(predictRound(input).players.map(p => p.outcome), ['draw', 'draw']);
  input.presenter!.players[0].health = 5000;
  assert.deepEqual(predictRound(input).players.map(p => p.outcome), ['loss', 'win']);
});

test('delayed pin and guess telemetry cannot replace a newer position with a false knockout', () => {
  for (const [newerType, olderType] of [['GuessWithLatLng', 'PinPosition'], ['PinPosition', 'GuessWithLatLng']]) {
    const input = fixture(); pins(input, [3000, 3000]);
    input.presenter!.players[1].health = 1000;
    const source = input.contexts!.live!.source, player = source.players[0];
    input.views = seedViews(source);
    const newer = { code: 'LiveStreamSamples', playerId: player.id,
      payload: [{ type: newerType, time: 99000, payload: player.pin }] };
    input.views = applyTelemetry(input.views, source, newer);
    assert.equal(predictRound(input).ending, false);
    for (const time of [98000, 99000]) {
      input.views = applyTelemetry(input.views, source, { code: 'LiveStreamSamples', playerId: player.id,
        payload: [{ type: olderType, time, payload: { lat: 0, lng: 0 } }] });
      assert.equal(predictRound(input).ending, false, `${olderType} at ${time} cannot overwrite ${newerType}`);
    }
    input.views = applyTelemetry(input.views, source, { code: 'LiveStreamSamples', playerId: player.id,
      payload: [{ type: olderType, time: 99500, payload: { lat: 0, lng: 0 } }] });
    assert.equal(predictRound(input).ending, true, 'newer positions still update the forecast');
  }
});

test('Pinpointing predicts the seven-point finish and Half tie-range zero points', () => {
  const input = fixture(); pinpointing(input); pins(input, [5000, 4000]);
  assert.deepEqual(predictRound(input).players.map(p => [p.after, p.outcome]), [[8, 'win'], [0, 'loss']]);
  pins(input, [4000, 3500]);
  assert.equal(predictRound(input).ending, false);
  assert.deepEqual(predictRound(input).players.map(p => p.after), [6, 0]);
});

test('double 5K waits for deliberate guess ordering, then predicts the fastest-5K winner', () => {
  const input = fixture(); pinpointing(input); pins(input, [5000, 5000]);
  assert.equal(predictRound(input).ending, null);
  assert.match(predictRound(input).message, /double 5K.*order/i);
  locked(input, [5000, 5000]);
  assert.equal(predictRound(input).ending, true);
  assert.deepEqual(predictRound(input).players.map(p => [p.after, p.outcome]), [[7, 'win'], [0, 'loss']]);
});

test('stale, mismatched, replay and rollback data cannot predict a winner', () => {
  for (const mismatch of ['party', 'game', 'generation', 'round', 'version', 'ahead', 'disconnected', 'staleParty', 'stalePresenter', 'replay', 'player', 'rules']) {
    const input = fixture(); locked(input, [5000, 0]); input.presenter!.players[1].health = 100;
    if (mismatch === 'party') input.connection!.partyId = 'other';
    if (mismatch === 'game') input.presenter!.gameId = 'other';
    if (mismatch === 'generation') input.connection!.controlGeneration = 'old';
    if (mismatch === 'round') input.status.duel!.round++;
    if (mismatch === 'version') input.presenter!.version--;
    if (mismatch === 'ahead') input.status.duel!.version++;
    if (mismatch === 'disconnected') input.connection!.state = 'stale';
    if (mismatch === 'staleParty') input.status.updatedAtMs = 1;
    if (mismatch === 'stalePresenter') input.connection!.lastUpdateMs = 1;
    if (mismatch === 'replay') input.connection!.input = 'replay';
    if (mismatch === 'player') input.status.duel!.teams[0].players[0].id = 'other';
    if (mismatch === 'rules') input.contexts!.live!.mode = 'half';
    assert.equal(predictRound(input).ending, null, mismatch);
  }
});

test('settled, terminal and not-yet-started rounds cannot be scored again', () => {
  for (const phase of ['settled', 'partial', 'finished', 'future', 'created', 'expired']) {
    const input = fixture(); locked(input, [5000, 0]);
    if (phase === 'settled') input.status.duel!.resolved = true;
    if (phase === 'partial') input.contexts!.live!.source.players[0].results.push({ round: 1, score: 5000, bestGuess: null, healthBefore: 6000, healthAfter: 6000, damageDealt: 5000, multiplier: 1 });
    if (phase === 'finished') input.presenter!.status = 'Finished';
    if (phase === 'future') input.contexts!.live!.source.rounds[0].startAtMs = 100001;
    if (phase === 'created') input.status.duel!.status = 'Created';
    if (phase === 'expired') input.contexts!.live!.source.rounds[0].endAtMs = 99999;
    assert.equal(predictRound(input).ending, null, phase);
  }
});

test('estimated scores agree with recorded GeoGuessr guesses from coordinates', () => {
  let checked = 0;
  for (const name of ['gs2-ws-full-duel-sequence.json', 'gs2-ws-full-duel-sequence-manual-rounds.json']) {
    let state: DuelState | null = null;
    for (const row of sample(name)) state = applySnapshot(state, row.message).state;
    assert.ok(state);
    for (const player of state.players) for (const guess of player.guesses) {
      const answer: Point = state.rounds.find(round => round.number === guess.round)!.panorama;
      assert.equal(scoreAtPin(answer, guess, state.ruleOptions!.maxErrorDistance), guess.score, `${name}: round ${guess.round}`);
      checked++;
    }
  }
  assert.ok(checked >= 10);
});
