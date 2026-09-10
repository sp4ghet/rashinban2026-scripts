import type {
  DuelPlayer,
  DuelState,
  Guess,
  Mode,
  Point,
  Round,
  RoundResult,
} from '../types/presenter.ts';

type RecordValue = Record<string, unknown>;

export type SnapshotDecodeResult = {
  state: DuelState | null;
  warnings: string[];
};

const SNAPSHOT_CODES = new Set([
  'DuelStarted',
  'DuelPinPlaced',
  'DuelPlayerGuessed',
  'DuelRoundTimedOut',
  'DuelNewRound',
  'DuelFinished',
  'DuelAborted',
]);

class DecodeError extends Error {
  readonly warning: string;

  constructor(warning: string) {
    super(warning);
    this.warning = warning;
  }
}

function invalid(): never {
  throw new DecodeError('Invalid duel snapshot');
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): RecordValue {
  if (!isRecord(value)) invalid();
  return value;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) invalid();
  return value;
}

function string(value: unknown): string {
  if (typeof value !== 'string') invalid();
  return value;
}

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid();
  return value;
}

function integer(value: unknown): number {
  const decoded = number(value);
  if (!Number.isInteger(decoded)) invalid();
  return decoded;
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid();
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : string(value);
}

function time(value: unknown): number | null {
  if (value === null) return null;
  const decoded = Date.parse(string(value));
  if (!Number.isFinite(decoded)) invalid();
  return decoded;
}

function requiredTime(value: unknown): number {
  const decoded = time(value);
  if (decoded === null) invalid();
  return decoded;
}

function point(value: unknown): Point {
  const decoded = record(value);
  return { lat: number(decoded.lat), lng: number(decoded.lng) };
}

function nullablePoint(value: unknown): Point | null {
  return value === null ? null : point(value);
}

function guess(value: unknown): Guess {
  const decoded = record(value);
  return {
    round: integer(decoded.roundNumber),
    lat: number(decoded.lat),
    lng: number(decoded.lng),
    distanceM: number(decoded.distance),
    score: number(decoded.score),
    createdAtMs: requiredTime(decoded.created),
  };
}

function roundResult(value: unknown): RoundResult {
  const decoded = record(value);
  return {
    round: integer(decoded.roundNumber),
    score: number(decoded.score),
    bestGuess: decoded.bestGuess === null ? null : guess(decoded.bestGuess),
    healthBefore: number(decoded.healthBefore),
    healthAfter: number(decoded.healthAfter),
    damageDealt: number(decoded.damageDealt),
    multiplier: number(decoded.multiplier),
  };
}

function team(value: unknown): DuelPlayer {
  const decoded = record(value);
  const players = array(decoded.players);
  if (players.length !== 1) {
    throw new DecodeError('Unsupported duel: expected exactly two single-player teams');
  }
  const player = record(players[0]);
  const color = string(decoded.name);
  if (color !== 'blue' && color !== 'red') invalid();

  return {
    id: string(player.playerId),
    teamId: string(decoded.id),
    teamColor: color,
    health: number(decoded.health),
    multiplier: number(decoded.currentMultiplier),
    pin: nullablePoint(player.pin),
    guesses: array(player.guesses).map(guess),
    results: array(decoded.roundResults).map(roundResult),
  };
}

function round(value: unknown): Round {
  const decoded = record(value);
  const panorama = record(decoded.panorama);
  return {
    number: integer(decoded.roundNumber),
    panorama: {
      ...point(panorama),
      panoId: string(panorama.panoId),
      heading: number(panorama.heading),
      pitch: number(panorama.pitch),
      zoom: number(panorama.zoom),
    },
    startAtMs: time(decoded.startTime),
    timerStartAtMs: time(decoded.timerStartTime),
    endAtMs: time(decoded.endTime),
    multiplier: number(decoded.multiplier),
  };
}

function mode(value: unknown): Mode {
  const decoded = record(value);
  const forbidMoving = boolean(decoded.forbidMoving);
  const forbidZooming = boolean(decoded.forbidZooming);
  const forbidRotating = boolean(decoded.forbidRotating);

  if (!forbidMoving && !forbidZooming && !forbidRotating) return 'MOVE';
  if (forbidMoving && !forbidZooming && !forbidRotating) return 'NM';
  if (forbidMoving && forbidZooming && forbidRotating) return 'NMPZ';
  throw new DecodeError('Unsupported duel movement mode');
}

function status(value: unknown): DuelState['status'] {
  const decoded = string(value);
  if (decoded !== 'Created' && decoded !== 'Ongoing' && decoded !== 'Finished') invalid();
  return decoded;
}

function decodeState(message: RecordValue, code: string): DuelState {
  const duel = record(message.duel);
  const source = record(duel.state);
  const teams = array(source.teams);
  if (teams.length !== 2) {
    throw new DecodeError('Unsupported duel: expected exactly two single-player teams');
  }
  const players: [DuelPlayer, DuelPlayer] = [team(teams[0]), team(teams[1])];
  if (players[0].teamColor === players[1].teamColor) invalid();

  const options = record(source.options);
  const result = source.result === null ? null : record(source.result);

  return {
    gameId: string(source.gameId),
    version: integer(source.version),
    round: integer(source.currentRoundNumber),
    mode: mode(options.movementOptions),
    status: status(source.status),
    paused: boolean(source.isPaused),
    initialHealth: number(options.initialHealth),
    players,
    rounds: array(source.rounds).map(round),
    aborted: code === 'DuelAborted',
    winnerTeamId: result === null ? null : nullableString(result.winningTeamId),
    isDraw: result === null ? false : boolean(result.isDraw),
  };
}

export function decodeSnapshot(message: unknown): SnapshotDecodeResult {
  try {
    const decoded = record(message);
    const code = string(decoded.code);
    if (!SNAPSHOT_CODES.has(code)) return { state: null, warnings: [] };
    return { state: decodeState(decoded, code), warnings: [] };
  } catch (error) {
    return {
      state: null,
      warnings: [error instanceof DecodeError ? error.warning : 'Invalid duel snapshot'],
    };
  }
}
