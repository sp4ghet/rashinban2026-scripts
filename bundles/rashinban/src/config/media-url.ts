import type { AssetInventory } from '../presenter/media.ts';

export const MEDIA_CATEGORIES = ['music', 'effects', 'video'] as const;
export type MediaCategory = typeof MEDIA_CATEGORIES[number];
export type EffectiveAssetInventory = Record<MediaCategory, (AssetInventory[number] & {source: 'shared' | 'local'})[]>;

export function isMediaCategory(value: string): value is MediaCategory {
  return (MEDIA_CATEGORIES as readonly string[]).includes(value);
}

export function isMediaFilename(value: string): boolean {
  return value.length > 0 && value !== '.' && value !== '..' && !/[\\/\x00-\x1f\x7f]/.test(value);
}

/** Keep saved references stable while routing playback through the effective library. */
export function mediaPlaybackUrl(url: string): string {
  const prefix = '/assets/rashinban/';
  if (!url.startsWith(prefix)) return url;
  const remainder = url.slice(prefix.length);
  const separator = remainder.indexOf('/');
  const category = remainder.slice(0, separator);
  const encoded = remainder.slice(separator + 1);
  const filename = decodeURIComponent(encoded);
  if (!isMediaCategory(category) || !isMediaFilename(filename) || encodeURIComponent(filename) !== encoded) {
    throw new Error('Invalid media reference');
  }
  return `/rashinban/media/${category}/${encoded}`;
}
