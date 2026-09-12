import { EMPTY_MEDIA, parseMedia, type MediaManifest } from '../presenter/media.ts';
import { DEFAULT_SETTINGS, parseSettings, type PresenterSettings } from '../presenter/settings.ts';
import type { SheetConfig } from '../sheet/types.ts';
import type { StartggConfig } from '../startgg/types.ts';
import type { ApplicationConfig, ConfigLayer, ConfigSection, ConfigSections } from './types.ts';

export const DEFAULT_SHEET_CONFIG: SheetConfig = {
  enabled: false,
  sheetId: '1xozkRDAEeRLqVPzvpqqDFAcpC3vcbTrd9xekrQ28B50',
  playersGid: '0',
  pollIntervalMs: 15_000,
};

export const DEFAULT_STARTGG_CONFIG: StartggConfig = {
  enabled: false,
  eventSlug: 'tournament/rashinban-2026/event/rashinban-2026',
  tournamentSlug: '',
  pollIntervalMs: 30_000,
};

export const DEFAULT_APPLICATION_CONFIG: ApplicationConfig = {
  schemaVersion: 1,
  presenter: {
    googleMapsApiKey: '',
    input: 'live',
    replayFixture: 'gs2-ws-full-duel-sequence.json',
    partyId: null,
    clientVersion: '1.7695-a61479c',
    settings: structuredClone(DEFAULT_SETTINGS),
    media: structuredClone(EMPTY_MEDIA),
  },
  sheet: { ...DEFAULT_SHEET_CONFIG },
  startgg: { ...DEFAULT_STARTGG_CONFIG },
};

function record(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error(`${label} must be an object`);
  return input as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const unknown = Object.keys(value).find(key => !keys.includes(key));
  if (unknown) throw new Error(`Unknown configuration field ${label}.${unknown}`);
}

function validatePartialObject(input: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  const value = record(input, label);
  rejectUnknown(value, allowed, label);
  return value;
}

function validateSettingsShape(input: unknown): void {
  const settings = validatePartialObject(input, Object.keys(DEFAULT_SETTINGS), 'presenter.settings');
  if (settings.timing !== undefined) {
    validatePartialObject(settings.timing, ['leadMs', 'countMs', 'damageMs', 'effectWatchdogMs', 'pinRateLimitMs'], 'presenter.settings.timing');
  }
  if (settings.tieRange !== undefined) validatePartialObject(settings.tieRange, ['enabled', 'mode'], 'presenter.settings.tieRange');
}

function validateMediaShape(input: unknown): void {
  const media = validatePartialObject(input, ['stems', 'fadeMs', 'sounds', 'fiveK'], 'presenter.media');
  if (media.fadeMs !== undefined) validatePartialObject(media.fadeMs, ['idle', 'round', 'urgent', 'results'], 'presenter.media.fadeMs');
  if (media.sounds !== undefined) {
    validatePartialObject(media.sounds, ['pre-round-tick', 'round-start', 'pin', 'opponent-guess', 'guess', 'countdown', 'results', 'count', 'collision', 'tie', 'multiplier', 'damage', 'five-k'], 'presenter.media.sounds');
  }
  if (media.fiveK !== undefined) validatePartialObject(media.fiveK, ['single', 'double'], 'presenter.media.fiveK');
}

export function parseConfigLayer(input: unknown, options: { allowLegacyCookieFile?: boolean } = {}): ConfigLayer {
  const value = record(input, 'Configuration');
  rejectUnknown(value, ['schemaVersion', 'presenter', 'sheet', 'startgg'], 'configuration');
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) throw new Error('Unsupported configuration schemaVersion');

  if (value.presenter !== undefined) {
    const allowed = ['googleMapsApiKey', 'input', 'replayFixture', 'partyId', 'clientVersion', 'settings', 'media'];
    if (options.allowLegacyCookieFile) allowed.push('cookieFile');
    const presenter = validatePartialObject(value.presenter, allowed, 'presenter');
    if (presenter.googleMapsApiKey !== undefined && typeof presenter.googleMapsApiKey !== 'string') throw new Error('presenter.googleMapsApiKey must be a string');
    if (presenter.input !== undefined && presenter.input !== 'live' && presenter.input !== 'replay') throw new Error('presenter.input must be live or replay');
    if (presenter.replayFixture !== undefined && !validFixture(presenter.replayFixture)) throw new Error('presenter.replayFixture is invalid');
    if (presenter.partyId !== undefined && !validPartyId(presenter.partyId)) throw new Error('presenter.partyId is invalid');
    if (presenter.clientVersion !== undefined && !nonEmptyString(presenter.clientVersion)) throw new Error('presenter.clientVersion must be nonempty');
    if (presenter.settings !== undefined) validateSettingsShape(presenter.settings);
    if (presenter.media !== undefined) validateMediaShape(presenter.media);
  }
  if (value.sheet !== undefined) validatePartialObject(value.sheet, ['enabled', 'sheetId', 'playersGid', 'pollIntervalMs'], 'sheet');
  if (value.startgg !== undefined) validatePartialObject(value.startgg, ['enabled', 'eventSlug', 'tournamentSlug', 'pollIntervalMs'], 'startgg');

  const cloned = structuredClone(value) as Record<string, unknown>;
  if (options.allowLegacyCookieFile && cloned.presenter && typeof cloned.presenter === 'object') {
    delete (cloned.presenter as Record<string, unknown>).cookieFile;
  }
  return cloned as ConfigLayer;
}

export function mergeConfigValues<T>(base: T, overlay: unknown): T {
  if (overlay === undefined) return structuredClone(base);
  if (overlay === null || typeof overlay !== 'object' || Array.isArray(overlay)) return structuredClone(overlay) as T;
  const output: Record<string, unknown> = typeof base === 'object' && base !== null && !Array.isArray(base)
    ? structuredClone(base as Record<string, unknown>) : {};
  for (const [key, next] of Object.entries(overlay as Record<string, unknown>)) {
    output[key] = mergeConfigValues(output[key], next);
  }
  return output as T;
}

export function parseSheetConfig(input: unknown): SheetConfig {
  const value = validatePartialObject(input, ['enabled', 'sheetId', 'playersGid', 'pollIntervalMs'], 'sheet');
  if (typeof value.enabled !== 'boolean' || typeof value.sheetId !== 'string' || typeof value.playersGid !== 'string') {
    throw new Error('Invalid sheet configuration');
  }
  if (!Number.isFinite(value.pollIntervalMs) || (value.pollIntervalMs as number) < 5_000) throw new Error('sheet.pollIntervalMs must be at least 5000');
  return { enabled: value.enabled, sheetId: value.sheetId, playersGid: value.playersGid, pollIntervalMs: value.pollIntervalMs as number };
}

export function parseStartggConfig(input: unknown): StartggConfig {
  const value = validatePartialObject(input, ['enabled', 'eventSlug', 'tournamentSlug', 'pollIntervalMs'], 'startgg');
  if (typeof value.enabled !== 'boolean' || typeof value.eventSlug !== 'string' || typeof value.tournamentSlug !== 'string') {
    throw new Error('Invalid startgg configuration');
  }
  if (!Number.isFinite(value.pollIntervalMs) || (value.pollIntervalMs as number) < 10_000) throw new Error('startgg.pollIntervalMs must be at least 10000');
  return { enabled: value.enabled, eventSlug: value.eventSlug, tournamentSlug: value.tournamentSlug, pollIntervalMs: value.pollIntervalMs as number };
}

export function parseApplicationConfig(input: unknown): ApplicationConfig {
  const layer = parseConfigLayer(input);
  const value = mergeConfigValues(DEFAULT_APPLICATION_CONFIG, layer);
  if (value.schemaVersion !== 1) throw new Error('Unsupported configuration schemaVersion');
  const presenter = record(value.presenter, 'presenter');
  if (typeof presenter.googleMapsApiKey !== 'string') throw new Error('presenter.googleMapsApiKey must be a string');
  if (presenter.input !== 'live' && presenter.input !== 'replay') throw new Error('presenter.input must be live or replay');
  if (!validFixture(presenter.replayFixture)) throw new Error('presenter.replayFixture is invalid');
  if (!validPartyId(presenter.partyId)) throw new Error('presenter.partyId is invalid');
  if (!nonEmptyString(presenter.clientVersion)) throw new Error('presenter.clientVersion must be nonempty');
  return {
    schemaVersion: 1,
    presenter: {
      googleMapsApiKey: presenter.googleMapsApiKey,
      input: presenter.input,
      replayFixture: presenter.replayFixture,
      partyId: presenter.partyId,
      clientVersion: presenter.clientVersion.trim(),
      settings: parseSettings(presenter.settings),
      media: parseMedia(presenter.media),
    },
    sheet: parseSheetConfig(value.sheet),
    startgg: parseStartggConfig(value.startgg),
  };
}

export function parseConfigSection<K extends ConfigSection>(section: K, input: unknown): ConfigSections[K] {
  switch (section) {
    case 'presenterSettings': return parseSettings(input) as ConfigSections[K];
    case 'presenterMedia': return parseMedia(input) as ConfigSections[K];
    case 'sheetConfig': return parseSheetConfig(input) as ConfigSections[K];
    case 'startggConfig': return parseStartggConfig(input) as ConfigSections[K];
  }
}

function nonEmptyString(input: unknown): input is string {
  return typeof input === 'string' && input.trim().length > 0;
}

function validFixture(input: unknown): input is string {
  return typeof input === 'string' && input.length <= 160 && /^[A-Za-z0-9_.-]+\.json$/.test(input) && input !== '.json' && !input.startsWith('..');
}

function validPartyId(input: unknown): input is string | null {
  return input === null || (typeof input === 'string' && /^[\w-]{1,128}$/.test(input));
}

export type { MediaManifest, PresenterSettings, SheetConfig, StartggConfig };
