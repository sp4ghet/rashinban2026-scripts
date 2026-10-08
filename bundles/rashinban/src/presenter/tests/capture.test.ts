import assert from 'node:assert/strict';
import test from 'node:test';
import { captureFrameMode, createCaptureInput, parseVideoInputs, type CaptureStatus } from '../../graphics/presenter/capture.ts';
import type { RenderFrame } from '../../graphics/presenter/renderer.ts';
import { applySnapshot } from '../normalize.ts';
import { seedViews } from '../telemetry.ts';
import { sample } from './fixtures.ts';

function stream() {
  const track = Object.assign(new EventTarget(), { stopped: 0, readyState: 'live', muted: false, stop() { this.stopped++; this.readyState = 'ended'; } });
  return { track, media: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function rig() {
  const requests: { id: string; resolve(value: MediaStream): void; reject(reason: unknown): void }[] = [];
  const timers: { run(): void; ms: number; cancelled: boolean }[] = [];
  let attached: MediaStream | null = null; let status: CaptureStatus | undefined;
  const input = createCaptureInput({
    open: id => new Promise((resolve, reject) => requests.push({ id, resolve, reject })),
    attach: value => { attached = value; }, status: value => { status = value; },
    schedule(run, ms) { const timer = { run, ms, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; },
  });
  return { input, requests, timers, get attached() { return attached; }, get status() { return status; } };
}

test('transient capture failures retry with bounded delays, then recover when the device reappears', async () => {
  const r = rig(); r.input.select('card', true);
  for (const [attempt, delay] of [500, 1500, 3000, 5000].entries()) {
    r.requests[attempt].reject({ name: 'NotReadableError' }); await flush();
    assert.equal(r.status?.state, 'error');
    assert.equal(r.timers[attempt]?.ms, delay);
    r.timers[attempt].run();
    assert.equal(r.requests.length, attempt + 2);
  }
  r.requests[4].reject({ name: 'NotFoundError' }); await flush();
  assert.equal(r.timers.length, 4, 'retry budget is finite');
  r.input.retryAvailable(); assert.equal(r.requests.length, 6);
  const video = stream(); r.requests[5].resolve(video.media); await flush();
  assert.equal(r.status?.state, 'ready');
  video.track.dispatchEvent(new Event('ended'));
  assert.equal(r.timers.at(-1)?.ms, 500, 'a recovered device gets a fresh retry budget');
  r.input.dispose(); assert.equal(r.timers.at(-1)?.cancelled, true);
});

test('a track that ends before attachment still recovers through retries or device discovery', async () => {
  for (const recovery of ['timer', 'devicechange']) {
    const r = rig(); r.input.select('card', true);
    const ended = stream(); ended.track.readyState = 'ended';
    r.requests[0].resolve(ended.media); await flush();
    assert.equal(r.status?.state, 'error'); assert.equal(r.attached, null);
    assert.equal(ended.track.stopped, 1); assert.equal(r.timers[0]?.ms, 500);
    if (recovery === 'timer') r.timers[0].run();
    else r.input.retryAvailable();
    assert.equal(r.requests.length, 2);
    const live = stream(); r.requests[1].resolve(live.media); await flush();
    assert.equal(r.status?.state, 'ready'); assert.equal(r.attached, live.media);
    r.input.dispose();
  }
});

test('capture retry is cancelled by ownership loss, device changes, or disposal', async () => {
  for (const action of ['disable', 'switch', 'dispose'] as const) {
    const r = rig(); r.input.select('old', true);
    r.requests[0].reject({ name: 'AbortError' }); await flush();
    assert.equal(r.timers.length, 1);
    if (action === 'disable') r.input.select('old', false);
    else if (action === 'switch') r.input.select('new', true);
    else r.input.dispose();
    assert.equal(r.timers[0].cancelled, true);
    r.timers[0].run();
    assert.equal(r.requests.length, action === 'switch' ? 2 : 1, 'stale retry cannot reopen a device');
    r.input.dispose();
  }
});

test('permissions and unsupported playback never retry automatically, even on device changes', async () => {
  for (const name of ['NotAllowedError', 'SecurityError', 'NotSupportedError']) {
    const r = rig(); r.input.select('card', true);
    r.requests[0].reject({ name }); await flush();
    assert.equal(r.status?.state, 'error'); assert.equal(r.timers.length, 0);
    r.input.retryAvailable(); assert.equal(r.requests.length, 1);
    r.input.reconnect(); assert.equal(r.requests.length, 2);
    r.input.dispose();
  }
});

test('capture only opens an explicitly selected input for an enabled source', async () => {
  const r = rig(); r.input.select('', true); r.input.select('left-card', false);
  assert.equal(r.requests.length, 0);
  r.input.select('left-card', true); r.input.select('left-card', true);
  assert.deepEqual(r.requests.map(item => item.id), ['left-card']);
  const video = stream(); r.requests[0].resolve(video.media); await flush();
  assert.equal(r.attached, video.media); assert.equal(r.status?.state, 'ready');
  r.input.select('left-card', false);
  assert.equal(video.track.stopped, 1); assert.equal(r.attached, null); assert.equal(r.status?.state, 'idle');
});

test('late permission grants cannot attach an old device after switching, disabling or disposing', async () => {
  for (const action of ['switch', 'disable', 'dispose'] as const) {
    const r = rig(); r.input.select('old', true);
    if (action === 'switch') r.input.select('new', true);
    else if (action === 'disable') r.input.select('old', false);
    else r.input.dispose();
    const old = stream(); r.requests[0].resolve(old.media); await flush();
    assert.equal(old.track.stopped, 1); assert.equal(r.attached, null);
    if (action === 'switch') {
      const next = stream(); r.requests[1].resolve(next.media); await flush();
      assert.equal(r.attached, next.media); r.input.dispose(); assert.equal(next.track.stopped, 1);
    }
  }
});

test('capture reports denied permission without repeated opens, and reconnect retries explicitly', async () => {
  const r = rig(); r.input.select('card', true);
  r.requests[0].reject({ name: 'NotAllowedError', message: 'private device details' }); await flush();
  assert.equal(r.status?.state, 'error'); assert.match(r.status!.message, /permission/i);
  assert.ok(!r.status!.message.includes('private'));
  r.input.select('card', true); assert.equal(r.requests.length, 1);
  r.input.reconnect(); assert.equal(r.requests.length, 2);
  const video = stream(); r.requests[1].resolve(video.media); await flush();
  assert.equal(r.status?.state, 'ready'); r.input.dispose();
});

test('device unplug releases the feed, while mute and unmute report signal recovery', async () => {
  const r = rig(); r.input.select('card', true); const video = stream();
  r.requests[0].resolve(video.media); await flush();
  video.track.muted = true; video.track.dispatchEvent(new Event('mute')); assert.equal(r.status?.state, 'muted');
  video.track.muted = false; video.track.dispatchEvent(new Event('unmute')); assert.equal(r.status?.state, 'ready');
  video.track.dispatchEvent(new Event('ended')); assert.equal(r.status?.state, 'error'); assert.equal(r.attached, null);
  r.input.dispose(); video.track.dispatchEvent(new Event('unmute')); assert.notEqual(r.status?.state, 'ready');
});

test('failed playback and already-ended streams never report a ready input or retain the device', async () => {
  for (const ended of [false, true]) {
    const video = stream(); if (ended) video.track.readyState = 'ended';
    let attached: MediaStream | null = null; let status: CaptureStatus | undefined;
    const input = createCaptureInput({ open: async () => video.media,
      attach(value) { attached = value; if (value) return Promise.reject({ name: 'NotSupportedError' }); },
      status: value => { status = value; } });
    input.select('card', true); await flush();
    assert.equal(status?.state, 'error'); assert.equal(attached, null); assert.equal(video.track.stopped, 1);
    input.dispose();
  }
});

test('a stale playback rejection cannot disconnect the replacement input', async () => {
  const old = stream(); const next = stream(); let rejectOld!: (error: unknown) => void;
  let attached: MediaStream | null = null; let status: CaptureStatus | undefined;
  const input = createCaptureInput({ open: async id => id === 'old' ? old.media : next.media,
    attach(value) { attached = value; if (value === old.media) return new Promise<void>((_resolve, reject) => { rejectOld = reject; }); },
    status: value => { status = value; } });
  input.select('old', true); await flush(); input.select('next', true); await flush();
  rejectOld(new Error('late')); await flush();
  assert.equal(attached, next.media); assert.equal(status?.state, 'ready'); assert.equal(next.track.stopped, 0);
  input.dispose();
});

test('stored device assignments validate distinct explicit devices without fallback to a default camera', () => {
  assert.deepEqual(parseVideoInputs({ left: 'card-1', right: 'card-2' }), { left: 'card-1', right: 'card-2' });
  assert.deepEqual(parseVideoInputs({ left: '', right: '' }), { left: '', right: '' });
  for (const value of [null, [], {}, { left: 'card', right: 'card' }, { left: 1, right: '' }, { left: 'x'.repeat(513), right: '' }]) {
    assert.throws(() => parseVideoInputs(value));
  }
});

test('live capture freezes at round completion and cannot draw results or a newer round under celebrations', () => {
  const state = structuredClone(applySnapshot(null, sample('gs2-ws-DuelStarted.json')).state!);
  const f: RenderFrame = { state, views: seedViews(state), source: 'video', displayedRound: state.round,
    projection: { phase: 'live', answer: null, players: [], remainingMs: null } };
  assert.equal(captureFrameMode(f), 'live');
  f.projection.remainingMs = 1; assert.equal(captureFrameMode(f), 'live');
  f.projection.remainingMs = 0; assert.equal(captureFrameMode(f), 'frozen', 'deadline freezes before result telemetry arrives');
  f.projection.remainingMs = null; assert.equal(captureFrameMode(f), 'live', 'untimed rounds do not freeze early');
  assert.equal(captureFrameMode({ ...f, frozen: true }), 'frozen');
  f.state.players.forEach(player => player.guesses.push({ round: state.round, lat: 0, lng: 0, score: 0, distanceM: 0, createdAtMs: 1 }));
  assert.equal(captureFrameMode(f), 'frozen');
  f.state.players.forEach(player => { player.guesses = []; });
  f.state.rounds[0].endAtMs = Date.now() + 60000;
  assert.equal(captureFrameMode(f), 'live', 'endAtMs may be the future round deadline');
  f.state.round++; assert.equal(captureFrameMode(f), 'hidden');
  for (const phase of ['pre-round', 'results-transition', 'results-reveal', 'waiting-host', 'finished', 'aborted'] as const) {
    assert.equal(captureFrameMode({ ...f, projection: { ...f.projection, phase } }), 'hidden');
  }
  assert.equal(captureFrameMode(null), 'hidden');
  assert.equal(captureFrameMode({ ...f, source: 'chroma' }), 'hidden');
});
