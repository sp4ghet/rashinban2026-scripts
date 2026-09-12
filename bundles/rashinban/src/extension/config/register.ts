import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import type NodeCG from '@nodecg/types';

import type {
  ConfigSection, ConfigSections, ConfigStore, DeepPartial, InstallationRoots, PresenterPublicConfig,
} from '../../config/types.ts';
import type { ApplicationConfig } from '../../config/types.ts';
import { CONFIGURATION_MESSAGES, REPLICANTS } from '../../types/replicants.ts';
import { loadSharedEnvironment } from '../env.ts';
import { readLegacyConfiguration } from './migration.ts';
import { resolveInstallationRoots } from './roots.ts';
import { createConfigStore } from './store.ts';

const SECTIONS = ['presenterSettings', 'presenterMedia', 'sheetConfig', 'startggConfig'] as const satisfies readonly ConfigSection[];

type RegisterOptions = {
  readLegacy?: (databasePath: string) => Partial<ConfigSections>;
};

type InitializeOptions = RegisterOptions & {
  appRoot?: string;
  env?: NodeJS.ProcessEnv;
  roots?: InstallationRoots;
  store?: ConfigStore;
  watch?: boolean;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function publicPresenter(config: ApplicationConfig): PresenterPublicConfig {
  const { googleMapsApiKey, input, replayFixture, partyId, clientVersion } = config.presenter;
  return { googleMapsApiKey, input, replayFixture, partyId, clientVersion };
}

function request(input: unknown): { section: ConfigSection; revision?: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Invalid configuration request');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['section', 'revision'].includes(key)) || !SECTIONS.includes(value.section as ConfigSection)) {
    throw new Error('Invalid configuration section');
  }
  if (value.revision !== undefined && typeof value.revision !== 'string') throw new Error('Invalid configuration revision');
  return { section: value.section as ConfigSection, revision: value.revision as string | undefined };
}

export function registerConfiguration(
  nodecg: NodeCG.ServerAPI,
  store: ConfigStore,
  roots: InstallationRoots,
  options: RegisterOptions = {},
): () => void {
  const initial = store.get();
  const status = nodecg.Replicant(REPLICANTS.configurationStatus, { persistent: false, defaultValue: clone(store.status()) });
  const publicConfig = nodecg.Replicant(REPLICANTS.presenterPublicConfig, { persistent: false, defaultValue: publicPresenter(initial) });
  const settings = nodecg.Replicant(REPLICANTS.presenterSettings, { persistent: false, defaultValue: clone(initial.presenter.settings) });
  const media = nodecg.Replicant(REPLICANTS.presenterMedia, { persistent: false, defaultValue: clone(initial.presenter.media) });
  const sheet = nodecg.Replicant(REPLICANTS.sheetConfig, { persistent: false, defaultValue: clone(initial.sheet) });
  const startgg = nodecg.Replicant(REPLICANTS.startggConfig, { persistent: false, defaultValue: clone(initial.startgg) });

  const publish = () => {
    const next = store.get();
    const assign = <T>(replicant: { value?: T }, value: T) => {
      if (!isDeepStrictEqual(replicant.value, value)) replicant.value = clone(value);
    };
    assign(status, store.status());
    assign(publicConfig, publicPresenter(next));
    assign(settings, next.presenter.settings);
    assign(media, next.presenter.media);
    assign(sheet, next.sheet);
    assign(startgg, next.startgg);
  };
  const unsubscribe = store.subscribe(publish);

  const handle = (operation: 'reset' | 'import', input: unknown, ack?: NodeCG.Acknowledgement) => {
    try {
      if (!roots.isWorktree) throw new Error('This action is available only in a worktree');
      const value = request(input);
      if (operation === 'reset') store.reset(value.section, value.revision);
      else {
        const legacy = (options.readLegacy ?? readLegacyConfiguration)(path.join(roots.appRoot, 'db', 'nodecg.sqlite3'));
        const imported = legacy[value.section];
        if (imported === undefined) throw new Error(`No legacy ${value.section} settings were found`);
        store.save(value.section, imported as never, value.revision);
      }
      if (ack && !ack.handled) ack(null, clone(store.status()));
    } catch (error) {
      if (ack && !ack.handled) ack(error instanceof Error ? error : new Error('Configuration request failed'));
    }
  };
  nodecg.listenFor(CONFIGURATION_MESSAGES.reset, (input, ack) => handle('reset', input, ack));
  nodecg.listenFor(CONFIGURATION_MESSAGES.importLocal, (input, ack) => handle('import', input, ack));
  return unsubscribe;
}

function launchOverrides(env: NodeJS.ProcessEnv): DeepPartial<ApplicationConfig> {
  const presenter: DeepPartial<ApplicationConfig['presenter']> = {};
  if (env.RASHINBAN_PRESENTER_INPUT !== undefined) presenter.input = env.RASHINBAN_PRESENTER_INPUT as 'live' | 'replay';
  if (env.RASHINBAN_PRESENTER_REPLAY_FIXTURE !== undefined) presenter.replayFixture = env.RASHINBAN_PRESENTER_REPLAY_FIXTURE;
  return Object.keys(presenter).length ? { presenter } : {};
}

export function initializeConfiguration(
  nodecg: NodeCG.ServerAPI,
  options: InitializeOptions = {},
): { store: ConfigStore; roots: InstallationRoots } {
  const env = options.env ?? process.env;
  const roots = options.roots ?? resolveInstallationRoots(options.appRoot, env);
  loadSharedEnvironment(nodecg, roots, env);
  const store = options.store ?? createConfigStore({ roots, launchOverrides: launchOverrides(env), watch: options.watch });
  registerConfiguration(nodecg, store, roots, options);
  return { store, roots };
}
