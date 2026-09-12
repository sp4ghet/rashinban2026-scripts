import type { MediaManifest } from '../presenter/media.ts';
import type { PresenterSettings } from '../presenter/settings.ts';
import type { SheetConfig } from '../sheet/types.ts';
import type { StartggConfig } from '../startgg/types.ts';
import type { CueKind } from '../types/presenter.ts';

export type ApplicationConfig = {
  schemaVersion: 1;
  presenter: {
    googleMapsApiKey: string;
    input: 'live' | 'replay';
    replayFixture: string;
    partyId: string | null;
    clientVersion: string;
    settings: PresenterSettings;
    media: MediaManifest;
  };
  sheet: SheetConfig;
  startgg: StartggConfig;
};

export type ConfigSection = 'presenterSettings' | 'presenterMedia' | 'sheetConfig' | 'startggConfig';

export type ConfigSections = {
  presenterSettings: PresenterSettings;
  presenterMedia: MediaManifest;
  sheetConfig: SheetConfig;
  startggConfig: StartggConfig;
};

export type ConfigStatus = {
  scope: 'shared' | 'worktree';
  revision: string;
  overridden: ConfigSection[];
  error: string | null;
};

export type InstallationRoots = {
  appRoot: string;
  sharedRoot: string;
  isWorktree: boolean;
};

export type ConfigStore = {
  get(): ApplicationConfig;
  status(): ConfigStatus;
  save<K extends ConfigSection>(section: K, next: ConfigSections[K], expectedRevision?: string): void;
  reset(section: ConfigSection, expectedRevision?: string): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
};

export type DeepPartial<T> = T extends readonly unknown[] ? T
  : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

export type MediaConfigLayer = Omit<DeepPartial<MediaManifest>, 'sounds'> & {
  sounds?: Partial<Record<CueKind, string | null>>;
};

export type ConfigLayer = Omit<DeepPartial<ApplicationConfig>, 'presenter'> & {
  presenter?: Omit<DeepPartial<ApplicationConfig['presenter']>, 'media'> & {
    media?: MediaConfigLayer;
  };
};
