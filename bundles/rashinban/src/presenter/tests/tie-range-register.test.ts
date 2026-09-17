import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type NodeCG from '@nodecg/types';
import { registerPresenter } from '../../extension/presenter/register.ts';
import { DEFAULT_SETTINGS } from '../settings.ts';
import { sample } from './fixtures.ts';

const rows = () => (sample('gs2-ws-full-duel-sequence-manual-rounds.json') as any[])
  .map(row => row.message).filter(message => message.duel?.state);

async function live(snapshot: any, saved = new Map<string, any>(), proxyReplicants = false) {
  const reps = new Map<string, any>(); const listeners = new Map<string, Function>();
  let now = 1900000000000; let deliver: (text: string) => void = () => assert.fail('No socket');
  const tasks: { fn: () => void; at: number; active: boolean }[] = [];
  const responses = [{ user: { id: 'spectator' } },
    { partyId: 'party', lobbyId: snapshot.gameId, gameState: 'Ongoing', gameType: 'Duels' },
    { gameId: snapshot.gameId, gameServerNodeId: 'node', status: 'Active' }, snapshot.duel.state];
  const before = process.env.GEOGUESSR_NCFA; process.env.GEOGUESSR_NCFA = 'test-only';
  try {
    registerPresenter({
      bundleConfig: { presenter: { input: 'live', partyId: 'party', clientVersion: 'fixture' } },
      Replicant(name: string, options: any) {
        const value = options.persistent && saved.has(name) ? structuredClone(saved.get(name)) : options.defaultValue;
        // NodeCG mutates assigned objects recursively, replacing children with proxies.
        function wrap(input: any): any {
          if (!proxyReplicants || input === null || typeof input !== 'object') return input;
          for (const key of Object.keys(input)) input[key] = wrap(input[key]);
          return new Proxy(input, {});
        }
        let stored = wrap(value);
        const rep = { get value() { return stored; }, set value(next) { stored = wrap(next); }, persistent: options.persistent };
        reps.set(name, rep); return rep;
      },
      Router: express.Router, mount() {}, listenFor(name: string, fn: Function) { listeners.set(name, fn); },
      log: { info() {}, warn() {} },
    } as unknown as NodeCG.ServerAPI, {
      now: () => now,
      schedule(fn, ms) { const task = { fn, at: now + ms, active: true }; tasks.push(task); return () => { task.active = false; }; },
      connection: { fetch: async () => new Response(JSON.stringify(responses.shift()), { status: 200 }),
        now: () => now, schedule: () => () => {},
        openSocket: () => ({ send() {}, close() {}, onOpen() {}, onMessage(fn) { deliver = fn; }, onClose() {} }),
      },
    });
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
  } finally {
    if (before === undefined) delete process.env.GEOGUESSR_NCFA; else process.env.GEOGUESSR_NCFA = before;
  }
  return {
    read: (name: string) => reps.get(name)?.value,
    send: (message: any) => deliver(JSON.stringify(message)),
    settings(mode: 'off' | 'full' | 'half') {
      let error: unknown;
      listeners.get('presenter:control')!({ action: 'settings', body: { ...DEFAULT_SETTINGS,
        tieRange: { enabled: mode !== 'off', mode: mode === 'off' ? 'full' : mode } } }, (err: unknown) => { error = err; });
      assert.equal(error, null);
    },
    replay() {
      let error: unknown;
      listeners.get('presenter:control')!({ action: 'reconnect', body: {
        input: 'replay', fixture: 'gs2-ws-full-duel-sequence-manual-rounds.json',
      } }, (err: unknown) => { error = err; });
      assert.equal(error, null);
    },
    save: () => new Map([...reps].filter(([, rep]) => rep.persistent).map(([name, rep]) => [name, structuredClone(rep.value)])),
    settle() {
      const target = now + 60000;
      for (let i = 0; i < 1000; i++) {
        const task = tasks.filter(value => value.active && value.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!task) { now = target; return; }
        now = Math.max(now, task.at);
        task.active = false; task.fn();
      }
      assert.fail('Timeline did not settle');
    },
  };
}

const enabled = () => new Map<string, any>([['presenterSettings', { ...DEFAULT_SETTINGS, tieRange: { enabled: true, mode: 'full' } }]]);

test('live rule locks per duel, survives restart, and changes for the next game', async () => {
  const first = rows()[0]; const app = await live(first, enabled());
  assert.equal(app.read('presenterDuel').tieRange.mode, 'full');
  app.settings('half');
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

  app.settings('half');
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

  app.settings('half');
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
  app.settings('half'); app.replay();
  assert.equal(app.read('presenterDuel').tieRange.mode, 'half');
  assert.equal(app.read('presenterRuleContexts').live.mode, 'full');
  app.settings('off');
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
  app.settings('half');
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
