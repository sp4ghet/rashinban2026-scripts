import {
  foldTieRange,
  type TieRangeBandMode,
  type TieRangeInput,
  type TieRangeOutput,
} from '../../bundles/rashinban/src/presenter/tie-range-core.ts';

export const PLAYER_TIE_RANGE_RULES_VERSION = 1;
const STORAGE_PREFIX = 'rashinban.tie-range';
const STORAGE_INDEX_KEY = `${STORAGE_PREFIX}.games`;
const MAX_SAVED_GAMES = 10;

export type PlayerDiagnosticCode =
  | 'invalid-snapshot'
  | 'unsupported-game'
  | 'partial-results'
  | 'incompatible-rules'
  | 'identity-change'
  | 'rules-change'
  | 'stale-version'
  | 'recovery'
  | 'source-ended'
  | 'schema-mismatch'
  | 'invalid-saved-context';

export type PlayerDiagnostic = {
  code: PlayerDiagnosticCode;
  message: string;
};

export type PlayerRoundStart = {
  round: number;
  startTime: string;
};

export type PlayerGameContext = {
  schemaVersion: number;
  gameId: string;
  mode: TieRangeBandMode;
  sourceVersion: number;
  currentRoundNumber: number;
  sourceStatus: string;
  teamIds: [string, string];
  teamLabels: ['blue', 'red'];
  playerIds: [string, string];
  roundStarts: PlayerRoundStart[];
  input: TieRangeInput;
};

export type PlayerSnapshotAcceptance = {
  accepted: boolean;
  context: PlayerGameContext | null;
  output: TieRangeOutput | null;
  diagnostic: PlayerDiagnostic | null;
};

export type PlayerContextRestore = {
  context: PlayerGameContext | null;
  output: TieRangeOutput | null;
  diagnostic: PlayerDiagnostic | null;
};

export interface PlayerTieRangeStorage {
  get(key: string): unknown | Promise<unknown>;
  set(key: string, value: unknown): void | Promise<void>;
  remove(key: string): void | Promise<void>;
}

type DecodedSnapshot = Omit<PlayerGameContext, 'schemaVersion' | 'mode'>;

class DecodeError extends Error {
  readonly code: PlayerDiagnosticCode;

  constructor(code: PlayerDiagnosticCode, message: string) {
    super(message);
    this.code = code;
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DecodeError('invalid-snapshot', `${label} is missing or invalid`);
  }
  return value as Record<string, unknown>;
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DecodeError('invalid-snapshot', `${label} is missing or invalid`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new DecodeError('invalid-snapshot', `${label} is missing or invalid`);
  }
  return value as number;
}

function tupleEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function diagnostic(code: PlayerDiagnosticCode, message: string): PlayerDiagnostic {
  return { code, message };
}

function outputFor(context: PlayerGameContext | null): TieRangeOutput | null {
  if (context === null || context.mode === 'off') return null;
  return foldTieRange(context.input, context.mode);
}

function retained(
  previous: PlayerGameContext | null,
  code: PlayerDiagnosticCode,
  message: string,
): PlayerSnapshotAcceptance {
  return {
    accepted: false,
    context: previous,
    output: outputFor(previous),
    diagnostic: diagnostic(code, message),
  };
}

function decodeOptions(raw: Record<string, unknown>): Omit<TieRangeInput, 'teamIds' | 'rounds'> {
  const options = record(raw.options, 'Player duel options');
  const initialHealth = integer(raw.initialHealth ?? options.initialHealth, 'Initial health', 1);
  if (options.initialHealth !== undefined && options.initialHealth !== initialHealth) {
    throw new DecodeError('incompatible-rules', 'Initial health options disagree');
  }

  const individual = integer(options.roundWinMultiplierIncrement, 'Round-win multiplier increment');
  const mutual = integer(options.multiplierIncrement, 'Mutual multiplier increment');
  const delay = integer(options.roundsWithoutDamageMultiplier, 'Multiplier delay');
  const rawMaxRounds = options.maxNumberOfRounds ?? raw.maxNumberOfRounds;
  const maxRounds = rawMaxRounds === null ? null : integer(rawMaxRounds, 'Maximum rounds', 1);
  if (raw.maxNumberOfRounds !== undefined && raw.maxNumberOfRounds !== maxRounds) {
    throw new DecodeError('incompatible-rules', 'Maximum-round options disagree');
  }

  const teamOneHealth = options.initialHealthTeamOne;
  const teamTwoHealth = options.initialHealthTeamTwo;
  if (options.individualInitialHealth === true
    || (teamOneHealth !== undefined && teamTwoHealth !== undefined && teamOneHealth !== teamTwoHealth)
    || (typeof teamOneHealth === 'number' && teamOneHealth !== 0 && teamOneHealth !== initialHealth)
    || (typeof teamTwoHealth === 'number' && teamTwoHealth !== 0 && teamTwoHealth !== initialHealth)) {
    throw new DecodeError('incompatible-rules', 'Asymmetric team health is unsupported');
  }
  if (options.disableHealing === false) {
    throw new DecodeError('incompatible-rules', 'Healing must be disabled');
  }
  if (options.disableMultipliers === true) {
    throw new DecodeError('incompatible-rules', 'Disabled multipliers are unsupported');
  }
  if (options.roundStartingBehavior !== undefined
    && !['Default', 'ManuallyStartFirstRound', 'ManuallyStartAllRounds'].includes(
      String(options.roundStartingBehavior),
    )) {
    throw new DecodeError('incompatible-rules', 'Special round-start scoring is unsupported');
  }

  return { initialHealth, individual, mutual, delay, maxRounds };
}

function decodeTeams(raw: Record<string, unknown>): {
  teamIds: [string, string];
  playerIds: [string, string];
  rounds: TieRangeInput['rounds'];
} {
  if (!Array.isArray(raw.teams) || raw.teams.length !== 2) {
    throw new DecodeError('unsupported-game', 'Exactly two teams are required');
  }

  const byLabel = new Map<string, {
    id: string;
    playerId: string;
    results: Map<number, number>;
  }>();
  for (const rawTeam of raw.teams) {
    const team = record(rawTeam, 'Team');
    const label = typeof team.name === 'string' ? team.name.toLowerCase() : '';
    if (label !== 'blue' && label !== 'red') {
      throw new DecodeError('unsupported-game', 'Explicit blue and red team labels are required');
    }
    if (byLabel.has(label)) throw new DecodeError('unsupported-game', 'Team labels must be unique');
    const id = nonemptyString(team.id, 'Team ID');
    if (!Array.isArray(team.players) || team.players.length !== 1) {
      throw new DecodeError('unsupported-game', 'Only one player per team is supported');
    }
    const playerId = nonemptyString(record(team.players[0], 'Player').playerId, 'Player ID');
    if (!Array.isArray(team.roundResults)) {
      throw new DecodeError('partial-results', 'Team round results are missing');
    }
    const results = new Map<number, number>();
    for (const rawResult of team.roundResults) {
      const result = record(rawResult, 'Round result');
      const round = integer(result.roundNumber, 'Round-result number', 1);
      const score = integer(result.score, `Score for round ${round}`);
      if (score > 5000) throw new DecodeError('invalid-snapshot', `Score for round ${round} is invalid`);
      if (results.has(round)) throw new DecodeError('partial-results', `Duplicate result for round ${round}`);
      results.set(round, score);
    }
    byLabel.set(label, { id, playerId, results });
  }

  const blue = byLabel.get('blue');
  const red = byLabel.get('red');
  if (!blue || !red || blue.id === red.id || blue.playerId === red.playerId) {
    throw new DecodeError('unsupported-game', 'Team and player identities must be distinct');
  }
  const allRounds = new Set([...blue.results.keys(), ...red.results.keys()]);
  const ordered = [...allRounds].sort((left, right) => left - right);
  const rounds: TieRangeInput['rounds'] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const round = ordered[index];
    if (round !== index + 1 || !blue.results.has(round) || !red.results.has(round)) {
      throw new DecodeError('partial-results', `Paired contiguous results are required at round ${index + 1}`);
    }
    rounds.push({ round, scores: [blue.results.get(round)!, red.results.get(round)!] });
  }
  return {
    teamIds: [blue.id, red.id],
    playerIds: [blue.playerId, red.playerId],
    rounds,
  };
}

function decodeRoundStarts(raw: Record<string, unknown>, settledRounds: number): PlayerRoundStart[] {
  if (!Array.isArray(raw.rounds)) throw new DecodeError('invalid-snapshot', 'Round identities are missing');
  const seen = new Set<number>();
  const starts: PlayerRoundStart[] = [];
  for (const rawRound of raw.rounds) {
    const sourceRound = record(rawRound, 'Round identity');
    const round = integer(sourceRound.roundNumber, 'Round identity number', 1);
    if (seen.has(round)) throw new DecodeError('invalid-snapshot', `Duplicate round identity ${round}`);
    seen.add(round);
    if (sourceRound.isHealingRound === true) {
      throw new DecodeError('incompatible-rules', `Healing round ${round} is unsupported`);
    }
    if (sourceRound.startTime !== null && sourceRound.startTime !== undefined) {
      starts.push({ round, startTime: nonemptyString(sourceRound.startTime, `Round ${round} start time`) });
    }
  }
  for (let round = 1; round <= settledRounds; round += 1) {
    if (!seen.has(round)) throw new DecodeError('partial-results', `Round identity ${round} is missing`);
  }
  return starts.sort((left, right) => left.round - right.round);
}

function decodeSnapshot(rawValue: unknown): DecodedSnapshot {
  const raw = record(rawValue, 'Player duel response');
  const gameId = nonemptyString(raw.gameId, 'Game ID');
  const sourceVersion = integer(raw.version, 'Source version');
  const currentRoundNumber = integer(raw.currentRoundNumber, 'Current round number', 1);
  const sourceStatus = nonemptyString(raw.status, 'Source status');
  const rules = decodeOptions(raw);
  const teams = decodeTeams(raw);
  const roundStarts = decodeRoundStarts(raw, teams.rounds.length);
  return {
    gameId,
    sourceVersion,
    currentRoundNumber,
    sourceStatus,
    teamIds: teams.teamIds,
    teamLabels: ['blue', 'red'],
    playerIds: teams.playerIds,
    roundStarts,
    input: { ...rules, teamIds: teams.teamIds, rounds: teams.rounds },
  };
}

function sameRules(previous: PlayerGameContext, next: DecodedSnapshot): boolean {
  return previous.input.initialHealth === next.input.initialHealth
    && previous.input.individual === next.input.individual
    && previous.input.mutual === next.input.mutual
    && previous.input.delay === next.input.delay
    && previous.input.maxRounds === next.input.maxRounds;
}

function sameRound(left: TieRangeInput['rounds'][number], right: TieRangeInput['rounds'][number]): boolean {
  return left.round === right.round && tupleEqual(left.scores, right.scores);
}

function rollbackStart(previous: PlayerGameContext, next: DecodedSnapshot): number | null {
  let rollback = next.currentRoundNumber < previous.currentRoundNumber
    ? next.currentRoundNumber
    : null;
  const previousStarts = new Map(previous.roundStarts.map(start => [start.round, start.startTime]));
  for (const start of next.roundStarts) {
    const oldStart = previousStarts.get(start.round);
    if (oldStart !== undefined && oldStart !== start.startTime
      && start.round <= Math.min(previous.currentRoundNumber, next.currentRoundNumber)) {
      rollback = rollback === null ? start.round : Math.min(rollback, start.round);
    }
  }
  return rollback;
}

function freezeContext(context: PlayerGameContext): PlayerGameContext {
  for (const round of context.input.rounds) {
    Object.freeze(round.scores);
    Object.freeze(round);
  }
  for (const start of context.roundStarts) Object.freeze(start);
  Object.freeze(context.input.rounds);
  Object.freeze(context.input.teamIds);
  Object.freeze(context.input);
  Object.freeze(context.teamIds);
  Object.freeze(context.teamLabels);
  Object.freeze(context.playerIds);
  Object.freeze(context.roundStarts);
  return Object.freeze(context);
}

export function parsePlayerDuelPath(path: string): { gameId: string } | null {
  const match = /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?(?:team-)?duels\/([A-Za-z0-9_-]+)(?:\/summary)?\/?$/.exec(path);
  return match ? { gameId: match[1] } : null;
}

export type PlayerPageRoute =
  | { kind: 'duel'; gameId: string }
  | { kind: 'party-lobby'; partyCode: string | null };

export function parsePlayerPageRoute(path: string): PlayerPageRoute | null {
  const pathname = path.split(/[?#]/, 1)[0];
  const duel = parsePlayerDuelPath(pathname);
  if (duel) return { kind: 'duel', gameId: duel.gameId };
  const party = /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?party\/lobby(?:\/([A-Za-z0-9_-]+))?\/?$/.exec(pathname);
  if (party) {
    return { kind: 'party-lobby', partyCode: party[1] ?? null };
  }
  return null;
}

export function acceptPlayerSnapshot(
  previous: PlayerGameContext | null,
  raw: unknown,
  configuredMode: TieRangeBandMode,
): PlayerSnapshotAcceptance {
  const rawGameId = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).gameId
    : undefined;
  const relevantPrevious = previous && typeof rawGameId === 'string' && rawGameId !== previous.gameId
    ? null
    : previous;
  if (configuredMode !== 'off' && configuredMode !== 'full' && configuredMode !== 'half') {
    return retained(relevantPrevious, 'invalid-snapshot', 'Configured tie-range mode is invalid');
  }

  let decoded: DecodedSnapshot;
  try {
    decoded = decodeSnapshot(raw);
  } catch (error) {
    if (error instanceof DecodeError) return retained(relevantPrevious, error.code, error.message);
    return retained(relevantPrevious, 'invalid-snapshot', 'Player duel response is invalid');
  }

  const activePrevious = relevantPrevious?.gameId === decoded.gameId ? relevantPrevious : null;
  if (activePrevious && decoded.sourceVersion < activePrevious.sourceVersion) {
    return retained(activePrevious, 'stale-version', 'An older duel response was ignored');
  }
  if (activePrevious && decoded.sourceVersion === activePrevious.sourceVersion) {
    return { accepted: true, context: activePrevious, output: outputFor(activePrevious), diagnostic: null };
  }
  if (activePrevious && (!tupleEqual(activePrevious.teamIds, decoded.teamIds)
    || !tupleEqual(activePrevious.playerIds, decoded.playerIds))) {
    return retained(activePrevious, 'identity-change', 'Team identities changed during the duel');
  }
  if (activePrevious && !sameRules(activePrevious, decoded)) {
    return retained(activePrevious, 'rules-change', 'Duel scoring options changed during the duel');
  }

  const rollback = activePrevious ? rollbackStart(activePrevious, decoded) : null;
  let acceptedRounds = decoded.input.rounds;
  if (activePrevious) {
    if (rollback === null) {
      if (decoded.input.rounds.length < activePrevious.input.rounds.length
        || activePrevious.input.rounds.some((round, index) => !decoded.input.rounds[index]
          || !sameRound(round, decoded.input.rounds[index]))) {
        return retained(activePrevious, 'recovery', 'Settled history is incomplete or changed without rollback evidence');
      }
      const previousTerminal = outputFor(activePrevious)?.terminal;
      if (previousTerminal !== null && previousTerminal !== undefined) {
        acceptedRounds = activePrevious.input.rounds;
      }
    } else {
      const prefix = activePrevious.input.rounds.filter(round => round.round < rollback);
      if (prefix.some((round, index) => !decoded.input.rounds[index]
        || !sameRound(round, decoded.input.rounds[index]))) {
        return retained(activePrevious, 'recovery', 'Rollback response does not contain the verified prefix');
      }
      acceptedRounds = decoded.currentRoundNumber < activePrevious.currentRoundNumber
        ? prefix
        : [
          ...prefix,
          ...decoded.input.rounds.filter(round => round.round >= rollback),
        ];
    }
  }

  const context = freezeContext({
    schemaVersion: PLAYER_TIE_RANGE_RULES_VERSION,
    gameId: decoded.gameId,
    mode: activePrevious?.mode ?? configuredMode,
    sourceVersion: decoded.sourceVersion,
    currentRoundNumber: decoded.currentRoundNumber,
    sourceStatus: decoded.sourceStatus,
    teamIds: [...decoded.teamIds],
    teamLabels: ['blue', 'red'],
    playerIds: [...decoded.playerIds],
    roundStarts: decoded.roundStarts.map(start => ({ ...start })),
    input: {
      ...decoded.input,
      teamIds: [...decoded.teamIds],
      rounds: acceptedRounds.map(round => ({ round: round.round, scores: [...round.scores] })),
    },
  });
  const output = outputFor(context);
  const endedWithoutCustomWinner = decoded.sourceStatus === 'Finished' && output?.terminal === null;
  return {
    accepted: true,
    context,
    output,
    diagnostic: endedWithoutCustomWinner
      ? diagnostic('source-ended', 'Duel ended without a custom winner')
      : null,
  };
}

function gameKey(gameId: string): string {
  return `${STORAGE_PREFIX}.game.${encodeURIComponent(gameId)}`;
}

function parseIndex(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function restoreContext(value: unknown): PlayerContextRestore {
  if (typeof value !== 'string') return { context: null, output: null, diagnostic: null };
  try {
    const parsed = record(JSON.parse(value), 'Saved tie-range context') as unknown as PlayerGameContext;
    if (parsed.schemaVersion !== PLAYER_TIE_RANGE_RULES_VERSION) {
      return {
        context: null,
        output: null,
        diagnostic: diagnostic('schema-mismatch', 'Saved tie-range rules are from a different version'),
      };
    }
    if ((parsed.mode !== 'off' && parsed.mode !== 'full' && parsed.mode !== 'half')
      || typeof parsed.gameId !== 'string'
      || !Number.isInteger(parsed.sourceVersion)
      || !Number.isInteger(parsed.currentRoundNumber)
      || typeof parsed.sourceStatus !== 'string'
      || !Array.isArray(parsed.teamIds) || parsed.teamIds.length !== 2
      || !Array.isArray(parsed.teamLabels) || !tupleEqual(parsed.teamLabels, ['blue', 'red'])
      || !Array.isArray(parsed.playerIds) || parsed.playerIds.length !== 2
      || !Array.isArray(parsed.roundStarts)) {
      throw new Error('invalid context');
    }
    const context = freezeContext(parsed);
    return { context, output: outputFor(context), diagnostic: null };
  } catch {
    return {
      context: null,
      output: null,
      diagnostic: diagnostic('invalid-saved-context', 'Saved tie-range context is invalid'),
    };
  }
}

export async function loadPlayerContext(
  storage: PlayerTieRangeStorage,
  gameId: string,
): Promise<PlayerContextRestore> {
  return restoreContext(await storage.get(gameKey(gameId)));
}

export async function savePlayerContext(
  storage: PlayerTieRangeStorage,
  context: PlayerGameContext,
): Promise<void> {
  await storage.set(gameKey(context.gameId), JSON.stringify(context));
  const oldIndex = parseIndex(await storage.get(STORAGE_INDEX_KEY));
  const index = [...oldIndex.filter(gameId => gameId !== context.gameId), context.gameId];
  const evicted = index.splice(0, Math.max(0, index.length - MAX_SAVED_GAMES));
  await storage.set(STORAGE_INDEX_KEY, JSON.stringify(index));
  await Promise.all(evicted.map(gameId => storage.remove(gameKey(gameId))));
}
