import type { Timing } from '../types/presenter.ts';
import { DEFAULT_TIMING } from './timeline.ts';

export type PresenterSettings = {
  viewSource: 'rendered' | 'chroma'; keyColor: '#00ff00' | '#ff00ff';
  audioOutput: 'separate' | 'embedded'; muted: boolean;
  musicGain: number; effectsGain: number; timing: Timing;
  tieRange: { enabled: boolean; mode: 'full' | 'half' };
};
export const DEFAULT_SETTINGS: PresenterSettings = {
  viewSource: 'chroma', keyColor: '#ff00ff', audioOutput: 'separate', muted: false,
  musicGain: 0.7, effectsGain: 1, timing: { ...DEFAULT_TIMING },
  tieRange: { enabled: false, mode: 'full' },
};
export function parseSettings(input: unknown): PresenterSettings {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Settings must be an object');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !(key in DEFAULT_SETTINGS))) throw new Error('Unknown settings field');
  if (value.viewSource !== 'rendered' && value.viewSource !== 'chroma') throw new Error('Invalid view source');
  if (value.keyColor !== '#00ff00' && value.keyColor !== '#ff00ff') throw new Error('Invalid key color');
  if (value.audioOutput !== 'separate' && value.audioOutput !== 'embedded') throw new Error('Invalid audio output');
  if (typeof value.muted !== 'boolean') throw new Error('Mute must be boolean');
  const tie = value.tieRange === undefined ? DEFAULT_SETTINGS.tieRange : value.tieRange;
  if (typeof tie !== 'object' || tie === null || Array.isArray(tie)) throw new Error('Invalid tie range');
  const rule = tie as Record<string, unknown>;
  if (Object.keys(rule).some(key => !['enabled', 'mode'].includes(key)) || typeof rule.enabled !== 'boolean'
    || (rule.mode !== 'full' && rule.mode !== 'half')) throw new Error('Invalid tie range');
  const bounded = (input: unknown, max: number): number => {
    if (typeof input !== 'number' || !Number.isFinite(input) || input < 0 || input > max) throw new Error('Invalid gain or duration');
    return input;
  };
  if (typeof value.timing !== 'object' || value.timing === null || Array.isArray(value.timing)) throw new Error('Invalid timing');
  const raw = value.timing as Record<string, unknown>;
  if (Object.keys(raw).some(key => !['leadMs', 'countMs', 'damageMs', 'effectWatchdogMs', 'pinRateLimitMs'].includes(key))) throw new Error('Unknown timing field');
  const timing: Timing = {
    leadMs: bounded(raw.leadMs, 120000), countMs: bounded(raw.countMs, 120000),
    damageMs: bounded(raw.damageMs, 120000), effectWatchdogMs: bounded(raw.effectWatchdogMs, 120000),
  };
  if (raw.pinRateLimitMs !== undefined) timing.pinRateLimitMs = bounded(raw.pinRateLimitMs, 120000);
  return { viewSource: value.viewSource, keyColor: value.keyColor, audioOutput: value.audioOutput, muted: value.muted,
    musicGain: bounded(value.musicGain, 1), effectsGain: bounded(value.effectsGain, 1), timing,
    tieRange: { enabled: rule.enabled, mode: rule.mode } };
}
