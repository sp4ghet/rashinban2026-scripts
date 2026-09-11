import type { PlayerProfile } from "../sheet/players.ts";
import type { StartggBracket } from "../startgg/types.ts";
import type { DuelState, SeriesState } from "../types/presenter.ts";
import { geoUid, matchProfile } from "./identity.ts";

export type MatchSide = {
  id: string;
  uid: string | null;
  entrantId: number | null;
  tag: string;
  name: string;
  nameOverride: string;
  handleOverride: string | null;
  wins: number;
};
export type MatchState = {
  schemaVersion: 1;
  revision: number;
  id: string;
  label: string;
  source: "manual" | "startgg";
  setId: number | null;
  gameMapping: { left: string; right: string };
  left: MatchSide;
  right: MatchSide;
};
export type ResolvedSide = MatchSide & {
  handle: string;
  profile: PlayerProfile | null;
  profileStatus: "matched" | "missing" | "ambiguous";
};
export type ResolvedMatch = Omit<MatchState, "left" | "right"> & {
  left: ResolvedSide;
  right: ResolvedSide;
};
export function emptyMatch(): MatchState {
  const side = (id: string): MatchSide => ({
    id,
    uid: null,
    entrantId: null,
    tag: "",
    name: "",
    nameOverride: "",
    handleOverride: null,
    wins: 0,
  });
  return {
    schemaVersion: 1,
    revision: 0,
    id: "current",
    label: "",
    source: "manual",
    setId: null,
    gameMapping: { left: "blue", right: "red" },
    left: side("left"),
    right: side("right"),
  };
}
export function parseMatch(input: unknown): MatchState {
  if (!input || typeof input !== "object") throw new Error("Expected a match");
  const value = input as MatchState;
  const str = (s: unknown, max = 160) => {
    if (typeof s !== "string" || s.length > max)
      throw new Error("Invalid match text");
    return s.trim();
  };
  const side = (s: MatchSide): MatchSide => {
    if (!s || !Number.isInteger(s.wins) || s.wins < 0 || s.wins > 2)
      throw new Error("Wins must be 0, 1 or 2");
    if (
      s.entrantId !== null &&
      (!Number.isInteger(s.entrantId) || s.entrantId <= 0)
    )
      throw new Error("Invalid entrant ID");
    return {
      id: str(s.id),
      uid: geoUid(s.uid ?? ""),
      entrantId: s.entrantId,
      tag: str(s.tag),
      name: str(s.name),
      nameOverride: str(s.nameOverride),
      handleOverride: s.handleOverride === null ? null : str(s.handleOverride),
      wins: s.wins,
    };
  };
  const left = side(value.left),
    right = side(value.right);
  if (
    left.id === right.id ||
    (left.uid && left.uid === right.uid) ||
    (left.entrantId && left.entrantId === right.entrantId)
  )
    throw new Error("Select two different players");
  if (value.source !== "manual" && value.source !== "startgg")
    throw new Error("Invalid match source");
  const account = (v: unknown, fallback: string) => {
    if (v === undefined) return fallback;
    if (v === "blue" || v === "red") return v;
    if (typeof v !== "string" || !v.trim())
      throw new Error("Choose a team or detected game account");
    return geoUid(v)!;
  };
  const gameMapping = {
    left: account(value.gameMapping?.left, "blue"),
    right: account(value.gameMapping?.right, "red"),
  };
  if (gameMapping.left === gameMapping.right)
    throw new Error("Choose different game accounts for each side");
  return {
    schemaVersion: 1,
    revision: Number.isSafeInteger(value.revision) ? value.revision : 0,
    id: str(value.id),
    label: str(value.label),
    source: value.source,
    setId: Number.isInteger(value.setId) ? value.setId : null,
    gameMapping,
    left,
    right,
  };
}
export function resolveMatch(
  match: MatchState,
  profiles: PlayerProfile[],
): ResolvedMatch {
  const side = (s: MatchSide): ResolvedSide => {
    const result = matchProfile(profiles, {
      uid: s.uid,
      entrantId: s.entrantId,
      tag: s.tag,
      name: s.name,
    });
    return {
      ...s,
      uid: s.uid || result.profile?.geoguessrPlayerUid || null,
      name: s.nameOverride || result.profile?.name || s.name || s.tag || "TBD",
      handle: s.handleOverride ?? result.profile?.twitter ?? "",
      profile: result.profile,
      profileStatus: result.status,
    };
  };
  return { ...match, left: side(match.left), right: side(match.right) };
}
export function importSet(
  bracket: StartggBracket,
  setId: number,
  profiles: PlayerProfile[],
): MatchState {
  const set = bracket.sets[setId];
  if (!set) throw new Error("Set no longer available; refresh start.gg");
  const match = emptyMatch();
  match.id = `startgg:${set.id}`;
  match.source = "startgg";
  match.setId = set.id;
  const phase = bracket.phases.find((p) => p.id === set.phaseId);
  match.label = [phase?.name, set.roundText].filter(Boolean).join(" / ");
  for (const [index, side] of ["left", "right"].entries()) {
    const slot = set.slots[index],
      entrant =
        slot?.entrantId == null ? null : bracket.entrants[slot.entrantId];
    if (!entrant)
      throw new Error("Both entrants must be known before loading a match");
    const p = matchProfile(profiles, {
      entrantId: entrant.id,
      tag: entrant.tag,
      name: entrant.name,
    });
    if (p.status === "ambiguous")
      throw new Error(`Ambiguous spreadsheet profile for ${entrant.tag}`);
    match[side as "left" | "right"] = {
      id: `startgg:${entrant.id}`,
      uid: p.profile?.geoguessrPlayerUid ?? null,
      entrantId: entrant.id,
      tag: entrant.tag,
      name: entrant.tag || entrant.name,
      nameOverride: "",
      handleOverride: null,
      wins:
        slot.score != null &&
        slot.score >= 0 &&
        slot.score <= 2 &&
        Number.isInteger(slot.score)
          ? slot.score
          : 0,
    };
  }
  return parseMatch(match);
}
export function swapMatch(match: MatchState): MatchState {
  const mapping = match.gameMapping ?? { left: "blue", right: "red" };
  return {
    ...match,
    left: { ...match.right },
    right: { ...match.left },
    gameMapping: { left: mapping.right, right: mapping.left },
  };
}
export function toSeries(
  match: ResolvedMatch,
  duel: Pick<DuelState, "players"> | null = null,
): SeriesState {
  const mapping = match.gameMapping ?? { left: "blue", right: "red" };
  const find = (selection: string) => {
    const players = (duel?.players ?? []).filter((p) =>
      selection === "blue" || selection === "red"
        ? p.teamColor === selection
        : p.id === selection,
    );
    return players.length === 1 ? players[0].id : null;
  };
  let left = find(mapping.left),
    right = find(mapping.right);
  if (left && left === right) left = right = null;
  const side = (s: ResolvedSide) => ({
    id: s.id,
    playerId: null as string | null,
    name: s.name,
    handle: s.handle,
    wins: s.wins,
  });
  return {
    id: match.id,
    source: "manual",
    left: { ...side(match.left), playerId: left },
    right: { ...side(match.right), playerId: right },
  };
}
