import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, unwatchFile, watchFile, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  DEFAULT_APPLICATION_CONFIG, mergeConfigValues, parseApplicationConfig, parseConfigLayer, parseConfigSection,
} from '../../config/schema.ts';
import type {
  ApplicationConfig, ConfigLayer, ConfigSection, ConfigSections, ConfigStatus, ConfigStore, DeepPartial, InstallationRoots,
} from '../../config/types.ts';
import { readLegacyConfiguration } from './migration.ts';

export type ConfigFileSystem = {
  writeAtomic(filePath: string, text: string, expectedText: string | null): void;
};

export type CreateConfigStoreOptions = {
  roots: InstallationRoots;
  launchOverrides?: DeepPartial<ApplicationConfig>;
  watch?: boolean;
  fileSystem?: ConfigFileSystem;
};

type LayerState = { raw: string | null; document: ConfigLayer; layer: ConfigLayer };

const SECTION_PATHS: Record<ConfigSection, readonly string[]> = {
  presenterSettings: ['presenter', 'settings'],
  presenterMedia: ['presenter', 'media'],
  sheetConfig: ['sheet'],
  startggConfig: ['startgg'],
};
const SECTION_ORDER = Object.keys(SECTION_PATHS) as ConfigSection[];

function readOptional(filePath: string): string | null {
  try { return readFileSync(filePath, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function defaultWriteAtomic(filePath: string, text: string, expectedText: string | null): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const lockPath = `${filePath}.lock`;
  let lock: number | undefined;
  let temporary: string | undefined;
  try {
    try { lock = openSync(lockPath, 'wx'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Configuration is being written by another process');
      throw error;
    }
    if (readOptional(filePath) !== expectedText) throw new Error('Configuration changed on disk');
    temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, text, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, filePath);
    temporary = undefined;
  } finally {
    if (temporary) rmSync(temporary, { force: true });
    if (lock !== undefined) {
      closeSync(lock);
      rmSync(lockPath, { force: true });
    }
  }
}

function parseDocument(raw: string | null, label: string, allowLegacyCookieFile = false): LayerState {
  if (raw === null) return { raw, document: {}, layer: {} };
  let document: unknown;
  try { document = JSON.parse(raw) as unknown; }
  catch { throw new Error(`${label} contains invalid JSON`); }
  try {
    const layer = parseConfigLayer(document, { allowLegacyCookieFile });
    return { raw, document: layer, layer };
  } catch (error) {
    throw new Error(`${label}: ${(error as Error).message}`);
  }
}

function legacyLayer(sections: Partial<ConfigSections>): ConfigLayer {
  const layer: ConfigLayer = {};
  if (sections.presenterSettings) layer.presenter = { ...layer.presenter, settings: sections.presenterSettings };
  if (sections.presenterMedia) layer.presenter = { ...layer.presenter, media: sections.presenterMedia };
  if (sections.sheetConfig) layer.sheet = sections.sheetConfig;
  if (sections.startggConfig) layer.startgg = sections.startggConfig;
  return layer;
}

function revision(sharedRaw: string | null, localRaw: string | null): string {
  return createHash('sha256').update(sharedRaw ?? '<missing>').update('\0').update(localRaw ?? '<missing>').digest('hex').slice(0, 16);
}

function sectionAt(input: unknown, section: ConfigSection): unknown {
  let value = input;
  for (const key of SECTION_PATHS[section]) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function sectionValue(config: ApplicationConfig, section: ConfigSection): ConfigSections[ConfigSection] {
  switch (section) {
    case 'presenterSettings': return config.presenter.settings;
    case 'presenterMedia': return config.presenter.media;
    case 'sheetConfig': return config.sheet;
    case 'startggConfig': return config.startgg;
  }
}

function hasValues(input: unknown): boolean {
  if (input === undefined) return false;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return true;
  return Object.keys(input).some(key => hasValues((input as Record<string, unknown>)[key]));
}

function overriddenSections(local: ConfigLayer, worktree: boolean): ConfigSection[] {
  if (!worktree) return [];
  return SECTION_ORDER.filter(section => hasValues(sectionAt(local, section)));
}

function setSection(document: ConfigLayer, section: ConfigSection, value: unknown): void {
  const keys = SECTION_PATHS[section];
  let target = document as Record<string, unknown>;
  const parents: Record<string, unknown>[] = [target];
  for (const key of keys.slice(0, -1)) {
    const child = target[key];
    if (typeof child !== 'object' || child === null || Array.isArray(child)) target[key] = {};
    target = target[key] as Record<string, unknown>;
    parents.push(target);
  }
  const last = keys.at(-1)!;
  if (value === undefined || (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0)) {
    delete target[last];
  } else target[last] = structuredClone(value);
  for (let index = parents.length - 1; index > 0; index -= 1) {
    if (Object.keys(parents[index]!).length > 0) break;
    delete parents[index - 1]![keys[index - 1]!];
  }
}

function sparseDifference(base: unknown, next: unknown): unknown {
  if (isDeepStrictEqual(base, next)) return undefined;
  if (
    typeof next !== 'object' || next === null || Array.isArray(next)
    || typeof base !== 'object' || base === null || Array.isArray(base)
  ) return structuredClone(next);
  const difference: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next as Record<string, unknown>)) {
    const child = sparseDifference((base as Record<string, unknown>)[key], value);
    if (child !== undefined) difference[key] = child;
  }
  return Object.keys(difference).length === 0 ? undefined : difference;
}

function withoutLaunchValues(next: unknown, persistent: unknown, launch: unknown): unknown {
  if (launch === undefined) return structuredClone(next);
  if (
    typeof launch !== 'object' || launch === null || Array.isArray(launch)
    || typeof next !== 'object' || next === null || Array.isArray(next)
  ) return structuredClone(persistent);
  const output = structuredClone(next) as Record<string, unknown>;
  for (const [key, launched] of Object.entries(launch as Record<string, unknown>)) {
    output[key] = withoutLaunchValues(
      output[key],
      typeof persistent === 'object' && persistent !== null && !Array.isArray(persistent)
        ? (persistent as Record<string, unknown>)[key] : undefined,
      launched,
    );
  }
  return output;
}

function serialize(document: ConfigLayer): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to load configuration';
}

export function createConfigStore(options: CreateConfigStoreOptions): ConfigStore {
  const { roots } = options;
  const fileSystem = options.fileSystem ?? { writeAtomic: defaultWriteAtomic };
  const sharedFile = path.join(roots.sharedRoot, 'cfg', 'rashinban.json');
  const localFile = path.join(roots.appRoot, 'cfg', 'rashinban.local.json');
  let startupError: string | null = null;
  let allowLegacyShared = false;

  try {
    const originalRaw = readOptional(sharedFile);
    let rawDocument: unknown = {};
    if (originalRaw !== null) {
      try { rawDocument = JSON.parse(originalRaw) as unknown; }
      catch { throw new Error('Shared configuration contains invalid JSON'); }
    }
    const rawRecord = typeof rawDocument === 'object' && rawDocument !== null && !Array.isArray(rawDocument)
      ? rawDocument as Record<string, unknown> : null;
    if (!rawRecord) throw new Error('Shared configuration must be an object');
    if (rawRecord.schemaVersion !== 1) {
      if (rawRecord.schemaVersion !== undefined) throw new Error('Unsupported configuration schemaVersion');
      allowLegacyShared = true;
      const databasePath = path.join(roots.sharedRoot, 'db', 'nodecg.sqlite3');
      if (existsSync(databasePath)) {
        const fileLayer = parseConfigLayer(rawRecord, { allowLegacyCookieFile: true });
        const legacy = readLegacyConfiguration(databasePath);
        const migrated = mergeConfigValues(legacyLayer(legacy), fileLayer);
        migrated.schemaVersion = 1;
        parseApplicationConfig(migrated);
        const migratedText = serialize(migrated);
        fileSystem.writeAtomic(sharedFile, migratedText, originalRaw);
        allowLegacyShared = false;
      }
    }
  } catch (error) {
    startupError = errorMessage(error);
  }

  let shared: LayerState;
  try {
    shared = parseDocument(readOptional(sharedFile), 'Shared configuration', allowLegacyShared);
    parseApplicationConfig(mergeConfigValues(DEFAULT_APPLICATION_CONFIG, shared.layer));
  }
  catch (error) {
    shared = { raw: readOptional(sharedFile), document: {}, layer: {} };
    startupError ??= errorMessage(error);
  }
  let local: LayerState;
  try {
    local = roots.isWorktree ? parseDocument(readOptional(localFile), 'Worktree configuration') : { raw: null, document: {}, layer: {} };
    parseApplicationConfig(mergeConfigValues(mergeConfigValues(DEFAULT_APPLICATION_CONFIG, shared.layer), local.layer));
  }
  catch (error) {
    local = { raw: readOptional(localFile), document: {}, layer: {} };
    startupError ??= errorMessage(error);
  }
  let persistent = parseApplicationConfig(mergeConfigValues(mergeConfigValues(DEFAULT_APPLICATION_CONFIG, shared.layer), local.layer));
  let launch: ConfigLayer = {};
  try {
    launch = parseConfigLayer(options.launchOverrides ?? {});
    parseApplicationConfig(mergeConfigValues(persistent, launch));
  }
  catch (error) { startupError ??= `Launch overrides: ${errorMessage(error)}`; }

  let effective = parseApplicationConfig(mergeConfigValues(persistent, launch));
  let writeBlocked = startupError !== null;
  let currentStatus: ConfigStatus = {
    scope: roots.isWorktree ? 'worktree' : 'shared',
    revision: revision(shared.raw, local.raw),
    overridden: overriddenSections(local.layer, roots.isWorktree),
    error: startupError,
  };
  let disposed = false;
  const listeners = new Set<() => void>();
  const watched: { file: string; listener: () => void }[] = [];

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  function setError(error: unknown): void {
    const message = errorMessage(error);
    if (currentStatus.error === message) return;
    currentStatus = { ...currentStatus, error: message };
    notify();
  }

  function reload(): void {
    if (disposed) return;
    try {
      const nextShared = parseDocument(readOptional(sharedFile), 'Shared configuration');
      const nextLocal = roots.isWorktree ? parseDocument(readOptional(localFile), 'Worktree configuration') : { raw: null, document: {}, layer: {} };
      const nextPersistent = parseApplicationConfig(mergeConfigValues(mergeConfigValues(DEFAULT_APPLICATION_CONFIG, nextShared.layer), nextLocal.layer));
      const nextEffective = parseApplicationConfig(mergeConfigValues(nextPersistent, launch));
      const nextStatus: ConfigStatus = {
        scope: currentStatus.scope,
        revision: revision(nextShared.raw, nextLocal.raw),
        overridden: overriddenSections(nextLocal.layer, roots.isWorktree),
        error: null,
      };
      if (isDeepStrictEqual(nextEffective, effective) && isDeepStrictEqual(nextStatus, currentStatus)) return;
      shared = nextShared;
      local = nextLocal;
      persistent = nextPersistent;
      effective = nextEffective;
      currentStatus = nextStatus;
      writeBlocked = false;
      notify();
    } catch (error) {
      writeBlocked = true;
      setError(error);
    }
  }

  function assertWritable(expectedRevision?: string): void {
    if (disposed) throw new Error('Configuration store is disposed');
    if (writeBlocked) throw new Error(`Configuration cannot be changed: ${currentStatus.error ?? 'configuration files are invalid'}`);
    if (expectedRevision !== undefined && expectedRevision !== currentStatus.revision) throw new Error('Configuration revision is stale');
  }

  function writeSection(section: ConfigSection, next: unknown | undefined, expectedRevision?: string): void {
    assertWritable(expectedRevision);
    const targetFile = roots.isWorktree ? localFile : sharedFile;
    const target = roots.isWorktree ? local : shared;
    const targetDocument = structuredClone(target.document);
    const inherited = roots.isWorktree
      ? parseApplicationConfig(mergeConfigValues(DEFAULT_APPLICATION_CONFIG, shared.layer))
      : structuredClone(DEFAULT_APPLICATION_CONFIG);
    let difference: unknown = undefined;
    if (next !== undefined) {
      const validated = parseConfigSection(section, next);
      const launchSection = sectionAt(launch, section);
      const desired = withoutLaunchValues(validated, sectionValue(persistent, section), launchSection);
      difference = sparseDifference(sectionValue(inherited, section), desired);
    }
    setSection(targetDocument, section, difference);
    if (!roots.isWorktree) targetDocument.schemaVersion = 1;

    const nextLayer = parseConfigLayer(targetDocument);
    const nextSharedLayer = roots.isWorktree ? shared.layer : nextLayer;
    const nextLocalLayer = roots.isWorktree ? nextLayer : local.layer;
    const nextPersistent = parseApplicationConfig(mergeConfigValues(mergeConfigValues(DEFAULT_APPLICATION_CONFIG, nextSharedLayer), nextLocalLayer));
    const nextEffective = parseApplicationConfig(mergeConfigValues(nextPersistent, launch));
    const text = serialize(targetDocument);
    try { fileSystem.writeAtomic(targetFile, text, target.raw); }
    catch (error) { setError(error); throw error; }

    const nextState: LayerState = { raw: text, document: targetDocument, layer: nextLayer };
    if (roots.isWorktree) local = nextState;
    else shared = nextState;
    persistent = nextPersistent;
    effective = nextEffective;
    currentStatus = {
      scope: currentStatus.scope,
      revision: revision(shared.raw, local.raw),
      overridden: overriddenSections(local.layer, roots.isWorktree),
      error: null,
    };
    writeBlocked = false;
    notify();
  }

  if (options.watch !== false) {
    const files = roots.isWorktree ? [sharedFile, localFile] : [sharedFile];
    for (const file of files) {
      const listener = () => reload();
      watchFile(file, { interval: 50, persistent: false }, listener);
      watched.push({ file, listener });
    }
  }

  return {
    get: () => structuredClone(effective),
    status: () => structuredClone(currentStatus),
    save(section, next, expectedRevision) { writeSection(section, next, expectedRevision); },
    reset(section, expectedRevision) { writeSection(section, undefined, expectedRevision); },
    subscribe(listener) {
      if (disposed) throw new Error('Configuration store is disposed');
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const item of watched) unwatchFile(item.file, item.listener);
      listeners.clear();
    },
  };
}
