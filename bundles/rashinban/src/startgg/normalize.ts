// Pure conversion of raw start.gg GraphQL data into the StartggBracket shape.
import type {
  BracketSet,
  BracketSide,
  BracketSlot,
  Entrant,
  Phase,
  PhaseGroup,
  RawEntrant,
  RawEvent,
  RawPhaseGroup,
  RawSet,
  RawStreamQueueEntry,
  Seed,
  SetState,
  StartggBracket,
} from "./types";

const SET_STATES: Record<number, SetState> = {
  1: "created",
  2: "active",
  3: "completed",
  4: "ready",
  5: "invalid",
  6: "called",
  7: "queued",
};

export function setState(code: number): SetState {
  return SET_STATES[code] ?? "unknown";
}

export function sideOf(set: Pick<RawSet, "round" | "fullRoundText">): BracketSide {
  if ((set.fullRoundText ?? "").startsWith("Grand Final")) return "grand";
  return set.round < 0 ? "losers" : "winners";
}

export function normalizeEntrant(raw: RawEntrant): Entrant {
  const p = raw.participants?.[0];
  const name = raw.name ?? p?.gamerTag ?? `#${raw.id}`;
  const prefix = p?.prefix?.trim() || null;
  const tag =
    p?.gamerTag?.trim() || (prefix && name.startsWith(`${prefix} | `) ? name.slice(prefix.length + 3) : name);
  return { id: raw.id, name, tag, prefix, initialSeedNum: raw.initialSeedNum ?? null };
}

export function normalizeSet(
  raw: RawSet,
  groupId: number,
  phaseId: number | null,
  localSetIds: Set<string>,
): BracketSet {
  const slots: BracketSlot[] = [...raw.slots]
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .map((s) => ({
      index: s.slotIndex,
      entrantId: s.entrant?.id ?? null,
      seedNum: s.seed?.seedNum ?? null,
      prereq:
        s.prereqType && s.prereqId
          ? {
              type: s.prereqType,
              id: s.prereqId,
              placement: s.prereqPlacement ?? null,
              external: s.prereqType === "set" && !localSetIds.has(String(s.prereqId)),
            }
          : null,
      score: s.standing?.stats?.score?.value ?? null,
      placement: s.standing?.placement ?? null,
    }));
  const winnerEntrantId = raw.winnerId ?? null;
  const loser =
    winnerEntrantId === null ? null : slots.find((s) => s.entrantId !== null && s.entrantId !== winnerEntrantId);
  return {
    id: raw.id,
    groupId,
    phaseId,
    identifier: raw.identifier ?? "",
    round: raw.round,
    side: sideOf(raw),
    roundText: raw.fullRoundText ?? "",
    state: setState(raw.state),
    stateCode: raw.state,
    winnerEntrantId,
    loserEntrantId: loser?.entrantId ?? null,
    displayScore: raw.displayScore ?? null,
    totalGames: raw.totalGames ?? null,
    wPlacement: raw.wPlacement ?? null,
    lPlacement: raw.lPlacement ?? null,
    startedAt: raw.startedAt ?? null,
    completedAt: raw.completedAt ?? null,
    streamName: raw.stream?.streamName ?? null,
    slots,
  };
}

export interface NormalizedGroup {
  group: PhaseGroup;
  sets: BracketSet[];
  entrants: Entrant[];
}

export function normalizePhaseGroup(raw: RawPhaseGroup): NormalizedGroup {
  const rawSets = raw.sets?.nodes ?? [];
  const localIds = new Set(rawSets.map((s) => String(s.id)));
  const phaseId = raw.phase?.id ?? null;
  const sets = rawSets.map((s) => normalizeSet(s, raw.id, phaseId, localIds));
  const entrants = new Map<number, Entrant>();
  for (const s of rawSets) {
    for (const slot of s.slots) if (slot.entrant) entrants.set(slot.entrant.id, normalizeEntrant(slot.entrant));
  }
  const seeds: Seed[] = (raw.seeds?.nodes ?? []).map((s) => ({
    id: s.id,
    seedNum: s.seedNum ?? null,
    placement: s.placement ?? null,
    isBye: Boolean(s.isBye),
    entrantId: s.entrant?.id ?? null,
    source: s.progressionSource
      ? {
          phaseGroupId: s.progressionSource.originPhaseGroup?.id ?? null,
          phaseGroupIdentifier: s.progressionSource.originPhaseGroup?.displayIdentifier ?? null,
          phaseId: s.progressionSource.originPhase?.id ?? null,
          placement: s.progressionSource.originPlacement ?? null,
        }
      : null,
  }));
  // Seeds can name entrants that have no set yet (unstarted bracket).
  for (const s of raw.seeds?.nodes ?? []) {
    if (s.entrant && !entrants.has(s.entrant.id)) {
      entrants.set(s.entrant.id, normalizeEntrant({ id: s.entrant.id, name: s.entrant.name }));
    }
  }
  const group: PhaseGroup = {
    id: raw.id,
    phaseId,
    identifier: raw.displayIdentifier ?? String(raw.id),
    bracketType: raw.bracketType ?? null,
    state: raw.state,
    winnersRounds: Math.max(0, ...sets.filter((s) => s.side !== "losers").map((s) => s.round)),
    losersRounds: Math.max(0, ...sets.filter((s) => s.side === "losers").map((s) => -s.round)),
    progressionsOut: (raw.progressionsOut ?? [])
      .map((p) => p.originPlacement ?? 0)
      .filter((p) => p > 0)
      .sort((a, b) => a - b),
    seeds,
    setIds: sets.map((s) => s.id),
  };
  return { group, sets, entrants: [...entrants.values()] };
}

export function normalizePhases(raw: RawEvent): Phase[] {
  return [...raw.phases]
    .sort((a, b) => a.phaseOrder - b.phaseOrder)
    .map((p) => ({
      id: p.id,
      name: p.name ?? "",
      order: p.phaseOrder,
      bracketType: p.bracketType ?? null,
      groupCount: p.groupCount ?? null,
      numSeeds: p.numSeeds ?? null,
      state: p.state ?? null,
      groupIds: (p.phaseGroups?.nodes ?? []).map((g) => g.id),
    }));
}

export function normalizeEvent(
  rawEvent: RawEvent | null,
  rawGroups: RawPhaseGroup[],
  rawStreamQueue: RawStreamQueueEntry[] | null,
  fetchedAt: number,
): StartggBracket {
  const out: StartggBracket = {
    fetchedAt,
    event: rawEvent
      ? {
          id: rawEvent.id,
          name: rawEvent.name ?? "",
          slug: rawEvent.slug ?? "",
          tournamentName: rawEvent.tournament?.name ?? null,
          numEntrants: rawEvent.numEntrants ?? null,
          state: rawEvent.state ?? null,
        }
      : null,
    phases: rawEvent ? normalizePhases(rawEvent) : [],
    groups: {},
    sets: {},
    entrants: {},
    streamQueue: [],
  };
  for (const rg of rawGroups) {
    const { group, sets, entrants } = normalizePhaseGroup(rg);
    out.groups[group.id] = group;
    for (const s of sets) out.sets[s.id] = s;
    for (const e of entrants) out.entrants[e.id] = e;
  }
  for (const entry of rawStreamQueue ?? []) {
    const setIds: number[] = [];
    for (const s of entry.sets ?? []) {
      setIds.push(s.id);
      if (!out.sets[s.id]) {
        const groupId = s.phaseGroup?.id ?? 0;
        out.sets[s.id] = normalizeSet(s, groupId, out.groups[groupId]?.phaseId ?? null, new Set());
        for (const slot of s.slots) {
          if (slot.entrant && !out.entrants[slot.entrant.id]) {
            out.entrants[slot.entrant.id] = normalizeEntrant(slot.entrant);
          }
        }
      }
    }
    out.streamQueue.push({
      streamName: entry.stream?.streamName ?? null,
      streamSource: entry.stream?.streamSource ?? null,
      setIds,
    });
  }
  return out;
}

/** Sets of one group in display order: winners rounds ascending, grand finals, then losers rounds from the top. */
export function groupSets(bracket: StartggBracket, groupId: number): BracketSet[] {
  const g = bracket.groups[groupId];
  if (!g) return [];
  const order = (s: BracketSet) =>
    s.side === "losers" ? 1000 - s.round : s.side === "grand" ? 500 + s.round : s.round;
  return g.setIds
    .map((id) => bracket.sets[id])
    .filter((s): s is BracketSet => Boolean(s))
    .sort((a, b) => order(a) - order(b) || a.identifier.localeCompare(b.identifier));
}

/** Sets worth showing now: active first, then called, ready, queued. */
export function liveSets(bracket: StartggBracket): BracketSet[] {
  const rank: Partial<Record<SetState, number>> = { active: 0, called: 1, ready: 2, queued: 3 };
  return Object.values(bracket.sets)
    .filter((s) => s.state in rank)
    .sort((a, b) => rank[a.state]! - rank[b.state]! || (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity));
}
