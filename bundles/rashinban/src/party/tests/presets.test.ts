import assert from 'node:assert/strict';
import test from 'node:test';
import { TOURNAMENT_PRESETS, presetSettings } from '../presets.ts';
import { settingsPatch } from '../state.ts';

test('tournament presets cover the exact Day 1 and Day 2 map and mode combinations', () => {
  assert.deepEqual(TOURNAMENT_PRESETS.filter(p => p.day === 1).map(p => [p.mode, p.mapId]), [
    ['MOVE', '696fe47c5b07bed052077a95'], ['NM', '6620b311f64a7b842b2ca83a'], ['NMPZ', '643dbc7ccc47d3a344307998'],
  ]);
  assert.deepEqual(TOURNAMENT_PRESETS.filter(p => p.day === 2).map(p => [p.mode, p.mapId]), [
    ['MOVE', '685af4d1d032e8a9d65ffbed'], ['MOVE', '696fe47c5b07bed052077a95'], ['MOVE', '667dab025a1e617dd25198c4'],
    ['NM', '652ba0d9002aa0d36f996153'], ['NM', '6620b311f64a7b842b2ca83a'], ['NM', '661ecb894e20c3a560ef26eb'],
    ['NMPZ', '643dbc7ccc47d3a344307998'], ['NMPZ', '65c86935d327035509fd616f'], ['NMPZ', '5be0de51fe3a84037ca36447'],
  ]);
  assert.equal(new Set(TOURNAMENT_PRESETS.map(p => p.id)).size, 12);
});

test('all health presets apply the rulebook values and disable Pinpointing', () => {
  for (const preset of TOURNAMENT_PRESETS.filter(p => p.day === 1 || p.mode !== 'MOVE')) {
    const patch = presetSettings(preset.id);
    assert.equal(patch.presenterRules.pinpointing.enabled, false);
    assert.equal(patch.gameType, 'Duels');
    assert.deepEqual([patch.gameSettings.timeAfterGuess, patch.gameSettings.maxRoundTime, patch.gameSettings.maxNumberOfRounds,
      patch.gameSettings.initialHealth, patch.gameSettings.multiplierIncrement, patch.gameSettings.roundWinMultiplierIncrement,
      patch.gameSettings.roundsWithoutDamageMultiplier], [15, 60, 50, 5000, 0, 5, 1]);
  }
});

test('Day 2 Move presets enable Pinpointing and use 90 seconds and zero multipliers', () => {
  for (const preset of TOURNAMENT_PRESETS.filter(p => p.day === 2 && p.mode === 'MOVE')) {
    const patch = presetSettings(preset.id);
    assert.equal(patch.presenterRules.pinpointing.enabled, true);
    assert.deepEqual([patch.gameSettings.timeAfterGuess, patch.gameSettings.maxRoundTime, patch.gameSettings.maxNumberOfRounds,
      patch.gameSettings.initialHealth, patch.gameSettings.multiplierIncrement, patch.gameSettings.roundWinMultiplierIncrement,
      patch.gameSettings.roundsWithoutDamageMultiplier], [90, 90, 50, 1000000, 0, 0, 0]);
  }
});

test('presets reset movement and per-team health overrides while preserving unrelated setup', () => {
  for (const preset of TOURNAMENT_PRESETS) {
    const { presenterRules, ...patch } = presetSettings(preset.id);
    assert.deepEqual([patch.gameSettings.forbidMoving, patch.gameSettings.forbidRotating, patch.gameSettings.forbidZooming],
      preset.mode === 'MOVE' ? [false, false, false] : preset.mode === 'NM' ? [true, false, false] : [true, true, true]);
    assert.equal(patch.gameSettings.individualInitialHealth, false);
    assert.equal(patch.settings.masterControl, true);
    assert.equal(patch.settings.masterControlAutoStartRounds, undefined);
    assert.doesNotThrow(() => settingsPatch(patch));
  }
  assert.throws(() => presetSettings('unknown'), /preset/i);
});

test('every tournament preset enables Half tie range', () => {
  for (const preset of TOURNAMENT_PRESETS) {
    assert.deepEqual(presetSettings(preset.id).presenterRules.tieRange, { enabled: true, mode: 'half' });
  }
});
