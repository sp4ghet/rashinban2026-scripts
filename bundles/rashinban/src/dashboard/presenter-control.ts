import { REPLICANTS, type PresenterConnection, type PresenterRenderer, type PresenterClients } from '../types/replicants.ts';
import type { PresenterPublicConfig } from '../config/types.ts';
import { bindConfigurationControls, type ConfigurationControls } from './configuration-status.ts';
import type { DuelState, SeriesState, Timeline } from '../types/presenter.ts';
import type { PresenterSettings } from '../presenter/settings.ts';
import type { RuleContexts } from '../presenter/tie-range-context.ts';
import { CUE_KINDS, EMPTY_MEDIA, MUSIC_CONTEXTS, type AssetInventory, type MediaManifest, type Stem } from '../presenter/media.ts';
import type { PresenterMediaStatus } from '../types/replicants.ts';
import { mediaAssetOptions, mediaAssetsForCategory, mediaPlaybackUrl, type EffectiveAssetInventory, type MediaCategory } from '../config/media-url.ts';

const series = nodecg.Replicant<SeriesState>(REPLICANTS.presenterSeries);
const settings = nodecg.Replicant<PresenterSettings>(REPLICANTS.presenterSettings);
const ruleContexts = nodecg.Replicant<RuleContexts>(REPLICANTS.presenterRuleContexts);
const duel = nodecg.Replicant<DuelState | null>(REPLICANTS.presenterDuel);
const connection = nodecg.Replicant<PresenterConnection>(REPLICANTS.presenterConnection);
const timeline = nodecg.Replicant<Timeline>(REPLICANTS.presenterTimeline);
const renderer = nodecg.Replicant<PresenterRenderer>(REPLICANTS.presenterRenderer);
const clients = nodecg.Replicant<PresenterClients>(REPLICANTS.presenterClients);
const media = nodecg.Replicant<MediaManifest>(REPLICANTS.presenterMedia);
const mediaStatus = nodecg.Replicant<PresenterMediaStatus>(REPLICANTS.presenterMediaStatus);
const publicConfig = nodecg.Replicant<PresenterPublicConfig>(REPLICANTS.presenterPublicConfig);
const presenterAssets = nodecg.Replicant<EffectiveAssetInventory>(REPLICANTS.presenterAssets);
const legacyInventories = { music: nodecg.Replicant<AssetInventory>('assets:music'), effects: nodecg.Replicant<AssetInventory>('assets:effects'), video: nodecg.Replicant<AssetInventory>('assets:video') };
const element = (id: string) => document.getElementById(id)!;
const input = (id: string) => element(id) as HTMLInputElement;
const select = (id: string) => element(id) as HTMLSelectElement;
const settingsConfiguration: ConfigurationControls = bindConfigurationControls('presenterSettings', {
  status: 'settings-configuration-status', reset: 'settings-configuration-reset', importLocal: 'settings-configuration-import', error: 'settings-configuration-error',
}, () => applySettings(settings.value));
const mediaConfiguration: ConfigurationControls = bindConfigurationControls('presenterMedia', {
  status: 'media-configuration-status', reset: 'media-configuration-reset', importLocal: 'media-configuration-import', error: 'media-configuration-error',
}, () => applyMedia(media.value));

function showPublicConfig(value?: PresenterPublicConfig) {
  element('google-setup-status').textContent = value?.googleMapsApiKey.trim()
    ? 'Browser key configured.'
    : 'Browser key missing. Set it in the shared installation configuration to enable maps and Street View.';
}
publicConfig.on('change', showPublicConfig);
showPublicConfig(publicConfig.value);
element('google-referrer').textContent = `${location.origin}/*`;
function showInputDraft() {
  const replay = select('input-mode').value === 'replay';
  element('replay-controls').hidden = !replay;
  input('party-id').disabled = replay;
  element('reconnect').textContent = replay ? 'Apply replay / restart fixture' : 'Apply live / reconnect spectator';
}
select('input-mode').addEventListener('change', showInputDraft);

function assetOptions(menu: HTMLSelectElement, category: MediaCategory, chosen = menu.value) {
  const inventory = mediaAssetsForCategory(presenterAssets.value, category, legacyInventories[category].value ?? []);
  menu.replaceChildren(...mediaAssetOptions(inventory, chosen).map(option => new Option(option.label, option.value)));
  menu.value = chosen;
}
function refreshAssetOptions() {
  for (const category of ['music', 'effects', 'video'] as const) {
    document.querySelectorAll<HTMLSelectElement>(`select[data-assets="${category}"]`).forEach(menu => assetOptions(menu, category));
  }
}
presenterAssets.on('change', refreshAssetOptions);
for (const inventory of Object.values(legacyInventories)) inventory.on('change', () => {
  if (!presenterAssets.value) refreshAssetOptions();
});
function field(parent: HTMLElement, title: string, key: string, value: string, max?: number) {
  const label = document.createElement('label'); label.textContent = title;
  const el = document.createElement('input'); el.dataset.field = key; el.value = value;
  if (max !== undefined) { el.type = 'number'; el.min = '0'; el.max = String(max); el.step = 'any'; }
  label.append(el); parent.append(label); return el;
}
function menuField(parent: HTMLElement, title: string, category: MediaCategory, value: string) {
  const label = document.createElement('label'); label.textContent = title;
  const menu = document.createElement('select'); menu.dataset.assets = category; assetOptions(menu, category, value);
  label.append(menu); parent.append(label); return menu;
}
function addStem(stem: Stem) {
  const row = document.createElement('fieldset'); row.className = 'media-stem';
  field(row, 'Stem ID', 'id', stem.id); menuField(row, 'Music asset', 'music', stem.url);
  const numbers = document.createElement('div'); numbers.className = 'row'; row.append(numbers);
  field(numbers, 'Loop start (s)', 'loopStartS', String(stem.loopStartS), 86400); field(numbers, 'Loop end (s)', 'loopEndS', String(stem.loopEndS), 86400);
  for (const context of MUSIC_CONTEXTS) field(numbers, `${context} gain`, context, String(stem.gains[context]), 1);
  const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove stem'; remove.onclick = () => row.remove(); row.append(remove);
  element('media-stems').append(row);
}
for (const context of MUSIC_CONTEXTS) field(element('media-fades'), context, context, '0', 120000);
const cuePreview = element('cue-preview-audio') as HTMLAudioElement;
let stopPreview: ReturnType<typeof setTimeout> | undefined;
function stopCuePreview() { clearTimeout(stopPreview); cuePreview.pause(); cuePreview.removeAttribute('src'); cuePreview.load(); }
for (const kind of CUE_KINDS) {
  const menu = menuField(element('media-sounds'), kind, 'effects', ''); menu.dataset.cue = kind;
  const preview = document.createElement('button'); preview.type = 'button'; preview.dataset.previewCue = kind; preview.textContent = 'Preview here';
  preview.onclick = () => {
    stopCuePreview(); if (!menu.value) return;
    cuePreview.src = mediaPlaybackUrl(menu.value); cuePreview.loop = kind === 'count'; cuePreview.volume = 0.5;
    void cuePreview.play().catch(() => { element('error').textContent = 'Preview audio unavailable. Check the selected asset.'; });
    stopPreview = setTimeout(stopCuePreview, kind === 'count' ? 3000 : 10000);
  };
  menu.parentElement!.append(preview);
}
element('stop-cue-preview').onclick = stopCuePreview;
window.addEventListener('pagehide', stopCuePreview);
element('add-stem').onclick = () => addStem({ id: `stem-${document.querySelectorAll('.media-stem').length + 1}`, url: '', loopStartS: 0, loopEndS: 8, gains: { idle: 0, round: 0, urgent: 0, results: 0 } });
function applyMedia(value: MediaManifest | undefined) {
  if (!value) return;
  for (const variant of ['single', 'double'] as const) {
    const asset = value.fiveK[variant]; assetOptions(select(`${variant}-video`), 'video', asset?.url ?? '');
    select(`${variant}-soundtrack`).value = asset?.soundtrack ?? 'embedded'; input(`${variant}-watchdog`).value = String(asset?.watchdogMs ?? 10000);
  }
  element('media-stems').replaceChildren(); value.stems.forEach(addStem);
  for (const context of MUSIC_CONTEXTS) (element('media-fades').querySelector(`[data-field="${context}"]`) as HTMLInputElement).value = String(value.fadeMs[context]);
  for (const kind of CUE_KINDS) assetOptions(element('media-sounds').querySelector(`[data-cue="${kind}"]`) as HTMLSelectElement, 'effects', value.sounds[kind] ?? '');
}
media.on('change', value => mediaConfiguration.acceptProjection(() => applyMedia(value)));
mediaStatus.on('change', value => {
  const labels = { idle: 'No celebration yet', pending: 'Waiting for video completion', missing: 'Video not selected or unavailable; results revealed normally', complete: 'Video completed', failed: 'Video failed or autoplay was blocked; results revealed normally', watchdog: 'Video timed out; results revealed normally' };
  element('media-status').textContent = value ? `${value.effect === 'none' ? '' : value.effect + ' · '}${labels[value.status]}` : labels.idle;
});
element('media-form').addEventListener('submit', event => {
  event.preventDefault();
  const next = structuredClone(EMPTY_MEDIA);
  for (const variant of ['single', 'double'] as const) {
    const url = select(`${variant}-video`).value;
    next.fiveK[variant] = url ? { url, watchdogMs: Number(input(`${variant}-watchdog`).value), soundtrack: select(`${variant}-soundtrack`).value as 'embedded' | 'cue' | 'silent' } : null;
  }
  for (const row of document.querySelectorAll<HTMLElement>('.media-stem')) {
    const read = (key: string) => (row.querySelector(`[data-field="${key}"]`) as HTMLInputElement).value;
    next.stems.push({ id: read('id'), url: row.querySelector('select')!.value, loopStartS: Number(read('loopStartS')), loopEndS: Number(read('loopEndS')),
      gains: Object.fromEntries(MUSIC_CONTEXTS.map(context => [context, Number(read(context))])) as Stem['gains'] });
  }
  for (const context of MUSIC_CONTEXTS) next.fadeMs[context] = Number((element('media-fades').querySelector(`[data-field="${context}"]`) as HTMLInputElement).value);
  for (const kind of CUE_KINDS) { const url = (element('media-sounds').querySelector(`[data-cue="${kind}"]`) as HTMLSelectElement).value; if (url) next.sounds[kind] = url; }
  void control('media', next, 'error', mediaConfiguration);
});

async function control(action: string, body?: unknown, errorTarget = 'error', configuration?: ConfigurationControls) {
  element(errorTarget).textContent = '';
  try {
    await nodecg.sendMessage('presenter:control', { action, body, revision: configuration?.draft.expectedRevision() });
    configuration?.saved();
  }
  catch (cause) { element(errorTarget).textContent = cause instanceof Error ? cause.message : 'Change rejected. Check the values and NodeCG connection.'; }
}
function showSeries(value: SeriesState) { element("current-match-summary").textContent = `${value.left.name} ${value.left.wins} – ${value.right.wins} ${value.right.name}`; }
function status() {
  const context = ruleContexts.value?.[connection.value?.input ?? 'live'];
  const modeLabel = (mode: string) => mode === 'off' ? 'Off' : mode === 'full' ? 'Full' : 'Half';
  const configured = settings.value?.tieRange;
  const configuredMode = configured?.enabled ? configured.mode : 'off';
  const active = context && context.source.gameId === connection.value?.gameId ? context : null;
  element('tie-range-status').textContent = active
    ? `Active duel: ${modeLabel(active.mode)}${active.mode !== configuredMode ? ` · Next duel: ${modeLabel(configuredMode)}` : ''}`
    : `Next duel: ${modeLabel(configuredMode)}`;
  const labels = { unreported: 'No graphic report', loading: 'Loading Google Maps', 'api-ready': 'Google Maps API loaded',
    'missing-key': 'Google Maps browser key missing', 'api-error': 'Google Maps API unavailable', 'view-error': 'Google Maps view unavailable', 'pano-error': 'Exact Street View panorama unavailable' };
  element('renderer-status').textContent = labels[renderer.value?.status ?? 'unreported'];
  const audience = clients.value;
  const owner = audience?.program?.clientId;
  element('program-status').textContent = owner ? `Program: ${owner.slice(0, 8)}` : 'No active program';
  const audioOwner = audience?.audio;
  element('program-status').textContent += audioOwner ? ` · Audio: ${audioOwner.clientId.slice(0, 8)} (${audioOwner.mode}${audioOwner.releasing ? ', waiting for mute' : ''})` : ' · No audio owner';
  const menu = select('program-client'); const selected = menu.value;
  menu.replaceChildren(new Option('Choose program source', ''));
  const list = element('client-list'); list.replaceChildren();
  for (const client of audience?.clients ?? []) {
    const label = `${client.clientId.slice(0, 8)} · ${client.role}${client.clientId === owner ? ' · active' : ''}`;
    const readiness = client.role === 'audio' ? (client.clockFresh ? 'clock ready' : 'clock not ready')
      : `${client.ready ? 'graphics ready' : 'graphics not ready'} · ${labels[client.renderer.status]}`;
    const row = document.createElement('div'); row.textContent = `${label} · ${readiness}`;
    row.textContent += ` · Audio: ${client.audio?.state ?? 'unreported'}${client.audio?.missing.length ? ' · unavailable audio: ' + client.audio.missing.join(', ') : ''}`;
    row.title = client.clientId; list.append(row);
    if (client.role === 'program' && client.clientId !== owner) menu.add(new Option(label, client.clientId));
  }
  menu.value = [...menu.options].some(option => option.value === selected) ? selected : '';
  (element('transfer-program') as HTMLButtonElement).disabled = !menu.value;
  const value = connection.value;
  const replay = value?.input === 'replay';
  element('replay-label').hidden = !replay;
  element('party-selection').textContent = `Selected: ${value?.selectedPartyId ?? 'automatic'} · Config default: ${value?.configuredPartyId ?? 'automatic'} · Connected party: ${value?.partyId ?? 'none'}`;
  element('connection-status').textContent = value ? `${replay ? 'Replay' : 'Spectator'} · ${value.state}` : 'Connecting to NodeCG…';
  element('game-status').textContent = `${duel.value?.mode ?? 'No game'} · ${timeline.value?.phase ?? 'waiting-game'}${duel.value ? ` · Round ${duel.value.round}` : ''}`;
  element('server-warning').textContent = [value?.error, ...(value?.warnings ?? [])].filter(Boolean).join(' · ');
  const match = series.value;
  const missing = match ? (['left', 'right'] as const).filter(side => !duel.value?.players.some(player => player.id === match[side].playerId)) : [];
  element('mapping-warning').textContent = missing.length ? `Player mapping needed: ${missing.join(', ')}. Health and results stay blank until mapped.` : '';
}
series.on('change', value => { if (value) showSeries(value); status(); });
function applySettings(value: PresenterSettings | undefined) {
  if (!value) return;
  select('view-source').value = value.viewSource; select('key-color').value = value.keyColor;
  select('audio-output').value = value.audioOutput; input('muted').checked = value.muted;
  input('music-gain').value = String(value.musicGain); input('effects-gain').value = String(value.effectsGain);
  input('tie-range-enabled').checked = value.tieRange?.enabled ?? false;
  select('tie-range-mode').value = value.tieRange?.mode ?? 'full';
  select('tie-range-mode').disabled = !input('tie-range-enabled').checked;
  element('audio-launch-help').textContent = value.audioOutput === 'separate'
    ? 'Open Program graphic and Separate audio.'
    : 'Open Program graphic for video and audio.';
}
settings.on('change', value => { settingsConfiguration.acceptProjection(() => applySettings(value)); status(); });
ruleContexts.on('change', status);
input('tie-range-enabled').addEventListener('change', () => { select('tie-range-mode').disabled = !input('tie-range-enabled').checked; });
duel.on('change', status);
let partyInitialized = false;
connection.on('change', (value, previous) => {
  if (value && (!previous || value.input !== previous.input)) { select('input-mode').value = value.input; showInputDraft(); }
  if (value && !partyInitialized) { input('party-id').value = value.selectedPartyId ?? ''; partyInitialized = true; }
  if (value?.replayFixture && value.replayFixture !== previous?.replayFixture) select('replay-fixture').value = value.replayFixture;
  status();
});
timeline.on('change', status);
renderer.on('change', status);
clients.on('change', status);
select('program-client').addEventListener('change', () => { (element('transfer-program') as HTMLButtonElement).disabled = !select('program-client').value; });
element('transfer-program').addEventListener('click', () => { const clientId = select('program-client').value; if (clientId) void control('program/transfer', { clientId }); });
element('settings-form').addEventListener('submit', event => {
  event.preventDefault(); if (!settings.value) return;
  void control('settings', { ...settings.value, viewSource: select('view-source').value, keyColor: select('key-color').value,
    audioOutput: select('audio-output').value, muted: input('muted').checked,
    musicGain: Number(input('music-gain').value), effectsGain: Number(input('effects-gain').value),
    tieRange: { enabled: input('tie-range-enabled').checked, mode: select('tie-range-mode').value } }, 'error', settingsConfiguration);
});
element('reconnect').addEventListener('click', () => {
  const mode = select('input-mode').value;
  const partyId = input('party-id').value.trim();
  if (mode === 'live' && partyId && !/^(?:[\w-]{1,128}|https:\/\/www\.geoguessr\.com\/party\/broadcast\/[\w-]{1,128})$/.test(partyId)) {
    element('source-error').textContent = 'Enter a party ID (letters, digits, underscores or hyphens), the exact https://www.geoguessr.com/party/broadcast/partyId URL, or leave blank for automatic discovery.';
    return;
  }
  void control('reconnect', mode === 'replay' ? { input: mode, fixture: select('replay-fixture').value } : { input: mode, partyId }, 'source-error');
});

element('settings-form').addEventListener('input', () => settingsConfiguration.draft.markDirty());
element('settings-form').addEventListener('change', () => settingsConfiguration.draft.markDirty());
element('media-form').addEventListener('input', () => mediaConfiguration.draft.markDirty());
element('media-form').addEventListener('change', () => mediaConfiguration.draft.markDirty());
if (settings.value) settingsConfiguration.acceptProjection(() => applySettings(settings.value));
if (media.value) mediaConfiguration.acceptProjection(() => applyMedia(media.value));
