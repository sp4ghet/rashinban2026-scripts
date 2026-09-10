import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoPlayer, playCelebration, type VideoPort } from '../../graphics/presenter/video.ts';
import { EMPTY_MEDIA, type EffectAsset } from '../media.ts';

function port(play = async () => {}) {
  let ended = () => {}; let error = () => {}; let stops = 0;
  const value: VideoPort = { play, stop() { stops++; }, onEnded(fn) { ended = fn; }, onError(fn) { error = fn; } };
  return { value, end: () => ended(), error: () => error(), stops: () => stops };
}
test('video ended followed by error completes only once', () => {
  const p = port(); const calls: unknown[] = [];
  playCelebration(p.value, 'g', (generation, failed) => calls.push([generation, failed]));
  p.end(); p.error();
  assert.deepEqual(calls, [['g', false]]); assert.equal(p.stops(), 1);
});

test('selected video preloads, limits its watchdog by metadata, mutes cues and cancels on ownership loss or new round', async () => {
  class Video extends EventTarget {
    hidden = true; muted = true; volume = 1; src = ''; preload = ''; playsInline = false;
    duration = 2; readyState = 1; currentTime = 0; paused = true; mutedAtPlay = true; error: unknown = null;
    load() {} play() { this.paused = false; this.mutedAtPlay = this.muted; return Promise.resolve(); } pause() { this.paused = true; }
    remove() {} removeAttribute() {}
  }
  const videos: Video[] = []; const timers: { fn: () => void; ms: number; active: boolean }[] = [];
  const player = createVideoPlayer(() => { const v = new Video(); videos.push(v); return v as unknown as HTMLVideoElement; }, (fn, ms) => {
    const task = { fn, ms, active: true }; timers.push(task); return () => { task.active = false; };
  });
  const single: EffectAsset = { url: '/assets/rashinban/video/single.webm', watchdogMs: 8000, soundtrack: 'embedded' };
  const double: EffectAsset = { ...single, url: '/assets/rashinban/video/double.webm', soundtrack: 'cue' };
  player.preload({ ...EMPTY_MEDIA, fiveK: { single, double } });
  assert.equal(videos.length, 2); assert.equal(videos[0]!.src, single.url); assert.equal(videos[0]!.preload, 'auto');
  const calls: unknown[] = []; player.play(single, 'g', (g, failed) => calls.push([g, failed]));
  player.update('g', true, 'single-5k', false, 0.4);
  assert.equal(videos[0]!.hidden, false); assert.equal(videos[0]!.paused, false); assert.equal(videos[0]!.muted, false); assert.equal(videos[0]!.volume, 0.4);
  assert.equal(videos[0]!.mutedAtPlay, false, 'request the intended audio at play so autoplay denial rejects rather than silently pausing on unmute');
  assert.equal(timers.find(t => t.active)!.ms, 3000);
  player.update('g', true, 'single-5k', true, 0.2); assert.equal(videos[0]!.muted, true);
  player.update('new', true, 'single-5k', false, 1); videos[0]!.dispatchEvent(new Event('ended'));
  assert.equal(calls.length, 0); assert.equal(videos[0]!.hidden, true); assert.equal(videos[0]!.paused, true);
  player.play(double, 'new', (g, failed) => calls.push([g, failed])); player.update('new', true, 'double-5k', false, 1);
  assert.equal(videos[1]!.muted, true); assert.equal(videos[1]!.hidden, false);
  player.update('new', false, 'double-5k', false, 1); videos[1]!.dispatchEvent(new Event('error')); assert.equal(calls.length, 0);
  player.play(single, 'third', (g, failed) => calls.push([g, failed])); timers.find(t => t.active)!.fn();
  assert.deepEqual(calls, [['third', true]]); assert.equal(videos[0]!.hidden, true);
  videos[0]!.duration = Infinity; player.play(single, 'invalid', (g, failed) => calls.push([g, failed]));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [['third', true], ['invalid', true]]);
  videos[0]!.readyState = 0; videos[0]!.error = { code: 4 };
  player.play(single, 'preload-error', (g, failed) => calls.push([g, failed]));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 3); assert.equal(videos[0]!.hidden, true); player.dispose();
});
test('autoplay rejection completes as failure and cancellation suppresses late events', async () => {
  const p = port(async () => { throw new Error('autoplay denied'); }); const calls: boolean[] = [];
  playCelebration(p.value, 'g', (_g, failed) => calls.push(failed));
  await new Promise(resolve => setImmediate(resolve)); p.end();
  assert.deepEqual(calls, [true]);
  const canceled = port(); const cancel = playCelebration(canceled.value, 'old', () => calls.push(false));
  cancel(); cancel(); canceled.end(); canceled.error();
  assert.deepEqual(calls, [true]); assert.equal(canceled.stops(), 1);
});
