import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudio, stemOffset } from '../../graphics/presenter/audio.ts';
import { EMPTY_MEDIA, type MediaManifest } from '../media.ts';
import { DEFAULT_SETTINGS } from '../settings.ts';
import { advanceTimeline } from '../timeline.ts';
import { applySnapshot } from '../normalize.ts';
import { loadReplay } from '../../extension/presenter/replay.ts';
import { finishEffect } from '../timeline.ts';

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
      connect(to: unknown) { this.output = to; }, output: null as unknown, disconnect() {}, start(...args: number[]) { this.starts.push(args); }, stopTimes: [] as number[], stop(at?: number) { this.stops++; if (at !== undefined) this.stopTimes.push(at); } }; sources.push(source); return source; },
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

test('equal-gain context transition applies its authored fade without restarting unchanged-context ramps', async () => {
  const p = port();
  await p.audio.load({ ...manifest, stems: [manifest.stems[0]], fadeMs: { ...manifest.fadeMs, round: 120000, urgent: 0 } });
  p.audio.lease(20000, 13500); p.audio.sync(timeline, DEFAULT_SETTINGS, 13500);
  const gain = p.sources[0].output.gain;
  p.context.currentTime = 10.5; p.audio.sync(timeline, DEFAULT_SETTINGS, 14000);
  assert.ok(Math.abs(gain.at(11) - 0.005833333333333333) < 1e-12, 'repeated round sync keeps the original 120-second ramp');
  p.context.currentTime = 11; p.audio.sync({ ...timeline, music: 'urgent' }, DEFAULT_SETTINGS, 14500);
  assert.equal(gain.at(11), 0.7, 'urgent zero-duration fade reaches the same target immediately');
  assert.equal(p.sources.length, 1); assert.equal(p.sources[0].stops, 0);
});

const cueMedia: MediaManifest = { ...EMPTY_MEDIA, sounds: { pin: '/pin', guess: '/guess', countdown: '/tick', results: '/results', count: '/count', damage: '/damage', 'five-k': '/five-k' } };
test('opponent submission uses its own asset regardless of which sound plays first', async () => {
  for (const opponentFirst of [false,true]) {
    const p = port(); await p.audio.load({ ...EMPTY_MEDIA, sounds: { guess: '/own-short', 'opponent-guess': '/opponent' } }); p.audio.lease(30000,1000);
    const own = cue('own','guess',1200); const opponent = { ...cue('opponent','guess',1300), sound:'opponent-guess' as const };
    const cues = opponentFirst ? [opponent,own] : [own,opponent];
    p.audio.sync({...timeline,cues},DEFAULT_SETTINGS,1000);
    assert.deepEqual(p.sources.map(s=>s.buffer.duration),opponentFirst?[12,3]:[3,12]);
  }
});
test('preview tick plays once at researched gain and finishes when live begins', async () => {
  const p = port(); await p.audio.load({ ...EMPTY_MEDIA, sounds: { 'pre-round-tick': '/tick' } }); p.audio.lease(20000,1000);
  const t = { ...timeline, phase: 'pre-round' as const, cues: [cue('one', 'pre-round-tick', 1000)] };
  p.audio.sync(t, DEFAULT_SETTINGS, 1000); p.audio.sync(t, DEFAULT_SETTINGS, 1000);
  assert.equal(p.sources.length,1); assert.equal(p.sources[0].output.gain.at(10), DEFAULT_SETTINGS.effectsGain * 1.3);
  p.context.currentTime = 11; p.audio.sync({ ...t, phase: 'live', cues: [] }, DEFAULT_SETTINGS, 2000);
  assert.equal(p.sources[0].stops,0);
  p.audio.sync({ ...t, phase: 'live', cues: [] }, { ...DEFAULT_SETTINGS, muted: true }, 2000);
  assert.equal(p.sources[0].output.gain.at(11),0);
});
test('continuous countdown seeks on late entry, fades on early results, and skips stale tails', async () => {
  const p = port(); await p.audio.load(cueMedia); p.audio.lease(30000, 8000);
  const t = { ...timeline, cues: [cue('continuous', 'countdown', 1000, 16000)] };
  p.audio.sync(t, DEFAULT_SETTINGS, 8000);
  assert.equal(p.sources.length, 1);
  assert.deepEqual(p.sources[0].starts[0], [10, 7]);
  p.context.currentTime = 11;
  p.audio.sync({ ...t, phase: 'results-transition', cues: [] }, DEFAULT_SETTINGS, 9000);
  assert.equal(p.sources[0].stops, 1);
  assert.deepEqual(p.sources[0].stopTimes, [12]);
  const stale = port(); await stale.audio.load(cueMedia); stale.audio.lease(30000, 17000);
  stale.audio.sync(t, DEFAULT_SETTINGS, 17000); assert.equal(stale.sources.length, 0);
  const short = port(); await short.audio.load(cueMedia); short.audio.lease(30000, 1000);
  short.audio.sync({ ...t, cues: [{ ...cue('short', 'countdown', 1000, 11000), offsetS: 5 }] }, DEFAULT_SETTINGS, 1000);
  assert.deepEqual(short.sources[0].starts[0], [10, 5]);
  const pending = port(); await pending.audio.load(cueMedia); pending.audio.lease(30000, 1000);
  pending.audio.sync({ ...t, cues: [cue('pending', 'countdown', 5000, 20000)] }, DEFAULT_SETTINGS, 1000);
  pending.audio.sync({ ...t, phase: 'results-transition', cues: [] }, DEFAULT_SETTINGS, 1100);
  assert.equal(pending.sources[0].stops, 1);
});
test('timeout plays the unmodified countdown ending; early second lock-in fades once', async () => {
  for (const early of [false,true]) {
    const p = port(); await p.audio.load(cueMedia); p.audio.lease(40000,1000);
    const t = { ...timeline, cues: [cue('timer','countdown',1000,10000)] };
    p.audio.sync(t,DEFAULT_SETTINGS,1000);
    const envelope = p.gains[2].gain;
    assert.equal(envelope.at(10),0); assert.equal(envelope.at(10.2),1);
    if (early) {
      const observed = { a:{guessed:true,pin:null,pinCueAtMs:null}, b:{guessed:true,pin:null,pinCueAtMs:null} };
      p.context.currentTime=12; p.audio.sync({...t,observed},DEFAULT_SETTINGS,3000);
      assert.deepEqual(p.sources[0].stopTimes,[13]);
      p.context.currentTime=12.5; p.audio.sync({...t,observed},DEFAULT_SETTINGS,3500);
      assert.equal(envelope.at(12.5),0.5); assert.equal(envelope.at(13),0);
      assert.deepEqual(p.sources[0].stopTimes,[13],'repeated state must not extend the fade');
    } else {
      p.context.currentTime=19; p.audio.sync({...t,phase:'results-transition',cues:[]},DEFAULT_SETTINGS,10000);
      assert.equal(p.sources[0].stops,0,'timeout preserves the tail');
      assert.equal(envelope.at(21),1); assert.equal(envelope.at(21.5),1); assert.equal(envelope.at(21.999),1);
      p.context.currentTime=21.5; p.audio.sync({...t,phase:'results-reveal',cues:[]},{...DEFAULT_SETTINGS,muted:true},12500);
      assert.equal(p.sources[0].output.gain.at(21.5),0);
      assert.equal(envelope.at(21.999),1,'mute uses the volume gate, without modifying the authored ending');
    }
  }
});
test('second guess cancels a pending countdown and prevents a new owner starting it', async () => {
  const p = port(); await p.audio.load(cueMedia); p.audio.lease(30000,1000);
  const t = {...timeline,cues:[cue('pending','countdown',1500,16500)]};
  p.audio.sync(t,DEFAULT_SETTINGS,1000);
  const locked = {...t,observed:{a:{guessed:true,pin:null,pinCueAtMs:null},b:{guessed:true,pin:null,pinCueAtMs:null}}};
  p.context.currentTime=10.1; p.audio.sync(locked,DEFAULT_SETTINGS,1100);
  assert.equal(p.sources[0].stops,1); assert.deepEqual(p.sources[0].stopTimes,[],'pending clip cancels immediately');
  const newcomer=port(); await newcomer.audio.load(cueMedia); newcomer.audio.lease(30000,1100);
  newcomer.audio.sync(locked,DEFAULT_SETTINGS,1100); assert.equal(newcomer.sources.length,0);
});
test('actual second lock-in finishes across results; guesses first seen in timeout results stay silent', async () => {
  for (const perfect of [false, true]) for (const coalesced of [false, true]) {
    const rows = loadReplay('gs2-ws-presenter-showcase.json');
    const result = structuredClone(applySnapshot(null, rows.find(row => (row.message as { code: string }).code === 'DuelRoundTimedOut')!.message).state!);
    if (!perfect) result.players[0].results[0].score = 4999;
    result.rounds[0].startAtMs = 0; result.rounds[0].endAtMs = 100000;
    const live = structuredClone(result);
    live.players.forEach(player => { player.results = []; });
    live.players[1].guesses = [];
    const p = port(); await p.audio.load({ ...EMPTY_MEDIA, sounds: { guess: '/guess', 'opponent-guess': '/opponent' } }); p.audio.lease(30000, 1000);
    let t = advanceTimeline(null, live, 1000, true, DEFAULT_SETTINGS.timing);
    p.audio.sync(t, DEFAULT_SETTINGS, 1000);
    if (!coalesced) {
      live.players[1].guesses = structuredClone(result.players[1].guesses);
      t = advanceTimeline(t, live, 1100, false, DEFAULT_SETTINGS.timing);
      p.context.currentTime = 10.1; p.audio.sync(t, DEFAULT_SETTINGS, 1100);
    }
    t = advanceTimeline(t, result, 1150, false, DEFAULT_SETTINGS.timing);
    p.context.currentTime = 10.15; p.audio.sync(t, DEFAULT_SETTINGS, 1150);
    if (coalesced) {
      assert.equal(p.sources.length, 0, 'timeout result guesses are not submission events');
      assert.equal(t.cues.some(cue => cue.kind === 'guess'), false);
      continue;
    }
    assert.equal(p.sources.length, 1, `lock-in must exist: perfect=${perfect}, coalesced=${coalesced}`);
    const sound = p.sources[0];
    assert.equal(sound.stops, 0, 'results must not cancel the pending lock-in');
    if (perfect) t = finishEffect(t, t.generation, 1350, DEFAULT_SETTINGS.timing);
    p.context.currentTime = 10.4; p.audio.sync(t, DEFAULT_SETTINGS, 1400);
    t = advanceTimeline(t, result, 2000, false, DEFAULT_SETTINGS.timing);
    p.context.currentTime = 11; p.audio.sync(t, DEFAULT_SETTINGS, 2000);
    assert.equal(sound.stops, 0, 'started one-shot must run to its natural end');
    assert.equal(p.sources.length, 1, 'lock-in must not be replayed');
    p.audio.stop(); assert.equal(sound.stops, 1, 'explicit audio shutdown still cancels sound');
    const adopted = advanceTimeline(null, result, 2000, true, DEFAULT_SETTINGS.timing);
    assert.equal(adopted.cues.some(cue => cue.kind === 'guess'), false, 'joining results must not replay old guesses');
  }
});
function cue(id: string, kind: import('../../types/presenter.ts').CueKind, atMs: number, untilMs = atMs + 250) { return { id, kind, atMs, untilMs, playerId: null }; }
test('audio schedules future cues against shared clock once and cancels replaced countdowns', async () => {
  const p = port(); await p.audio.load(cueMedia); p.audio.lease(20000, 1000);
  const t = { ...timeline, cues: [cue('tick', 'countdown', 3000)] };
  p.audio.sync(t, DEFAULT_SETTINGS, 1000); p.audio.sync(t, DEFAULT_SETTINGS, 1000);
  assert.equal(p.sources.length, 1); assert.deepEqual(p.sources[0].starts[0], [12, 0]);
  assert.equal(p.sources[0].output.gain.at(10), DEFAULT_SETTINGS.effectsGain);
  p.audio.sync({ ...t, cues: [cue('shorter', 'countdown', 2500)] }, DEFAULT_SETTINGS, 1000);
  assert.equal(p.sources[0].stops, 1); assert.equal(p.sources.length, 2);
  assert.equal(p.sources[1].starts[0][0], 11.5);
  p.audio.sync({ ...t, generation: 'new', cues: [] }, DEFAULT_SETTINGS, 1000);
  assert.equal(p.sources[1].stops, 1);
});
test('new audio owner skips historical one-shots, joins only remaining count and cancels on stop', async () => {
  const p = port(); await p.audio.load(cueMedia); p.audio.lease(20000, 1100);
  p.audio.sync({ ...timeline, damageAtMs: 3000, cues: [cue('past', 'guess', 1000), cue('count', 'count', 1000, 3000), cue('expired', 'pin', 0)] }, DEFAULT_SETTINGS, 1100);
  assert.equal(p.sources.length, 1); assert.equal(p.sources[0].loop, true);
  assert.deepEqual(p.sources[0].starts[0], [10, 0.1]); assert.deepEqual(p.sources[0].stopTimes, [11.9]);
  p.audio.stop(); assert.equal(p.sources[0].stops, 2);
  p.audio.lease(20000, 1600); p.audio.sync({ ...timeline, damageAtMs: 3000, cues: [cue('count', 'count', 1000, 3000)] }, DEFAULT_SETTINGS, 1600);
  assert.equal(p.sources.length, 2); assert.equal(p.sources[1].starts[0][1], 0.6);
});
test('lease is mandatory for cues, future reacquisition remains schedulable and mute affects existing sounds', async () => {
  const p = port(); await p.audio.load(cueMedia); const t = { ...timeline, cues: [cue('future', 'guess', 3000)] };
  p.audio.sync(t, DEFAULT_SETTINGS, 1000); assert.equal(p.sources.length, 0);
  p.audio.lease(20000, 1000); p.audio.sync(t, DEFAULT_SETTINGS, 1000); p.audio.stop();
  p.audio.lease(20000, 1500); p.audio.sync(t, DEFAULT_SETTINGS, 1500); assert.equal(p.sources.length, 2);
  p.audio.sync(t, { ...DEFAULT_SETTINGS, muted: true }, 1500); assert.equal(p.sources[1].output.gain.at(10), 0);
});
test('five-k uses exactly cue soundtrack and stops when celebration disappears', async () => {
  for (const soundtrack of ['embedded', 'silent', 'cue'] as const) {
    const p = port(); await p.audio.load({ ...cueMedia, fiveK: { single: { url: '/video', watchdogMs: 10000, soundtrack }, double: null } });
    p.audio.lease(20000, 1000); const t = { ...timeline, effect: 'single-5k' as const, cues: [cue('5k', 'five-k', 1200, 11200)] };
    p.audio.sync(t, DEFAULT_SETTINGS, 1000); assert.equal(p.sources.length, soundtrack === 'cue' ? 1 : 0);
    p.audio.sync({ ...t, effect: 'none', cues: [] }, DEFAULT_SETTINGS, 1000);
    if (soundtrack === 'cue') assert.equal(p.sources[0].stops, 2);
  }
});
test('missing cue asset reports sanitized status while other cues remain usable', async () => {
  const p = port(); await p.audio.load({ ...EMPTY_MEDIA, sounds: { pin: '/missing', guess: '/guess' } });
  assert.equal(p.audio.status().state, 'partial'); assert.deepEqual(p.audio.status().missing, ['sound-pin']);
});


test('an already sounding one-shot finishes its asset after its scheduling record expires', async () => {
  const p = port(); await p.audio.load(cueMedia); p.audio.lease(20000, 1000);
  p.audio.sync({ ...timeline, cues: [cue('pin', 'pin', 1200)] }, DEFAULT_SETTINGS, 1000);
  p.context.currentTime = 11; p.audio.sync({ ...timeline, cues: [] }, DEFAULT_SETTINGS, 2000);
  assert.equal(p.sources[0].stops, 0);
});
test('far-future cues wait for renewable lease coverage and missed one-shots never burst on resume', async () => {
  const p = port(); await p.audio.load(cueMedia); p.audio.lease(7000, 1000);
  const t = { ...timeline, cues: [cue('future', 'countdown', 10000), cue('missed', 'countdown', 8000)] };
  p.audio.sync(t, DEFAULT_SETTINGS, 1000); assert.equal(p.sources.length, 0);
  p.context.currentTime = 17.5; p.audio.lease(16000, 8500); p.audio.sync(t, DEFAULT_SETTINGS, 8500);
  assert.equal(p.sources.length, 1); assert.equal(p.sources[0].starts[0][0], 19);
});

test('renewal after the audio gate already closed cannot revive tails of previous one-shots', async () => {
  const p = port(); await p.audio.load(cueMedia); p.audio.lease(7000, 1000);
  p.audio.sync({ ...timeline, cues: [cue('guess', 'guess', 1200)] }, DEFAULT_SETTINGS, 1000);
  p.context.currentTime = 17; p.audio.lease(16000, 8000);
  p.audio.sync({ ...timeline, cues: [] }, DEFAULT_SETTINGS, 8000);
  assert.equal(p.sources[0].stops, 1);
});

test('separate celebration soundtrack cancels when the program video owner transfers and cannot replay', async () => {
  const p = port(); await p.audio.load({ ...cueMedia, fiveK: { single: { url: '/video', watchdogMs: 10000, soundtrack: 'cue' }, double: null } });
  p.audio.lease(20000, 1000);
  const t = { ...timeline, effect: 'single-5k' as const, cues: [cue('5k-owner', 'five-k', 1500, 11500)] };
  p.audio.sync(t, DEFAULT_SETTINGS, 1000, 'program-one');
  assert.equal(p.sources.length, 1);
  p.audio.sync(t, DEFAULT_SETTINGS, 1000, 'program-two');
  assert.equal(p.sources[0].stops, 2);
  p.audio.sync(t, DEFAULT_SETTINGS, 1000, 'program-two'); assert.equal(p.sources.length, 1);
  p.audio.sync({ ...t, generation: 'fresh', cues: [cue('new-5k', 'five-k', 1600, 11600)] }, DEFAULT_SETTINGS, 1000, 'program-two');
  assert.equal(p.sources.length, 2);
  p.audio.sync({ ...t, generation: 'fresh', cues: [cue('new-5k', 'five-k', 1600, 11600)] }, DEFAULT_SETTINGS, 1000, null);
  assert.equal(p.sources[1].stops, 2);
});
