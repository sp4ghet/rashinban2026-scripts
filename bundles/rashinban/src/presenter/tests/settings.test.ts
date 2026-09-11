import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutKind } from '../../graphics/presenter/layout.ts';
import { DEFAULT_SETTINGS, parseSettings } from '../settings.ts';

test('chroma NMPZ uses two complete player windows', () => {
  assert.equal(layoutKind('NMPZ', 'chroma'), 'dual');
  assert.equal(layoutKind('NMPZ', 'rendered'), 'shared');
});

test('settings accept both keys and output choices without mutating input', () => {
  const value = { ...DEFAULT_SETTINGS, keyColor: '#00ff00', viewSource: 'rendered', audioOutput: 'embedded', muted: true, musicGain: 0, effectsGain: 0.5 };
  const parsed = parseSettings(value);
  assert.deepEqual(parsed, value);
  assert.notEqual(parsed.timing, value.timing);
});

test('settings reject invalid gains, key, source, output, mute and timings', () => {
  for (const patch of [
    { musicGain: -1 }, { effectsGain: 1.1 }, { musicGain: NaN }, { effectsGain: '0.5' },
    { keyColor: 'green' }, { viewSource: 'mixed' }, { audioOutput: 'both' }, { muted: 1 },
    { timing: { ...DEFAULT_SETTINGS.timing, leadMs: -1 } },
    { timing: { ...DEFAULT_SETTINGS.timing, countMs: Infinity } },
    { timing: { ...DEFAULT_SETTINGS.timing, damageMs: 120001 } },
    { cookie: 'must-not-be-accepted' },
  ]) assert.throws(() => parseSettings({ ...DEFAULT_SETTINGS, ...patch }));
  for (const input of [null, [], {}, 'chroma']) assert.throws(() => parseSettings(input));
});
