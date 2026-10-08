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
  let attached: MediaStream | null = null; let status: CaptureStatus | undefined;
  const input = createCaptureInput({
    open: id => new Promise((resolve, reject) => requests.push({ id, resolve, reject })),
    attach: value => { attached = value; }, status: value => { status = value; },
  });
  return { input, requests, get attached() { return attached; }, get status() { return status; } };
}

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
