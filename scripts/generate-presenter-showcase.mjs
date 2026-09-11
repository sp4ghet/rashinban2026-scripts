// Curated synthetic protocol replay, not a recording of an actual match.
// Run from the repository root; --check verifies the committed artifact without writing.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const samples = new URL('../docs/geoguessr/samples/', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name, samples), 'utf8'));
const captured = read('gs2-ws-full-duel-sequence.json').find(row => row.message.duel?.state).message.duel.state;
const trace = read('gs2-ws-LiveStreamSamples-movement-trace.json').samples;
// Exact captured IDs; positions verified against Google's exact-pano lookup on 2026-09-11.
const positions = [
  { lat: 49.415105420161225, lng: -120.26104446693604, panoId: 'U2ccr5lQej7rGiGxpmLdew' },
  { lat: 49.41499228404625, lng: -120.26109922143681, panoId: 'bwjR3SgyQ-zuGzc6v8mhug' },
  { lat: 49.41416336761251, lng: -120.2614622901268, panoId: 'hf8Q0ZxJE-uRDeAUkKoG9Q' },
];
const base = Date.parse('2026-09-11T00:00:00.000Z');
const at = seconds => base + Math.round(seconds * 1000);
const iso = seconds => new Date(at(seconds)).toISOString();
const rows = [];
// Match the presenter's captured-player mapping: left/blue ...7655, right/red ...791e.
const playerIds = ['6aa29a4e4752c83aa99d7655', '65701c932c6e4a0a9881791e'];
assert.ok(playerIds.every(id => captured.teams.some(team => team.players[0].playerId === id)));
const teams = captured.teams.map((team, side) => ({
  id: team.id, name: team.name, health: 6000, currentMultiplier: 1,
  players: [{ playerId: playerIds[side], pin: null, guesses: [] }], roundResults: [],
}));
const state = {
  gameId: '6aa2a12c864d352115ae0001', status: 'Ongoing', version: 0,
  currentRoundNumber: 1, teams, rounds: [1, 2].map(number => ({
    roundNumber: number, panorama: { ...positions[number === 1 ? 0 : 2], countryCode: 'ca', heading: 117.13894, pitch: -5.503892, zoom: 0 },
    startTime: null, endTime: null, timerStartTime: null,
    hasProcessedRoundTimeout: false, isHealingRound: false, multiplier: 1, damageMultiplier: 1, skippedByPlayerId: null,
  })), isPaused: false, result: null,
  created: iso(0), initialHealth: 6000, maxNumberOfRounds: 2,
  movementOptions: structuredClone(captured.movementOptions),
  options: {
    ...structuredClone(captured.options), maxNumberOfRounds: 2,
    roundTime: 15, maxRoundTime: 27, roundWinMultiplierIncrement: 0,
    roundsWithoutDamageMultiplier: 2, healingRounds: [],
  },
  context: { type: 'Party', id: '00000000-0000-4000-8000-000000000001' },
};
function snapshot(seconds, code, playerId = null) {
  state.version++;
  rows.push({ receivedAt: at(seconds), message: {
    code, gameId: state.gameId, timestamp: iso(seconds),
    duel: { state: structuredClone(state), pin: null, fromPanoId: null, location: null, playerId },
  } });
}
function telemetry(seconds, side, payload) {
  rows.push({ receivedAt: at(seconds), message: {
    code: 'LiveStreamSamples', gameId: state.gameId, playerId: teams[side].players[0].playerId,
    payload: payload.map(([type, value]) => ({ time: at(seconds) - 40, type, payload: value })),
  } });
}
function pin(seconds, side, point) {
  teams[side].players[0].pin = point;
  telemetry(seconds, side, [['PinPosition', point]]);
  snapshot(seconds, 'DuelPinPlaced', teams[side].players[0].playerId);
}
function guess(seconds, side, score, point, distance) {
  const player = teams[side].players[0];
  player.pin = point;
  player.guesses.push({ roundNumber: state.currentRoundNumber, ...point, distance,
    created: iso(seconds), isTeamsBestGuessOnRound: true, score });
  state.rounds.find(round => round.roundNumber === state.currentRoundNumber).timerStartTime ??= iso(seconds);
  telemetry(seconds, side, [['GuessWithLatLng', point]]);
  snapshot(seconds, 'DuelPlayerGuessed', player.playerId);
}
function results(seconds) {
  const scores = teams.map(team => team.players[0].guesses.at(-1).score);
  const damage = Math.abs(scores[0] - scores[1]);
  for (let side = 0; side < 2; side++) {
    const team = teams[side];
    const healthBefore = team.health;
    team.health -= scores[side] < scores[1 - side] ? damage : 0;
    team.roundResults.push({ roundNumber: state.currentRoundNumber, score: scores[side],
      healthBefore, healthAfter: team.health, bestGuess: structuredClone(team.players[0].guesses.at(-1)),
      damageDealt: scores[side] > scores[1 - side] ? damage : 0, multiplier: 1 });
  }
  Object.assign(state.rounds.find(round => round.roundNumber === state.currentRoundNumber), { endTime: iso(seconds), hasProcessedRoundTimeout: true });
  snapshot(seconds, 'DuelRoundTimedOut');
}
function playRound(number, offset) {
  state.currentRoundNumber = number;
  teams.forEach(team => { team.players[0].pin = null; });
  const currentRound = state.rounds.find(round => round.roundNumber === number);
  Object.assign(currentRound, {
    startTime: iso(offset + 3), endTime: iso(offset + 30), timerStartTime: null,
    hasProcessedRoundTimeout: false, isHealingRound: false, multiplier: 1, damageMultiplier: 1, skippedByPlayerId: null,
  });
  snapshot(offset, number === 1 ? 'DuelStarted' : 'DuelNewRound');
  for (let side = 0; side < 2; side++) {
    // Replay captured motion payloads in their original order on a shorter synthetic clock.
    trace.forEach((sample, index) => {
      const value = sample.type === 'PanoPosition'
        ? positions.find(position => position.panoId === sample.payload.panoId)
        : sample.payload;
      assert.ok(value, 'All captured movement panoramas must have verified positions');
      telemetry(offset + 4 + side + index * 17 / (trace.length - 1), side, [[sample.type, value]]);
    });
    const bounds = { north: 50.4, east: -118.8, south: 48.5, west: -122 };
    telemetry(offset + 6 + side, side, [
      ['MapDisplay', { isActive: true, isSticky: false, size: 4 }], ['MapBoundingBox', bounds],
    ]);
    telemetry(offset + 12 + side, side, [['MapDisplay', { isActive: false, isSticky: false, size: 1 }]]);
    telemetry(offset + 17 + side, side, [
      ['MapDisplay', { isActive: true, isSticky: side === 1, size: 4 }],
      ['MapBoundingBox', { north: 49.6, east: -120.05, south: 49.2, west: -120.5 }],
    ]);
  }
  const answer = { lat: currentRound.panorama.lat, lng: currentRound.panorama.lng };
  const miss = { lat: 49.1, lng: -120.6 };
  const first = number === 1 ? 0 : 1;
  const pointFor = side => number === 2 || side === 0 ? answer : miss;
  const lock = (seconds, side) => {
    const perfect = number === 2 || side === 0;
    guess(offset + seconds, side, perfect ? 5000 : 4700, pointFor(side), perfect ? 0 : 42788);
  };
  pin(offset + 10, 0, { lat: 49.3, lng: -120.4 });
  pin(offset + 11, 1, { lat: 49.2, lng: -120.5 });
  pin(offset + 14, first, pointFor(first));
  lock(15, first);
  // Synthetic post-lock spawn reset: the renderer must keep this player's locked scene frozen.
  telemetry(offset + 16, first, [
    ['PanoPosition', positions[0]], ['PanoPov', { heading: 117.13894, pitch: -5.503892 }], ['PanoZoom', { zoom: 0 }],
  ]);
  pin(offset + 21, 1 - first, pointFor(1 - first));
  lock(28, 1 - first);
  results(offset + 30);
}
playRound(1, 0);
playRound(2, 60);
state.status = 'Finished';
state.result = { isDraw: false, winningTeamId: teams[0].id, winnerStyle: 'Victory' };
snapshot(120, 'DuelFinished');
rows.sort((a, b) => a.receivedAt - b.receivedAt);
const output = `${JSON.stringify(rows, null, 2)}\n`;
const target = new URL('gs2-ws-presenter-showcase.json', samples);
if (process.argv.includes('--check')) assert.equal(readFileSync(target, 'utf8'), output, 'Regenerate the showcase fixture');
else writeFileSync(target, output, 'utf8');
console.log(`Presenter showcase: ${rows.length} messages, 120 seconds (${process.argv.includes('--check') ? 'verified' : 'written'})`);
