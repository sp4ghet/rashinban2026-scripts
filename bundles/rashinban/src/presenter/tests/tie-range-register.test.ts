import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type NodeCG from '@nodecg/types';
import { registerPresenter } from '../../extension/presenter/register.ts';
import { DEFAULT_SETTINGS } from '../settings.ts';
import { live, rows } from './register-harness.ts';

const enabled = () => new Map<string, any>([['presenterSettings', { ...DEFAULT_SETTINGS, tieRange: { enabled: true, mode: 'full' } }]]);

test('live rule locks per duel, survives restart, and changes for the next game', async () => {
  const first = rows()[0]; const app = await live(first, enabled());
  assert.equal(app.read('presenterDuel').tieRange.mode, 'full');
  app.settings({ tieRange: { enabled: true, mode: 'half' } });
  assert.equal(app.read('presenterDuel').tieRange.mode, 'full');
  const restarted = await live(first, app.save());
  assert.equal(restarted.read('presenterDuel').tieRange.mode, 'full');
  const next = structuredClone(first); next.gameId = next.duel.state.gameId = 'next-game';
  const nextGame = await live(next, restarted.save());
  assert.equal(nextGame.read('presenterDuel').tieRange.mode, 'half');
});

test('custom knockout survives later server rounds and abort; raw rollback removes it', async () => {
  const messages = rows(); const app = await live(messages[0], enabled());
  for (const message of messages) app.send(message);
  const finished = app.read('presenterDuel');
  assert.equal(finished.round, 3);
  assert.equal(finished.status, 'Finished');
  assert.equal(finished.aborted, false);
  app.settle(); assert.equal(app.read('presenterTimeline').phase, 'finished');
  const rawFinal = messages.at(-1); const abort = structuredClone(rawFinal);
  abort.code = 'DuelAborted'; abort.duel.state.version++;
  app.send(abort);
  assert.equal(app.read('presenterDuel').round, 3);
  assert.equal(app.read('presenterDuel').winnerTeamId, finished.winnerTeamId);
  assert.equal(app.read('presenterDuel').aborted, false);
  const restored = await live(abort, app.save());
  assert.equal(restored.read('presenterDuel').round, 3);
  assert.equal(restored.read('presenterTimeline').phase, 'finished');
  const rollback = structuredClone(messages.find(message => message.code === 'DuelNewRound' && message.duel.state.currentRoundNumber === 2));
  assert.ok(rollback);
  rollback.duel.state.version = abort.duel.state.version + 1;
  restored.send(rollback);
  assert.equal(restored.read('presenterDuel').round, 2);
  assert.equal(restored.read('presenterDuel').status, 'Ongoing');
  assert.equal(restored.read('presenterDuel').tieRange.mode, 'full');
});

test('missing rule inputs withhold custom state and recover on valid input', async () => {
  const first = rows()[0]; const bad = structuredClone(first);
  delete bad.duel.state.options.roundWinMultiplierIncrement;
  const app = await live(bad, enabled());
  assert.equal(app.read('presenterDuel'), null);
  assert.ok(app.read('presenterConnection').warnings.some((warning: string) => warning.includes('Tie-range')));
  const repaired = structuredClone(first); repaired.duel.state.version++;
  app.send(repaired);
  assert.equal(app.read('presenterDuel').tieRange.mode, 'full');
  assert.deepEqual(app.read('presenterConnection').warnings, []);
});

test('missing historical panorama recovers while retaining the same-duel rule', async () => {
  const complete = rows().find(message => message.code === 'DuelNewRound'
    && message.duel.state.currentRoundNumber === 4);
  assert.ok(complete);
  const incomplete = structuredClone(complete);
  incomplete.duel.state.rounds = incomplete.duel.state.rounds.filter((round: any) => round.roundNumber !== 1);
  const app = await live(incomplete, enabled());
  assert.equal(app.read('presenterDuel'), null);
  assert.ok(app.read('presenterConnection').warnings.some((warning: string) => warning.includes('Tie-range')));

  app.settings({ tieRange: { enabled: true, mode: 'half' } });
  const repaired = structuredClone(complete); repaired.duel.state.version++;
  app.send(repaired);

  assert.equal(app.read('presenterDuel').tieRange.mode, 'full');
  assert.deepEqual(app.read('presenterConnection').warnings, []);
});

test('invalid paired score recovers while retaining the same-duel rule', async () => {
  const complete = rows().find(message => message.code === 'DuelNewRound'
    && message.duel.state.currentRoundNumber === 4);
  assert.ok(complete);
  const invalid = structuredClone(complete);
  invalid.duel.state.teams[0].roundResults[0].score = 5001;
  const app = await live(invalid, enabled());
  assert.equal(app.read('presenterDuel'), null);
  assert.ok(app.read('presenterConnection').warnings.some((warning: string) => warning.includes('Tie-range')));

  app.settings({ tieRange: { enabled: true, mode: 'half' } });
  const repaired = structuredClone(complete); repaired.duel.state.version++;
  app.send(repaired);

  assert.equal(app.read('presenterDuel').tieRange.mode, 'full');
  assert.deepEqual(app.read('presenterConnection').warnings, []);
});

test('cold round 2 without round 1 results withholds state and recovers with complete history', async () => {
  const complete = rows().find(message => message.code === 'DuelNewRound'
    && message.duel.state.currentRoundNumber === 2);
  assert.ok(complete);
  const incomplete = structuredClone(complete);
  for (const team of incomplete.duel.state.teams) team.roundResults = [];
  const app = await live(incomplete, enabled());
  assert.equal(app.read('presenterDuel'), null);
  assert.ok(app.read('presenterConnection').warnings.some((warning: string) => warning.includes('Tie-range')));

  const repaired = structuredClone(complete); repaired.duel.state.version++;
  app.send(repaired);

  assert.equal(app.read('presenterDuel').tieRange.mode, 'full');
  assert.deepEqual(app.read('presenterConnection').warnings, []);
});

test('finished source without completed history withholds an unverified custom outcome', async () => {
  const incomplete = structuredClone(rows().find(message => message.code === 'DuelFinished'));
  assert.ok(incomplete);
  for (const team of incomplete.duel.state.teams) team.roundResults = [];
  const app = await live(incomplete, enabled());

  assert.equal(app.read('presenterDuel'), null);
  assert.ok(app.read('presenterConnection').warnings.some((warning: string) => warning.includes('Tie-range')));
});

test('explicit replay restart captures preferences without replacing the saved live rule', async () => {
  const first = rows()[0]; const app = await live(first, enabled());
  app.settings({ tieRange: { enabled: true, mode: 'half' } }); app.replay();
  assert.equal(app.read('presenterDuel').tieRange.mode, 'half');
  assert.equal(app.read('presenterRuleContexts').live.mode, 'full');
  app.settings({ tieRange: { enabled: false, mode: 'full' } });
  assert.equal(app.read('presenterDuel').tieRange.mode, 'half');
  app.replay();
  assert.equal(app.read('presenterDuel').tieRange, undefined);
  assert.equal(app.read('presenterRuleContexts').replay.mode, 'off');
  const resumedLive = await live(first, app.save());
  assert.equal(resumedLive.read('presenterDuel').tieRange.mode, 'full');
});

test('later snapshots cannot change settled custom scores, including after restart', async () => {
  const final = rows().at(-1); const app = await live(final, enabled());
  const original = structuredClone(app.read('presenterDuel'));
  const changed = structuredClone(final); changed.duel.state.version++;
  changed.duel.state.teams[0].roundResults[0].score = 0;
  app.send(changed);
  assert.deepEqual(app.read('presenterDuel').players, original.players);
  const restored = await live(changed, app.save());
  assert.deepEqual(restored.read('presenterDuel').players, original.players);
});

test('enabled rule works with NodeCG recursive proxy ownership', async () => {
  const app = await live(rows()[0], enabled(), true);
  assert.equal(app.read('presenterDuel')?.tieRange.mode, 'full');
  assert.deepEqual(app.read('presenterConnection').warnings, []);
});

test('configured replay resumes its saved rule and position after a process restart', async () => {
  const app = await live(rows()[0], enabled()); app.replay();
  for (let i = 0; i < 10; i++) app.settle();
  app.settings({ tieRange: { enabled: true, mode: 'half' } });
  const saved = app.save(); const before = app.read('presenterDuel');
  const reps = new Map<string, any>();
  registerPresenter({ bundleConfig: { presenter: { input: 'replay', replayFixture: 'gs2-ws-full-duel-sequence-manual-rounds.json' } },
    Replicant(name: string, opts: any) { const rep = { value: opts.persistent && saved.has(name) ? structuredClone(saved.get(name)) : opts.defaultValue }; reps.set(name, rep); return rep; },
    Router: express.Router, mount() {}, listenFor() {}, log: { info() {}, warn() {} },
  } as unknown as NodeCG.ServerAPI, { now: () => 1900010000000, schedule: () => () => {} });
  assert.equal(reps.get('presenterDuel').value?.tieRange.mode, 'full');
  assert.equal(reps.get('presenterDuel').value?.round, before.round);
  assert.equal(reps.get('presenterDuel').value?.status, 'Finished');
  assert.equal(reps.get('presenterTimeline').value.phase, 'finished');
});
