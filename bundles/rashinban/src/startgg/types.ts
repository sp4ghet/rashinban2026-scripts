// start.gg data shapes. `Raw*` mirrors the GraphQL responses produced by the
// queries in ./queries.ts (and scripts/startgg-fetch.mjs). The normalized
// types below are what the replicant carries and what overlays render.

// ---- raw (GraphQL) -------------------------------------------------------

export interface RawParticipant {
  id: number;
  gamerTag: string | null;
  prefix: string | null;
}

export interface RawEntrant {
  id: number;
  name: string | null;
  initialSeedNum?: number | null;
  participants?: RawParticipant[] | null;
}

export interface RawSlot {
  id: string;
  slotIndex: number;
  prereqType: string | null;
  prereqId: string | null;
  prereqPlacement: number | null;
  entrant: RawEntrant | null;
  seed: { id: number; seedNum: number | null } | null;
  standing: { placement: number | null; stats: { score: { value: number | null } | null } | null } | null;
}

export interface RawSet {
  id: number;
  identifier: string | null;
  round: number;
  fullRoundText: string | null;
  state: number;
  winnerId: number | null;
  displayScore: string | null;
  totalGames: number | null;
  startedAt: number | null;
  completedAt: number | null;
  wPlacement: number | null;
  lPlacement: number | null;
  hasPlaceholder?: boolean | null;
  stream?: { streamName: string | null; streamSource: string | null } | null;
  slots: RawSlot[];
  phaseGroup?: { id: number; displayIdentifier: string | null } | null;
}

export interface RawProgression {
  id: number;
  originPlacement: number | null;
  originPhaseGroup?: { id: number; displayIdentifier: string | null } | null;
  originPhase?: { id: number; name: string | null } | null;
}

export interface RawSeed {
  id: number;
  seedNum: number | null;
  placement: number | null;
  isBye: boolean | null;
  entrant: { id: number; name: string | null } | null;
  progressionSource: RawProgression | null;
}

export interface RawPhaseGroup {
  id: number;
  displayIdentifier: string | null;
  bracketType: string | null;
  state: number;
  numRounds: number | null;
  phase: { id: number; name: string | null; phaseOrder: number; bracketType: string | null; groupCount: number | null; numSeeds: number | null } | null;
  progressionsOut: RawProgression[] | null;
  seeds: { nodes: RawSeed[] } | null;
  sets: { pageInfo?: { total: number; totalPages: number }; nodes: RawSet[] } | null;
}

export interface RawEvent {
  id: number;
  name: string | null;
  slug: string | null;
  numEntrants: number | null;
  state: string | null;
  startAt: number | null;
  tournament?: { id: number; name: string | null; slug: string | null } | null;
  phases: {
    id: number;
    name: string | null;
    bracketType: string | null;
    groupCount: number | null;
    numSeeds: number | null;
    phaseOrder: number;
    state: string | null;
    isExhibition?: boolean | null;
    phaseGroups: { pageInfo?: { total: number }; nodes: { id: number; displayIdentifier: string | null; bracketType: string | null; numRounds: number | null; state: number }[] } | null;
  }[];
}

export interface RawStreamQueueEntry {
  stream: { id: number; streamName: string | null; streamSource: string | null } | null;
  sets: RawSet[] | null;
}

// ---- normalized ----------------------------------------------------------

export type SetState =
  | "created"
  | "active"
  | "completed"
  | "ready"
  | "invalid"
  | "called"
  | "queued"
  | "unknown";

export type BracketSide = "winners" | "losers" | "grand";

export interface Entrant {
  id: number;
  /** Full display name as start.gg shows it, e.g. "ZETA | Higuchi". */
  name: string;
  /** Name without the sponsor prefix. */
  tag: string;
  prefix: string | null;
  initialSeedNum: number | null;
}

export interface SlotPrereq {
  type: string;
  id: string;
  placement: number | null;
  /** True when a "set" prereq refers to a set outside this phase group (previous phase). */
  external: boolean;
}

export interface BracketSlot {
  index: number;
  entrantId: number | null;
  seedNum: number | null;
  prereq: SlotPrereq | null;
  score: number | null;
  placement: number | null;
}

export interface BracketSet {
  id: number;
  groupId: number;
  phaseId: number | null;
  identifier: string;
  round: number;
  side: BracketSide;
  roundText: string;
  state: SetState;
  stateCode: number;
  winnerEntrantId: number | null;
  loserEntrantId: number | null;
  displayScore: string | null;
  totalGames: number | null;
  wPlacement: number | null;
  lPlacement: number | null;
  startedAt: number | null;
  completedAt: number | null;
  streamName: string | null;
  slots: BracketSlot[];
}

export interface Seed {
  id: number;
  seedNum: number | null;
  placement: number | null;
  isBye: boolean;
  entrantId: number | null;
  /** Where this seed came from when the phase is fed by progressions. */
  source: { phaseGroupId: number | null; phaseGroupIdentifier: string | null; phaseId: number | null; placement: number | null } | null;
}

export interface PhaseGroup {
  id: number;
  phaseId: number | null;
  identifier: string;
  bracketType: string | null;
  state: number;
  /** Highest winners round and deepest losers round present in `sets`. */
  winnersRounds: number;
  losersRounds: number;
  /** Placements (within this group) that progress to the next phase. */
  progressionsOut: number[];
  seeds: Seed[];
  setIds: number[];
}

export interface Phase {
  id: number;
  name: string;
  order: number;
  bracketType: string | null;
  groupCount: number | null;
  numSeeds: number | null;
  state: string | null;
  groupIds: number[];
}

export interface StreamQueueEntry {
  streamName: string | null;
  streamSource: string | null;
  setIds: number[];
}

export interface StartggBracket {
  fetchedAt: number;
  event: {
    id: number;
    name: string;
    slug: string;
    tournamentName: string | null;
    numEntrants: number | null;
    state: string | null;
  } | null;
  phases: Phase[];
  groups: Record<number, PhaseGroup>;
  sets: Record<number, BracketSet>;
  entrants: Record<number, Entrant>;
  streamQueue: StreamQueueEntry[];
}

export interface StartggConfig {
  enabled: boolean;
  /** e.g. "tournament/rashinban-2026/event/rashinban-2026" */
  eventSlug: string;
  /** e.g. "rashinban-2026" (for the stream queue). Derived from eventSlug when empty. */
  tournamentSlug: string;
  pollIntervalMs: number;
}

export interface StartggStatus {
  polling: boolean;
  lastFetchAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  lastComplexity: number | null;
  requestsLastMinute: number;
  tokenPresent: boolean;
}
