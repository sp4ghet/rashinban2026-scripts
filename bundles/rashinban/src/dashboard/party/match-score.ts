import { MATCH_MESSAGES, REPLICANTS } from '../../types/replicants.ts';
import type { MatchState, ResolvedMatch } from '../../match/state.ts';

/** Edits the same authoritative scores used by Shared / Current Match. */
export function bindMatchScore() {
  const match = nodecg.Replicant<MatchState | null>(REPLICANTS.matchState);
  const resolved = nodecg.Replicant<ResolvedMatch | null>(REPLICANTS.matchResolved);
  const el = (id: string) => document.getElementById(`match-score-${id}`)!;
  const field = (side: 'left' | 'right') => el(side) as HTMLInputElement;
  const button = (id: string) => el(id) as HTMLButtonElement;
  const form = el('form') as HTMLFormElement;
  const sides = ['left', 'right'] as const;
  let current: MatchState | null = match.value ?? null;
  let draftRevision: number | null = null;
  let saving = false;

  function showError(message = '') {
    el('error').textContent = message;
    el('error').hidden = !message;
  }
  function render() {
    const conflict = draftRevision !== null && draftRevision !== current?.revision;
    const disabled = !current || saving || conflict;
    for (const side of sides) {
      if (draftRevision === null) field(side).value = String(current?.[side].wins ?? 0);
      field(side).disabled = !current || saving;
      const name = resolved.value?.revision === current?.revision ? resolved.value?.[side].name : current?.[side].name || current?.[side].tag;
      el(`label-${side}`).textContent = `${side === 'left' ? 'Left / A' : 'Right / B'}${name ? ` · ${name}` : ''}`;
      button(`increment-${side}`).disabled = disabled || !field(side).validity.valid || Number(field(side).value) >= Number(field(side).max);
    }
    button('apply').disabled = disabled || draftRevision === null;
    button('reset').disabled = disabled;
    button('reload').hidden = draftRevision === null;
    button('reload').disabled = saving;
    el('status').textContent = saving ? 'Saving...' : !current ? 'Loading current match...'
      : conflict ? 'Current Match changed elsewhere. Discard score edits to reload.'
      : draftRevision !== null ? 'Unsaved score edits' : 'Shared with Current Match';
  }
  async function save(action: 'apply' | 'reset' | 'left' | 'right') {
    if (!current || saving || draftRevision !== null && draftRevision !== current.revision) return;
    if (action !== 'reset' && !form.reportValidity()) return;
    // JSON cloning also supports NodeCG Replicant proxies.
    const next: MatchState = JSON.parse(JSON.stringify(current));
    for (const side of sides) next[side].wins = action === 'reset' ? 0 : Number(field(side).value) + (action === side ? 1 : 0);
    draftRevision ??= current.revision;
    saving = true; showError(); render();
    try {
      const saved = await nodecg.sendMessage(MATCH_MESSAGES.apply, next) as MatchState;
      if (!current || saved.revision >= current.revision) current = saved;
      draftRevision = null;
    } catch (error) {
      const detail = typeof error === 'string' ? error : error && typeof error === 'object' && 'message' in error ? error.message : null;
      showError(typeof detail === 'string' ? detail : 'Could not save Match Score. Try again after reloading the score.');
    } finally { saving = false; render(); }
  }
  for (const side of sides) {
    field(side).addEventListener('input', () => { draftRevision ??= current?.revision ?? null; showError(); render(); });
    button(`increment-${side}`).addEventListener('click', () => { void save(side); });
  }
  form.addEventListener('submit', event => { event.preventDefault(); void save('apply'); });
  button('reset').addEventListener('click', () => { void save('reset'); });
  button('reload').addEventListener('click', () => { draftRevision = null; showError(); render(); });
  match.on('change', value => {
    if (!value || !current || value.revision >= current.revision) current = value ?? null;
    render();
  });
  resolved.on('change', render);
  render();
}
