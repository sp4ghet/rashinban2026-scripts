import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS } from '../settings.ts';
import { live, rows } from './register-harness.ts';

const FULL_DUEL = 'gs2-ws-full-duel-sequence.json';
const enabled = (tieRange = false) => new Map<string, any>([['presenterSettings', { ...DEFAULT_SETTINGS,
  pinpointing: { enabled: true }, tieRange: { enabled: tieRange, mode: 'full' } }]]);

/** The recorded final snapshot with blue scoring a solo 5K in rounds 1 to 4 (8 points at round 4). */
function blueSweep(): any {
  const final = structuredClone(rows(FULL_DUEL).at(-1));
  for (const team of final.duel.state.teams) {
    const blue = team.name === 'blue';
    for (const result of team.roundResults) if (result.roundNumber <= 4) result.score = blue ? 5000 : 0;
    for (const guess of team.players[0].guesses) if (guess.roundNumber <= 4) guess.score = blue ? 5000 : 0;
  }
  return final;
}

test('Pinpointing Duels latches per duel, survives restart, and changes for the next game', async () => {
  const first = rows(FULL_DUEL)[0]; const app = await live(first, enabled());
  assert.deepEqual(app.read('presenterDuel').pinpointing.totals, [0, 0]);
  assert.equal(app.read('presenterDuel').pinpointing.firstTo, 7);
  assert.equal(app.read('presenterRuleContexts').live.pinpointing, true);
  app.settings({ pinpointing: { enabled: false } });
  assert.ok(app.read('presenterDuel').pinpointing);
  const restarted = await live(first, app.save());
  assert.ok(restarted.read('presenterDuel').pinpointing);
  const next = structuredClone(first); next.gameId = next.duel.state.gameId = 'next-game';
  const nextGame = await live(next, restarted.save());
  assert.equal(nextGame.read('presenterDuel').pinpointing, undefined);
});

test('points accumulate over the recorded duel and the server finish is reported without a winner', async () => {
  const messages = rows(FULL_DUEL); const app = await live(messages[0], enabled());
  for (const message of messages) app.send(message);
  const duel = app.read('presenterDuel');
  assert.deepEqual(duel.pinpointing.totals, [2, 3]);
  assert.equal(duel.status, 'Finished');
  assert.equal(duel.winnerTeamId, null);
  assert.ok(app.read('presenterConnection').warnings.some((warning: string) => warning.includes('before a player reached 7')));
  app.settle(); assert.equal(app.read('presenterTimeline').phase, 'finished');
});

test('tie range combines with Pinpointing Duels and publishes band metadata', async () => {
  const messages = rows(FULL_DUEL); const app = await live(messages[0], enabled(true));
  for (const message of messages) app.send(message);
  const duel = app.read('presenterDuel');
  assert.deepEqual(duel.pinpointing.totals, [0, 3]);
  assert.equal(duel.tieRange.mode, 'full');
  assert.equal(duel.tieRange.rounds.length, 5);
  assert.deepEqual(duel.players.map((player: any) => player.health), messages.at(-1).duel.state.teams.map((team: any) => team.health));
});

test('reaching seven finishes the custom game, survives abort, and a raw rollback reopens it', async () => {
  const final = blueSweep(); const app = await live(final, enabled());
  const finished = app.read('presenterDuel');
  assert.equal(finished.round, 4);
  assert.equal(finished.status, 'Finished');
  assert.equal(finished.winnerTeamId, final.duel.state.teams[0].id);
  assert.deepEqual(finished.pinpointing.totals, [8, 0]);
  assert.deepEqual(app.read('presenterConnection').warnings, []);
  const abort = structuredClone(final); abort.code = 'DuelAborted'; abort.duel.state.version++;
  app.send(abort);
  assert.equal(app.read('presenterDuel').round, 4);
  assert.equal(app.read('presenterDuel').aborted, false);
  assert.equal(app.read('presenterDuel').winnerTeamId, finished.winnerTeamId);
  const rollback = structuredClone(rows(FULL_DUEL).find(message => message.code === 'DuelNewRound' && message.duel.state.currentRoundNumber === 2));
  rollback.duel.state.version = abort.duel.state.version + 1;
  app.send(rollback);
  assert.equal(app.read('presenterDuel').round, 2);
  assert.equal(app.read('presenterDuel').status, 'Ongoing');
  // Round 1 stays frozen as the settled solo 5K; only round 2 onward reopened.
  assert.deepEqual(app.read('presenterDuel').pinpointing.totals, [2, 0]);
  assert.equal(app.read('presenterDuel').pinpointing.terminal, null);
});

test('missing round results withhold the duel with a Pinpointing warning and recover', async () => {
  const complete = rows(FULL_DUEL).find(message => message.code === 'DuelNewRound' && message.duel.state.currentRoundNumber === 3);
  const broken = structuredClone(complete);
  for (const team of broken.duel.state.teams) team.roundResults = [];
  const app = await live(broken, enabled());
  assert.equal(app.read('presenterDuel'), null);
  assert.ok(app.read('presenterConnection').warnings.some((warning: string) => warning.includes('Pinpointing')));
  const repaired = structuredClone(complete); repaired.duel.state.version++;
  app.send(repaired);
  assert.deepEqual(app.read('presenterDuel').pinpointing.totals, [2, 0]);
  assert.deepEqual(app.read('presenterConnection').warnings, []);
});
