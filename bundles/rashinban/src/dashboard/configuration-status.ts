import type { ConfigSection, ConfigStatus } from '../config/types.ts';
import { CONFIGURATION_MESSAGES, REPLICANTS } from '../types/replicants.ts';

export class ConfigurationDraft {
  private currentRevision: string | undefined;
  private loadedRevision: string | undefined;
  private dirty = false;
  private hasLoaded = false;

  observeRevision(revision: string): void {
    this.currentRevision = revision;
    if (!this.dirty && this.hasLoaded) this.loadedRevision = revision;
  }

  loaded(): void {
    this.dirty = false;
    this.hasLoaded = true;
    this.loadedRevision = this.currentRevision;
  }

  markDirty(): void { this.dirty = true; }
  isDirty(): boolean { return this.dirty; }

  saved(): void {
    this.dirty = false;
    this.loadedRevision = this.currentRevision;
  }

  expectedRevision(): string | undefined { return this.loadedRevision; }
}

export type ConfigurationControls = {
  draft: ConfigurationDraft;
  acceptProjection(apply: () => void): void;
  saved(): void;
};

export function bindConfigurationControls(
  section: ConfigSection,
  ids: { status: string; reset: string; importLocal: string; error: string },
  afterMutation: () => void = () => {},
): ConfigurationControls {
  const draft = new ConfigurationDraft();
  const status = nodecg.Replicant<ConfigStatus>(REPLICANTS.configurationStatus);
  const statusElement = document.getElementById(ids.status)!;
  const reset = document.getElementById(ids.reset) as HTMLButtonElement;
  const importLocal = document.getElementById(ids.importLocal) as HTMLButtonElement;
  const error = document.getElementById(ids.error)!;

  const render = (value?: ConfigStatus) => {
    if (!value) return;
    draft.observeRevision(value.revision);
    const overridden = value.overridden.includes(section);
    statusElement.textContent = `${value.scope === 'worktree' ? 'Worktree overrides' : 'Shared configuration'} · ${overridden ? 'section overridden' : 'using shared/default values'}${value.error ? `\n${value.error}` : ''}`;
    reset.disabled = value.scope !== 'worktree' || !overridden;
    importLocal.disabled = value.scope !== 'worktree';
    error.textContent = value.error ?? '';
  };
  status.on('change', render);
  if (status.value) render(status.value);

  async function mutate(message: string): Promise<void> {
    error.textContent = '';
    try {
      await nodecg.sendMessage(message, { section, revision: draft.expectedRevision() });
      draft.saved();
      afterMutation();
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : 'Configuration change rejected';
    }
  }
  reset.addEventListener('click', () => void mutate(CONFIGURATION_MESSAGES.reset));
  importLocal.addEventListener('click', () => void mutate(CONFIGURATION_MESSAGES.importLocal));

  return {
    draft,
    acceptProjection(apply) {
      if (draft.isDirty()) return;
      apply();
      draft.loaded();
    },
    saved() { draft.saved(); },
  };
}
