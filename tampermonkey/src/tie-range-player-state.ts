import {
  foldTieRange,
  type TieRangeBandMode,
  type TieRangeInput,
  type TieRangeOutput,
} from '../../bundles/rashinban/src/presenter/tie-range-core.ts';
import { foldPinpointing, type PinpointingOutput } from '../../bundles/rashinban/src/presenter/pinpointing-core.ts';

/** Version 2 adds Pinpointing Duels (`pinpointing`, per-round `guessedAtMs`). */
export const PLAYER_TIE_RANGE_RULES_VERSION = 2;
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

export type PlayerConfiguredRules = { mode: TieRangeBandMode; pinpointing: boolean };

/** Server time of each side's first deliberate guess (before the deadline), else null. */
export type PlayerSettledRound = TieRangeInput['rounds'][number] & { guessedAtMs: [number | null, number | null] };
export type PlayerRulesInput = Omit<TieRangeInput, 'rounds'> & { rounds: PlayerSettledRound[] };

export type PlayerGameContext = {
  schemaVersion: number;
  gameId: string;
  mode: TieRangeBandMode;
  pinpointing: boolean;
  sourceVersion: number;
  currentRoundNumber: number;
  sourceStatus: string;
  teamIds: [string, string];
  teamLabels: ['blue', 'red'];
  playerIds: [string, string];
  roundStarts: PlayerRoundStart[];
  rollbackPendingFrom?: number | null;
  input: PlayerRulesInput;
};

export type PlayerSnapshotAcceptance = {
  accepted: boolean;
  context: PlayerGameContext | null;
  output: TieRangeOutput | null;
  pinpointing: PinpointingOutput | null;
  diagnostic: PlayerDiagnostic | null;
};

export type PlayerContextRestore = {
  context: PlayerGameContext | null;
  output: TieRangeOutput | null;
  pinpointing: PinpointingOutput | null;
  diagnostic: PlayerDiagnostic | null;
};

export interface PlayerTieRangeStorage {
  get(key: string): unknown | Promise<unknown>;
  set(key: string, value: unknown): void | Promise<void>;
  remove(key: string): void | Promise<void>;
  withLock?<T>(operation: () => Promise<T>): Promise<T>;
}

type DecodedSnapshot = Omit<PlayerGameContext, 'schemaVersion' | 'mode' | 'pinpointing' | 'rollbackPendingFrom'>;

function configuredRules(configured: TieRangeBandMode | PlayerConfiguredRules): PlayerConfiguredRules {
  return typeof configured === 'string' ? { mode: configured, pinpointing: false } : configured;
}

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

/** Custom HP applies only when tie range is on and Pinpointing Duels is off. */
function outputFor(context: PlayerGameContext | null): TieRangeOutput | null {
  if (context === null || context.mode === 'off' || context.pinpointing) return null;
  return foldTieRange(context.input, context.mode);
}

export function pinpointingFor(context: PlayerGameContext | null): PinpointingOutput | null {
  if (context === null || !context.pinpointing) return null;
  return foldPinpointing({
    teamIds: context.input.teamIds,
    tieRange: context.mode,
    rounds: context.input.rounds.map(round => ({ round: round.round, scores: round.scores, guessedAtMs: round.guessedAtMs })),
  });
}

function customActive(context: PlayerGameContext | null): boolean {
  return context !== null && (context.mode !== 'off' || context.pinpointing);
}

/** Round of the custom finish (knockout, round limit, or seven points), else null. */
function terminalRound(context: PlayerGameContext | null): number | null {
  if (context === null) return null;
  return context.pinpointing ? pinpointingFor(context)?.terminal?.round ?? null : outputFor(context)?.terminal?.round ?? null;
}

function endedWithoutWinner(context: PlayerGameContext | null): boolean {
  if (context === null || !customActive(context)) return false;
  return context.sourceStatus === 'Finished' && terminalRound(context) === null;
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
    pinpointing: pinpointingFor(previous),
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

function decodeDeadlines(raw: Record<string, unknown>): Map<number, number> {
  const deadlines = new Map<number, number>();
  if (!Array.isArray(raw.rounds)) return deadlines;
  for (const rawRound of raw.rounds) {
    if (typeof rawRound !== 'object' || rawRound === null) continue;
    const { roundNumber, endTime } = rawRound as Record<string, unknown>;
    const at = typeof endTime === 'string' ? Date.parse(endTime) : NaN;
    if (Number.isInteger(roundNumber) && Number.isFinite(at)) deadlines.set(roundNumber as number, at);
  }
  return deadlines;
}

/** Earliest guess created before the round deadline; a timeout auto-submission never counts. */
function decodeGuessTimes(player: Record<string, unknown>, deadlines: Map<number, number>): Map<number, number> {
  const times = new Map<number, number>();
  if (!Array.isArray(player.guesses)) return times;
  for (const rawGuess of player.guesses) {
    if (typeof rawGuess !== 'object' || rawGuess === null) continue;
    const { roundNumber, created } = rawGuess as Record<string, unknown>;
    const at = typeof created === 'string' ? Date.parse(created) : NaN;
    const deadline = Number.isInteger(roundNumber) ? deadlines.get(roundNumber as number) : undefined;
    if (deadline === undefined || !Number.isFinite(at) || at >= deadline) continue;
    const round = roundNumber as number;
    const previous = times.get(round);
    if (previous === undefined || at < previous) times.set(round, at);
  }
  return times;
}

function decodeTeams(raw: Record<string, unknown>): {
  teamIds: [string, string];
  playerIds: [string, string];
  rounds: PlayerSettledRound[];
} {
  const deadlines = decodeDeadlines(raw);
  if (!Array.isArray(raw.teams) || raw.teams.length !== 2) {
    throw new DecodeError('unsupported-game', 'Exactly two teams are required');
  }

  const byLabel = new Map<string, {
    id: string;
    playerId: string;
    results: Map<number, number>;
    guessTimes: Map<number, number>;
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
    const player = record(team.players[0], 'Player');
    const playerId = nonemptyString(player.playerId, 'Player ID');
    const guessTimes = decodeGuessTimes(player, deadlines);
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
    byLabel.set(label, { id, playerId, results, guessTimes });
  }

  const blue = byLabel.get('blue');
  const red = byLabel.get('red');
  if (!blue || !red || blue.id === red.id || blue.playerId === red.playerId) {
    throw new DecodeError('unsupported-game', 'Team and player identities must be distinct');
  }
  const allRounds = new Set([...blue.results.keys(), ...red.results.keys()]);
  const ordered = [...allRounds].sort((left, right) => left - right);
  const rounds: PlayerSettledRound[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const round = ordered[index];
    if (round !== index + 1 || !blue.results.has(round) || !red.results.has(round)) {
      throw new DecodeError('partial-results', `Paired contiguous results are required at round ${index + 1}`);
    }
    rounds.push({ round, scores: [blue.results.get(round)!, red.results.get(round)!],
      guessedAtMs: [blue.guessTimes.get(round) ?? null, red.guessTimes.get(round) ?? null] });
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

/** Scores identify a settled round; guess times are frozen separately and never block acceptance. */
function sameRound(left: PlayerSettledRound, right: PlayerSettledRound): boolean {
  return left.round === right.round && tupleEqual(left.scores, right.scores);
}

/** Keep captured guess times; a later snapshot may only fill in ones that were unknown. */
function retainGuessTimes(previous: PlayerGameContext, rounds: PlayerSettledRound[]): PlayerSettledRound[] {
  return rounds.map(round => {
    const old = previous.input.rounds.find(value => value.round === round.round);
    if (!old || !tupleEqual(old.scores, round.scores)) return round;
    return { ...round, guessedAtMs: [old.guessedAtMs[0] ?? round.guessedAtMs[0], old.guessedAtMs[1] ?? round.guessedAtMs[1]] };
  });
}

function rollbackStart(previous: PlayerGameContext, next: DecodedSnapshot): number | null {
  // A finished duel cannot restart: a lower current round there only means a pre-announced
  // next round never played (a health kill after auto-start). Its history is final.
  if (next.sourceStatus === 'Finished') return null;
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
    Object.freeze(round.guessedAtMs);
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
  configured: TieRangeBandMode | PlayerConfiguredRules,
): PlayerSnapshotAcceptance {
  const rules = configuredRules(configured);
  const configuredMode = rules.mode;
  const rawGameId = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).gameId
    : undefined;
  const relevantPrevious = previous && typeof rawGameId === 'string' && rawGameId !== previous.gameId
    ? null
    : previous;
  if ((configuredMode !== 'off' && configuredMode !== 'full' && configuredMode !== 'half') || typeof rules.pinpointing !== 'boolean') {
    return retained(relevantPrevious, 'invalid-snapshot', 'Configured rules are invalid');
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
    return {
      accepted: true, context: activePrevious, output: outputFor(activePrevious), pinpointing: pinpointingFor(activePrevious),
      diagnostic: activePrevious.rollbackPendingFrom
        ? diagnostic('recovery', 'Waiting for restarted round history to clear')
        : endedWithoutWinner(activePrevious)
          ? diagnostic('source-ended', 'Duel ended without a custom winner') : null,
    };
  }
  if (activePrevious && (!tupleEqual(activePrevious.teamIds, decoded.teamIds)
    || !tupleEqual(activePrevious.playerIds, decoded.playerIds))) {
    return retained(activePrevious, 'identity-change', 'Team identities changed during the duel');
  }
  if (activePrevious && !sameRules(activePrevious, decoded)) {
    return retained(activePrevious, 'rules-change', 'Duel scoring options changed during the duel');
  }

  const rollback = activePrevious ? rollbackStart(activePrevious, decoded) : null;
  if (rollback === null && !activePrevious?.rollbackPendingFrom
    && decoded.input.rounds.length < decoded.currentRoundNumber - 1) {
    return retained(activePrevious, 'recovery', 'Earlier resolved rounds are missing from the player response');
  }
  let acceptedRounds = decoded.input.rounds;
  let rollbackPendingFrom = activePrevious?.rollbackPendingFrom ?? null;
  if (activePrevious) {
    if (rollback === null) {
      if (decoded.input.rounds.length < activePrevious.input.rounds.length
        || activePrevious.input.rounds.some((round, index) => !decoded.input.rounds[index]
          || !sameRound(round, decoded.input.rounds[index]))) {
        return retained(activePrevious, 'recovery', 'Settled history is incomplete or changed without rollback evidence');
      }
      if (terminalRound(activePrevious) !== null) {
        acceptedRounds = activePrevious.input.rounds;
      }
    } else {
      const prefix = activePrevious.input.rounds.filter(round => round.round < rollback);
      if (prefix.some((round, index) => !decoded.input.rounds[index]
        || !sameRound(round, decoded.input.rounds[index]))) {
        return retained(activePrevious, 'recovery', 'Rollback response does not contain the verified prefix');
      }
      acceptedRounds = prefix;
      rollbackPendingFrom = decoded.input.rounds.some(round => round.round >= rollback) ? rollback : null;
    }
  }

  if (activePrevious) acceptedRounds = retainGuessTimes(activePrevious, acceptedRounds);
  if (rollback === null && rollbackPendingFrom !== null && decoded.sourceStatus === 'Finished') {
    // The live node may drop its round number before it reports the finish; the final
    // archive is authoritative, so the suffix it carries is settled history, not a restart.
    rollbackPendingFrom = null;
  } else if (rollback === null && rollbackPendingFrom !== null) {
    if (decoded.input.rounds.some(round => round.round >= rollbackPendingFrom!)) {
      // A newer version alone cannot tie an old score to the restarted round.
      // Wait until the authoritative history clears before accepting its suffix.
      acceptedRounds = acceptedRounds.filter(round => round.round < rollbackPendingFrom!);
    } else {
      rollbackPendingFrom = null;
    }
  }

  const context = freezeContext({
    schemaVersion: PLAYER_TIE_RANGE_RULES_VERSION,
    gameId: decoded.gameId,
    mode: activePrevious?.mode ?? configuredMode,
    pinpointing: activePrevious?.pinpointing ?? rules.pinpointing,
    sourceVersion: decoded.sourceVersion,
    currentRoundNumber: decoded.currentRoundNumber,
    sourceStatus: decoded.sourceStatus,
    rollbackPendingFrom,
    teamIds: [...decoded.teamIds],
    teamLabels: ['blue', 'red'],
    playerIds: [...decoded.playerIds],
    roundStarts: decoded.roundStarts.map(start => ({ ...start })),
    input: {
      ...decoded.input,
      teamIds: [...decoded.teamIds],
      rounds: acceptedRounds.map(round => ({ round: round.round, scores: [...round.scores], guessedAtMs: [...round.guessedAtMs] })),
    },
  });
  return {
    accepted: true,
    context,
    output: outputFor(context),
    pinpointing: pinpointingFor(context),
    diagnostic: rollbackPendingFrom !== null
      ? diagnostic('recovery', 'Waiting for restarted round history to clear')
      : endedWithoutWinner(context)
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

function migrateSavedContext(parsed: PlayerGameContext): void {
  if (parsed.schemaVersion !== 1) return;
  // Version 1 predates Pinpointing Duels: HP-only contexts with no guess times.
  parsed.schemaVersion = PLAYER_TIE_RANGE_RULES_VERSION;
  parsed.pinpointing = false;
  if (parsed.input && Array.isArray(parsed.input.rounds)) {
    for (const round of parsed.input.rounds) if (round && round.guessedAtMs === undefined) round.guessedAtMs = [null, null];
  }
}

function restoreContext(value: unknown, expectedGameId: string): PlayerContextRestore {
  if (typeof value !== 'string') return { context: null, output: null, pinpointing: null, diagnostic: null };
  try {
    const parsed = record(JSON.parse(value), 'Saved tie-range context') as unknown as PlayerGameContext;
    migrateSavedContext(parsed);
    if (parsed.schemaVersion !== PLAYER_TIE_RANGE_RULES_VERSION) {
      return {
        context: null,
        output: null,
        pinpointing: null,
        diagnostic: diagnostic('schema-mismatch', 'Saved tie-range rules are from a different version'),
      };
    }
    if ((parsed.mode !== 'off' && parsed.mode !== 'full' && parsed.mode !== 'half')
      || typeof parsed.pinpointing !== 'boolean'
      || parsed.gameId !== expectedGameId || expectedGameId.length === 0
      || !Number.isInteger(parsed.sourceVersion) || parsed.sourceVersion < 0
      || !Number.isInteger(parsed.currentRoundNumber) || parsed.currentRoundNumber < 1
      || typeof parsed.sourceStatus !== 'string' || parsed.sourceStatus.length === 0
      || !Array.isArray(parsed.teamIds) || parsed.teamIds.length !== 2
      || !Array.isArray(parsed.teamLabels) || !tupleEqual(parsed.teamLabels, ['blue', 'red'])
      || !Array.isArray(parsed.playerIds) || parsed.playerIds.length !== 2
      || !Array.isArray(parsed.roundStarts)) {
      throw new Error('invalid context');
    }
    for (const tuple of [parsed.teamIds, parsed.playerIds]) {
      if (tuple.some(id => typeof id !== 'string' || id.length === 0) || tuple[0] === tuple[1]) {
        throw new Error('invalid identity');
      }
    }
    if (!parsed.input || !tupleEqual(parsed.teamIds, parsed.input.teamIds)) throw new Error('identity mismatch');
    // Off contexts still need valid inputs: they can be restored before a fetch.
    foldTieRange(parsed.input, parsed.mode === 'off' ? null : parsed.mode);
    // Also validates every round's guess times, whichever ruleset is captured.
    foldPinpointing({ teamIds: parsed.input.teamIds, tieRange: parsed.mode, rounds: parsed.input.rounds });
    const seen = new Set<number>();
    for (const start of parsed.roundStarts) {
      if (!start || !Number.isInteger(start.round) || start.round < 1 || seen.has(start.round)
        || typeof start.startTime !== 'string' || start.startTime.length === 0) throw new Error('invalid round identity');
      seen.add(start.round);
    }
    if (parsed.rollbackPendingFrom !== undefined && parsed.rollbackPendingFrom !== null
      && (!Number.isInteger(parsed.rollbackPendingFrom) || parsed.rollbackPendingFrom < 1
        || parsed.input.rounds.some(round => round.round >= parsed.rollbackPendingFrom!))) throw new Error('invalid rollback');
    const context = freezeContext(parsed);
    return {
      context, output: outputFor(context), pinpointing: pinpointingFor(context),
      diagnostic: context.rollbackPendingFrom
        ? diagnostic('recovery', 'Waiting for restarted round history to clear')
        : endedWithoutWinner(context)
          ? diagnostic('source-ended', 'Duel ended without a custom winner') : null,
    };
  } catch {
    return {
      context: null,
      output: null,
      pinpointing: null,
      diagnostic: diagnostic('invalid-saved-context', 'Saved tie-range context is invalid'),
    };
  }
}

export async function loadPlayerContext(
  storage: PlayerTieRangeStorage,
  gameId: string,
): Promise<PlayerContextRestore> {
  return restoreContext(await storage.get(gameKey(gameId)), gameId);
}

const saveQueues = new WeakMap<PlayerTieRangeStorage, Promise<void>>();

export async function savePlayerContext(
  storage: PlayerTieRangeStorage,
  context: PlayerGameContext,
): Promise<void> {
  const operation = async () => {
    await storage.set(gameKey(context.gameId), JSON.stringify(context));
    const oldIndex = parseIndex(await storage.get(STORAGE_INDEX_KEY));
    const index = [...new Set(oldIndex.filter(gameId => gameId !== context.gameId)), context.gameId];
    const evicted = index.splice(0, Math.max(0, index.length - MAX_SAVED_GAMES));
    await storage.set(STORAGE_INDEX_KEY, JSON.stringify(index));
    await Promise.all(evicted.map(gameId => storage.remove(gameKey(gameId))));
  };
  const previous = saveQueues.get(storage) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => storage.withLock ? storage.withLock(operation) : operation());
  saveQueues.set(storage, next);
  try { await next; } finally { if (saveQueues.get(storage) === next) saveQueues.delete(storage); }
}
