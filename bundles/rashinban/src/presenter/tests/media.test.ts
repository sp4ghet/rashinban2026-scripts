import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPTY_MEDIA, parseMedia } from '../media.ts';

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
