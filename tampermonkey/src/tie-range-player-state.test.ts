import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  PLAYER_TIE_RANGE_RULES_VERSION,
  acceptPlayerSnapshot,
  loadPlayerContext,
  parsePlayerDuelPath,
  parsePlayerPageRoute,
  savePlayerContext,
  type PlayerTieRangeStorage,
} from './tie-range-player-state.ts';

const fixture = JSON.parse(readFileSync(
  new URL('../../docs/geoguessr/samples/player-tie-range/player-rest-full.json', import.meta.url),
  'utf8',
)) as Record<string, unknown>;
const liveLimitFixture = JSON.parse(readFileSync(
  new URL('../../docs/geoguessr/samples/player-tie-range/player-rest-live-limit.json', import.meta.url),
  'utf8',
)) as Record<string, unknown>;
const liveManualFixture = JSON.parse(readFileSync(
  new URL('../../docs/geoguessr/samples/player-tie-range/player-live-manual.json', import.meta.url),
  'utf8',
)) as { created: unknown; resolved: unknown; resolvedDamage: unknown };

function snapshot(change: (value: any) => void = () => {}): unknown {
  const value = structuredClone(fixture);
  change(value);
  return value;
}

test('accepts only duel routes, including locale prefixes and optional summary', () => {
  assert.deepEqual(parsePlayerDuelPath('/duels/game-1'), { gameId: 'game-1' });
  assert.deepEqual(parsePlayerDuelPath('/team-duels/game-2/'), { gameId: 'game-2' });
  assert.deepEqual(parsePlayerDuelPath('/ja/duels/game-3/summary'), { gameId: 'game-3' });
  assert.deepEqual(parsePlayerDuelPath('/en-US/team-duels/game-4/summary/'), { gameId: 'game-4' });
  assert.equal(parsePlayerDuelPath('/duels/game-1/results'), null);
  assert.equal(parsePlayerDuelPath('/maps/duels/game-1'), null);
  assert.equal(parsePlayerDuelPath('/duels/game-1/summary/more'), null);
});

test('accepts only the exact party lobby route for active-duel discovery', () => {
  assert.deepEqual(parsePlayerPageRoute('/party/lobby'), { kind: 'party-lobby', partyCode: null });
  assert.deepEqual(parsePlayerPageRoute('/ja/party/lobby/ABCD?from=invite'), {
    kind: 'party-lobby',
    partyCode: 'ABCD',
  });
  assert.deepEqual(parsePlayerPageRoute('/duels/game-1'), { kind: 'duel', gameId: 'game-1' });
  assert.equal(parsePlayerPageRoute('/party/broadcast'), null);
  assert.equal(parsePlayerPageRoute('/party/settings'), null);
  assert.equal(parsePlayerPageRoute('/party/lobby/code/more'), null);
});

test('decodes the captured player response to literal custom health without server health', () => {
  const accepted = acceptPlayerSnapshot(null, snapshot(), 'full');

  assert.equal(accepted.accepted, true);
  assert.equal(accepted.diagnostic, null);
  assert.ok(accepted.context);
  assert.equal(accepted.context.schemaVersion, PLAYER_TIE_RANGE_RULES_VERSION);
  assert.equal(accepted.context.mode, 'full');
  assert.deepEqual(accepted.context.teamIds, ['team-blue', 'team-red']);
  assert.deepEqual(accepted.context.teamLabels, ['blue', 'red']);
  assert.deepEqual(accepted.context.playerIds, ['player-blue', 'player-red']);
  assert.deepEqual(accepted.context.input, {
    initialHealth: 6000,
    individual: 5,
    mutual: 0,
    delay: 1,
    maxRounds: 30,
    teamIds: ['team-blue', 'team-red'],
    rounds: [
      { round: 1, scores: [4240, 4164] },
      { round: 2, scores: [4465, 4278] },
      { round: 3, scores: [4533, 5000] },
      { round: 4, scores: [251, 251] },
      { round: 5, scores: [1, 4226] },
    ],
  });
  assert.deepEqual(accepted.output?.currentHealth, [0, 5644]);
  assert.deepEqual(accepted.output?.currentMultiplierTenths, [25, 30]);
  assert.deepEqual(accepted.output?.terminal, {
    round: 5,
    winnerTeamId: 'team-red',
    isDraw: false,
  });
});

test('requires two distinct single-player teams and explicit blue/red labels', () => {
  for (const [name, mutate] of [
    ['multiple players', (value: any) => value.teams[0].players.push({ playerId: 'extra' })],
    ['duplicate player', (value: any) => { value.teams[1].players[0].playerId = 'player-blue'; }],
    ['missing label', (value: any) => { delete value.teams[0].name; }],
    ['unknown label', (value: any) => { value.teams[0].name = 'home'; }],
  ] as const) {
    const result = acceptPlayerSnapshot(null, snapshot(mutate), 'full');
    assert.equal(result.context, null, name);
    assert.equal(result.diagnostic?.code, 'unsupported-game', name);
  }
});

test('rejects partial, duplicate, invalid, and incompatible scoring data', () => {
  const cases: Array<[string, (value: any) => void]> = [
    ['partial result', value => value.teams[1].roundResults.pop()],
    ['duplicate team result', value => value.teams[0].roundResults.push(value.teams[0].roundResults[0])],
    ['duplicate round identity', value => value.rounds.push(value.rounds[0])],
    ['invalid score', value => { value.teams[0].roundResults[0].score = 5001; }],
    ['unknown required option', value => { delete value.options.roundWinMultiplierIncrement; }],
    ['asymmetric health', value => { value.options.initialHealthTeamOne = 6000; }],
    ['healing enabled', value => { value.options.disableHealing = false; }],
    ['healing round', value => { value.rounds[0].isHealingRound = true; }],
    ['special round behavior', value => { value.options.roundStartingBehavior = 'Seeded'; }],
    ['disabled multipliers', value => { value.options.disableMultipliers = true; }],
  ];

  for (const [name, mutate] of cases) {
    const result = acceptPlayerSnapshot(null, snapshot(mutate), 'full');
    assert.equal(result.context, null, name);
    assert.ok(result.diagnostic, name);
  }
});

test('keeps canonical team order when the response reverses its teams', () => {
  const first = acceptPlayerSnapshot(null, snapshot(), 'full');
  assert.ok(first.context);
  const reversed = acceptPlayerSnapshot(first.context, snapshot(value => {
    value.version = 50;
    value.teams.reverse();
  }), 'half');

  assert.equal(reversed.accepted, true);
  assert.deepEqual(reversed.context?.teamIds, ['team-blue', 'team-red']);
  assert.deepEqual(reversed.output?.currentHealth, [0, 5644]);
  assert.equal(reversed.context?.mode, 'full');
});

test('older versions and ambiguous truncation preserve the last verified context', () => {
  const first = acceptPlayerSnapshot(null, snapshot(), 'full');
  assert.ok(first.context);

  const old = acceptPlayerSnapshot(first.context, snapshot(value => {
    value.version = 48;
    value.teams[0].roundResults[0].score = 0;
  }), 'full');
  assert.equal(old.accepted, false);
  assert.equal(old.context, first.context);
  assert.equal(old.diagnostic?.code, 'stale-version');
  assert.deepEqual(old.output?.currentHealth, [0, 5644]);

  const truncated = acceptPlayerSnapshot(first.context, snapshot(value => {
    value.version = 50;
    value.teams[0].roundResults.pop();
    value.teams[1].roundResults.pop();
  }), 'full');
  assert.equal(truncated.accepted, false);
  assert.equal(truncated.context, first.context);
  assert.equal(truncated.diagnostic?.code, 'recovery');
});

test('never carries verified values into an invalid snapshot for another game', () => {
  const first = acceptPlayerSnapshot(null, snapshot(), 'full');
  assert.ok(first.context);
  const invalidNext = acceptPlayerSnapshot(first.context, snapshot(value => {
    value.gameId = 'next-game';
    delete value.options.roundWinMultiplierIncrement;
  }), 'full');

  assert.equal(invalidNext.accepted, false);
  assert.equal(invalidNext.context, null);
  assert.equal(invalidNext.output, null);
});

test('positive restart evidence releases and replaces the affected suffix', () => {
  const first = acceptPlayerSnapshot(null, snapshot(), 'full');
  assert.ok(first.context);

  const rolledBack = acceptPlayerSnapshot(first.context, snapshot(value => {
    value.version = 50;
    value.currentRoundNumber = 3;
    value.status = 'Started';
    value.teams[0].roundResults.splice(2);
    value.teams[1].roundResults.splice(2);
  }), 'full');
  assert.equal(rolledBack.accepted, true);
  assert.deepEqual(rolledBack.context?.input.rounds.map(round => round.round), [1, 2]);
  assert.equal(rolledBack.output?.terminal, null);

  const changedStart = acceptPlayerSnapshot(first.context, snapshot(value => {
    value.version = 51;
    value.currentRoundNumber = 5;
    value.status = 'Started';
    value.rounds[3].startTime = '2026-09-12T00:00:00.000+00:00';
    value.teams[0].roundResults.splice(3);
    value.teams[1].roundResults.splice(3);
  }), 'full');
  assert.equal(changedStart.accepted, true);
  assert.deepEqual(changedStart.context?.input.rounds.map(round => round.round), [1, 2, 3]);
  assert.equal(changedStart.output?.terminal, null);
});

test('an earlier current round releases a stale suffix even if the API still includes it', () => {
  const first = acceptPlayerSnapshot(null, snapshot(), 'full');
  assert.ok(first.context);
  const rollback = acceptPlayerSnapshot(first.context, snapshot(value => {
    value.version = 50;
    value.currentRoundNumber = 3;
    value.status = 'Started';
  }), 'full');

  assert.equal(rollback.accepted, true);
  assert.deepEqual(rollback.context?.input.rounds.map(round => round.round), [1, 2]);
  assert.equal(rollback.output?.terminal, null);
});

test('pins terminal inputs across later source rounds and host aborts', () => {
  const first = acceptPlayerSnapshot(null, snapshot(), 'full');
  assert.ok(first.context);
  const later = acceptPlayerSnapshot(first.context, snapshot(value => {
    value.version = 50;
    value.status = 'Finished';
    value.currentRoundNumber = 6;
    value.rounds[5].startTime = '2026-09-12T00:00:00.000+00:00';
    value.teams[0].roundResults.push({ roundNumber: 6, score: 5000 });
    value.teams[1].roundResults.push({ roundNumber: 6, score: 0 });
    value.result = { isDraw: false, winningTeamId: 'team-blue' };
  }), 'half');

  assert.equal(later.accepted, true);
  assert.equal(later.context?.mode, 'full');
  assert.equal(later.context?.input.rounds.length, 5);
  assert.deepEqual(later.output?.terminal, first.output?.terminal);
});

test('uses settled scores for a round-limit draw instead of native HP or winner fields', () => {
  const result = acceptPlayerSnapshot(null, structuredClone(liveLimitFixture), 'full');

  assert.equal(result.accepted, true);
  assert.deepEqual(result.output?.currentHealth, [6000, 6000]);
  assert.deepEqual(result.output?.currentMultiplierTenths, [20, 20]);
  assert.deepEqual(result.output?.terminal, { round: 3, winnerTeamId: null, isDraw: true });
});

test('accepts captured manual-round live-node snapshots and ignores preloaded future rounds', () => {
  const created = acceptPlayerSnapshot(null, structuredClone(liveManualFixture.created), 'full');
  assert.equal(created.accepted, true);
  assert.deepEqual(created.context?.input.rounds, []);
  assert.deepEqual(created.output?.currentHealth, [6000, 6000]);

  const resolved = acceptPlayerSnapshot(
    created.context,
    structuredClone(liveManualFixture.resolved),
    'half',
  );
  assert.equal(resolved.accepted, true);
  assert.equal(resolved.context?.sourceVersion, 8);
  assert.equal(resolved.context?.mode, 'full');
  assert.deepEqual(resolved.context?.input.rounds, [{ round: 1, scores: [0, 0] }]);
  assert.deepEqual(resolved.output?.currentMultiplierTenths, [15, 15]);

  const damage = acceptPlayerSnapshot(
    resolved.context,
    structuredClone(liveManualFixture.resolvedDamage),
    'half',
  );
  assert.equal(damage.accepted, true);
  assert.deepEqual(damage.output?.currentHealth, [6000, 2295]);
  assert.deepEqual(damage.output?.currentMultiplierTenths, [20, 20]);
  assert.deepEqual(damage.output?.rounds[1], {
    round: 2,
    scores: [2470, 0],
    healthBefore: [6000, 6000],
    healthAfter: [6000, 2295],
    damageDealt: [3705, 0],
    multiplierTenths: [15, 15],
    nextMultiplierTenths: [20, 20],
    band: 2530,
    withinBand: true,
    mutualMultiplierTenths: 10,
    nextMutualMultiplierTenths: 10,
  });
});

test('reports a source finish without inventing a winner from the native result', () => {
  const result = acceptPlayerSnapshot(null, snapshot(value => {
    value.version = 10;
    value.currentRoundNumber = 1;
    value.status = 'Finished';
    value.teams[0].roundResults.splice(1);
    value.teams[1].roundResults.splice(1);
    value.result = { isDraw: false, winningTeamId: 'team-red' };
  }), 'full');

  assert.equal(result.accepted, true);
  assert.equal(result.output?.terminal, null);
  assert.equal(result.diagnostic?.code, 'source-ended');
});

test('captures the configured mode once per duel, including Off', () => {
  const first = acceptPlayerSnapshot(null, snapshot(), 'off');
  assert.equal(first.context?.mode, 'off');
  assert.equal(first.output, null);

  const same = acceptPlayerSnapshot(first.context, snapshot(value => { value.version = 50; }), 'half');
  assert.equal(same.context?.mode, 'off');
  assert.equal(same.output, null);

  const next = acceptPlayerSnapshot(same.context, snapshot(value => {
    value.gameId = 'next-game';
    value.version = 1;
  }), 'half');
  assert.equal(next.context?.gameId, 'next-game');
  assert.equal(next.context?.mode, 'half');
  assert.deepEqual(next.output?.currentHealth, [0, 5644]);
});

class MemoryStorage implements PlayerTieRangeStorage {
  readonly values = new Map<string, unknown>();
  get(key: string): unknown { return this.values.get(key); }
  set(key: string, value: unknown): void { this.values.set(key, value); }
  remove(key: string): void { this.values.delete(key); }
}

test('serializes compact contexts, reloads derived output, and bounds independent game keys', async () => {
  const storage = new MemoryStorage();
  let current = acceptPlayerSnapshot(null, snapshot(), 'full').context;
  assert.ok(current);
  await savePlayerContext(storage, current);

  const rawSaved = [...storage.values.values()].find(value => typeof value === 'string') as string;
  assert.ok(rawSaved);
  assert.doesNotMatch(rawSaved, /healthAfter|damageDealt|winningTeamId|guess|pano/i);

  const restored = await loadPlayerContext(storage, 'player-rest-full');
  assert.deepEqual(restored.context, current);
  assert.deepEqual(restored.output?.currentHealth, [0, 5644]);
  assert.equal(restored.diagnostic, null);

  for (let index = 0; index < 11; index += 1) {
    const context = acceptPlayerSnapshot(null, snapshot(value => {
      value.gameId = `game-${index}`;
      value.version = index + 1;
    }), 'half').context;
    assert.ok(context);
    await savePlayerContext(storage, context);
  }
  const contextKeys = [...storage.values.keys()].filter(key => key.includes('.game.'));
  assert.equal(contextKeys.length, 10);
  assert.equal((await loadPlayerContext(storage, 'game-0')).context, null);
  assert.ok((await loadPlayerContext(storage, 'game-10')).context);
});

test('reports an unavailable active context when its rules schema is old', async () => {
  const storage = new MemoryStorage();
  const context = acceptPlayerSnapshot(null, snapshot(), 'full').context;
  assert.ok(context);
  await savePlayerContext(storage, context);
  const entry = [...storage.values.entries()].find(([key]) => key.includes('.game.'));
  assert.ok(entry);
  storage.values.set(entry[0], (entry[1] as string).replace(
    `\"schemaVersion\":${PLAYER_TIE_RANGE_RULES_VERSION}`,
    `\"schemaVersion\":${PLAYER_TIE_RANGE_RULES_VERSION + 1}`,
  ));

  const restored = await loadPlayerContext(storage, context.gameId);
  assert.equal(restored.context, null);
  assert.equal(restored.output, null);
  assert.equal(restored.diagnostic?.code, 'schema-mismatch');
});
