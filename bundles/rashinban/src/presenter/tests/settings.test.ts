import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutKind } from '../../graphics/presenter/layout.ts';
import { DEFAULT_SETTINGS, parseSettings } from '../settings.ts';
import { parseApplicationConfig } from '../../config/schema.ts';

test('chroma NMPZ uses two complete player windows', () => {
  assert.equal(layoutKind('NMPZ', 'chroma'), 'dual');
  assert.equal(layoutKind('NMPZ', 'rendered'), 'dual');
});

test('older presentation settings keep both cameras centered without resetting other preferences', () => {
  const legacy = { ...DEFAULT_SETTINGS, musicGain: 0.25, muted: true } as Record<string, unknown>;
  delete legacy.cameraFraming;
  const migrated = parseSettings(legacy);
  assert.deepEqual(migrated.cameraFraming, { left: 50, right: 50 });
  assert.equal(migrated.musicGain, 0.25);
  assert.equal(migrated.muted, true);
});

test('independent camera framing survives serialization and partial configuration overlays', () => {
  const value = { ...DEFAULT_SETTINGS, cameraFraming: { left: 0, right: 100 } };
  const parsed = parseSettings(JSON.parse(JSON.stringify(value)));
  assert.deepEqual(parsed, value);
  assert.notEqual(parsed.cameraFraming, value.cameraFraming);
  assert.deepEqual(parseApplicationConfig({ presenter: { settings: { cameraFraming: { left: 25 } } } })
    .presenter.settings.cameraFraming, { left: 25, right: 50 });
});

test('camera framing rejects malformed values and unknown configuration fields', () => {
  for (const cameraFraming of [null, [], true, {}, { left: 50 }, { left: -1, right: 50 },
    { left: 50, right: 101 }, { left: NaN, right: 50 }, { left: 50, right: Infinity },
    { left: '50', right: 50 }, { left: 50, right: 50, vertical: 25 }]) {
    assert.throws(() => parseSettings({ ...DEFAULT_SETTINGS, cameraFraming }));
  }
  assert.throws(() => parseApplicationConfig({ presenter: { settings: { cameraFraming: { vertical: 25 } } } }),
    /Unknown configuration field presenter.settings.cameraFraming.vertical/);
});

test('video inputs persist as a third presentation and keep independent feeds in every game mode', () => {
  const value = { ...DEFAULT_SETTINGS, viewSource: 'video' };
  assert.equal(parseSettings(value).viewSource, 'video');
  for (const mode of ['MOVE', 'NM', 'NMPZ'] as const) assert.equal(layoutKind(mode, 'video'), 'dual');
});

test('settings accept both keys and output choices without mutating input', () => {
  const value = { ...DEFAULT_SETTINGS, keyColor: '#00ff00', viewSource: 'rendered', audioOutput: 'embedded', muted: true, musicGain: 0, effectsGain: 0.5 };
  const parsed = parseSettings(value);
  assert.deepEqual(parsed, value);
  assert.notEqual(parsed.timing, value.timing);
});

test('transparent capture windows survive settings validation and serialization', () => {
  const value = { ...DEFAULT_SETTINGS, keyColor: 'transparent' };
  assert.deepEqual(parseSettings(JSON.parse(JSON.stringify(value))), value);
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

test('Pinpointing Duels preference migrates, round-trips and rejects bad shapes', () => {
  const legacy = { ...DEFAULT_SETTINGS, musicGain: 0.25 } as any;
  delete legacy.pinpointing;
  const migrated = parseSettings(legacy);
  assert.deepEqual(migrated.pinpointing, { enabled: false });
  assert.equal(migrated.musicGain, 0.25);
  const parsed = parseSettings({ ...DEFAULT_SETTINGS, pinpointing: { enabled: true } });
  assert.deepEqual(parsed.pinpointing, { enabled: true });
  for (const pinpointing of [null, [], true, {}, { enabled: 1 }, { enabled: true, firstTo: 7 }]) {
    assert.throws(() => parseSettings({ ...DEFAULT_SETTINGS, pinpointing }));
  }
});
