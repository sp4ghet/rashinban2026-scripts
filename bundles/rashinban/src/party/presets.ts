import type { PresenterSettings } from '../presenter/settings.ts';
import type { Settings } from './types.ts';

export type PresenterRulesPatch = { pinpointing: PresenterSettings['pinpointing']; tieRange?: PresenterSettings['tieRange'] };
export type TournamentPreset = { id: string; day: 1 | 2; mode: 'MOVE' | 'NM' | 'NMPZ'; map: string; mapId: string };
export type PresetSettings = { gameType: string; gameSettings: Settings; settings: Settings; presenterRules: PresenterRulesPatch };
const maps = [
  ['5kable', 'MOVE', 'A 5kable World', '685af4d1d032e8a9d65ffbed'],
  ['moving', 'MOVE', 'A Moving World', '696fe47c5b07bed052077a95'],
  ['intersection', 'MOVE', 'An Arbitrary Rural Intersectionguessr', '667dab025a1e617dd25198c4'],
  ['official', 'NM', 'An Official World', '652ba0d9002aa0d36f996153'],
  ['pro', 'NM', 'A Pro World', '6620b311f64a7b842b2ca83a'],
  ['saturday', 'NM', 'GeoGuessr Saturday', '661ecb894e20c3a560ef26eb'],
  ['arbitrary-rural', 'NMPZ', 'An Arbitrary Rural World', '643dbc7ccc47d3a344307998'],
  ['rainbolt', 'NMPZ', 'Rainbolt World', '65c86935d327035509fd616f'],
  ['rural', 'NMPZ', 'A Rural World', '5be0de51fe3a84037ca36447'],
] as const;
export const TOURNAMENT_PRESETS: readonly TournamentPreset[] = ([1, 2] as const).flatMap(day => maps
  .filter(([key]) => day === 2 || ['moving', 'pro', 'arbitrary-rural'].includes(key))
  .map(([key, mode, map, mapId]) => ({ id: `day${day}-${key}`, day, mode, map, mapId })));

export function presetSettings(id: string): PresetSettings {
  const preset = TOURNAMENT_PRESETS.find(preset => preset.id === id);
  if (!preset) throw new Error('Unknown tournament preset');
  const pinpointing = preset.day === 2 && preset.mode === 'MOVE';
  const health = pinpointing ? 1_000_000 : 5000;
  return { gameType: 'Duels', gameSettings: {
    mapSlug: preset.mapId, forbidMoving: preset.mode !== 'MOVE', forbidRotating: preset.mode === 'NMPZ', forbidZooming: preset.mode === 'NMPZ',
    timeAfterGuess: pinpointing ? 90 : 15, maxRoundTime: pinpointing ? 90 : 60, maxNumberOfRounds: 50,
    initialHealth: health, individualInitialHealth: false, initialHealthTeamOne: health, initialHealthTeamTwo: health,
    multiplierIncrement: 0, roundWinMultiplierIncrement: pinpointing ? 0 : 5, roundsWithoutDamageMultiplier: pinpointing ? 0 : 1,
  }, settings: { masterControl: true }, presenterRules: { pinpointing: { enabled: pinpointing }, tieRange: { enabled: true, mode: 'half' } } };
}
