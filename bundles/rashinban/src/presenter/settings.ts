import type { Cue, CueKind, Timing } from '../types/presenter.ts';
import { CUE_KINDS } from './media.ts';
import { DEFAULT_TIMING } from './timeline.ts';

export type PlayerViewSource = 'rendered' | 'chroma' | 'video';
export type PresenterSettings = {
  viewSource: PlayerViewSource; keyColor: '#00ff00' | '#ff00ff' | 'transparent';
  audioOutput: 'separate' | 'embedded'; muted: boolean;
  musicGain: number; effectsGain: number; celebrationGain: number; cueGains: Record<CueKind, number>; timing: Timing;
  tieRange: { enabled: boolean; mode: 'full' | 'half' };
  pinpointing: { enabled: boolean };
  cameraFraming: { left: number; right: number };
};
export const DEFAULT_SETTINGS: PresenterSettings = {
  viewSource: 'chroma', keyColor: '#ff00ff', audioOutput: 'embedded', muted: false,
  musicGain: 0.7, effectsGain: 1, celebrationGain: 1, timing: { ...DEFAULT_TIMING },
  cueGains: Object.fromEntries(CUE_KINDS.map(kind => [kind, 1])) as Record<CueKind, number>,
  tieRange: { enabled: false, mode: 'full' },
  pinpointing: { enabled: false },
  cameraFraming: { left: 50, right: 50 },
};
export function parseSettings(input: unknown): PresenterSettings {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Settings must be an object');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !(key in DEFAULT_SETTINGS))) throw new Error('Unknown settings field');
  if (value.viewSource !== 'rendered' && value.viewSource !== 'chroma' && value.viewSource !== 'video') throw new Error('Invalid view source');
  if (value.keyColor !== '#00ff00' && value.keyColor !== '#ff00ff' && value.keyColor !== 'transparent') throw new Error('Invalid key color');
  if (value.audioOutput !== 'separate' && value.audioOutput !== 'embedded') throw new Error('Invalid audio output');
  if (typeof value.muted !== 'boolean') throw new Error('Mute must be boolean');
  const tie = value.tieRange === undefined ? DEFAULT_SETTINGS.tieRange : value.tieRange;
  if (typeof tie !== 'object' || tie === null || Array.isArray(tie)) throw new Error('Invalid tie range');
  const rule = tie as Record<string, unknown>;
  if (Object.keys(rule).some(key => !['enabled', 'mode'].includes(key)) || typeof rule.enabled !== 'boolean'
    || (rule.mode !== 'full' && rule.mode !== 'half')) throw new Error('Invalid tie range');
  const pinpointing = value.pinpointing === undefined ? DEFAULT_SETTINGS.pinpointing : value.pinpointing;
  if (typeof pinpointing !== 'object' || pinpointing === null || Array.isArray(pinpointing)) throw new Error('Invalid Pinpointing Duels setting');
  const points = pinpointing as Record<string, unknown>;
  if (Object.keys(points).some(key => key !== 'enabled') || typeof points.enabled !== 'boolean') throw new Error('Invalid Pinpointing Duels setting');
  const cameraFraming = value.cameraFraming === undefined ? DEFAULT_SETTINGS.cameraFraming : value.cameraFraming;
  if (typeof cameraFraming !== 'object' || cameraFraming === null || Array.isArray(cameraFraming)) throw new Error('Invalid camera framing');
  const framing = cameraFraming as Record<string, unknown>;
  if (Object.keys(framing).some(key => key !== 'left' && key !== 'right')
    || [framing.left, framing.right].some(position => typeof position !== 'number' || !Number.isFinite(position) || position < 0 || position > 100)) {
    throw new Error('Camera framing must be a percentage from 0 to 100 for each player');
  }
  const bounded = (input: unknown, max: number): number => {
    if (typeof input !== 'number' || !Number.isFinite(input) || input < 0 || input > max) throw new Error('Invalid gain or duration');
    return input;
  };
  const cueInput = value.cueGains === undefined ? {} : value.cueGains;
  if (typeof cueInput !== 'object' || cueInput === null || Array.isArray(cueInput)
    || Object.keys(cueInput).some(key => !CUE_KINDS.includes(key as CueKind))) throw new Error('Invalid cue gains');
  const cueValues = cueInput as Record<string, unknown>;
  const cueGains = Object.fromEntries(CUE_KINDS.map(kind => [kind,
    Object.hasOwn(cueValues, kind) ? bounded(cueValues[kind], 1) : 1,
  ])) as Record<CueKind, number>;
  if (typeof value.timing !== 'object' || value.timing === null || Array.isArray(value.timing)) throw new Error('Invalid timing');
  const raw = value.timing as Record<string, unknown>;
  if (Object.keys(raw).some(key => !['leadMs', 'countMs', 'damageMs', 'effectWatchdogMs', 'pinRateLimitMs'].includes(key))) throw new Error('Unknown timing field');
  const timing: Timing = {
    leadMs: bounded(raw.leadMs, 120000), countMs: bounded(raw.countMs, 120000),
    damageMs: bounded(raw.damageMs, 120000), effectWatchdogMs: bounded(raw.effectWatchdogMs, 120000),
  };
  if (raw.pinRateLimitMs !== undefined) timing.pinRateLimitMs = bounded(raw.pinRateLimitMs, 120000);
  return { viewSource: value.viewSource, keyColor: value.keyColor, audioOutput: value.audioOutput, muted: value.muted,
    musicGain: bounded(value.musicGain, 1), effectsGain: bounded(value.effectsGain, 1), cueGains, timing,
    celebrationGain: value.celebrationGain === undefined ? 1 : bounded(value.celebrationGain, 1),
    tieRange: { enabled: rule.enabled, mode: rule.mode }, pinpointing: { enabled: points.enabled },
    cameraFraming: { left: framing.left as number, right: framing.right as number } };
}

/** Embedded celebration audio has its own fader, independent of the five-k cue. */
export function celebrationVolume(settings: Pick<PresenterSettings, 'effectsGain' | 'celebrationGain'>): number {
  return settings.effectsGain * (settings.celebrationGain ?? 1);
}

/** Preserve the authored cue level, then apply the two operator faders. */
export function cueVolume(settings: Pick<PresenterSettings, 'muted' | 'effectsGain' | 'cueGains'>, cue: Pick<Cue, 'kind' | 'sound'>): number {
  const maxVolume = cue.kind === 'pre-round-tick' ? 1.3 : 1;
  return settings.muted ? 0 : maxVolume * settings.effectsGain * (settings.cueGains?.[cue.sound ?? cue.kind] ?? 1);
}
