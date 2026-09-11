export type Mode = 'MOVE' | 'NM' | 'NMPZ';

export type Point = { lat: number; lng: number };

export type Panorama = Point & {
  panoId: string;
  heading: number;
  pitch: number;
  zoom: number;
};

export type Guess = Point & {
  round: number;
  score: number;
  distanceM: number;
  createdAtMs: number;
};

export type RoundResult = {
  round: number;
  score: number;
  bestGuess: Guess | null;
  healthBefore: number;
  healthAfter: number;
  damageDealt: number;
  multiplier: number;
};

export type DuelPlayer = {
  id: string;
  teamId: string;
  teamColor: 'blue' | 'red';
  health: number;
  multiplier: number;
  pin: Point | null;
  guesses: Guess[];
  results: RoundResult[];
};

export type Round = {
  number: number;
  panorama: Panorama;
  startAtMs: number | null;
  timerStartAtMs: number | null;
  endAtMs: number | null;
  multiplier: number;
};

export type DuelState = {
  gameId: string;
  version: number;
  round: number;
  mode: Mode;
  status: 'Created' | 'Ongoing' | 'Finished';
  paused: boolean;
  manualRoundStart: boolean;
  roundStartingBehavior?: 'Default' | 'ManuallyStartFirstRound' | 'ManuallyStartAllRounds';
  maxRounds?: number | null;
  roundTimeMs?: number | null;
  initialHealth: number;
  players: [DuelPlayer, DuelPlayer];
  rounds: Round[];
  aborted: boolean;
  winnerTeamId: string | null;
  isDraw: boolean;
};

export type ApplyResult = {
  state: DuelState | null;
  accepted: boolean;
  warnings: string[];
};

export type Bounds = { north: number; east: number; south: number; west: number };

export type PlayerView = {
  panorama: Panorama;
  mapBounds: Bounds | null;
  pin: Point | null;
  mapActive: boolean;
  mapSticky: boolean;
  mapSize: number;
  lastByType: Record<string, number>;
};

export type Views = {
  gameId: string;
  round: number;
  players: Record<string, PlayerView>;
};

export type Competitor = {
  id: string;
  playerId: string | null;
  name: string;
  handle: string;
  wins: number;
};

export type SeriesState = {
  id: string;
  source: 'manual';
  left: Competitor;
  right: Competitor;
};

export type Phase = 'waiting-game' | 'waiting-host' | 'pre-round' | 'live'
  | 'results-transition' | 'results-reveal' | 'between-rounds' | 'finished' | 'aborted';
export type MusicContext = 'idle' | 'round' | 'urgent' | 'results';
export type EffectKind = 'none' | 'single-5k' | 'double-5k';
export type CueKind = 'pre-round-tick' | 'round-start' | 'pin' | 'guess' | 'countdown' | 'results' | 'count' | 'collision' | 'tie' | 'multiplier' | 'damage' | 'five-k';
export type ScoreCalculation = { tied: boolean; winnerId: string | null; loserId: string | null; difference: number; damage: number; multiplier: number; hasDamage: boolean };
export type ScoreSequence = ScoreCalculation & {
  countAtMs: number; countEndAtMs: number; subtractAtMs: number; collisionAtMs: number; differenceAtMs: number;
  multiplierAtMs: number | null; flightAtMs: number | null; impactAtMs: number | null; healthEndAtMs: number; completeAtMs: number;
};
export type ScoreStage = 'entry' | 'count' | 'score-hold' | 'subtract' | 'difference' | 'tie' | 'multiplier' | 'flight' | 'impact' | 'complete';
export type ScoreProjection = ScoreCalculation & { stage: ScoreStage; entryProgress: number; subtractProgress: number; multiplierProgress: number; flightProgress: number; impactProgress: number; tieProgress: number };
export type Cue = { id: string; kind: CueKind; atMs: number; untilMs: number; playerId: string | null; offsetS?: number };
export type Timeline = {
  generation: string;
  revision: number;
  gameId: string | null;
  round: number | null;
  phase: Phase;
  musicEpochMs: number;
  music: MusicContext;
  effect: EffectKind;
  effectDeadlineMs: number | null;
  revealAtMs: number | null;
  damageAtMs: number | null;
  holdAtMs: number | null;
  cues: Cue[];
  hasDamage?: boolean;
  scoring?: ScoreSequence | null;
  scoringResult?: ScoreCalculation;
  // Observations suppress replay when snapshots or scheduled ticks repeat.
  observed: Record<string, { pin: Point | null; statePin?: Point | null; guessed: boolean; pinCueAtMs: number | null }>;
  countdownEndAtMs: number | null;
  countdownStarted?: boolean;
  countdownTimerStartAtMs?: number | null;
  roundStartAtMs?: number | null;
};
export type Timing = { leadMs: number; countMs: number; damageMs: number; effectWatchdogMs: number; pinRateLimitMs?: number };
export type VisiblePlayer = { id: string; health: number; healthBar?: number; locked: boolean; score: number | null; distanceM: number | null };
export type Projection = { phase: Phase; remainingMs: number | null; answer: Panorama | null; players: VisiblePlayer[]; scoring?: ScoreProjection };
