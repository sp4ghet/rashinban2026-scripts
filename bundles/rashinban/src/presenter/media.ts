import type { CueKind, MusicContext } from '../types/presenter.ts';
export type Stem = { id: string; url: string; loopStartS: number; loopEndS: number; gains: Record<MusicContext, number> };
export const AUDIO_STATES = ['unreported', 'loading', 'ready', 'silent', 'partial', 'error', 'suspended'] as const;
export type AudioState = typeof AUDIO_STATES[number];
export type AudioStatus = { state: AudioState; missing: string[] };
export type EffectAsset = { url: string; watchdogMs: number; soundtrack: 'embedded' | 'cue' | 'silent' };
export type MediaManifest = { stems: Stem[]; fadeMs: Record<MusicContext, number>; sounds: Partial<Record<CueKind, string>>; fiveK: { single: EffectAsset | null; double: EffectAsset | null } };
export const EMPTY_MEDIA: MediaManifest = { stems: [], fadeMs: { idle: 0, round: 0, urgent: 0, results: 0 }, sounds: {}, fiveK: { single: null, double: null } };
export const MUSIC_CONTEXTS = ['idle', 'round', 'urgent', 'results'] as const;
export const CUE_KINDS = ['pin', 'guess', 'countdown', 'results', 'count', 'damage', 'five-k'] as const;
export type AssetInventory = { url: string; base?: string }[];
function record(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) throw new Error('Invalid media fields');
  return input as Record<string, unknown>;
}
function number(input: unknown, min: number, max: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < min || input > max) throw new Error('Invalid media number');
  return input;
}
function contexts(input: unknown, max: number): Record<MusicContext, number> {
  const value = record(input, MUSIC_CONTEXTS);
  return Object.fromEntries(MUSIC_CONTEXTS.map(key => [key, number(value[key], 0, max)])) as Record<MusicContext, number>;
}
function assetUrl(input: unknown, category: string): string {
  const prefix = `/assets/rashinban/${category}/`;
  if (typeof input !== 'string' || !input.startsWith(prefix)) throw new Error('Expected local asset URL');
  const file = input.slice(prefix.length);
  const decoded = decodeURIComponent(file);
  if (!decoded || decoded === '.' || decoded === '..' || /[\\/\x00-\x1f\x7f]/.test(decoded)
    || encodeURIComponent(decoded) !== file) throw new Error('Invalid asset filename');
  return input;
}
export function parseMedia(input: unknown): MediaManifest {
  const value = record(input, ['stems', 'fadeMs', 'sounds', 'fiveK']);
  if (!Array.isArray(value.stems) || value.stems.length > 32) throw new Error('Invalid stems');
  const ids = new Set<string>();
  const stems = value.stems.map((input): Stem => {
    const stem = record(input, ['id', 'url', 'loopStartS', 'loopEndS', 'gains']);
    if (typeof stem.id !== 'string' || !/^[\w-]{1,80}$/.test(stem.id) || ids.has(stem.id)) throw new Error('Missing or duplicate stem ID');
    ids.add(stem.id);
    const loopStartS = number(stem.loopStartS, 0, 86400); const loopEndS = number(stem.loopEndS, 0, 86400);
    if (loopEndS <= loopStartS) throw new Error('Invalid loop');
    return { id: stem.id, url: assetUrl(stem.url, 'music'), loopStartS, loopEndS, gains: contexts(stem.gains, 1) };
  });
  const sounds = Object.fromEntries(Object.entries(record(value.sounds, CUE_KINDS)).map(([key, url]) => [key, assetUrl(url, 'effects')])) as MediaManifest['sounds'];
  const fiveK = record(value.fiveK, ['single', 'double']);
  function effect(input: unknown): EffectAsset | null {
    if (input === null) return null;
    const value = record(input, ['url', 'watchdogMs', 'soundtrack']);
    if (value.soundtrack !== 'embedded' && value.soundtrack !== 'cue' && value.soundtrack !== 'silent') throw new Error('Invalid soundtrack');
    if (value.soundtrack === 'cue' && !sounds['five-k']) throw new Error('Cue soundtrack needs a five-k sound');
    return { url: assetUrl(value.url, 'video'), watchdogMs: number(value.watchdogMs, 500, 120000), soundtrack: value.soundtrack };
  }
  return { stems, fadeMs: contexts(value.fadeMs, 120000), sounds, fiveK: { single: effect(fiveK.single), double: effect(fiveK.double) } };
}

/** Resolve exactly one variant; a double never substitutes the single asset. */
export function celebrationAsset(media: MediaManifest, effect: string, inventory: AssetInventory): EffectAsset | null {
  const asset = effect === 'single-5k' ? media.fiveK.single : effect === 'double-5k' ? media.fiveK.double : null;
  return asset && inventory.some(item => item.url === asset.url) ? asset : null;
}
