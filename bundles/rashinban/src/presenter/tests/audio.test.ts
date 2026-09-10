import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudio, stemOffset } from '../../graphics/presenter/audio.ts';
import { EMPTY_MEDIA, type MediaManifest } from '../media.ts';
import { DEFAULT_SETTINGS } from '../settings.ts';
import { advanceTimeline } from '../timeline.ts';

// The external audio port records actual scheduling instructions. Evaluate
// automation without calling JS again to model a stalled page's audio thread.
class Param {
  value = 0; events: { value: number; at: number; ramp: boolean }[] = [];
  setValueAtTime(value: number, at: number) { this.events.push({ value, at, ramp: false }); }
  linearRampToValueAtTime(value: number, at: number) { this.events.push({ value, at, ramp: true }); }
  cancelScheduledValues(at: number) { this.events = this.events.filter(e => e.at < at); }
  cancelAndHoldAtTime(at: number) { const value = this.at(at); this.cancelScheduledValues(at); this.setValueAtTime(value, at); }
  at(time: number) { let value = this.value; let at = 0; for (const e of this.events) { if (e.at > time) return e.ramp ? value + (e.value - value) * (time - at) / (e.at - at) : value; value = e.value; at = e.at; } return value; }
}
function port() {
  const gains: { gain: Param; connect(to: unknown): void; disconnect(): void }[] = [];
  const sources: any[] = [];
  const context = { currentTime: 10, state: 'running', baseLatency: 0, outputLatency: 0, destination: {},
    createGain() { const gain = { gain: new Param(), connect() {}, disconnect() {} }; gains.push(gain); return gain; },
    createBufferSource() { const source = { buffer: null, loop: false, loopStart: 0, loopEnd: 0, playbackRate: { value: 1 }, starts: [] as number[][], stops: 0,
      connect(to: unknown) { this.output = to; }, output: null as unknown, disconnect() {}, start(...args: number[]) { this.starts.push(args); }, stop() { this.stops++; } }; sources.push(source); return source; },
    async decodeAudioData(bytes: ArrayBuffer) { return { duration: new Uint8Array(bytes)[0], sampleRate: 48000 }; },
  };
  const fetchAsset = async (url: string) => { if (url.endsWith('missing')) throw Error(); return { ok: true, arrayBuffer: async () => new Uint8Array([url.endsWith('short') ? 3 : 12]).buffer }; };
  return { context, gains, sources, audio: createAudio(context as unknown as AudioContext, fetchAsset as unknown as typeof fetch) };
}
const manifest: MediaManifest = { ...EMPTY_MEDIA, fadeMs: { idle: 100, round: 500, urgent: 1000, results: 200 }, stems: [
  { id: 'base', url: '/base', loopStartS: 2, loopEndS: 10, gains: { idle: 0, round: 1, urgent: 1, results: 0.3 } },
  { id: 'urgent', url: '/urgent', loopStartS: 0, loopEndS: 8, gains: { idle: 0, round: 0, urgent: 0.8, results: 0 } },
] };
const timeline = { ...advanceTimeline(null, null, 1000, false, DEFAULT_SETTINGS.timing), gameId: 'game', musicEpochMs: 1000, music: 'round' as const, phase: 'live' as const };
test('reloaded stem rejoins the shared loop phase', () => { assert.equal(stemOffset(1000, 13500, 2, 10), 6.5); assert.equal(stemOffset(2000, 1000, 2, 10), 9); });
test('all stems share a scheduled start and muted layers advance through context fades', async () => {
  const p = port(); await p.audio.load(manifest); p.audio.lease(20000, 13500); p.audio.sync(timeline, DEFAULT_SETTINGS, 13500);
  assert.equal(p.sources.length, 2); const [base, urgent] = p.sources;
  assert.equal(base.starts[0][0], urgent.starts[0][0]); assert.ok(base.starts[0][0] > 10);
  assert.ok(Math.abs(base.starts[0][1] - (6.5 + base.starts[0][0] - 10)) < 1e-9);
  assert.equal(urgent.output.gain.at(11), 0); assert.equal(base.output.gain.at(11), 0.7);
  p.context.currentTime = 11; p.audio.sync({ ...timeline, music: 'urgent' }, DEFAULT_SETTINGS, 14500);
  assert.equal(p.sources.length, 2); assert.equal(urgent.stops, 0); assert.ok(Math.abs(urgent.output.gain.at(11.5) - 0.28) < 1e-9);
  assert.ok(Math.abs(urgent.output.gain.at(12) - 0.56) < 1e-9); assert.ok(p.sources.every(s => s.playbackRate.value === 1));
  p.context.currentTime = 12; p.audio.sync({ ...timeline, phase: 'aborted' }, DEFAULT_SETTINGS, 15500);
  assert.equal(base.output.gain.at(13), 0); assert.equal(p.sources.length, 2);
});
test('invalid decoded bounds, mismatched loops and missing assets stay silent with status', async () => {
  const p = port(); await p.audio.load({ ...manifest, stems: [...manifest.stems,
    { ...manifest.stems[0], id: 'missing', url: '/missing' }, { ...manifest.stems[0], id: 'short', url: '/short' },
    { ...manifest.stems[0], id: 'different', loopEndS: 9 }] });
  p.audio.lease(20000, 13500); p.audio.sync(timeline, DEFAULT_SETTINGS, 13500);
  assert.equal(p.sources.length, 2); assert.deepEqual(p.audio.status().missing, ['missing', 'short', 'different']);
});
test('asset replacement and new game clean up sources and recover phase', async () => {
  const p = port(); await p.audio.load(manifest); p.audio.lease(20000, 13500); p.audio.sync(timeline, DEFAULT_SETTINGS, 13500);
  const original = [...p.sources]; await p.audio.load(EMPTY_MEDIA); assert.ok(original.every(s => s.stops === 1));
  await p.audio.load(manifest); p.audio.sync(timeline, DEFAULT_SETTINGS, 14500); assert.equal(p.sources.length, 4);
  p.audio.sync({ ...timeline, gameId: 'new', musicEpochMs: 14500 }, DEFAULT_SETTINGS, 14500);
  assert.equal(p.sources.length, 6); assert.ok(p.sources.slice(2, 4).every(s => s.stops === 1));
  p.audio.stop(); assert.ok(p.sources.every(s => s.stops === 1));
});
test('audio clock gate closes before lease expiry without any JS callback; renewal cannot leave an old cutoff', async () => {
  const p = port(); await p.audio.load(manifest); p.audio.lease(16000, 10000); p.audio.sync(timeline, DEFAULT_SETTINGS, 10000);
  const gate = p.gains[0].gain; assert.equal(gate.at(14), 1); assert.equal(gate.at(16), 0);
  p.context.currentTime = 12; p.audio.lease(18000, 12000); assert.equal(gate.at(15.5), 1); assert.equal(gate.at(18), 0);
  p.audio.stop(); assert.equal(gate.at(12), 0);
});

test('suspended context creates no sources; late decode cannot restore replaced assets', async () => {
  const p = port(); let finish!: (value: ArrayBuffer) => void;
  const fetchAsset = async () => ({ ok: true, arrayBuffer: () => new Promise<ArrayBuffer>(resolve => { finish = resolve; }) });
  const audio = createAudio(p.context as unknown as AudioContext, fetchAsset as unknown as typeof fetch);
  const loading = audio.load({ ...manifest, stems: [manifest.stems[0]] }); await Promise.resolve();
  await audio.load(EMPTY_MEDIA); finish(new Uint8Array([12]).buffer); await loading;
  audio.lease(20000, 13500); audio.sync(timeline, DEFAULT_SETTINGS, 13500); assert.equal(p.sources.length, 0);
  await p.audio.load(manifest); p.context.state = 'suspended'; p.audio.lease(20000, 13500); p.audio.sync(timeline, DEFAULT_SETTINGS, 13500);
  assert.equal(p.sources.length, 0); assert.equal(p.audio.status().state, 'suspended');
});

test('lease closure also reserves reported device buffering before an expired owner can be replaced', async () => {
  const p = port(); p.context.outputLatency = 1.5;
  await p.audio.load(manifest); p.audio.lease(16000, 10000); p.audio.sync(timeline, DEFAULT_SETTINGS, 10000);
  assert.equal(p.gains[0].gain.at(13), 1); assert.equal(p.gains[0].gain.at(14), 0);
});

test('operator mute silences immediately while loop sources keep advancing', async () => {
  const p = port(); await p.audio.load(manifest); p.audio.lease(20000, 13500); p.audio.sync(timeline, DEFAULT_SETTINGS, 13500);
  p.context.currentTime = 11;
  p.audio.sync(timeline, { ...DEFAULT_SETTINGS, muted: true }, 14500);
  assert.equal(p.sources[0].output.gain.at(11), 0); assert.ok(p.sources.every(s => s.stops === 0));
  p.context.currentTime = 12; p.audio.sync(timeline, DEFAULT_SETTINGS, 15500);
  assert.equal(p.sources.length, 2); assert.equal(p.sources[0].output.gain.at(13), 0.7);
});
