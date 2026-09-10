import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import express from 'express';
import type NodeCG from '@nodecg/types';
import { registerPresenter } from '../../extension/presenter/register.ts';
import { DEFAULT_SETTINGS } from '../settings.ts';
import { sample } from './fixtures.ts';
import type { ConnectionDeps } from '../../extension/presenter/connection.ts';

test('presenter boots isolated replay and validates HTTP edits before publishing state', async () => {
  const app = express();
  const reps = new Map<string, { value: any; opts: any }>();
  const owners = new WeakMap<object, string>();
  function own(value: unknown, name: string): void {
    if (typeof value !== 'object' || value === null) return;
    const previous = owners.get(value);
    if (previous && previous !== name) throw new Error(`Cross-Replicant object: ${previous} -> ${name}`);
    owners.set(value, name);
    Object.values(value).forEach(child => own(child, name));
  }
  const listeners = new Map<string, Function>();
  const tasks: Array<{ fn: () => void; at: number; active: boolean }> = [];
  let now = 1900000000000;
  const fake = {
    bundleConfig: { presenter: { input: 'replay', replayFixture: 'gs2-ws-full-duel-sequence-manual-rounds.json' } },
    Replicant(name: string, opts: any) {
      let value: unknown;
      const rep = Object.assign(new EventEmitter(), { opts, value: undefined as unknown });
      Object.defineProperty(rep, 'value', { get: () => value, set: next => { own(next, name); value = next; } });
      rep.value = opts.defaultValue;
      reps.set(name, rep); return rep;
    },
    Router: express.Router, mount: (path: string, router: any) => app.use(path, router),
    listenFor: (name: string, fn: Function) => listeners.set(name, fn), log: { info() {}, warn() {} },
  } as unknown as NodeCG.ServerAPI;
  registerPresenter(fake, { now: () => now, schedule(fn, delay) {
    const task = { fn, at: now + delay, active: true }; tasks.push(task); return () => { task.active = false; };
  } });
  assert.equal(reps.get('presenterRenderer')?.value.status, 'unreported');
  listeners.get('presenter:renderer')!('missing-key');
  assert.deepEqual(reps.get('presenterRenderer')?.value, { status: 'missing-key', updatedAtMs: now });
  listeners.get('presenter:renderer')!({ status: 'api-ready', error: 'private raw error' });
  assert.equal(reps.get('presenterRenderer')?.value.status, 'missing-key');
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const post = (path: string, body?: unknown) => fetch(`http://127.0.0.1:${address.port}/rashinban/presenter/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    const changed = await post('view/rendered');
    assert.equal(changed.status, 200);
    assert.equal(reps.get('presenterSettings')?.value.viewSource, 'rendered');
    assert.equal(reps.get('presenterConnection')?.value.input, 'replay');
    assert.equal(reps.get('presenterTimeline')?.value.phase, 'waiting-host');
    for (const name of ['presenterConnection', 'presenterDuel', 'presenterViews', 'presenterTimeline']) assert.equal(reps.get(name)?.opts.persistent, false);
    for (const name of ['presenterSeries', 'presenterSettings']) assert.equal(reps.get(name)?.opts.persistent, true);
    const previous = structuredClone(reps.get('presenterSettings')?.value);
    assert.equal((await post('settings', { ...DEFAULT_SETTINGS, musicGain: -1 })).status, 400);
    assert.deepEqual(reps.get('presenterSettings')?.value, previous);
    assert.equal((await post('settings', { ...DEFAULT_SETTINGS, keyColor: '#00ff00' })).status, 200);
    assert.equal((await post('mute')).status, 200);
    assert.equal(reps.get('presenterSettings')?.value.muted, true);
    assert.equal((await post('unmute')).status, 200);
    assert.equal(reps.get('presenterSettings')?.value.muted, false);
    const series = { id: 'match', source: 'manual', left: { id: 'a', name: '<b>A</b>', handle: '@a', playerId: 'one', wins: 1 }, right: { id: 'b', name: 'B', handle: '@b', playerId: 'two', wins: 2 } };
    assert.equal((await post('series', series)).status, 200);
    assert.equal((await post('series', { ...series, right: { ...series.right, playerId: 'one' } })).status, 400);
    assert.deepEqual(reps.get('presenterSeries')?.value, series);
    // Observe complete manual replay through the actual scheduled coordinator.
    const phases = new Set<string>();
    let effectAt: number | null = null;
    let skippedEffects = 0;
    for (let i = 0; i < 10000; i++) {
      const next = tasks.filter(task => task.active).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      now = next.at; next.active = false; next.fn();
      const value = reps.get('presenterTimeline')!.value;
      phases.add(value.phase);
      if (value.effect !== 'none' && effectAt === null) effectAt = now;
      if (value.effect === 'none' && effectAt !== null) {
        assert.ok(now - effectAt <= 200, 'missing media must skip at the effect start, not the watchdog');
        skippedEffects++; effectAt = null;
      }
    }
    assert.equal(reps.get('presenterTimeline')?.value.phase, 'finished');
    assert.ok(phases.has('pre-round')); assert.ok(phases.has('live')); assert.ok(phases.has('results-reveal')); assert.ok(phases.has('waiting-host'));
    assert.equal((await post('reconnect', { fixture: 'gs2-ws-full-duel-sequence.json' })).status, 200);
    for (let i = 0; i < 10000; i++) {
      const next = tasks.filter(task => task.active).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      now = next.at; next.active = false; next.fn();
      const value = reps.get('presenterTimeline')!.value;
      if (value.effect !== 'none' && effectAt === null) effectAt = now;
      if (value.effect === 'none' && effectAt !== null) {
        assert.ok(now - effectAt <= 200, 'missing media must skip at the effect start, not the watchdog');
        skippedEffects++; effectAt = null;
      }
    }
    assert.ok(skippedEffects > 0);
    assert.deepEqual(reps.get('presenterSeries')?.value, series);
    assert.equal((await post('reconnect', { fixture: '../../.secrets/geoguessr.json' })).status, 400);
    assert.equal((await post('reconnect', { fixture: 'gs2-ws-full-duel-sequence-aborted.json' })).status, 200);
    // Drain real coordinator/replay callbacks on a controlled clock, preserving their actual boundaries.
    for (let i = 0; i < 10000; i++) {
      const next = tasks.filter(task => task.active).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      now = next.at; next.active = false; next.fn();
    }
    assert.equal(reps.get('presenterTimeline')?.value.phase, 'aborted');
    assert.deepEqual(reps.get('presenterSeries')?.value, series);
    assert.ok(listeners.has('presenter:control'));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('live reconnect bootstraps duplicate versions and terminal results survive normal close', async () => {
  const rows = sample('gs2-ws-full-duel-sequence.json') as Array<{ receivedAt: number; message: any }>;
  const first = rows.find(row => row.message.code === 'DuelStarted')!;
  const last = rows.find(row => row.message.code === 'DuelFinished')!;
  const reps = new Map<string, { value: any }>();
  const previousSecret = process.env.GEOGUESSR_NCFA;
  process.env.GEOGUESSR_NCFA = 'test-only-in-memory';
  let onMessage: (text: string) => void = () => {};
  let onClose: (code: number) => void = () => {};
  const retryTasks: Array<{ fn: () => void; delay: number }> = [];
  const responses = [
    { user: { id: 'spectator' } },
    { partyId: 'party', lobbyId: first.message.gameId, gameState: 'Ongoing', gameType: 'Duels' },
    { gameId: first.message.gameId, gameServerNodeId: 'node', status: 'Active' },
    first.message.duel.state,
  ];
  const transport: ConnectionDeps = {
    fetch: async () => new Response(JSON.stringify(responses.shift()), { status: 200 }),
    now: () => first.receivedAt,
    schedule(fn, delay) { retryTasks.push({ fn, delay }); return () => {}; },
    openSocket: () => ({ send() {}, close() {}, onOpen() {}, onMessage(fn) { onMessage = fn; }, onClose(fn) { onClose = fn; } }),
  };
  try {
    registerPresenter({
      bundleConfig: { presenter: { input: 'live', partyId: 'party', clientVersion: 'fixture' } },
      Replicant(name: string, opts: any) { const rep = { value: opts.defaultValue }; reps.set(name, rep); return rep; },
      Router: express.Router, mount() {}, listenFor() {}, log: { info() {}, warn() {} },
    } as unknown as NodeCG.ServerAPI, { now: () => first.receivedAt, schedule: () => () => {}, connection: transport });
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    onMessage(JSON.stringify(last.message));
    assert.equal(reps.get('presenterDuel')!.value.status, 'Finished');
    assert.equal(reps.get('presenterTimeline')!.value.phase, 'results-transition');
    onClose(1012);
    retryTasks.find(task => task.delay < 5000)!.fn();
    onMessage(JSON.stringify({ code: 'DuelStarted', gameId: last.message.gameId, duel: last.message.duel }));
    assert.equal(reps.get('presenterTimeline')!.value.phase, 'finished');
    onClose(1000);
    assert.equal(reps.get('presenterDuel')!.value?.status, 'Finished');
    assert.equal(reps.get('presenterTimeline')!.value.phase, 'finished');
  } finally {
    if (previousSecret === undefined) delete process.env.GEOGUESSR_NCFA;
    else process.env.GEOGUESSR_NCFA = previousSecret;
  }
});
