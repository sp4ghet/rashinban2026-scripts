import type { AssetInventory, MediaManifest } from '../presenter/media.ts';

export const MEDIA_CATEGORIES = ['music', 'effects', 'video'] as const;
export type MediaCategory = typeof MEDIA_CATEGORIES[number];
export type EffectiveAssetInventory = Record<MediaCategory, (AssetInventory[number] & {source: 'shared' | 'local'; version: string})[]>;
export type MediaAsset = AssetInventory[number] & { source?: 'shared' | 'local'; version?: string };
export type BoundMediaState = {
  audioSignature: string;
  videoSignatures: Record<string, string>;
  versions: Record<string, string>;
};

export function isMediaCategory(value: string): value is MediaCategory {
  return (MEDIA_CATEGORIES as readonly string[]).includes(value);
}

export function isMediaFilename(value: string): boolean {
  return value.length > 0 && value !== '.' && value !== '..' && !/[\\/\x00-\x1f\x7f]/.test(value);
}

/** Keep saved references stable while routing playback through the effective library. */
export function mediaPlaybackUrl(url: string, version?: string): string {
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
  return `/rashinban/media/${category}/${encoded}${version ? `?v=${encodeURIComponent(version)}` : ''}`;
}

/** Capture only selected files so unrelated inventory updates cannot restart playback. */
export function boundMediaState(media: MediaManifest, inventory: EffectiveAssetInventory | undefined): BoundMediaState {
  const versions: Record<string, string> = {};
  function binding(category: MediaCategory, url: string): [string, string] {
    const asset = inventory?.[category].find(item => item.url === url);
    if (asset) versions[url] = asset.version;
    return [url, inventory ? asset ? `${asset.source}:${asset.version}` : 'missing' : 'pending'];
  }
  const audio = [
    ...media.stems.map(stem => ['music', stem.url] as const),
    ...Object.values(media.sounds).map(url => ['effects', url] as const),
  ];
  const uniqueAudio = [...new Map(audio.map(([category, url]) => [`${category}:${url}`, [category, url] as const])).values()]
    .sort((left, right) => left[1].localeCompare(right[1]));
  const videoUrls = [...new Set([media.fiveK.single?.url, media.fiveK.double?.url].filter((url): url is string => !!url))].sort();
  return {
    audioSignature: JSON.stringify(uniqueAudio.map(([category, url]) => binding(category, url))),
    videoSignatures: Object.fromEntries(videoUrls.map(url => binding('video', url))),
    versions,
  };
}

export function changedVideoBindings(previous: BoundMediaState, next: BoundMediaState): string[] {
  return [...new Set([...Object.keys(previous.videoSignatures), ...Object.keys(next.videoSignatures)])]
    .filter(url => previous.videoSignatures[url] !== next.videoSignatures[url]);
}

/** Prefer the server-owned merged library; native NodeCG assets are a legacy startup fallback only. */
export function mediaAssetsForCategory(
  inventory: EffectiveAssetInventory | undefined,
  category: MediaCategory,
  legacy: AssetInventory = [],
): MediaAsset[] {
  return inventory ? inventory[category] : legacy;
}

/** Build stable selector entries while retaining an operator's unsaved choice across inventory refreshes. */
export function mediaAssetOptions(inventory: readonly MediaAsset[], chosen = ''): { label: string; value: string }[] {
  const options = [{ label: 'None', value: '' }, ...inventory.map(item => {
    const name = item.base ?? item.url.split('/').pop()!;
    return { label: item.source === 'shared' ? `${name} (inherited)` : name, value: item.url };
  })];
  if (chosen && !options.some(option => option.value === chosen)) {
    options.push({ label: `Unavailable · ${chosen.split('/').pop()}`, value: chosen });
  }
  return options;
}
