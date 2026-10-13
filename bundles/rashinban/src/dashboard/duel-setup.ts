// Shared-workspace card for the controls operators touch every match: the
// presenter's input source and the Pinpointing Duels toggle. Everything else
// about the presenter stays in Config → Duels Presenter.
import { REPLICANTS, type PresenterConnection } from '../types/replicants.ts';
import type { PresenterSettings } from '../presenter/settings.ts';
import type { RuleContexts } from '../presenter/tie-range-context.ts';

const settings = nodecg.Replicant<PresenterSettings>(REPLICANTS.presenterSettings);
const ruleContexts = nodecg.Replicant<RuleContexts>(REPLICANTS.presenterRuleContexts);
const connection = nodecg.Replicant<PresenterConnection>(REPLICANTS.presenterConnection);
const element = (id: string) => document.getElementById(id)!;
const input = (id: string) => element(id) as HTMLInputElement;
const select = (id: string) => element(id) as HTMLSelectElement;

async function control(action: string, body: unknown, errorTarget: string): Promise<boolean> {
  element(errorTarget).textContent = '';
  try {
    await nodecg.sendMessage('presenter:control', { action, body });
    return true;
  }
  catch (cause) {
    element(errorTarget).textContent = cause instanceof Error ? cause.message : 'Change rejected. Check the values and NodeCG connection.';
    return false;
  }
}

function showInputDraft() {
  const replay = select('input-mode').value === 'replay';
  element('replay-controls').hidden = !replay;
  input('party-id').disabled = replay;
  element('reconnect').textContent = replay ? 'Apply replay / restart fixture' : 'Apply live / reconnect spectator';
}
select('input-mode').addEventListener('change', showInputDraft);

function status() {
  const value = connection.value;
  const replay = value?.input === 'replay';
  element('replay-label').hidden = !replay;
  element('connection-status').textContent = value ? `${replay ? 'Replay' : 'Spectator'} · ${value.state}` : 'Connecting to NodeCG…';
  element('party-selection').textContent = `Selected: ${value?.selectedPartyId ?? 'automatic'} · Config default: ${value?.configuredPartyId ?? 'automatic'} · Connected party: ${value?.partyId ?? 'none'}`;

  const context = ruleContexts.value?.[value?.input ?? 'live'];
  const active = context && context.source.gameId === value?.gameId ? context : null;
  const pointsLabel = (enabled: boolean) => enabled ? 'Pinpointing Duels' : 'Health duel';
  const configured = settings.value?.pinpointing?.enabled ?? false;
  const activePinpointing = active ? active.pinpointing === true : null;
  element('pinpointing-status').textContent = activePinpointing !== null
    ? `Active duel: ${pointsLabel(activePinpointing)}${activePinpointing !== configured ? ` · Next duel: ${pointsLabel(configured)}` : ''}`
    : `Next duel: ${pointsLabel(configured)}`;
}

let partyInitialized = false;
connection.on('change', (value, previous) => {
  if (value && (!previous || value.input !== previous.input)) { select('input-mode').value = value.input; showInputDraft(); }
  if (value && !partyInitialized) { input('party-id').value = value.selectedPartyId ?? ''; partyInitialized = true; }
  if (value?.replayFixture && value.replayFixture !== previous?.replayFixture) select('replay-fixture').value = value.replayFixture;
  status();
});
settings.on('change', value => {
  if (value) input('pinpointing-enabled').checked = value.pinpointing?.enabled ?? false;
  status();
});
ruleContexts.on('change', status);

element('reconnect').addEventListener('click', () => {
  const mode = select('input-mode').value;
  const partyId = input('party-id').value.trim();
  if (mode === 'live' && partyId && !/^(?:[\w-]{1,128}|https:\/\/www\.geoguessr\.com\/party\/broadcast\/[\w-]{1,128})$/.test(partyId)) {
    element('source-error').textContent = 'Enter a party ID (letters, digits, underscores or hyphens), the exact https://www.geoguessr.com/party/broadcast/partyId URL, or leave blank for automatic discovery.';
    return;
  }
  void control('reconnect', mode === 'replay' ? { input: mode, fixture: select('replay-fixture').value } : { input: mode, partyId }, 'source-error');
});

input('pinpointing-enabled').addEventListener('change', async () => {
  const toggle = input('pinpointing-enabled');
  if (!settings.value) { toggle.checked = !toggle.checked; return; }
  toggle.disabled = true;
  const ok = await control('settings', { ...settings.value, pinpointing: { enabled: toggle.checked } }, 'pinpointing-error');
  if (!ok) toggle.checked = settings.value?.pinpointing?.enabled ?? false;
  toggle.disabled = false;
});
