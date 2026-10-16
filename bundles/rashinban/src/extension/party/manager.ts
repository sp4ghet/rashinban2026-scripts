import { createHash } from 'node:crypto';
import type { ConnectionConfig } from '../presenter/connection.ts';
import { createPartyClient, PARTY_API, RejectedRequest } from './client.ts';
import { identifier, lobbyStartBlockReason, parseCommand, parseDuel, parseMember, parseParty, record, settingsPatch } from '../../party/state.ts';
import { EMPTY_PARTY_STATUS, type Activity, type Member, type PartyCommand, type PartyStatus } from '../../party/types.ts';
import { parseSettings, type PresenterSettings } from '../../presenter/settings.ts';

export type ManagerDeps = {
  fetch: typeof fetch; now(): number;
  selection(): { input: 'live' | 'replay'; partyId: string | null; generation?: string };
  publish(status: PartyStatus): void;
  presentation?: { get(): { settings: PresenterSettings; revision: string }; save(settings: PresenterSettings, revision: string): void };
};
type Pending = { id: string; deadline: number; verify(value: PartyStatus): boolean; complete?(): void; completionFailed?: boolean };
type Prepared = { url: string; method: string; body?: unknown; verify(value: PartyStatus): boolean; complete?(): void };
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)]));
  return value;
}
const revision = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

export function createPartyManager(config: ConnectionConfig, deps: ManagerDeps) {
  const client = createPartyClient(config, deps.fetch, deps.now);
  let status: PartyStatus = structuredClone(EMPTY_PARTY_STATUS);
  let rawParty: Record<string, unknown> | null = null;
  let refreshWork: Promise<void> | null = null;
  let pending: Pending | null = null;
  let locked = false;
  const seen = new Set<string>();
  const selectionKey = () => JSON.stringify(deps.selection());
  function publish() {
    status.busy = locked; status.pending = pending?.id ?? null;
    // NodeCG recursively wraps assigned objects. Keep internal state independent.
    deps.publish(JSON.parse(JSON.stringify(status)) as PartyStatus);
  }
  function activity(id: string, patch: Partial<Activity>) {
    status.activity = status.activity.map(item => item.id === id ? { ...item, ...patch } : item);
  }
  function checkPending() {
    if (!pending || pending.completionFailed) return;
    const command = pending;
    if (status.activity.find(item => item.id === command.id)?.outcome === 'sending') return;
    if (status.state === 'ready' && command.verify(status)) {
      try {
        command.complete?.();
        activity(command.id, { outcome: 'confirmed', message: command.complete ? 'GeoGuessr settings and presenter rules confirmed.' : 'Confirmed in GeoGuessr state.' }); pending = null;
      } catch {
        command.completionFailed = true;
        activity(command.id, { outcome: 'uncertain', message: 'GeoGuessr settings applied, but presenter rules could not be confirmed. Check presenter settings and configuration overrides, clear this command, then reload and apply the preset again.' });
      }
    } else if (deps.now() > command.deadline) {
      activity(command.id, { outcome: 'uncertain', message: 'Change not confirmed. Inspect the current state before clearing this command.' });
    }
  }
  async function read() {
    const key = selectionKey(); const selection = deps.selection();
    if (selection.input === 'replay') {
      rawParty = null;
      status = { ...status, state: 'replay', error: null, canManage: false, disabledReason: 'Replay mode — remote controls disabled', party: null, duel: null, members: [], updatedAtMs: null };
      checkPending(); publish(); return;
    }
    try {
      const profile = record(await client.request('https://www.geoguessr.com/api/v3/profiles/'));
      const account = record(profile.user); const accountId = identifier(account.id ?? account.userId);
      const activeRaw = await client.request(`${PARTY_API}/active`);
      const active = activeRaw === null ? null : parseParty(activeRaw);
      const selectedId = selection.partyId ?? active?.partyId;
      const raw = selectedId ? (active?.partyId === selectedId ? activeRaw : await client.request(`${PARTY_API}/${identifier(selectedId)}`)) : null;
      const party = raw ? parseParty(raw) : null;
      const members: Member[] = [];
      if (party && active?.partyId === party.partyId) {
        let total = Infinity;
        for (let page = 0; members.length < total && page < 20; page++) {
          const result = record(await client.request(`${PARTY_API}/members?page=${page}&count=100`));
          if (!Array.isArray(result.members) || typeof result.totalCount !== 'number' || !Number.isInteger(result.totalCount) || result.totalCount < 0) throw new Error('Invalid roster');
          total = result.totalCount;
          const batch = result.members.map(parseMember); members.push(...batch);
          if (batch.length === 0 && members.length < total) throw new Error('Incomplete roster');
        }
        if (members.length < total || new Set(members.map(member => member.userId)).size !== members.length) throw new Error('Incomplete roster');
      }
      let duel: PartyStatus['duel'] = null;
      if (party?.lobbyId && party.gameState === 'Ongoing' && ['Duels', 'TeamDuels'].includes(party.gameType)) {
        const phone = record(await client.request(`https://www.geoguessr.com/api/v4/game-server/phonebook/${identifier(party.lobbyId)}`));
        const node = identifier(phone.gameServerNodeId), game = identifier(phone.gameId);
        if (game !== party.lobbyId || phone.status !== 'Active') throw new Error('Game not ready');
        duel = parseDuel(await client.request(`https://gs2.geoguessr.com/${node}/${game}/${party.owner.userId === accountId ? 'game-master' : 'spectator'}`));
        if (duel.partyId !== party.partyId || duel.gameId !== game || duel.nodeId !== node) throw new Error('Game identity mismatch');
      }
      if (key !== selectionKey()) return;
      const disabledReason = !party ? 'No active party. Open the GeoGuessr lobby with the configured account.'
        : active?.partyId !== party.partyId ? 'Selected party is not the configured account’s active party.'
        : party.owner.userId !== accountId ? 'The configured account is not the party host.'
        : !['Duels', 'TeamDuels'].includes(party.gameType) ? 'Choose Duels or TeamDuels in GeoGuessr first.'
        : duel && duel.gameMasterId !== accountId ? 'The configured account is not this duel’s game master.' : null;
      rawParty = raw === null ? null : record(raw);
      status = { ...status, sourceGeneration: selection.generation ?? 'initial', state: 'ready', error: null, updatedAtMs: deps.now(), accountId,
        activePartyId: active?.partyId ?? null, party, members, duel,
        settingsRevision: rawParty ? revision([rawParty.gameType, rawParty.gameSettings, rawParty.partySettings]) : '',
        canManage: disabledReason === null, disabledReason, serverOffsetMs: client.serverOffsetMs };
      checkPending();
    } catch (error) {
      if (key !== selectionKey()) return;
      status = { ...status, state: 'error', canManage: false, disabledReason: 'State unavailable — refresh before sending commands.',
        error: error instanceof RejectedRequest ? error.message : 'Unable to read complete GeoGuessr state. Check the connection and refresh.' };
      checkPending();
    }
    publish();
  }
  async function refresh() {
    if (refreshWork) return refreshWork;
    refreshWork = read();
    try { await refreshWork; } finally { refreshWork = null; }
  }
  function prepare(command: PartyCommand): Prepared {
    const party = status.party, duel = status.duel;
    if (command.sourceGeneration !== (deps.selection().generation ?? 'initial')) throw new Error('The source reconnected. Review the refreshed state before continuing.');
    if (!status.canManage || !party || !rawParty) throw new Error(status.disabledReason ?? 'Party is unavailable');
    if (command.partyId !== party.partyId) throw new Error('Party changed. Refresh before continuing.');
    if (command.gameId !== (duel?.gameId ?? null)) throw new Error('The game changed. Review the new game before continuing.');
    if (command.round !== (duel?.round ?? null)) throw new Error('The round changed. Review the current round before continuing.');
    const { action, body } = command;
    const allowed = action === 'settings' ? ['gameType', 'gameSettings', 'settings', 'presenterRules', 'presenterRevision'] : action === 'rollback' ? ['roundNumber']
      : action === 'swap' ? ['userId', 'secondMemberId'] : action === 'team' ? ['userId', 'teamName']
      : ['bench', 'unbench', 'kick', 'ban', 'unban', 'mute', 'unmute', 'host'].includes(action) ? ['userId'] : [];
    if (Object.keys(body).some(key => !allowed.includes(key))) throw new Error('Unexpected command field');
    const lobby = party.gameState !== 'Ongoing';
    if (action === 'settings') {
      if (!lobby) throw new Error('Settings apply between games.');
      if (command.settingsRevision !== status.settingsRevision) throw new Error('Party settings changed. Reload the draft before saving.');
      const { presenterRules, presenterRevision, ...native } = body;
      const patch = settingsPatch(native);
      let complete: (() => void) | undefined;
      if (presenterRules !== undefined) {
        const rules = record(presenterRules), key = selectionKey();
        if (!Object.keys(rules).length || Object.keys(rules).some(key => !['pinpointing', 'tieRange'].includes(key))) throw new Error('Unsupported presenter rule');
        const current = deps.presentation?.get();
        if (!current || typeof presenterRevision !== 'string' || current.revision !== presenterRevision) throw new Error('Presenter settings changed. Reload the preset before saving.');
        const next = parseSettings({ ...current.settings, ...rules });
        complete = () => {
          if (key !== selectionKey() || !status.canManage || status.party?.gameState === 'Ongoing') throw new Error('Party changed before presenter rules could be saved');
          deps.presentation!.save(next, presenterRevision);
          const applied = deps.presentation!.get().settings;
          for (const rule of ['pinpointing', 'tieRange'] as const) {
            if (Object.hasOwn(rules, rule) && revision(applied[rule]) !== revision(next[rule])) throw new Error('Presenter rule is overridden');
          }
        };
      } else if (presenterRevision !== undefined) throw new Error('Presenter rules are missing');
      const merged = { gameType: patch.gameType ?? party.gameType, gameSettings: { ...record(rawParty.gameSettings), ...patch.gameSettings }, settings: { ...record(rawParty.partySettings), ...patch.settings } };
      const target = revision([merged.gameType, merged.gameSettings, merged.settings]);
      return { url: `${PARTY_API}/all-settings`, method: 'PUT', body: merged, complete, verify: s => s.party?.partyId === party.partyId && s.settingsRevision === target };
    }
    if (action === 'startGame') {
      if (!lobby) throw new Error('A duel is already ongoing.');
      if (!party.settings.masterControl) throw new Error('Enable game master in lobby settings first.');
      const blocked = lobbyStartBlockReason(party, status.members);
      if (blocked) throw new Error(blocked);
      return { url: `${PARTY_API}/start-game`, method: 'POST', body: {}, verify: s => s.party?.partyId === party.partyId && s.party.gameState === 'Ongoing' && !!s.party.lobbyId && s.party.lobbyId !== party.lobbyId };
    }
    if (['startRound', 'pause', 'resume', 'rollback', 'abort'].includes(action)) {
      if (!duel || duel.status === 'Finished' || party.gameState !== 'Ongoing') throw new Error('No ongoing duel.');
      const base = `https://gs2.geoguessr.com/${identifier(duel.nodeId)}/${identifier(duel.gameId)}`;
      const newer = (s: PartyStatus) => s.party?.partyId === party.partyId && s.duel?.gameId === duel.gameId && s.duel.version > duel.version;
      if (action === 'abort') return { url: `${base}/abort`, method: 'POST', body: {}, verify: s => s.party?.partyId === party.partyId && s.party.gameState === 'NoGame' };
      if (action === 'startRound') {
        if (duel.paused || !(duel.status === 'Created' || duel.manual && duel.resolved)) throw new Error('The duel is not waiting for a manual round start.');
        return { url: `${base}/game-master/start-next-round`, method: 'POST', body: {}, verify: s => newer(s) && (s.duel!.round > duel.round || duel.status === 'Created' && s.duel!.status === 'Ongoing' && s.duel!.startTime !== null) };
      }
      if (action === 'pause') {
        if (duel.status !== 'Ongoing' || duel.paused || duel.resolved) throw new Error('Pause after round requires an active round.');
        return { url: `${base}/game-master/pause`, method: 'POST', body: { roundNumber: duel.round }, verify: s => newer(s) && s.duel!.round === duel.round && s.duel!.paused };
      }
      if (!duel.paused) throw new Error('The duel must be paused first.');
      if (action === 'resume') return { url: `${base}/game-master/resume-paused-round`, method: 'POST', body: { roundNumber: duel.round },
        verify: s => newer(s) && !s.duel!.paused && (s.duel!.resolved || s.duel!.round > duel.round)
          || s.party?.partyId === party.partyId && s.party.lobbyId === duel.gameId && s.party.gameState === 'Finished' };
      const target = body.roundNumber;
      if (!Number.isInteger(target) || Number(target) < 1 || Number(target) > duel.round) throw new Error('Choose a played round to roll back to.');
      return { url: `${base}/game-master/rollback`, method: 'POST', body: { roundNumber: target }, verify: s => newer(s) && s.duel!.round === target && !s.duel!.paused && !s.duel!.resolved && s.duel!.startTime !== null };
    }
    if (!lobby) throw new Error('Roster changes apply between games.');
    const userId = identifier(body.userId), member = status.members.find(m => m.userId === userId);
    if (action !== 'unban' && !member) throw new Error('Player is no longer in the roster.');
    if (userId === party.owner.userId) throw new Error('Choose a player other than the current host.');
    if (action === 'unbench' && (member?.benchReason === 'RosterFull' || party.gameType === 'Duels'
      && status.members.filter(m => !m.isBenched && m.userId !== party.owner.userId).length >= 2)) {
      throw new Error('The player slots are full. Swap this player with a playing slot.');
    }
    const endpoint = `${PARTY_API}/member/${userId}`;
    const nextMember = (s: PartyStatus) => s.party?.partyId === party.partyId ? s.members.find(m => m.userId === userId) : undefined;
    if (action === 'swap') {
      const second = status.members.find(m => m.userId === identifier(body.secondMemberId));
      if (!second || second.userId === userId || second.userId === party.owner.userId) throw new Error('Choose two different non-host players.');
      const firstIndex = status.members.findIndex(m => m.userId === userId), secondIndex = status.members.indexOf(second);
      return { url: `${endpoint}/move`, method: 'PUT', body: { secondMemberId: second.userId }, verify: s => s.party?.partyId === party.partyId && s.members[firstIndex]?.userId === second.userId && s.members[secondIndex]?.userId === userId };
    }
    if (action === 'team') {
      if (party.gameType !== 'TeamDuels' || !['blue', 'red'].includes(String(body.teamName))) throw new Error('Choose a TeamDuels team.');
      return { url: `${PARTY_API}/team`, method: 'PUT', body: { userId, teamName: body.teamName }, verify: s => nextMember(s)?.team === body.teamName };
    }
    if (action === 'host') {
      if (!member!.isEligibleAsOwner) throw new Error('This player is not eligible to host.');
      return { url: `${PARTY_API}/change-owner/${userId}`, method: 'PUT', verify: s => s.party?.partyId === party.partyId && s.party.owner.userId === userId };
    }
    if (action === 'unban') return { url: `${PARTY_API}/unban/${userId}`, method: 'PUT', verify: s => s.party?.partyId === party.partyId && !s.party.bannedPlayerIds.includes(userId) };
    if (action === 'kick' || action === 'ban') return { url: `${endpoint}/${action}`, method: 'DELETE', verify: s => s.party?.partyId === party.partyId && !nextMember(s) && (action !== 'ban' || s.party.bannedPlayerIds.includes(userId)) };
    if (action === 'mute' || action === 'unmute') return { url: `${endpoint}/mute`, method: action === 'mute' ? 'PUT' : 'DELETE', verify: s => s.party?.partyId === party.partyId && s.party.mutedPlayerIds.includes(userId) === (action === 'mute') };
    return { url: `${endpoint}/bench`, method: action === 'bench' ? 'PUT' : 'DELETE', verify: s => !!nextMember(s) && (action === 'bench' ? nextMember(s)!.isBenched : !nextMember(s)!.isBenched) };
  }
  async function command(raw: unknown) {
    if (deps.selection().input === 'replay') throw new Error('Replay mode — remote controls disabled.');
    const cmd = parseCommand(raw);
    const supersedesPause = cmd.action === 'abort' && status.activity.find(item => item.id === pending?.id)?.action === 'pause';
    if (locked || pending && !supersedesPause) throw new Error('A command is pending. Verify its result before continuing.');
    if (seen.has(cmd.id)) throw new Error('This command was already submitted.');
    locked = true; publish(); const key = selectionKey();
    try {
      if (refreshWork) await refreshWork;
      await refresh();
      if (key !== selectionKey()) throw new Error('Party selection changed.');
      // Polling can replace status during the following requests. Validate against
      // the snapshot that authorized this command, never the poller's next state.
      const baseline = status;
      const prepared = prepare(cmd);
      // Session-scoped routes contain no party ID. Recheck immediately before writing.
      const active = await client.request(`${PARTY_API}/active`);
      if (!active || parseParty(active).partyId !== cmd.partyId) throw new Error('The active party changed. Reconnect before continuing.');
      const latest = parseParty(active), source = record(active);
      if (latest.owner.userId !== baseline.accountId || latest.lobbyId !== baseline.party?.lobbyId || latest.gameState !== baseline.party?.gameState
        || revision([source.gameType, source.gameSettings, source.partySettings]) !== baseline.settingsRevision) {
        throw new Error('Party host, game or settings changed during the command. Refresh and review before continuing.');
      }
      if (baseline.duel && ['startRound', 'pause', 'resume', 'rollback', 'abort'].includes(cmd.action)) {
        const previous = baseline.duel;
        const current = parseDuel(await client.request(`https://gs2.geoguessr.com/${identifier(previous.nodeId)}/${identifier(previous.gameId)}/game-master`));
        const boundary = (duel: typeof previous) => JSON.stringify([duel.partyId, duel.gameId, duel.nodeId, duel.gameMasterId,
          duel.round, duel.status, duel.paused, duel.resolved, duel.startTime]);
        if (boundary(current) !== boundary(previous) || current.version < previous.version) throw new Error('The round or game changed during the command. Refresh and review before continuing.');
      }
      if (key !== selectionKey()) throw new Error('Party selection changed.');
      const suspendedPause = pending && supersedesPause ? { pending, entry: status.activity.find(item => item.id === pending!.id)! } : null;
      if (pending && supersedesPause) activity(pending.id, { outcome: 'uncertain', message: 'Pause request superseded by the operator’s abort command.' });
      seen.add(cmd.id); if (seen.size > 500) seen.delete(seen.values().next().value!);
      status.activity.unshift({ id: cmd.id, action: cmd.action, atMs: deps.now(), outcome: 'sending', message: 'Sending once…' });
      status.activity = status.activity.slice(0, 30);
      const pauseWait = cmd.action === 'pause' ? Math.max(120_000, (status.duel?.endTime ?? 0) - deps.now() - status.serverOffsetMs + 15_000) : 15_000;
      pending = { id: cmd.id, deadline: deps.now() + pauseWait, verify: prepared.verify, complete: prepared.complete }; publish();
      try {
        await client.request(prepared.url, prepared.method, prepared.body);
        activity(cmd.id, { outcome: 'accepted', message: cmd.action === 'pause' ? 'Pause requested; waiting for the round deadline.' : 'Accepted; waiting for GeoGuessr state.' });
      } catch (error) {
        if (error instanceof RejectedRequest) {
          activity(cmd.id, { outcome: 'failed', message: error.message });
          pending = suspendedPause?.pending ?? null;
          if (suspendedPause) activity(suspendedPause.entry.id, suspendedPause.entry);
        }
        else activity(cmd.id, { outcome: 'uncertain', message: 'The request outcome is unknown. It was not retried. Refresh and inspect the state.' });
      }
      await refresh();
    } finally { locked = false; publish(); }
  }
  async function acknowledge(id: unknown) {
    if (locked || typeof id !== 'string' || pending?.id !== id) throw new Error('Pending command changed.');
    locked = true; publish();
    try {
      await refresh();
      if (!pending) return;
      if (status.state !== 'ready' && status.state !== 'replay') throw new Error('Refresh the connection before clearing a command.');
      const entry = status.activity.find(a => a.id === id);
      if (entry?.outcome !== 'uncertain') throw new Error('Wait for the pending command to resolve before clearing it.');
      activity(id, { message: 'Unconfirmed outcome acknowledged by operator. Review state before issuing another command.' }); pending = null;
    } finally { locked = false; publish(); }
  }
  publish();
  return { refresh, command, acknowledge };
}
