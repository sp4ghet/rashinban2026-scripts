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
