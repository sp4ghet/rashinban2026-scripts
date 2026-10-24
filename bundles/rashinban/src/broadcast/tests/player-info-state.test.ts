import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, withDefaults, setPreview, take, clearPreview, revertPreview, swap } from '../state.ts';
import { controlRows, patchAt, monitorUrls } from '../switcher-model.ts';

test('player introductions are independent, staged, persistent and clearable', () => {
  const initial = withDefaults(undefined);
  assert.deepEqual((initial.stream.preview as any).playerInfo, { visible: false, playerId: '', page: 'results' });
  let state = setPreview(initial, 'stream', { playerInfo: { visible: true, playerId: 'tag:meishin', page: 'profile' } } as any);
  assert.equal((state.stream.program as any).playerInfo.visible, false);
  state = take(state, 'stream');
  assert.deepEqual(state.en, initial.en);
  assert.deepEqual(state.led, initial.led);
  const cleared = clearPreview(state, 'stream');
  assert.equal((cleared.stream.preview as any).playerInfo.visible, false);
  assert.equal((cleared.stream.preview as any).playerInfo.playerId, 'tag:meishin');
  assert.deepEqual(revertPreview(cleared, 'stream').stream.preview, state.stream.program);
  assert.deepEqual(swap(cleared, 'stream').stream.preview, state.stream.program);
  assert.throws(() => setPreview(initial, 'en', { playerInfo: { page: 'bad' } } as any));
});

test('cue 24 enables player info and navigation disables it atomically like bracket', () => {
  let state = createInitialState();
  state = setPreview(state, 'stream', patchAt(['slides', 'mode'], 'day2-opening', state.stream.preview));
  state = setPreview(state, 'stream', patchAt(['slides', 'index'], 23, state.stream.preview));
  assert.equal((state.stream.preview as any).playerInfo.visible, true);
  state = take(state, 'stream');
  state = setPreview(state, 'stream', patchAt(['slides', 'index'], 24, state.stream.preview));
  assert.equal((state.stream.preview as any).playerInfo.visible, false);
  assert.equal((state.stream.program as any).playerInfo.visible, true);
  for (const scene of ['bracket', 'interval']) {
    const next = setPreview(state, 'stream', patchAt([scene, 'visible'], true, state.stream.preview));
    assert.equal((next.stream.preview as any).playerInfo.visible, false);
  }
  const direct = setPreview(state, 'stream', patchAt(['playerInfo', 'visible'], true, state.stream.preview));
  assert.equal(direct.stream.preview.slides.visible, false);
  assert.equal(direct.stream.preview.bracket.visible, false);
  assert.equal(direct.stream.preview.interval.visible, false);
});

test('player info row follows Slides and EN has an independent source', () => {
  const ids = controlRows('stream').map(row => row.id);
  assert.equal(ids[ids.indexOf('slides') + 1], 'playerInfo');
  assert.ok(controlRows('en').some(row => row.id === 'playerInfo'));
  assert.ok(!controlRows('led').some(row => row.id === 'playerInfo'));
  assert.match(monitorUrls('en', 'preview', 'player-info' as any).info, /player-info-en.html\?channel=preview/);
});
