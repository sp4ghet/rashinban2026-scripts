import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPTY_MEDIA, parseMedia } from '../media.ts';
import * as mediaModule from '../media.ts';
import { boundMediaState, changedVideoBindings } from '../../config/media-url.ts';

const valid = () => ({ ...structuredClone(EMPTY_MEDIA), stems: [{ id: 'rhythm', url: '/assets/rashinban/music/rhythm.wav', loopStartS: 0, loopEndS: 8, gains: { idle: 0.2, round: 0.5, urgent: 1, results: 0 } }], fiveK: { single: { url: '/assets/rashinban/video/single.webm', watchdogMs: 5000, soundtrack: 'embedded' }, double: null } });
test('empty media is silent; local media preserves loops, gains and separate variants', () => {
  assert.deepEqual(parseMedia(EMPTY_MEDIA), EMPTY_MEDIA);
  assert.deepEqual(parseMedia(valid()), valid());
});
test('round-start accepts a local effect asset', () => {
  const media = { ...structuredClone(EMPTY_MEDIA), sounds: { 'round-start': '/assets/rashinban/effects/round-reveal.wav' } };
  assert.deepEqual(parseMedia(media), media);
});
test('rejects missing or duplicate IDs, invalid loops, gains, watchdog and soundtrack combinations', () => {
  for (const patch of [{ id: '' }, { id: undefined }, { loopStartS: -1 }, { loopEndS: 0 }, { gains: { idle: 2, round: 0, urgent: 0, results: 0 } }]) {
    const v = valid(); Object.assign(v.stems[0]!, patch); assert.throws(() => parseMedia(v));
  }
  const duplicate = valid(); duplicate.stems.push(duplicate.stems[0]!); assert.throws(() => parseMedia(duplicate));
  for (const patch of [{ watchdogMs: Infinity }, { watchdogMs: 0 }, { watchdogMs: 120001 }, { soundtrack: 'cue' }, { soundtrack: 'both' }]) {
    const v = valid(); Object.assign(v.fiveK.single!, patch); assert.throws(() => parseMedia(v));
  }
  const cue = valid(); cue.fiveK.single.soundtrack = 'cue'; cue.sounds = { 'five-k': '/assets/rashinban/effects/cue.wav' };
  assert.deepEqual(parseMedia(cue), cue);
});
test('rejects remote, cross-category, traversal and noncanonical asset URLs', () => {
  for (const url of ['https://example.com/a.webm', '//example.com/a.webm', '/assets/other/video/a.webm', '/assets/rashinban/music/a.webm', '/assets/rashinban/video/../a.webm', '/assets/rashinban/video/%2e%2e', '/assets/rashinban/video/a%2fb.webm', '/assets/rashinban/video/a%5cb.webm', '/assets/rashinban/video/a.webm?token=1', '/assets/rashinban/video/a.webm#x']) {
    const v = valid(); v.fiveK.single.url = url; assert.throws(() => parseMedia(v), url);
  }
});
test('an optional end fade is preserved and bounded like the context fades', () => {
  const ended = { ...valid(), fadeMs: { ...EMPTY_MEDIA.fadeMs, end: 4000 } };
  assert.deepEqual(parseMedia(ended), ended);
  for (const end of [-1, 120001, Infinity, '4000']) assert.throws(() => parseMedia({ ...valid(), fadeMs: { ...EMPTY_MEDIA.fadeMs, end } }));
});

test('celebrations preserve optional LED URLs and validate them as local video assets', () => {
  const value = valid();
  const single = { ...value.fiveK.single, ledUrl: '/assets/rashinban/video/single-led.webm' };
  const media = { ...value, fiveK: { single, double: null } };
  assert.deepEqual(parseMedia(media), media);
  for (const ledUrl of ['', null, 'https://example.com/led.webm', '/assets/rashinban/music/led.webm', '/assets/rashinban/video/../led.webm']) {
    assert.throws(() => parseMedia({ ...media, fiveK: { single: { ...single, ledUrl }, double: null } }));
  }
});

test('each output resolves and tracks its own 5K and 10K videos without mutating saved media', () => {
  const single = { ...valid().fiveK.single, ledUrl: '/assets/rashinban/video/single-led.webm' };
  const double = { ...single, url: '/assets/rashinban/video/double.webm', ledUrl: '/assets/rashinban/video/double-led.webm' };
  const media = parseMedia({ ...valid(), fiveK: { single, double } });
  const saved = structuredClone(media);
  const stream = mediaModule.mediaForOutput(media, 'stream');
  const led = mediaModule.mediaForOutput(media, 'led');
  const inventory = [single.url, single.ledUrl, double.url, double.ledUrl].map(url => ({ url, source: 'local' as const, version: '1' }));
  for (const [effect, variant] of [['single-5k', 'single'], ['double-5k', 'double']] as const) {
    assert.equal(mediaModule.celebrationAsset(stream, effect, inventory)?.url, saved.fiveK[variant]!.url);
    assert.equal(mediaModule.celebrationAsset(stream, effect, inventory)?.soundtrack, 'embedded');
    assert.equal(mediaModule.celebrationAsset(led, effect, inventory)?.url, saved.fiveK[variant]!.ledUrl);
    assert.equal(mediaModule.celebrationAsset(led, effect, inventory)?.soundtrack, 'silent');
    assert.equal(mediaModule.celebrationAsset(led, effect, inventory.filter(item => item.url !== saved.fiveK[variant]!.ledUrl)), null);
  }
  const before = { music: [], effects: [], video: inventory };
  const after = { ...before, video: inventory.map(item => ({ ...item, version: item.url === single.ledUrl ? '2' : '1' })) };
  assert.deepEqual(changedVideoBindings(boundMediaState(stream, before), boundMediaState(stream, after)), []);
  assert.deepEqual(changedVideoBindings(boundMediaState(led, before), boundMediaState(led, after)), [single.ledUrl]);
  assert.deepEqual(media, saved);
});

test('older manifests retain their video on LED and empty effects stay empty', () => {
  const media = parseMedia(valid());
  const led = mediaModule.mediaForOutput(media, 'led');
  assert.equal(led.fiveK.single?.url, media.fiveK.single?.url);
  assert.equal(led.fiveK.single?.soundtrack, 'silent');
  assert.equal(led.fiveK.double, null);
  assert.deepEqual(mediaModule.mediaForOutput(EMPTY_MEDIA, 'led'), EMPTY_MEDIA);
});
