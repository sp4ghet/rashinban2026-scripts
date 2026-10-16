import { PARTY_ACTIONS, type ManagedDuel, type Member, type Party, type PartyCommand, type Settings } from './types.ts';

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid GeoGuessr data');
  return value as Record<string, unknown>;
}
export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w-]{1,128}$/.test(value)) throw new Error('Invalid identifier');
  return value;
}
function text(value: unknown): string { return typeof value === 'string' ? value.slice(0,300) : ''; }
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid numeric state');
  return value;
}
function items(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error('Invalid collection'); return value; }
function time(value: unknown): number | null {
  if (value == null) return null;
  const result = Date.parse(String(value)); if (!Number.isFinite(result)) throw new Error('Invalid timestamp'); return result;
}

export const GAME_NUMBERS: Record<string, [number, number]> = {
  timeAfterGuess: [1, 600], initialHealth: [1, 1_000_000_000], maxRoundTime: [0, 3600], maxNumberOfRounds: [1, 1000],
  multiplierIncrement: [0, 1000], roundWinMultiplierIncrement: [0, 1000], roundsWithoutDamageMultiplier: [0, 1000],
  initialHealthTeamOne: [0, 1_000_000_000], initialHealthTeamTwo: [0, 1_000_000_000],
};
export const GAME_BOOLEANS = ['forbidMoving', 'forbidZooming', 'forbidRotating', 'disableHealing', 'countAllGuesses', 'individualInitialHealth'];
export const PARTY_BOOLEANS = ['isolateInGameChat', 'allowGuests', 'allowSwitchingTeams', 'masterControl', 'masterControlAutoStartRounds', 'hideJoinInfo'];
function publicSettings(raw: unknown, party: boolean): Settings {
  const source = record(raw); const result: Settings = {};
  const keys = party ? [...PARTY_BOOLEANS, 'maxPartySize', 'allowedCommunication']
    : [...GAME_BOOLEANS, ...Object.keys(GAME_NUMBERS), 'mapSlug', 'guessMapType'];
  for (const key of keys) {
    const value = source[key]; if (['string', 'number', 'boolean'].includes(typeof value)) result[key] = value as Settings[string];
  }
  return result;
}
export function parseParty(raw: unknown): Party {
  const value = record(raw), owner = record(value.owner);
  if (!['NoGame', 'Ongoing', 'Finished'].includes(String(value.gameState))) throw new Error('Unsupported party state');
  return {
    partyId: identifier(value.partyId), owner: { userId: identifier(owner.userId), nick: text(owner.nick) },
    lobbyId: value.lobbyId ? identifier(value.lobbyId) : null, gameState: value.gameState as Party['gameState'],
    gameType: text(value.gameType), settings: publicSettings(value.partySettings, true), gameSettings: publicSettings(value.gameSettings, false),
    joinCode: value.joinCode && typeof value.joinCode === 'object' ? text(record(value.joinCode).code) || null : null,
    bannedPlayerIds: Array.isArray(value.bannedPlayerIds) ? value.bannedPlayerIds.map(identifier) : [],
    mutedPlayerIds: Array.isArray(value.mutedPlayerIds) ? value.mutedPlayerIds.map(identifier) : [],
  };
}
export function parseMember(raw: unknown): Member {
  const value = record(raw);
  return { userId: identifier(value.userId), nick: text(value.nick), team: typeof value.team === 'string' ? value.team : null,
    isPresent: value.isPresent === true, isPlaying: value.isPlaying === true, isBenched: value.isBenched === true,
    isInCurrentGame: value.isInCurrentGame === true, isEligibleAsOwner: value.isEligibleAsOwner === true,
    benchReason: typeof value.benchReason === 'string' ? value.benchReason : null };
}
export function lobbyStartBlockReason(party: Party, members: Member[]): string | null {
  const players = members.filter(member => !member.isBenched && member.userId !== party.owner.userId);
  if (party.gameType === 'Duels' ? players.length !== 2 : !players.some(member => member.team === 'blue') || !players.some(member => member.team === 'red')) {
    return 'Fill both player slots / teams before starting.';
  }
  // isPresent remains true on game/results screens; GeoGuessr also checks isPlaying for lobby absence.
  const waiting = players.filter(member => !member.isPresent || member.isPlaying);
  return waiting.length ? `Waiting for ${waiting.map(member => member.nick || member.userId).join(', ')} to return to the lobby.` : null;
}
export function parseDuel(raw: unknown): ManagedDuel {
  const value = record(raw), options = record(value.options), context = record(value.context);
  if (context.type !== 'Party' || !['Created', 'Ongoing', 'Finished'].includes(String(value.status))) throw new Error('Unsupported duel state');
  const round = number(value.currentRoundNumber);
  const current = items(value.rounds).map(record).find(item => item.roundNumber === round);
  if (!current || !Number.isInteger(round) || round < 1 || typeof value.isPaused !== 'boolean') throw new Error('Invalid current round');
  const teams = items(value.teams).map(record);
  if (teams.length !== 2) throw new Error('Expected two duel teams');
  return {
    gameId: identifier(value.gameId), nodeId: identifier(value.gameServerNodeId), partyId: identifier(context.id),
    gameMasterId: identifier(value.gameMasterId), version: number(value.version), round, status: value.status as ManagedDuel['status'],
    paused: value.isPaused, resolved: current.hasProcessedRoundTimeout === true || teams.every(team => items(team.roundResults).some(result => record(result).roundNumber === round)),
    manual: options.roundStartingBehavior === 'ManuallyStartAllRounds' || options.masterControlAutoStartRounds === false,
    startTime: time(current.startTime), endTime: time(current.endTime), map: text(record(options.map).name),
    winnerTeamId: value.result ? text(record(value.result).winningTeamId) || null : null,
    teams: teams.map(team => ({ id: identifier(team.id), name: text(team.name), health: number(team.health), multiplier: number(team.currentMultiplier),
      players: items(team.players).map(rawPlayer => { const player = record(rawPlayer); return { id: identifier(player.playerId),
        guessed: items(player.guesses).some(guess => record(guess).roundNumber === round), helpRequested: player.helpRequested === true }; }) })),
  };
}
export function settingsPatch(raw: unknown): { gameType?: string; gameSettings: Settings; settings: Settings } {
  const value = record(raw);
  if (Object.keys(value).some(key => !['gameType', 'gameSettings', 'settings'].includes(key))) throw new Error('Unsupported settings field');
  if (value.gameType !== undefined && !['Duels', 'TeamDuels'].includes(String(value.gameType))) throw new Error('Choose Duels or TeamDuels');
  const parse = (input: unknown, party: boolean): Settings => {
    const result: Settings = {};
    for (const [key, v] of Object.entries(input === undefined ? {} : record(input))) {
      const bounds = party ? key === 'maxPartySize' ? [2, 1000] : undefined : Object.hasOwn(GAME_NUMBERS, key) ? GAME_NUMBERS[key] : undefined;
      if (bounds) {
        if (typeof v !== 'number' || !Number.isInteger(v) || v < bounds[0] || v > bounds[1]) throw new Error(`Invalid ${key}`);
      } else if ((party ? PARTY_BOOLEANS : GAME_BOOLEANS).includes(key)) {
        if (typeof v !== 'boolean') throw new Error(`Invalid ${key}`);
      } else if (!party && key === 'mapSlug') identifier(v);
      else if (!party && key === 'guessMapType') { if (!['roadmap', 'satellite', 'hybrid', 'terrain'].includes(String(v))) throw new Error('Invalid map type'); }
      else if (party && key === 'allowedCommunication') { if (!['None', 'EmotesOnly', 'TextMessages', 'TeamTextMessages'].includes(String(v))) throw new Error('Invalid communication setting'); }
      else throw new Error(`Unsupported settings field: ${key}`);
      result[key] = v as Settings[string];
    }
    return result;
  };
  return { ...(value.gameType === undefined ? {} : { gameType: String(value.gameType) }), gameSettings: parse(value.gameSettings, false), settings: parse(value.settings, true) };
}
export function parseCommand(raw: unknown): PartyCommand {
  const value = record(raw);
  if (Object.keys(value).some(key => !['id', 'action', 'partyId', 'gameId', 'round', 'settingsRevision', 'body', 'sourceGeneration'].includes(key))
    || !PARTY_ACTIONS.includes(value.action as PartyCommand['action'])) throw new Error('Invalid party command');
  if (value.round !== null && (!Number.isInteger(value.round) || Number(value.round) < 1)) throw new Error('Invalid expected round');
  return { id: identifier(value.id), action: value.action as PartyCommand['action'], partyId: identifier(value.partyId),
    sourceGeneration: identifier(value.sourceGeneration),
    gameId: value.gameId === null ? null : identifier(value.gameId), round: value.round as number | null,
    settingsRevision: typeof value.settingsRevision === 'string' ? value.settingsRevision : undefined, body: record(value.body ?? {}) };
}
export function phase(duel: ManagedDuel | null): string {
  if (!duel) return 'Lobby';
  if (duel.status === 'Finished') return 'Finished';
  if (duel.paused) return 'Paused — result held';
  if (duel.status === 'Created') return 'Ready for round 1';
  if (duel.resolved) return duel.manual ? 'Waiting for next round' : 'Round complete';
  return 'Round in progress';
}
