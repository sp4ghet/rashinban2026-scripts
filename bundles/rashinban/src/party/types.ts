export type Settings = Record<string, string | number | boolean>;
export type Member = {
  userId: string; nick: string; team: string | null; isPresent: boolean; isPlaying: boolean;
  isBenched: boolean; isInCurrentGame: boolean; isEligibleAsOwner: boolean; benchReason: string | null;
};
export type Party = {
  partyId: string; owner: { userId: string; nick: string }; lobbyId: string | null;
  gameState: 'NoGame' | 'Ongoing' | 'Finished'; gameType: string;
  gameSettings: Settings; settings: Settings; joinCode: string | null;
  bannedPlayerIds: string[]; mutedPlayerIds: string[];
};
export type ManagedDuel = {
  gameId: string; nodeId: string; partyId: string; gameMasterId: string;
  version: number; round: number; status: 'Created' | 'Ongoing' | 'Finished'; paused: boolean;
  resolved: boolean; manual: boolean; startTime: number | null; endTime: number | null;
  map: string; winnerTeamId: string | null;
  teams: { id: string; name: string; health: number; multiplier: number;
    players: { id: string; guessed: boolean; helpRequested: boolean }[] }[];
};
export const PARTY_ACTIONS = ['settings', 'startGame', 'startRound', 'pause', 'resume', 'rollback', 'abort',
  'bench', 'unbench', 'swap', 'team', 'kick', 'ban', 'unban', 'mute', 'unmute', 'host'] as const;
export type PartyAction = typeof PARTY_ACTIONS[number];
export type PartyCommand = {
  id: string; action: PartyAction; partyId: string; gameId: string | null; round: number | null;
  sourceGeneration: string;
  settingsRevision?: string; body: Record<string, unknown>;
};
export type Activity = {
  id: string; action: string; atMs: number; outcome: 'sending' | 'accepted' | 'confirmed' | 'failed' | 'uncertain'; message: string;
};
export type PartyStatus = {
  state: 'loading' | 'ready' | 'replay' | 'error'; error: string | null; updatedAtMs: number | null;
  accountId: string | null; activePartyId: string | null; party: Party | null;
  members: Member[]; duel: ManagedDuel | null; settingsRevision: string;
  canManage: boolean; disabledReason: string | null; busy: boolean; pending: string | null;
  serverOffsetMs: number; activity: Activity[];
  sourceGeneration: string;
};
export const EMPTY_PARTY_STATUS: PartyStatus = {
  state: 'loading', error: null, updatedAtMs: null, accountId: null, activePartyId: null,
  party: null, members: [], duel: null, settingsRevision: '', canManage: false,
  disabledReason: 'Connecting to GeoGuessr', busy: false, pending: null, serverOffsetMs: 0, activity: [], sourceGeneration: 'initial',
};
export const PARTY_MESSAGES = { command: 'party:command', refresh: 'party:refresh', acknowledge: 'party:acknowledge' } as const;
