import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildPartyScoreboard, type ScoreboardInput } from '../scoreboard.ts';
import { EMPTY_PARTY_STATUS } from '../types.ts';
import { DEFAULT_SETTINGS } from '../../presenter/settings.ts';
import { deriveTieRange } from '../../presenter/tie-range.ts';
import { derivePinpointing } from '../../presenter/pinpointing.ts';
import { applySnapshot } from '../../presenter/normalize.ts';
import type { DuelState } from '../../types/presenter.ts';

function fixture(): ScoreboardInput {
  const scores = [[4000, 3000], [3000, 4000], [5000, 4000]];
  const player = (side: number): DuelState['players'][number] => ({ id: `player-${side}`, teamId: `team-${side}`, teamColor: side ? 'red' : 'blue',
    health: 999999, multiplier: 9, pin: null, guesses: [],
    results: scores.map((score, i) => ({ round: i + 1, score: score[side], bestGuess: null,
      healthBefore: 999999, healthAfter: 999999, damageDealt: 0, multiplier: 9 })) });
  const source: DuelState = {
    gameId: 'game', partyId: 'party', version: 8, round: 3, mode: 'NM', status: 'Ongoing', paused: false, manualRoundStart: true,
    initialHealth: 6000, maxRounds: null, ruleOptions: { individual: 5, mutual: 0, delay: 1, maxErrorDistance: null },
    aborted: false, winnerTeamId: null, isDraw: false,
    rounds: scores.map((_, i) => ({ number: i + 1, startAtMs: i * 1000, timerStartAtMs: i * 1000, endAtMs: (i + 1) * 1000,
      multiplier: 1, panorama: { lat: 0, lng: 0, panoId: 'private', heading: 0, pitch: 0, zoom: 0 } })),
    players: [player(0), player(1)],
  };
  return {
    status: { ...structuredClone(EMPTY_PARTY_STATUS), state: 'ready', sourceGeneration: 'generation',
      party: { partyId: 'party', owner: { userId: 'host', nick: 'Host' }, lobbyId: 'game', gameState: 'Ongoing', gameType: 'Duels',
        settings: {}, gameSettings: {}, joinCode: null, bannedPlayerIds: [], mutedPlayerIds: [] },
      duel: { gameId: 'game', nodeId: 'node', partyId: 'party', gameMasterId: 'host', version: 8, round: 3, status: 'Ongoing',
        paused: false, resolved: true, manual: true, startTime: 2000, endTime: 3000, map: 'World', winnerTeamId: null,
        teams: source.players.map(p => ({ id: p.teamId, name: p.teamColor, health: p.health, multiplier: p.multiplier,
          players: [{ id: p.id, guessed: true, helpRequested: false }] })) },
      members: source.players.map((p, i) => ({ userId: p.id, nick: i ? 'Red' : 'Blue', team: p.teamColor,
        isPresent: true, isPlaying: true, isBenched: false, isInCurrentGame: true, isEligibleAsOwner: false, benchReason: null })),
    },
    presenter: source, settings: structuredClone(DEFAULT_SETTINGS),
    contexts: { live: { mode: 'off', pinpointing: false, source }, replay: null },
    connection: { state: 'live', input: 'live', partyId: 'party', gameId: 'game', lastUpdateMs: 1000, error: null,
      serverOffsetMs: 0, replayFixture: null, warnings: [], controlGeneration: 'generation' },
  };
}
function custom(input: ScoreboardInput, mode: 'off' | 'full' | 'half', pinpointing: boolean) {
  const context = input.contexts!.live!;
  context.mode = mode; context.pinpointing = pinpointing;
  input.settings!.tieRange = { enabled: mode !== 'off', mode: mode === 'off' ? 'full' : mode };
  input.settings!.pinpointing.enabled = pinpointing;
  input.presenter = pinpointing ? derivePinpointing(context.source, mode) : deriveTieRange(context.source, mode);
}

test('ordinary duel keeps native health when no custom scoring is enabled', () => {
  const input = fixture(); input.presenter = null; input.contexts = null;
  const board = buildPartyScoreboard(input);
  assert.equal(board.source, 'native');
  assert.deepEqual(board.teams.map(team => [team.amount, team.multiplier]), [[999999, 9], [999999, 9]]);
});

test('tie range shows presenter health and multipliers instead of native health', () => {
  const input = fixture(); custom(input, 'full', false);
  const board = buildPartyScoreboard(input);
  assert.equal(board.source, 'presenter');
  assert.deepEqual(board.teams.map(team => [team.amount, team.multiplier, team.unit]), [[4500, 2.5, 'HP'], [3000, 2, 'HP']]);
  assert.match(board.rules, /Tie range Full/);
  assert.equal(JSON.stringify(board).includes('private'), false);
});

test('Pinpointing uses team identities for points even when native teams are reordered', () => {
  const input = fixture(); custom(input, 'off', true); input.status.duel!.teams.reverse();
  const board = buildPartyScoreboard(input);
  assert.deepEqual(board.teams.map(team => [team.name, team.amount, team.target, team.multiplier]), [['Red', 1, 7, null], ['Blue', 3, 7, null]]);
  assert.ok(board.teams.every(team => team.unit === 'points'));
  assert.match(board.lastRound!, /Blue.*\+2.*SOLO 5K/);
});

test('combined rules use the presenter tie-band points and retain active rules when settings change', () => {
  const input = fixture(); custom(input, 'full', true);
  input.settings!.pinpointing.enabled = false; input.settings!.tieRange = { enabled: true, mode: 'half' };
  const board = buildPartyScoreboard(input);
  assert.deepEqual(board.teams.map(team => team.amount), [2, 0]);
  assert.match(board.rules, /Pinpointing.*Tie range Full/);
  assert.match(board.nextRules!, /Health.*Tie range Half/);
});

test('unavailable or mismatched custom scores never fall back to native HP', () => {
  for (const mismatch of ['missing', 'game', 'party', 'generation', 'version', 'rules', 'replay'] as const) {
    const input = fixture(); custom(input, 'full', true);
    if (mismatch === 'missing') input.presenter = null;
    if (mismatch === 'game') input.presenter!.gameId = 'old-game';
    if (mismatch === 'party') input.connection!.partyId = 'other-party';
    if (mismatch === 'generation') input.connection!.controlGeneration = 'old-generation';
    if (mismatch === 'version') input.contexts!.live!.source.version++;
    if (mismatch === 'rules') input.presenter = input.contexts!.live!.source;
    if (mismatch === 'replay') input.connection!.input = 'replay';
    const board = buildPartyScoreboard(input);
    assert.equal(board.source, 'unavailable', mismatch);
    assert.ok(board.warning, mismatch);
    assert.ok(board.teams.every(team => team.amount === null), mismatch);
  }
});

test('loading rule contexts cannot replace custom scores with HP from next-duel settings', () => {
  const input = fixture(); custom(input, 'full', true);
  input.contexts = null; input.settings = structuredClone(DEFAULT_SETTINGS);
  const board = buildPartyScoreboard(input);
  assert.equal(board.source, 'unavailable');
  assert.ok(board.teams.every(team => team.amount === null && team.unit === 'points'));
});

test('an ordinary active duel is not rescored when custom rules are saved for the next duel', () => {
  const input = fixture(); input.settings!.pinpointing.enabled = true;
  const board = buildPartyScoreboard(input);
  assert.equal(board.source, 'native');
  assert.deepEqual(board.teams.map(team => team.amount), [999999, 999999]);
  assert.match(board.nextRules!, /Pinpointing/);
});

test('a finished custom result remains after abort and disappears when a new game is selected', () => {
  const input = fixture(); custom(input, 'full', true);
  input.presenter!.pinpointing!.totals = [7, 4];
  input.presenter!.pinpointing!.terminal = { round: 3, winnerTeamId: 'team-0' };
  input.presenter!.status = 'Finished'; input.presenter!.winnerTeamId = 'team-0';
  input.status.duel = null; input.status.party!.gameState = 'NoGame'; input.status.party!.lobbyId = null;
  input.connection!.gameId = null; input.connection!.state = 'disconnected';
  let board = buildPartyScoreboard(input);
  assert.deepEqual(board.teams.map(team => team.amount), [7, 4]);
  assert.match(board.result!, /Blue wins/);
  input.status.party!.gameState = 'Ongoing'; input.status.party!.lobbyId = 'next-game';
  board = buildPartyScoreboard(input);
  assert.equal(board.result, null); assert.ok(board.teams.every(team => team.amount === null));
});

test('automatic discovery of another idle party cannot retain the previous party result', () => {
  const input = fixture(); custom(input, 'full', true);
  input.presenter!.status = 'Finished';
  input.status.duel = null; input.status.party!.gameState = 'NoGame'; input.status.party!.lobbyId = null;
  input.status.party!.partyId = 'new-party'; input.connection!.partyId = 'new-party';
  input.connection!.gameId = null; input.connection!.state = 'disconnected';
  const board = buildPartyScoreboard(input);
  assert.equal(board.source, 'none');
  assert.deepEqual(board.teams, []); assert.equal(board.result, null);
});

test('presenter normalization and custom derivations retain the recorded originating party', () => {
  const recorded = JSON.parse(readFileSync(new URL('../../../../../docs/geoguessr/samples/gs2-ws-DuelAborted.json', import.meta.url), 'utf8'));
  const decoded = applySnapshot(null, recorded).state!;
  assert.equal(decoded.partyId, recorded.duel.state.context.id);
  assert.equal(derivePinpointing(decoded, 'full').partyId, recorded.duel.state.context.id);
  assert.equal(deriveTieRange(decoded, 'full').partyId, recorded.duel.state.context.id);
});

test('rollback replaces points and last-round summary without accumulating scores twice', () => {
  const input = fixture(); custom(input, 'off', true);
  assert.deepEqual(buildPartyScoreboard(input).teams.map(team => team.amount), [3, 1]);
  const source = input.contexts!.live!.source;
  source.version++; source.round = 2;
  for (const player of source.players) player.results = player.results.filter(round => round.round < 2);
  custom(input, 'off', true);
  const board = buildPartyScoreboard(input);
  assert.deepEqual(board.teams.map(team => team.amount), [1, 0]);
  assert.match(board.lastRound!, /Round 1/);
});

test('a newer native rollback hides pre-rollback scores until the presenter catches up, including the same round', () => {
  for (const target of [2, 3]) {
    const input = fixture(); custom(input, 'full', true);
    input.status.duel!.version++; input.status.duel!.round = target;
    input.status.duel!.resolved = false; input.status.duel!.startTime = 10000;
    const board = buildPartyScoreboard(input);
    assert.equal(board.source, 'unavailable');
    assert.ok(board.teams.every(team => team.amount === null));
    assert.equal(board.lastRound, null);
  }
});

test('server finish before seven points shows no custom winner', () => {
  const input = fixture(); input.contexts!.live!.source.status = 'Finished'; custom(input, 'off', true);
  input.status.duel = null; input.status.party!.gameState = 'Finished';
  const board = buildPartyScoreboard(input);
  assert.deepEqual(board.teams.map(team => team.amount), [3, 1]);
  assert.match(board.warning!, /before.*7 points/); assert.equal(board.result, null);
});

test('recorded abort before a custom outcome never awards the native synthetic winner', () => {
  const recorded = JSON.parse(readFileSync(new URL('../../../../../docs/geoguessr/samples/gs2-ws-DuelAborted.json', import.meta.url), 'utf8'));
  for (const pinpointing of [false, true]) {
    const input = fixture();
    input.contexts!.live!.source = applySnapshot(null, recorded).state!;
    input.status.duel = null; input.status.party!.lobbyId = null; input.status.party!.gameState = 'NoGame';
    input.status.party!.partyId = recorded.duel.state.context.id; input.connection!.partyId = recorded.duel.state.context.id;
    input.connection!.gameId = null; input.connection!.state = 'disconnected';
    custom(input, 'full', pinpointing);
    assert.equal(input.presenter!.aborted, true);
    assert.ok(input.presenter!.winnerTeamId, 'captured GeoGuessr abort carries a winner');
    const board = buildPartyScoreboard(input);
    assert.equal(board.result, 'Duel aborted');
    assert.ok(board.teams.every(team => !team.winner));
  }
});

test('Team Duels identifies native health and unsupported custom scoring explicitly', () => {
  const input = fixture(); custom(input, 'full', true); input.status.party!.gameType = 'TeamDuels';
  const board = buildPartyScoreboard(input);
  assert.equal(board.source, 'native'); assert.match(board.rules, /GeoGuessr/);
  assert.match(board.warning!, /1v1/);
});
