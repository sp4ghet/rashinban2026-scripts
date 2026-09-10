import { REPLICANTS, type PresenterConnection, type PresenterRenderer, type PresenterClients } from '../types/replicants.ts';
import type { DuelState, SeriesState, Timeline } from '../types/presenter.ts';
import type { PresenterSettings } from '../presenter/settings.ts';

const series = nodecg.Replicant<SeriesState>(REPLICANTS.presenterSeries);
const settings = nodecg.Replicant<PresenterSettings>(REPLICANTS.presenterSettings);
const duel = nodecg.Replicant<DuelState | null>(REPLICANTS.presenterDuel);
const connection = nodecg.Replicant<PresenterConnection>(REPLICANTS.presenterConnection);
const timeline = nodecg.Replicant<Timeline>(REPLICANTS.presenterTimeline);
const renderer = nodecg.Replicant<PresenterRenderer>(REPLICANTS.presenterRenderer);
const clients = nodecg.Replicant<PresenterClients>(REPLICANTS.presenterClients);
const element = (id: string) => document.getElementById(id)!;
const input = (id: string) => element(id) as HTMLInputElement;
const select = (id: string) => element(id) as HTMLSelectElement;
let seriesDraft: SeriesState | null = null;

async function control(action: string, body?: unknown) {
  element('error').textContent = '';
  try { await nodecg.sendMessage('presenter:control', { action, body }); }
  catch { element('error').textContent = 'Change rejected. Check the values and NodeCG connection.'; }
}
function mappingOptions(initialize = false) {
  for (const side of ['left', 'right'] as const) {
    const menu = select(`${side}-player`);
    const selected = initialize ? seriesDraft?.[side].playerId ?? '' : menu.value;
    menu.replaceChildren(new Option('Not mapped', ''));
    for (const player of duel.value?.players ?? []) menu.add(new Option(`${player.teamColor} · ${player.id}`, player.id));
    if (selected && !(duel.value?.players.some(player => player.id === selected))) menu.add(new Option(`Unavailable · ${selected}`, selected));
    menu.value = selected;
  }
}
function showSeries(value: SeriesState) {
  // Browser Replicant values are proxies and cannot be structuredClone'd.
  seriesDraft = { ...value, left: { ...value.left }, right: { ...value.right } };
  mappingOptions(true);
  for (const side of ['left', 'right'] as const) {
    input(`${side}-name`).value = value[side].name;
    input(`${side}-handle`).value = value[side].handle;
    input(`${side}-wins`).value = String(value[side].wins);
    select(`${side}-player`).value = value[side].playerId ?? '';
  }
}
function status() {
  const labels = { unreported: 'No graphic report', loading: 'Loading Google Maps', 'api-ready': 'Google Maps API loaded; check views on graphic',
    'missing-key': 'Google Maps browser key missing', 'api-error': 'Google Maps API unavailable', 'view-error': 'Google Maps view unavailable', 'pano-error': 'Exact Street View panorama unavailable' };
  element('renderer-status').textContent = labels[renderer.value?.status ?? 'unreported'];
  const audience = clients.value;
  const owner = audience?.program?.clientId;
  element('program-status').textContent = owner ? `Program: ${owner.slice(0, 8)}` : 'No active program';
  const menu = select('program-client'); const selected = menu.value;
  menu.replaceChildren(new Option('Choose program source', ''));
  const list = element('client-list'); list.replaceChildren();
  for (const client of audience?.clients ?? []) {
    const label = `${client.clientId.slice(0, 8)} · ${client.role}${client.clientId === owner ? ' · active' : ''}`;
    const row = document.createElement('div'); row.textContent = `${label} · ${client.ready ? 'ready' : 'not ready'} · ${labels[client.renderer.status]}`;
    row.title = client.clientId; list.append(row);
    if (client.role === 'program' && client.clientId !== owner) menu.add(new Option(label, client.clientId));
  }
  menu.value = [...menu.options].some(option => option.value === selected) ? selected : '';
  (element('transfer-program') as HTMLButtonElement).disabled = !menu.value;
  const value = connection.value;
  const replay = value?.input === 'replay';
  element('replay-label').hidden = !replay;
  element('replay-controls').hidden = !replay;
  element('reconnect').textContent = replay ? 'Restart selected replay' : 'Reconnect spectator';
  element('connection-status').textContent = value ? `${replay ? 'Replay' : 'Spectator'} · ${value.state}` : 'Connecting to NodeCG…';
  element('game-status').textContent = `${duel.value?.mode ?? 'No game'} · ${timeline.value?.phase ?? 'waiting-game'}${duel.value ? ` · Round ${duel.value.round}` : ''}`;
  element('server-warning').textContent = [value?.error, ...(value?.warnings ?? [])].filter(Boolean).join(' · ');
  const match = series.value;
  const missing = match ? (['left', 'right'] as const).filter(side => !duel.value?.players.some(player => player.id === match[side].playerId)) : [];
  element('mapping-warning').textContent = missing.length ? `Player mapping needed: ${missing.join(', ')}. Health and results stay blank until mapped.` : '';
}
series.on('change', value => { if (value) showSeries(value); status(); });
settings.on('change', value => {
  if (!value) return;
  select('view-source').value = value.viewSource; select('key-color').value = value.keyColor;
  select('audio-output').value = value.audioOutput; input('muted').checked = value.muted;
  input('music-gain').value = String(value.musicGain); input('effects-gain').value = String(value.effectsGain);
});
duel.on('change', () => { mappingOptions(); status(); });
connection.on('change', (value, previous) => {
  if (value?.replayFixture && value.replayFixture !== previous?.replayFixture) select('replay-fixture').value = value.replayFixture;
  status();
});
timeline.on('change', status);
renderer.on('change', status);
clients.on('change', status);
select('program-client').addEventListener('change', () => { (element('transfer-program') as HTMLButtonElement).disabled = !select('program-client').value; });
element('transfer-program').addEventListener('click', () => { const clientId = select('program-client').value; if (clientId) void control('program/transfer', { clientId }); });
function readSeries(): SeriesState | null {
  if (!seriesDraft) return null;
  const value = structuredClone(seriesDraft);
  for (const side of ['left', 'right'] as const) {
    value[side] = { ...value[side], name: input(`${side}-name`).value, handle: input(`${side}-handle`).value,
      wins: Number(input(`${side}-wins`).value), playerId: select(`${side}-player`).value || null };
  }
  return value;
}
element('series-form').addEventListener('submit', event => { event.preventDefault(); const value = readSeries(); if (value) void control('series', value); });
element('swap').addEventListener('click', () => { const value = readSeries(); if (value) showSeries({ ...value, left: value.right, right: value.left }); });
element('settings-form').addEventListener('submit', event => {
  event.preventDefault(); if (!settings.value) return;
  void control('settings', { ...settings.value, viewSource: select('view-source').value, keyColor: select('key-color').value,
    audioOutput: select('audio-output').value, muted: input('muted').checked,
    musicGain: Number(input('music-gain').value), effectsGain: Number(input('effects-gain').value) });
});
element('reconnect').addEventListener('click', () => void control('reconnect', connection.value?.input === 'replay' ? { fixture: select('replay-fixture').value } : undefined));
