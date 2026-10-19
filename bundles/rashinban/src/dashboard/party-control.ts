import { REPLICANTS, type PresenterConnection } from '../types/replicants.ts';
import { bindMatchScore } from './party/match-score.ts';
import type { DuelState, Views } from '../types/presenter.ts';
import { EMPTY_PARTY_STATUS, PARTY_MESSAGES, type PartyAction, type PartyStatus, type Settings } from '../party/types.ts';
import { lobbyStartBlockReason, phase } from '../party/state.ts';
import { buildPartyScoreboard, type PartyScoreboard } from '../party/scoreboard.ts';
import { predictRound } from '../party/prediction.ts';
import type { PresenterSettings } from '../presenter/settings.ts';
import { EMPTY_INTERMISSION, type Intermission } from '../presenter/intermission.ts';
import type { RuleContexts } from '../presenter/tie-range-context.ts';
import type { ConfigStatus } from '../config/types.ts';
import { TOURNAMENT_PRESETS, presetSettings, type PresetSettings, type PresenterRulesPatch } from '../party/presets.ts';

bindMatchScore();

const partyRep = nodecg.Replicant<PartyStatus>(REPLICANTS.partyStatus);
const connection = nodecg.Replicant<PresenterConnection>(REPLICANTS.presenterConnection);
const presenter = nodecg.Replicant<DuelState | null>(REPLICANTS.presenterDuel);
const views = nodecg.Replicant<Views | null>(REPLICANTS.presenterViews);
const presenterSettings = nodecg.Replicant<PresenterSettings>(REPLICANTS.presenterSettings);
const intermission = nodecg.Replicant<Intermission>(REPLICANTS.presenterIntermission);
const ruleContexts = nodecg.Replicant<RuleContexts>(REPLICANTS.presenterRuleContexts);
const configuration = nodecg.Replicant<ConfigStatus>(REPLICANTS.configurationStatus);
const el = (id: string) => document.getElementById(id)!;
const input = (id: string) => el(id) as HTMLInputElement;
const button = (id: string) => el(id) as HTMLButtonElement;
const menu = (id: string) => el(id) as HTMLSelectElement;
const fields = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]')];
let state: PartyStatus = structuredClone(EMPTY_PARTY_STATUS);
let working = false, dirty = false, draftRevision = '', draftPartyId: string | null = null;
let draft: { gameType: string; gameSettings: Settings; settings: Settings } | null = null;
let rosterKey = '', teamKey = '', predictionKey = '', activityKey = '', sourceInitialized = false;
let submittedSettingsId: string | null = null;
let presetDraft: PresetSettings | null = null, presetRevision: string | null = null, presetDraftName = '';
for (const day of [1, 2]) {
  const group = document.createElement('optgroup'); group.label = `Day ${day}`;
  for (const preset of TOURNAMENT_PRESETS.filter(preset => preset.day === day)) {
    group.append(new Option(`${preset.mode === 'MOVE' ? day === 2 ? 'Move (Pinpointing)' : 'Move' : preset.mode === 'NM' ? 'NoMove' : 'NMPZ'} · ${preset.map}`, preset.id));
  }
  menu('tournament-preset').append(group);
}

function showError(message = '') { el('error').textContent = message; el('error').hidden = !message; }
function notice(id: string, message: string) { el(id).textContent = message; el(id).hidden = !message; }
function currentEnough() { return state.updatedAtMs !== null && Date.now() - state.updatedAtMs < 15_000; }
function available() { return state.state === 'ready' && state.canManage && currentEnough() && !state.busy && !state.pending && !working; }
function canAbort() {
  const pausePending = state.activity.find(a => a.id === state.pending)?.action === 'pause';
  return state.state === 'ready' && state.canManage && currentEnough() && !state.busy && !working && (!state.pending || pausePending);
}
function lobbyAvailable() { return available() && state.party?.gameState !== 'Ongoing'; }

const actionLabels: Record<PartyAction, string> = {
  startGame: 'Start duel', startRound: 'Start round', pause: 'Pause after round', resume: 'Release held result',
  abort: 'Abort duel', rollback: 'Roll back', settings: 'Apply settings', bench: 'Bench player', unbench: 'Activate player',
  swap: 'Swap players', team: 'Assign team', kick: 'Kick player', ban: 'Ban player', unban: 'Unban player', mute: 'Mute chat', unmute: 'Unmute chat', host: 'Transfer host',
};
async function message(name: string, body?: unknown) {
  showError(); working = true; render();
  try { await nodecg.sendMessage(name, body); }
  catch (error) {
    // NodeCG serializes acknowledgement errors into plain objects across Socket.IO.
    const detail = typeof error === 'string' ? error
      : error && typeof error === 'object' && 'message' in error ? error.message : null;
    showError(typeof detail === 'string' && detail.trim() ? detail : 'Command failed. Refresh and inspect the current state.');
  }
  finally { working = false; render(); }
}
async function command(action: PartyAction, body: Record<string, unknown> = {}, confirmText?: string) {
  if (!(action === 'abort' ? canAbort() : available()) || !state.party) return;
  // Command IDs are opaque deduplication keys. getRandomValues also works on HTTP LAN dashboards.
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  const request = { id, action, partyId: state.party.partyId, gameId: state.duel?.gameId ?? null,
    round: state.duel?.round ?? null, sourceGeneration: state.sourceGeneration, body, ...(action === 'settings' ? { settingsRevision: draftRevision } : {}) };
  if (confirmText && !window.confirm(confirmText)) return;
  if (action === 'settings') submittedSettingsId = request.id;
  await message(PARTY_MESSAGES.command, request);
}

function loadDraft() {
  if (!state.party) return;
  draft = { gameType: state.party.gameType, gameSettings: { ...state.party.gameSettings }, settings: { ...state.party.settings } };
  draftPartyId = state.party.partyId; draftRevision = state.settingsRevision; dirty = false;
  presetDraft = null; presetRevision = null; presetDraftName = '';
  menu('tournament-preset').value = '';
  fillDraftFields(draft);
  render();
}
function fillDraftFields(values: NonNullable<typeof draft>) {
  for (const field of fields) {
    const key = field.dataset.key!;
    const group = field.dataset.group!;
    const value = group === 'root' ? values.gameType : values[group as 'gameSettings' | 'settings'][key];
    field.disabled = value === undefined;
    if (field instanceof HTMLInputElement && field.type === 'checkbox') field.checked = value === true;
    else field.value = value === undefined ? '' : String(typeof value === 'number' ? value / Number(field.dataset.scale ?? 1) : value);
  }
  const g = values.gameSettings;
  menu('movement').value = !g.forbidMoving && !g.forbidRotating && !g.forbidZooming ? 'MOVE'
    : g.forbidMoving && !g.forbidRotating && !g.forbidZooming ? 'NM'
    : g.forbidMoving && g.forbidRotating && g.forbidZooming ? 'NMPZ' : 'CUSTOM';
}
function draftPatch() {
  const patch: { gameType?: string; gameSettings: Settings; settings: Settings; presenterRules?: PresenterRulesPatch; presenterRevision?: string } = {
    gameSettings: { ...presetDraft?.gameSettings }, settings: { ...presetDraft?.settings },
    ...(presetDraft ? { gameType: presetDraft.gameType, presenterRules: presetDraft.presenterRules, presenterRevision: presetRevision! } : {}),
  };
  if (!draft) throw new Error('Load party settings first.');
  for (const field of fields) {
    if (field.disabled) continue;
    const key = field.dataset.key!, group = field.dataset.group!;
    let value: string | number | boolean = field instanceof HTMLInputElement && field.type === 'checkbox' ? field.checked
      : field instanceof HTMLInputElement && field.type === 'number' ? Number(field.value) * Number(field.dataset.scale ?? 1) : field.value.trim();
    if (key === 'mapSlug' && typeof value === 'string' && value.startsWith('https://')) {
      const match = /^https:\/\/www\.geoguessr\.com\/maps\/([\w-]+)\/?$/.exec(value);
      if (!match) throw new Error('Use a GeoGuessr map ID or https://www.geoguessr.com/maps/mapId URL.');
      value = match[1];
    }
    if (group === 'root') { if (value !== draft.gameType) patch.gameType = String(value); else delete patch.gameType; }
    else if (value !== draft[group as 'gameSettings' | 'settings'][key]) patch[group as 'gameSettings' | 'settings'][key] = value;
    else delete patch[group as 'gameSettings' | 'settings'][key];
  }
  if (menu('movement').value !== 'CUSTOM') {
    const mode = menu('movement').value;
    const flags = { forbidMoving: mode !== 'MOVE', forbidRotating: mode === 'NMPZ', forbidZooming: mode === 'NMPZ' };
    for (const [key, value] of Object.entries(flags)) {
      if (draft.gameSettings[key] !== value) patch.gameSettings[key] = value; else delete patch.gameSettings[key];
    }
  }
  return patch;
}

function loadPreset() {
  const preset = TOURNAMENT_PRESETS.find(preset => preset.id === menu('tournament-preset').value);
  if (!preset || !lobbyAvailable() || !configuration.value?.revision || !presenterSettings.value) return;
  loadDraft();
  if (!draft) return;
  menu('tournament-preset').value = preset.id;
  presetDraft = presetSettings(preset.id); presetRevision = configuration.value.revision;
  presetDraftName = `Day ${preset.day} · ${preset.mode} · ${preset.map}`;
  fillDraftFields({ gameType: presetDraft.gameType, gameSettings: { ...draft.gameSettings, ...presetDraft.gameSettings }, settings: { ...draft.settings, ...presetDraft.settings } });
  dirty = true; render();
}

function populateMenu(id: string) {
  const select = menu(id), previous = select.value;
  select.replaceChildren(new Option('Choose player…', ''));
  for (const member of state.members) if (member.userId !== state.party?.owner.userId) select.add(new Option(member.nick || member.userId, member.userId));
  select.value = previous;
}
function renderRoster() {
  const canEdit = lobbyAvailable();
  const key = JSON.stringify([state.members, state.party?.owner, state.party?.gameType, state.party?.bannedPlayerIds, canEdit]);
  if (rosterKey === key) return;
  rosterKey = key;
  el('members').replaceChildren();
  if (!state.members.length) el('members').textContent = 'No roster available.';
  for (const member of state.members) {
    const row = document.createElement('div'); row.className = 'member';
    const info = document.createElement('div'); info.className = 'member-info';
    const name = document.createElement('strong'); name.textContent = member.nick || member.userId;
    const meta = document.createElement('small');
    const host = member.userId === state.party?.owner.userId;
    const presence = !member.isPresent ? 'Away' : member.isPlaying ? member.isInCurrentGame ? 'In current duel' : 'In game / results' : 'In lobby';
    meta.textContent = [host ? 'Host' : member.isBenched ? 'Bench' : 'Playing slot', member.team, presence, member.benchReason].filter(Boolean).join(' · ');
    info.append(name, meta); row.append(info);
    if (!host) {
      if (state.party?.gameType === 'TeamDuels') {
        const select = document.createElement('select'); select.setAttribute('aria-label', `Team for ${member.nick}`);
        select.add(new Option('Unassigned', '')); select.add(new Option('Blue', 'blue')); select.add(new Option('Red', 'red'));
        select.value = member.team ?? ''; select.disabled = !canEdit;
        select.addEventListener('change', () => { if (select.value) void command('team', { userId: member.userId, teamName: select.value }); }); row.append(select);
      }
      const full = member.isBenched && (member.benchReason === 'RosterFull' || state.party?.gameType === 'Duels'
        && state.members.filter(m => !m.isBenched && m.userId !== state.party?.owner.userId).length >= 2);
      const action = document.createElement('button'); action.textContent = full ? 'Swap required' : member.isBenched ? 'Activate' : 'Bench'; action.disabled = !canEdit || full;
      if (full) action.title = 'Swap with one of the playing slots below.';
      action.addEventListener('click', () => { void command(member.isBenched ? 'unbench' : 'bench', { userId: member.userId }); }); row.append(action);
    }
    el('members').append(row);
  }
  for (const id of ['swap-first', 'swap-second', 'moderation-player']) populateMenu(id);
  el('banned').replaceChildren();
  for (const userId of state.party?.bannedPlayerIds ?? []) {
    const row = document.createElement('div'), label = document.createElement('span'), action = document.createElement('button');
    label.textContent = userId; action.textContent = 'Unban'; action.disabled = !canEdit;
    action.addEventListener('click', () => { void command('unban', { userId }, `Allow ${userId} to rejoin this party?`); }); row.append(label, action); el('banned').append(row);
  }
}
function renderTeams(scores: PartyScoreboard) {
  const key = JSON.stringify(scores.teams); if (key === teamKey) return; teamKey = key;
  el('teams').replaceChildren();
  for (const team of scores.teams) {
    const card = document.createElement('div'); card.className = `team ${team.color}`;
    card.classList.toggle('winner', team.winner);
    const names = document.createElement('div'); names.textContent = team.name;
    const total = document.createElement('strong'); total.textContent = team.amount === null ? '—'
      : team.unit === 'points' ? `${team.amount} / ${team.target} points` : `${team.amount.toLocaleString()} HP`;
    const detail = document.createElement('span'); detail.className = 'muted';
    detail.textContent = [team.multiplier !== null ? `×${team.multiplier}` : null,
      team.winner ? 'WINNER' : team.matchPoint ? 'MATCH POINT' : null,
      team.guessed !== null ? `${team.guessed}/${team.players} guessed` : null, team.helpRequested ? 'HELP REQUESTED' : null].filter(Boolean).join(' · ');
    card.append(names, total, detail); el('teams').append(card);
  }
}
function renderPrediction() {
  const prediction = predictRound({ status: state, presenter: presenter.value ?? null, settings: presenterSettings.value ?? null,
    contexts: ruleContexts.value ?? null, connection: connection.value ?? null, views: views.value ?? null, nowMs: Date.now() });
  const names = prediction.players.map(player => state.members.find(member => member.userId === player.id)?.nick || player.color);
  const key = JSON.stringify([prediction, names]); if (key === predictionKey) return; predictionKey = key;
  el('prediction').hidden = prediction.state === 'inactive';
  el('prediction').classList.toggle('ending', prediction.ending === true);
  el('prediction-summary').textContent = prediction.message;
  el('prediction-cards').replaceChildren();
  for (const [index, player] of prediction.players.entries()) {
    const card = document.createElement('div'); card.className = `prediction-player ${player.color}`;
    const name = document.createElement('div'); name.className = 'prediction-name'; name.textContent = names[index];
    const score = document.createElement('strong'); score.className = 'prediction-score';
    score.textContent = player.score === null ? '—' : `${player.locked ? '' : '≈'}${player.score.toLocaleString()} pts`;
    const pin = document.createElement('span'); pin.className = 'small muted';
    pin.textContent = player.score === null ? player.locked ? 'Score unavailable' : 'Waiting for pin' : player.locked ? 'Guess locked' : 'Pin placed · estimate';
    const after = document.createElement('div'); after.className = 'prediction-after';
    after.textContent = player.after === null ? `Current: ${player.before.toLocaleString()} ${prediction.unit}`
      : `${player.before.toLocaleString()} → ${player.after.toLocaleString()} ${prediction.unit}${player.change ? ` (${player.change > 0 ? '+' : ''}${player.change.toLocaleString()})` : ''}`;
    card.append(name, score, pin, after);
    if (player.outcome) {
      const outcome = document.createElement('span'); outcome.className = `prediction-outcome ${player.outcome}`;
      outcome.textContent = player.outcome === 'continues' ? 'DUEL CONTINUES' : `PREDICTED ${player.outcome.toUpperCase()}`;
      card.append(outcome);
    }
    el('prediction-cards').append(card);
  }
}
function render() {
  const party = state.party, duel = state.duel, ready = available(), lobby = lobbyAvailable();
  const scores = buildPartyScoreboard({ status: state, presenter: presenter.value ?? null, settings: presenterSettings.value ?? null,
    contexts: ruleContexts.value ?? null, connection: connection.value ?? null });
  el('connection-status').textContent = state.state === 'replay' ? 'OFFLINE REPLAY' : state.state === 'ready' ? state.canManage ? 'Host connected' : 'Read only' : state.state === 'error' ? 'Connection error' : 'Connecting…';
  const pending = state.activity.find(a => a.id === state.pending);
  notice('warning', state.error ?? state.disabledReason ?? (!currentEnough() ? 'Party state is stale. Refresh before continuing.' : pending ? pending.message : ''));
  el('identity').textContent = party ? `Host: ${party.owner.nick} · Party: ${party.partyId}` : '';
  el('join-info').textContent = party?.joinCode ? `Join code: ${party.joinCode}` : 'No join code available.';
  el('game-type').textContent = party?.gameType ?? '—'; el('phase').textContent = party ? party.gameState === 'Finished' ? 'Duel finished' : phase(duel) : 'Waiting for party';
  el('round-number').textContent = duel ? `ROUND ${String(duel.round).padStart(2, '0')}` : 'LOBBY';
  el('map-name').textContent = duel?.map || String(party?.gameSettings.mapSlug ?? '');
  el('game-details').textContent = duel ? `Game ${duel.gameId} · version ${duel.version} · ${duel.manual ? 'Manual rounds' : 'Automatic rounds'}\n`
    + duel.teams.map(team => `GeoGuessr ${team.name}: ${team.health.toLocaleString()} HP · ×${team.multiplier}`).join('\n') : 'No active duel.';
  el('score-rules').textContent = scores.rules;
  el('score-next-rules').textContent = scores.nextRules ?? ''; el('score-next-rules').hidden = !scores.nextRules;
  el('score-last-round').textContent = scores.lastRound ?? ''; el('score-last-round').hidden = !scores.lastRound;
  el('score-result').textContent = scores.result ?? ''; el('score-result').hidden = !scores.result;
  el('roster-count').textContent = `${state.members.length} members`;
  el('roster-hint').textContent = party?.gameState === 'Ongoing' ? 'Roster changes unlock after this duel finishes.' : 'Order determines Duels slots. Swap an active player with a benched player to replace them.';
  const startBlocked = party ? lobbyStartBlockReason(party, state.members) : null;
  notice('start-hint', party && party.gameState !== 'Ongoing' ? startBlocked ?? '' : '');
  button('start-game').disabled = !lobby || dirty || !!startBlocked || !party?.settings.masterControl;
  button('start-game').title = dirty ? 'Apply or reload the settings draft first' : startBlocked ?? (!party?.settings.masterControl ? 'Enable game master in settings' : '');
  button('start-round').disabled = !ready || !duel || duel.paused || !(duel.status === 'Created' || duel.status === 'Ongoing' && duel.manual && duel.resolved);
  button('start-round').textContent = duel?.status === 'Created' ? 'Start round 1' : `Start round ${(duel?.round ?? 0) + 1}`;
  button('pause').disabled = !ready || !duel || duel.status !== 'Ongoing' || duel.paused || duel.resolved;
  button('resume').disabled = !ready || !duel?.paused;
  button('rollback').disabled = !ready || !duel?.paused;
  button('abort').disabled = !canAbort() || !duel || duel.status === 'Finished';
  input('rollback-round').max = String(duel?.round ?? 1);
  button('swap').disabled = !lobby || !menu('swap-first').value || !menu('swap-second').value || menu('swap-first').value === menu('swap-second').value;
  button('moderate').disabled = !lobby || !menu('moderation-player').value;
  (el('settings-fields') as HTMLFieldSetElement).disabled = !lobby;
  const conflict = !!draftRevision && (draftRevision !== state.settingsRevision || draftPartyId !== party?.partyId);
  const presenterConflict = !!presetDraft && presetRevision !== configuration.value?.revision;
  button('save-settings').disabled = !lobby || !dirty || conflict || presenterConflict;
  button('save-settings').textContent = presetDraft ? 'Apply settings & rules' : 'Apply settings';
  menu('tournament-preset').disabled = !lobby || !configuration.value?.revision || !presenterSettings.value;
  const selectedPreset = TOURNAMENT_PRESETS.find(preset => preset.id === menu('tournament-preset').value);
  el('preset-description').textContent = selectedPreset ? `BO3 · ${selectedPreset.day === 2 && selectedPreset.mode === 'MOVE' ? 'Pinpointing Duels' : 'Health duel'} · Half tie range. Draft ready to review and apply.` : 'Choose a tournament game to fill its map, movement, timers, health and scoring rules.';
  el('preset-draft').textContent = presetDraft ? `Draft: ${presetDraftName} · ${presetDraft.presenterRules.pinpointing.enabled ? 'Pinpointing Duels' : 'Health duel'} · Half tie range · Presenter rules will be saved for the next duel.` : '';
  el('preset-draft').hidden = !presetDraft;
  button('reload-settings').disabled = !party || working;
  el('draft-status').textContent = !party ? 'Waiting for party' : conflict ? 'Settings changed remotely — reload draft' : presenterConflict ? 'Presenter settings changed — reload and reselect preset' : dirty ? 'Unsaved changes' : 'Matches current party';
  button('refresh').disabled = working || state.busy;
  button('connect').disabled = working || state.busy || !!state.pending;
  button('acknowledge').hidden = pending?.outcome !== 'uncertain'; button('acknowledge').disabled = working || state.busy;
  notice('presenter-warning', scores.warning ?? '');
  renderRoster(); renderTeams(scores); renderPrediction();
  const key = JSON.stringify(state.activity);
  if (key !== activityKey) {
    activityKey = key; el('activity-list').replaceChildren();
    for (const activity of state.activity) {
      const row = document.createElement('li');
      for (const [i, text] of [new Date(activity.atMs).toLocaleTimeString(), actionLabels[activity.action as PartyAction] ?? activity.action, activity.outcome, activity.message].entries()) {
        const span = document.createElement('span'); span.textContent = text; if (i === 2) span.className = `outcome-${activity.outcome}`; row.append(span);
      }
      el('activity-list').append(row);
    }
    if (!state.activity.length) el('activity-list').textContent = 'No commands sent.';
  }
}

function showIntermission(value = intermission.value ?? EMPTY_INTERMISSION) {
  for (const view of ['before-game', 'end-of-last-game'] as const) {
    const button = el(view) as HTMLButtonElement;
    button.setAttribute('aria-pressed', String(value.view === view));
    button.classList.toggle('primary', value.view === view);
    button.disabled = view === 'end-of-last-game' && !value.lastGame;
  }
  el('intermission-status').textContent = `${value.view === 'before-game' ? 'Before-Game · both cameras' : 'End-of-Last-Game · last result'} · shown between games; gameplay takes priority.`;
}
intermission.on('change', showIntermission);
showIntermission();
for (const view of ['before-game', 'end-of-last-game'] as const) {
  el(view).addEventListener('click', () => { void message('presenter:control', { action: 'intermission', body: { view } }); });
}

partyRep.on('change', value => {
  if (!value) return; state = value;
  if (submittedSettingsId && state.activity.some(a => a.id === submittedSettingsId && a.outcome === 'confirmed')) {
    submittedSettingsId = null; loadDraft();
  }
  if (state.party && (!draft || !dirty && draftRevision !== state.settingsRevision)) loadDraft();
  render();
});
connection.on('change', value => { if (!sourceInitialized && value) { input('party-id').value = value.selectedPartyId ?? ''; sourceInitialized = true; } render(); });
presenter.on('change', render);
views.on('change', renderPrediction);
presenterSettings.on('change', render);
ruleContexts.on('change', render);
configuration.on('change', render);
menu('tournament-preset').addEventListener('change', loadPreset);
button('refresh').addEventListener('click', () => { void message(PARTY_MESSAGES.refresh); });
button('connect').addEventListener('click', () => { void message('presenter:control', { action: 'reconnect', body: { input: 'live', partyId: input('party-id').value.trim() } }); });
for (const [id, action] of [['start-game', 'startGame'], ['start-round', 'startRound'], ['pause', 'pause'], ['resume', 'resume']] as const) button(id).addEventListener('click', () => { void command(action); });
button('abort').addEventListener('click', () => { void command('abort', {}, `Abort round ${state.duel?.round} of the current GeoGuessr duel and return the party to the lobby?`); });
button('rollback').addEventListener('click', () => { const roundNumber = Number(input('rollback-round').value); void command('rollback', { roundNumber }, `Roll back to round ${roundNumber}? Results from that round onward will be removed and its location will be replayed.`); });
button('swap').addEventListener('click', () => { void command('swap', { userId: menu('swap-first').value, secondMemberId: menu('swap-second').value }); });
button('moderate').addEventListener('click', () => {
  const userId = menu('moderation-player').value, action = menu('moderation-action').value as PartyAction;
  const name = state.members.find(m => m.userId === userId)?.nick ?? userId;
  void command(action, { userId }, `${actionLabels[action]}: ${name}?${action === 'host' ? ' Your dashboard will lose host control.' : ''}`);
});
for (const id of ['swap-first', 'swap-second', 'moderation-player']) menu(id).addEventListener('change', render);
button('acknowledge').addEventListener('click', () => { if (state.pending && window.confirm('Confirm you checked the current state. Clearing this lock does not retry or undo the command.')) void message(PARTY_MESSAGES.acknowledge, state.pending); });
el('settings-form').addEventListener('input', () => { dirty = true; render(); });
el('settings-form').addEventListener('change', () => { dirty = true; render(); });
button('reload-settings').addEventListener('click', () => { if (!dirty || window.confirm('Discard the unsaved settings draft?')) loadDraft(); });
el('settings-form').addEventListener('submit', event => { event.preventDefault(); try { void command('settings', draftPatch()); } catch (error) { showError(error instanceof Error ? error.message : 'Invalid settings'); } });
setInterval(() => {
  const duel = state.duel, now = Date.now() + state.serverOffsetMs;
  el('updated').textContent = state.updatedAtMs ? `Updated ${Math.max(0, Math.floor((Date.now() - state.updatedAtMs) / 1000))}s ago` : '';
  let timer = '—';
  if (duel && duel.status === 'Ongoing' && !duel.resolved) {
    if (duel.paused) timer = 'HELD';
    else if (duel.startTime && duel.startTime > now) timer = `Starts ${Math.ceil((duel.startTime - now) / 1000)}s`;
    else if (duel.endTime) { const seconds = Math.max(0, Math.ceil((duel.endTime - now) / 1000)); timer = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
    else timer = '∞';
  }
  el('timer').textContent = timer;
  renderPrediction();
  if (!currentEnough() && state.state === 'ready') render();
}, 250);
render();
