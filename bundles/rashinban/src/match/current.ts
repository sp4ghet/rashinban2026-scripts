// Which match is "on stream". Pure: overlays and the dashboard call
// resolveCurrentMatch with the replicant values they already have.

import { liveSets } from "../startgg/normalize.ts";
import type { BracketSet, Entrant, StartggBracket } from "../startgg/types";

export type CurrentMatchMode = "auto" | "set" | "tags";

export interface CurrentMatchSelection {
  /**
   * auto: first set in the stream queue, else the first active/called set.
   * set:  the start.gg set with id `setId`.
   * tags: two gamer tags typed by the operator (no start.gg needed).
   */
  mode: CurrentMatchMode;
  setId: number | null;
  tags: [string, string];
}

export const DEFAULT_SELECTION: CurrentMatchSelection = { mode: "auto", setId: null, tags: ["", ""] };

export interface CurrentMatch {
  /** Source that produced this match. */
  source: "queue" | "live" | "set" | "tags" | "none";
  set: BracketSet | null;
  /** Left and right participants; an entrant may be null when a slot is still TBD. */
  players: [MatchPlayer, MatchPlayer];
  roundText: string;
  phaseName: string;
  groupIdentifier: string;
}

export interface MatchPlayer {
  entrant: Entrant | null;
  /** Tag used for profile lookup: the entrant's tag, or the typed tag in "tags" mode. */
  tag: string;
  score: number | null;
}

function playersOf(bracket: StartggBracket, set: BracketSet): [MatchPlayer, MatchPlayer] {
  const slot = (i: number): MatchPlayer => {
    const s = set.slots[i];
    const entrant = s?.entrantId != null ? (bracket.entrants[s.entrantId] ?? null) : null;
    return { entrant, tag: entrant?.tag ?? "", score: s?.score ?? null };
  };
  return [slot(0), slot(1)];
}

function describe(bracket: StartggBracket, set: BracketSet) {
  const group = bracket.groups[set.groupId];
  const phase = bracket.phases.find((p) => p.id === set.phaseId);
  return { roundText: set.roundText, phaseName: phase?.name ?? "", groupIdentifier: group?.identifier ?? "" };
}

export function resolveCurrentMatch(bracket: StartggBracket | null, sel: CurrentMatchSelection | null | undefined): CurrentMatch {
  const selection = sel ?? DEFAULT_SELECTION;
  const none: CurrentMatch = {
    source: "none",
    set: null,
    players: [
      { entrant: null, tag: "", score: null },
      { entrant: null, tag: "", score: null },
    ],
    roundText: "",
    phaseName: "",
    groupIdentifier: "",
  };
  if (selection.mode === "tags") {
    return {
      ...none,
      source: "tags",
      players: [
        { entrant: null, tag: selection.tags[0].trim(), score: null },
        { entrant: null, tag: selection.tags[1].trim(), score: null },
      ],
    };
  }
  if (!bracket) return none;
  let set: BracketSet | null = null;
  let source: CurrentMatch["source"] = "none";
  if (selection.mode === "set") {
    set = selection.setId != null ? (bracket.sets[selection.setId] ?? null) : null;
    source = set ? "set" : "none";
  } else {
    const queued = bracket.streamQueue.flatMap((q) => q.setIds).map((id) => bracket.sets[id]).find(Boolean) ?? null;
    if (queued) {
      set = queued;
      source = "queue";
    } else {
      set = liveSets(bracket)[0] ?? null;
      source = set ? "live" : "none";
    }
  }
  if (!set) return none;
  return { source, set, players: playersOf(bracket, set), ...describe(bracket, set) };
}
