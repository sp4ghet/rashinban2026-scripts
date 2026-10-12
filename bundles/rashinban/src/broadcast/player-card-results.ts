import type { ResolvedSide } from "../match/state.ts";
import { matchProfile } from "../match/identity.ts";
import type { PlayerProfile } from "../sheet/players.ts";
import type { StartggBracket } from "../startgg/types.ts";

export type PlayerCardResult = {
  id: number;
  round: string;
  opponent: string;
  score: string;
  outcome: "win" | "loss" | "unknown";
};
export type PlayerCardResults = {
  rows: PlayerCardResult[];
  status: "ready" | "unavailable" | "unlinked" | "empty";
};

const timestamp = (seconds: number | null | undefined): number | null =>
  typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;

/** Latest completed games before the selected match, newest first, across all dates. */
export function playerCardResults(
  bracket: StartggBracket | null,
  player: ResolvedSide,
  profiles: PlayerProfile[],
  currentSetId: number | null,
  limit: 3 | 5,
  now = Date.now(),
): PlayerCardResults {
  if (!bracket) return { rows: [], status: "unavailable" };
  let entrantId = player.entrantId ?? player.profile?.startggEntrantId;
  if (entrantId == null && player.profile) {
    // Entrant IDs are optional in the player sheet. Reuse the directory's
    // normalized tag/name rules, but never choose among ambiguous entrants.
    const candidates = Object.values(bracket.entrants).filter(entrant =>
      matchProfile([player.profile!], { entrantId: entrant.id, tag: entrant.tag, name: entrant.name }).status === "matched");
    if (candidates.length === 1) entrantId = candidates[0]!.id;
  }
  if (entrantId == null) return { rows: [], status: "unlinked" };
  const current = currentSetId == null ? undefined : bracket.sets[currentSetId];
  const cutoff = Math.min(now, timestamp(current?.startedAt) ?? timestamp(current?.completedAt) ?? now);
  const rows: PlayerCardResult[] = [];
  const sets = Object.values(bracket.sets).filter(set => {
    const completed = timestamp(set.completedAt);
    return set.id !== currentSetId && set.state === "completed" && completed !== null && completed < cutoff &&
      set.slots.some(slot => slot.entrantId === entrantId) &&
      set.slots.some(slot => slot.entrantId != null && slot.entrantId !== entrantId);
  }).sort((a, b) => b.completedAt! - a.completedAt! || b.id - a.id).slice(0, limit);
  for (const set of sets) {
    const own = set.slots.find(slot => slot.entrantId === entrantId);
    const opponent = set.slots.find(slot => slot.entrantId != null && slot.entrantId !== entrantId);
    if (!own || !opponent) continue; // A bye is not a played match.
    const entrant = bracket.entrants[opponent.entrantId!];
    const profile = matchProfile(profiles, { entrantId: opponent.entrantId, tag: entrant?.tag, name: entrant?.name }).profile;
    const scoreValue = (value: number | null) => typeof value === "number" && Number.isInteger(value) && value >= 0;
    let score = "—";
    if (own.score === -1 && set.winnerEntrantId === opponent.entrantId) score = "DQ–W";
    else if (opponent.score === -1 && set.winnerEntrantId === entrantId) score = "W–DQ";
    else if (scoreValue(own.score) && scoreValue(opponent.score)) score = `${own.score}–${opponent.score}`;
    rows.push({
      id: set.id,
      round: set.roundText || "Match",
      opponent: profile?.name || entrant?.tag || entrant?.name || "Unknown opponent",
      score,
      outcome: set.winnerEntrantId === entrantId ? "win" : set.winnerEntrantId === opponent.entrantId ? "loss" : "unknown",
    });
  }
  return { rows, status: rows.length ? "ready" : "empty" };
}
