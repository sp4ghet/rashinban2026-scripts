import assert from 'node:assert/strict';
import test from 'node:test';
import { parseVideoInputs } from '../../graphics/presenter/capture.ts';

test('relay input assignments retain optional cameras and load existing two-feed selections', () => {
  assert.deepEqual(parseVideoInputs({ left: 'screen-a', right: 'screen-b' }, true),
    { left: 'screen-a', right: 'screen-b', 'camera-left': '', 'camera-right': '' });
  assert.deepEqual(parseVideoInputs({ left: '', right: '', 'camera-left': 'webcam-a', 'camera-right': 'webcam-b' }, true),
    { left: '', right: '', 'camera-left': 'webcam-a', 'camera-right': 'webcam-b' });
});

test('a physical input cannot be assigned to both a screen and a player camera', () => {
  assert.throws(() => parseVideoInputs({ left: 'input-a', right: 'input-b', 'camera-left': 'input-a', 'camera-right': '' }, true));
  assert.throws(() => parseVideoInputs({ left: '', right: '', 'camera-left': 'input-a', 'camera-right': 'input-a' }, true));
  assert.throws(() => parseVideoInputs({ left: '', right: '', 'camera-left': 5 }, true));
  assert.throws(() => parseVideoInputs({ left: '', right: '', 'camera-left': 'x'.repeat(513) }, true));
});
