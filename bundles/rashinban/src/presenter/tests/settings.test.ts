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

test('tie-range preferences migrate without resetting existing presentation settings', () => {
  const legacy = { ...DEFAULT_SETTINGS, musicGain: 0.25, muted: true } as any;
  delete legacy.tieRange;
  const migrated = parseSettings(legacy);
  assert.deepEqual(migrated.tieRange, { enabled: false, mode: 'full' });
  assert.equal(migrated.musicGain, 0.25);
  assert.equal(migrated.muted, true);
  const preferences = { enabled: true, mode: 'half' as const };
  const parsed = parseSettings({ ...DEFAULT_SETTINGS, tieRange: preferences });
  assert.deepEqual(parsed.tieRange, preferences);
  assert.notEqual(parsed.tieRange, preferences);
  for (const tieRange of [null, [], true, {}, { enabled: 1, mode: 'full' },
    { enabled: true, mode: 'third' }, { enabled: true, mode: 'full', divisor: 3 }]) {
    assert.throws(() => parseSettings({ ...DEFAULT_SETTINGS, tieRange }));
  }
});
