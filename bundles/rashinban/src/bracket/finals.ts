// DAY2 top-8 bracket data: turns the start.gg bracket — live, or a recorded
// phase-group sample from docs/startgg/samples — into the 11 match slots drawn
// by graphics/brackets-finals.html.
//
// Match numbers follow the rashinban2026 finals layout:
//   1, 2 Winners Semifinal (A, B)   3 Winners Final (C)
//   4, 5 Losers R1 (F, G)           6, 7 Losers Quarterfinal (H, I)   8 Losers Semifinal (J)   9 Losers Final (K)
//   10 Grand Final (D)              11 Reset (hidden until it has players)
// Top/bottom within a match is start.gg's slot order.
import { normalizeEvent } from "../startgg/normalize.ts";
import type { BracketSet, BracketSlot, RawPhaseGroup, StartggBracket } from "../startgg/types.ts";

/** Live start.gg data, or a recorded phase-group sample (for testing). */
export type BracketSource = "startgg" | "sample";

export interface BracketRow {
  match: number;
  top: string;
  bottom: string;
  /** Both empty unless both sides have a score. */
  topScore: string;
  bottomScore: string;
  winner: "top" | "bottom" | null;
  /** Drawn with the red "on now" border. */
  active: boolean;
}

export interface BracketConfig {
  source: BracketSource;
  /** Live start.gg phase group; null picks the last phase's group (DAY2). */
  groupId: number | null;
  /** Recorded `npm run startgg:fetch -- phase-group ...` output, relative to the NodeCG working directory. */
  samplePath: string;
}

export interface BracketFinals {
  source: BracketSource;
  groupId: number | null;
  rows: BracketRow[];
  updatedAt: number | null;
  error: string | null;
}

export const FINALS_MATCH_COUNT = 11;

export const DEFAULT_BRACKET_CONFIG: BracketConfig = {
  source: "startgg",
  groupId: null,
  samplePath: "docs/startgg/samples/evo-japan-2026-sf6-finals-top8.json",
};

/** Fills gaps in a stored config (e.g. one saved by an older version). */
export function withDefaults(value: Partial<BracketConfig> | undefined): BracketConfig {
  const cfg = { ...DEFAULT_BRACKET_CONFIG, ...value };
  if (cfg.source !== "startgg" && cfg.source !== "sample") cfg.source = DEFAULT_BRACKET_CONFIG.source;
  if (typeof cfg.samplePath !== "string" || !cfg.samplePath.trim()) cfg.samplePath = DEFAULT_BRACKET_CONFIG.samplePath;
  return { source: cfg.source, groupId: cfg.groupId ?? null, samplePath: cfg.samplePath };
}

export const emptyRow = (match: number): BracketRow => ({
  match,
  top: "",
  bottom: "",
  topScore: "",
  bottomScore: "",
  winner: null,
  active: false,
});

const emptyRows = () => Array.from({ length: FINALS_MATCH_COUNT }, (_, i) => emptyRow(i + 1));

/** The DAY2 group: the first group of the last phase that has any. */
export function finalsGroupId(bracket: StartggBracket): number | null {
  const phases = bracket.phases.filter((p) => p.groupIds.length > 0).sort((a, b) => a.order - b.order);
  return phases.at(-1)?.groupIds[0] ?? null;
}

const byIdentifier = (a: BracketSet, b: BracketSet) => a.identifier.localeCompare(b.identifier) || a.id - b.id;

const feeds = (set: BracketSet | undefined, from: BracketSet | undefined) =>
  Boolean(set && from && set.slots.some((s) => s.prereq?.type === "set" && s.prereq.id === String(from.id)));

export function fromStartgg(bracket: StartggBracket, groupId: number): BracketRow[] {
  const group = bracket.groups[groupId];
  if (!group) throw new Error(`start.gg phase group ${groupId} is not in the fetched event`);
  const sets = group.setIds.map((id) => bracket.sets[id]).filter((s): s is BracketSet => Boolean(s));
  if (sets.length === 0) return emptyRows(); // not seeded yet

  const winners = sets.filter((s) => s.side === "winners").sort((a, b) => a.round - b.round || byIdentifier(a, b));
  const grand = sets.filter((s) => s.side === "grand").sort((a, b) => a.round - b.round || byIdentifier(a, b));
  // Losers rounds are negative and run -3 (R1) down to -6 (final).
  const losers = sets.filter((s) => s.side === "losers").sort((a, b) => b.round - a.round || byIdentifier(a, b));
  if (winners.length !== 3 || losers.length !== 6 || grand.length > 2) {
    throw new Error(
      `phase group ${groupId} is not a top 8 (${winners.length} winners, ${losers.length} losers, ${grand.length} grand final sets)`,
    );
  }

  // Keep each losers quarterfinal on the same line as the R1 set feeding it.
  let quarters = [losers[2], losers[3]];
  if (feeds(quarters[1], losers[0]) && !feeds(quarters[0], losers[0])) quarters = [quarters[1], quarters[0]];

  const slots: (BracketSet | undefined)[] = [
    winners[0], winners[1], winners[2],
    losers[0], losers[1], quarters[0], quarters[1], losers[4], losers[5],
    grand[0], grand[1],
  ];
  return slots.map((set, i) => (set ? setRow(i + 1, set, bracket) : emptyRow(i + 1)));
}

/** A recorded phase-group response ({ data: { phaseGroup } }), mapped exactly like live data. */
export function fromPhaseGroupSample(json: unknown): { groupId: number; rows: BracketRow[] } {
  const group = (json as { data?: { phaseGroup?: RawPhaseGroup | null } } | null)?.data?.phaseGroup;
  if (!group || typeof group.id !== "number") {
    throw new Error("Not a start.gg phase group sample (expected data.phaseGroup; record one with npm run startgg:fetch)");
  }
  return { groupId: group.id, rows: fromStartgg(normalizeEvent(null, [group], null, 0), group.id) };
}

function setRow(match: number, set: BracketSet, bracket: StartggBracket): BracketRow {
  const [a, b] = set.slots;
  const name = (slot: BracketSlot | undefined) => {
    if (slot?.entrantId == null) return "";
    return bracket.entrants[slot.entrantId]?.tag ?? `#${slot.entrantId}`;
  };
  const score = (slot: BracketSlot | undefined) =>
    slot?.score == null ? "" : slot.score < 0 ? "DQ" : String(slot.score);
  let topScore = score(a);
  let bottomScore = score(b);
  if (topScore === "" || bottomScore === "") topScore = bottomScore = "";
  const winnerId = set.winnerEntrantId;
  return {
    match,
    top: name(a),
    bottom: name(b),
    topScore,
    bottomScore,
    winner: winnerId == null ? null : a?.entrantId === winnerId ? "top" : b?.entrantId === winnerId ? "bottom" : null,
    active: set.state === "active",
  };
}
