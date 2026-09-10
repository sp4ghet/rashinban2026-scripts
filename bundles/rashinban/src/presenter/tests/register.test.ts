import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import express from 'express';
import type NodeCG from '@nodecg/types';
import { registerPresenter } from '../../extension/presenter/register.ts';
import { DEFAULT_SETTINGS } from '../settings.ts';
import { EMPTY_MEDIA } from '../media.ts';
import { sample } from './fixtures.ts';
import type { ConnectionDeps } from '../../extension/presenter/connection.ts';

test('audio mode handoff waits for old mute acknowledgement or expiry, and denies previews and duplicates', () => {
  const reps = new Map<string, any>(); const listeners = new Map<string, Function>(); let now = 100000;
  const tasks: { fn: () => void; at: number; active: boolean }[] = [];
  registerPresenter({ bundleConfig: { presenter: { input: 'invalid' } },
    Replicant(name: string, opts: any) { const rep = { value: opts.defaultValue }; reps.set(name, rep); return rep; },
    Router: express.Router, mount() {}, listenFor: (name: string, fn: Function) => listeners.set(name, fn),
  } as unknown as NodeCG.ServerAPI, { now: () => now, schedule(fn, ms) { const t = { fn, at: now + ms, active: true }; tasks.push(t); return () => { t.active = false; }; } });
  const message = (name: string, body: unknown) => { let result: any; listeners.get(name)?.(body, (err: unknown, value: unknown) => { result = err ? 'rejected' : value; }); return result; };
  const report = (clientId: string, role: string) => message('presenter:client', { clientId, role, ready: false, renderer: 'missing-key', clockFresh: true, audio: { state: 'ready', missing: [] } });
  const audio = () => reps.get('presenterClients').value.audio;
  report('preview', 'preview'); assert.equal(audio() ?? null, null);
  report('program', 'program'); report('one', 'audio'); report('two', 'audio');
  assert.equal(audio()?.clientId, 'one'); const first = { ...audio() };
  message('presenter:control', { action: 'settings', body: { ...DEFAULT_SETTINGS, audioOutput: 'embedded' } });
  assert.equal(audio().clientId, 'one'); assert.equal(audio().releasing, true);
  assert.equal(message('presenter:audio-muted', { clientId: 'two', token: first.token }), false);
  assert.equal(message('presenter:audio-muted', { clientId: 'one', token: first.token }), true);
  assert.equal(audio().clientId, 'program', 'missing Google key must not block embedded audio'); assert.equal(audio().mode, 'embedded');
  assert.notEqual(audio().token, first.token);
  message('presenter:control', { action: 'settings', body: DEFAULT_SETTINGS });
  assert.equal(audio().clientId, 'program'); assert.equal(audio().releasing, true);
  now += 2000; report('two', 'audio');
  now = 106000; for (const t of tasks.filter(t => t.active && t.at <= now)) { t.active = false; t.fn(); }
  assert.equal(audio().clientId, 'two'); assert.equal(audio().releasing, false);
  assert.equal(message('presenter:audio-muted', { clientId: 'one', token: first.token }), false);
});

test('available celebration holds results with its own deadline; missing double skips without substituting single', () => {
  const reps = new Map<string, any>(); const listeners = new Map<string, Function>();
  const tasks: { fn: () => void; at: number; active: boolean }[] = []; let now = 1900000000000;
  registerPresenter({ bundleConfig: { presenter: { input: 'replay' } },
    Replicant(name: string, opts: any) { const rep = Object.assign(new EventEmitter(), { value: opts.defaultValue, opts }); reps.set(name, rep); return rep; },
    Router: express.Router, mount() {}, listenFor: (name: string, fn: Function) => listeners.set(name, fn), log: { info() {}, warn() {} },
  } as unknown as NodeCG.ServerAPI, { now: () => now, schedule(fn, ms) { const task = { fn, at: now + ms, active: true }; tasks.push(task); return () => { task.active = false; }; } });
  const url = '/assets/rashinban/video/single.webm';
  const media = { ...EMPTY_MEDIA, fiveK: { single: { url, watchdogMs: 5000, soundtrack: 'embedded' }, double: null } };
  let error: unknown; listeners.get('presenter:control')!({ action: 'media', body: media }, (err: unknown) => { error = err; });
  assert.equal(error, null); assert.equal(reps.get('presenterMedia').opts.persistent, true);
  reps.get('assets:video').value = [{ url }];
  listeners.get('presenter:control')!({ action: 'settings', body: { ...DEFAULT_SETTINGS, timing: { ...DEFAULT_SETTINGS.timing, leadMs: 0, effectWatchdogMs: 0 } } });
  for (let i = 0; i < 10000 && reps.get('presenterTimeline').value.effect !== 'single-5k'; i++) {
    const task = tasks.filter(t => t.active).sort((a, b) => a.at - b.at)[0]; if (!task) break; now = task.at; task.active = false; task.fn();
  }
  const t = reps.get('presenterTimeline').value; assert.equal(t.effect, 'single-5k');
  const start = t.cues[0].atMs; assert.equal(t.effectDeadlineMs, start + 5000);
  now = start; listeners.get('presenter:control')!({ action: 'settings', body: DEFAULT_SETTINGS });
  assert.equal(reps.get('presenterTimeline').value.effect, 'single-5k'); assert.equal(reps.get('presenterTimeline').value.revealAtMs, null);
  reps.get('presenterTimeline').value.effect = 'double-5k';
  listeners.get('presenter:control')!({ action: 'settings', body: DEFAULT_SETTINGS });
  assert.equal(reps.get('presenterTimeline').value.effect, 'none'); assert.equal(reps.get('presenterTimeline').value.revealAtMs, start + 200);
  assert.equal(reps.get('presenterMediaStatus').value.status, 'missing');
  assert.equal(reps.get('presenterMediaStatus').value.effect, 'double-5k');
  const before = reps.get('presenterMedia').value;
  listeners.get('presenter:control')!({ action: 'media', body: { ...media, stems: [{ id: '' }] } }, (err: unknown) => { error = err; });
  assert.ok(error); assert.deepEqual(reps.get('presenterMedia').value, before);
});

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
  listeners.get('presenter:client')?.({ clientId: 'program', role: 'program', ready: false, renderer: 'missing-key' });
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
    const replayBefore = reps.get('presenterTimeline')!.value;
    assert.equal((await post('reconnect', { partyId: 'another-party' })).status, 400);
    assert.equal((await post('reconnect', { partyId: '' })).status, 400);
    assert.equal(reps.get('presenterTimeline')!.value, replayBefore);
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

test('client leases isolate preview reports, renew uniquely, expire and transfer only to live programs', () => {
  const reps = new Map<string, { value: any; opts: any }>(); const listeners = new Map<string, Function>();
  const tasks: { fn: () => void; at: number; active: boolean }[] = []; let now = 100000;
  registerPresenter({ bundleConfig: { presenter: { input: 'invalid' } },
    Replicant(name: string, opts: any) { const rep = { value: opts.defaultValue, opts }; reps.set(name, rep); return rep; },
    Router: express.Router, mount() {}, listenFor: (name: string, fn: Function) => listeners.set(name, fn),
  } as unknown as NodeCG.ServerAPI, { now: () => now, schedule(fn, delay) {
    const task = { fn, at: now + delay, active: true }; tasks.push(task); return () => { task.active = false; };
  } });
  function message(name: string, body: unknown) { let result: any; listeners.get(name)?.(body, (error: unknown, value: unknown) => { result = error ? 'rejected' : value; }); return result; }
  const report = (id: string, role: string, renderer = 'api-ready') => message('presenter:client', { clientId: id, role, ready: true, renderer });
  const clients = () => reps.get('presenterClients')?.value;
  report('preview', 'preview', 'missing-key');
  assert.equal(clients()?.program, null);
  assert.equal(reps.get('presenterClients')?.opts.persistent, false);
  report('one', 'program'); report('two', 'program', 'pano-error');
  assert.deepEqual(clients().program, { clientId: 'one', expiresAtMs: 106000 });
  assert.equal(reps.get('presenterRenderer')?.value.status, 'api-ready');
  message('presenter:renderer', { clientId: 'preview', status: 'api-error' });
  assert.equal(reps.get('presenterRenderer')?.value.status, 'api-ready');
  assert.equal(clients().clients.find((c: any) => c.clientId === 'preview').renderer.status, 'api-error');
  message('presenter:renderer', { clientId: 'one', status: 'raw private error' });
  assert.equal(reps.get('presenterRenderer')?.value.status, 'api-ready');
  assert.equal(report('one', 'preview'), 'rejected', 'same ID cannot change role');
  now += 2000; report('one', 'program'); report('two', 'program', 'pano-error');
  assert.equal(clients().clients.length, 3);
  assert.equal(clients().program.expiresAtMs, 108000);
  assert.equal(message('presenter:control', { action: 'program/transfer', body: { clientId: 'preview' } }), 'rejected');
  assert.notEqual(message('presenter:control', { action: 'program/transfer', body: { clientId: 'two' } }), 'rejected');
  assert.equal(clients().program.clientId, 'two');
  assert.equal(reps.get('presenterRenderer')?.value.status, 'pano-error');
  report('one', 'program'); assert.equal(clients().program.clientId, 'two');
  now = 108000;
  for (const task of tasks.filter(t => t.active && t.at <= now)) { task.active = false; task.fn(); }
  assert.equal(clients().program, null); assert.equal(clients().clients.length, 0);
  assert.equal(reps.get('presenterRenderer')?.value.status, 'unreported');
  report('one', 'program'); assert.equal(clients().program.clientId, 'one');
  const timeline = reps.get('presenterTimeline')!;
  timeline.value = { ...timeline.value, generation: 'g', phase: 'results-transition', effect: 'single-5k', effectDeadlineMs: now + 10000,
    cues: [{ id: 'effect-1', kind: 'five-k', atMs: now - 1, untilMs: now + 10000, playerId: null }] };
  const completion = { clientId: 'one', generation: 'g', effect: 'single-5k', cueId: 'effect-1' };
  timeline.value.phase = 'live';
  assert.equal(message('presenter:effect-ended', completion), false, 'completion outside results transition is ineffective');
  timeline.value.phase = 'results-transition';
  for (const patch of [{ clientId: 'preview' }, { clientId: 'two' }, { generation: 'old' }, { effect: 'double-5k' }, { cueId: 'old' }]) {
    assert.equal(message('presenter:effect-ended', { ...completion, ...patch }), false);
    assert.equal(timeline.value.effect, 'single-5k');
  }
  assert.equal(message('presenter:effect-ended', completion), true);
  assert.equal(timeline.value.effect, 'none');
  assert.equal(message('presenter:effect-ended', completion), false);
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

test('live party selector validates before stopping, supports automatic discovery, and retains session selection', async () => {
  const reps = new Map<string, any>(); const listeners = new Map<string, Function>();
  const urls: string[] = []; let stops = 0;
  const previousSecret = process.env.GEOGUESSR_NCFA; process.env.GEOGUESSR_NCFA = 'test-only-in-memory';
  const transport: ConnectionDeps = {
    async fetch(url) { urls.push(String(url)); return new Response(JSON.stringify(String(url).includes('/profiles/') ? { user: { id: 'spectator' } } : { partyId: 'observed-party', lobbyId: null })); },
    now: () => 1000, schedule() { return () => { stops++; }; },
    openSocket() { throw Error('No lobby'); },
  };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const reconnect = (body?: unknown) => { let result: any; listeners.get('presenter:control')!({ action: 'reconnect', body }, (err: unknown, value: unknown) => { result = err ? 'rejected' : value; }); return result; };
  try {
    registerPresenter({ bundleConfig: { presenter: { input: 'live', partyId: 'configured-party', clientVersion: 'fixture' } },
      Replicant(name: string, opts: any) { const rep = { value: opts.defaultValue }; reps.set(name, rep); return rep; },
      Router: express.Router, mount() {}, listenFor: (name: string, fn: Function) => listeners.set(name, fn),
    } as unknown as NodeCG.ServerAPI, { now: () => 1000, schedule: () => () => {}, connection: transport });
    await flush(); assert.ok(urls.some(url => url.endsWith('/configured-party')));
    const before = reps.get('presenterConnection').value; const stoppedBefore = stops;
    for (const partyId of ['../bad', 'bad party', 'x'.repeat(129), 42, null]) assert.equal(reconnect({ partyId }), 'rejected');
    assert.equal(reconnect({ fixture: 'gs2-ws-full-duel-sequence.json' }), 'rejected');
    assert.equal(stops, stoppedBefore); assert.equal(reps.get('presenterConnection').value, before);
    assert.notEqual(reconnect({ partyId: 'selected_party-2' }), 'rejected'); await flush();
    assert.ok(urls.at(-1)!.endsWith('/selected_party-2'));
    assert.equal(reps.get('presenterConnection').value.selectedPartyId, 'selected_party-2');
    assert.notEqual(reconnect(), 'rejected'); await flush(); assert.ok(urls.at(-1)!.endsWith('/selected_party-2'));
    assert.notEqual(reconnect({ partyId: '   ' }), 'rejected'); await flush(); assert.ok(urls.at(-1)!.endsWith('/active'));
    assert.equal(reps.get('presenterConnection').value.selectedPartyId, null);
    assert.equal(reps.get('presenterConnection').value.configuredPartyId, 'configured-party');
  } finally { if (previousSecret === undefined) delete process.env.GEOGUESSR_NCFA; else process.env.GEOGUESSR_NCFA = previousSecret; }
});
