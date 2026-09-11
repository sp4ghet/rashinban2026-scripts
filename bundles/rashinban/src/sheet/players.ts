// Player profiles authored in the Google Sheet "players" tab, joined to
// start.gg entrants by gamer tag. Column names are the sheet's header row
// (case-insensitive). See docs/sheet/README.md for the column list.

import type { Entrant } from "../startgg/types";
import { geoUid } from '../match/identity.ts';

export interface ModeStats {
  all: string;
  move: string;
  nm: string;
  nmpz: string;
}

export interface PlayerProfile {
  geoguessrPlayerUid: string | null;
  /** Join key: the start.gg gamer tag, compared case- and space-insensitively. */
  startggTag: string;
  /** Optional numeric start.gg entrant id for an exact match. */
  startggEntrantId: number | null;
  /** Display name on the card; falls back to startggTag. */
  name: string;
  twitter: string;
  age: string;
  rating: string;
  favoriteMode: string;
  strengths: string;
  favoriteFood: string;
  message: string;
  winRate: ModeStats;
  played: ModeStats;
  placement: ModeStats;
  roundsPlayed: string;
  /** ISO 3166-1 alpha-2 codes, lower-case, or empty. */
  bestCountry: string;
  worstCountry: string;
  /** Any other columns, for future card fields. */
  extra: Record<string, string>;
}

/** Sheet column -> profile field. Keys are lower-case header names. */
export const PLAYER_COLUMNS = {
  geoguessr_player_uid: "geoguessrPlayerUid",
  startgg_tag: "startggTag",
  startgg_entrant_id: "startggEntrantId",
  name: "name",
  twitter: "twitter",
  age: "age",
  rating: "rating",
  favorite_mode: "favoriteMode",
  strengths: "strengths",
  favorite_food: "favoriteFood",
  message: "message",
  winrate_all: "winRate.all",
  winrate_move: "winRate.move",
  winrate_nm: "winRate.nm",
  winrate_nmpz: "winRate.nmpz",
  played_all: "played.all",
  played_move: "played.move",
  played_nm: "played.nm",
  played_nmpz: "played.nmpz",
  placement_all: "placement.all",
  placement_move: "placement.move",
  placement_nm: "placement.nm",
  placement_nmpz: "placement.nmpz",
  rounds_played: "roundsPlayed",
  best_country: "bestCountry",
  worst_country: "worstCountry",
} as const;

export const REQUIRED_COLUMNS = ["startgg_tag"] as const;

export function normalizeTag(tag: string | null | undefined): string {
  return (tag ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

const emptyStats = (): ModeStats => ({ all: "", move: "", nm: "", nmpz: "" });

export function rowToProfile(row: Record<string, string>): PlayerProfile {
  const p: PlayerProfile = {
    geoguessrPlayerUid: null,
    startggTag: "",
    startggEntrantId: null,
    name: "",
    twitter: "",
    age: "",
    rating: "",
    favoriteMode: "",
    strengths: "",
    favoriteFood: "",
    message: "",
    winRate: emptyStats(),
    played: emptyStats(),
    placement: emptyStats(),
    roundsPlayed: "",
    bestCountry: "",
    worstCountry: "",
    extra: {},
  };
  for (const [col, value] of Object.entries(row)) {
    const target = (PLAYER_COLUMNS as Record<string, string | undefined>)[col];
    if (!target) {
      if (value) p.extra[col] = value;
      continue;
    }
    if (target === 'geoguessrPlayerUid') {
      try { p.geoguessrPlayerUid = geoUid(value); } catch { p.extra.invalid_geoguessr_player_uid = value; }
    } else if (target === "startggEntrantId") {
      const n = Number(value);
      p.startggEntrantId = value && Number.isInteger(n) ? n : null;
    } else if (target === "bestCountry" || target === "worstCountry") {
      p[target] = value.trim().toLowerCase();
    } else if (target.includes(".")) {
      const [group, key] = target.split(".") as ["winRate" | "played" | "placement", keyof ModeStats];
      p[group][key] = value;
    } else {
      (p as unknown as Record<string, string>)[target] = value;
    }
  }
  if (!p.name) p.name = p.startggTag;
  p.twitter = p.twitter.replace(/^@/, "");
  return p;
}

export interface ParsedPlayers {
  players: PlayerProfile[];
  /** Required columns absent from the header row. */
  missingColumns: string[];
  /** Rows skipped because they had no join key. */
  skippedRows: number;
}

export function parsePlayers(rows: Record<string, string>[]): ParsedPlayers {
  const header = new Set(Object.keys(rows[0] ?? {}));
  const missingColumns = header.has('geoguessr_player_uid') ? [] : rows.length ? REQUIRED_COLUMNS.filter((c) => !header.has(c)) : [...REQUIRED_COLUMNS];
  const players: PlayerProfile[] = [];
  let skippedRows = 0;
  for (const row of rows) {
    const p = rowToProfile(row);
    if (!p.startggTag && !p.geoguessrPlayerUid) {
      skippedRows++;
      continue;
    }
    players.push(p);
  }
  return { players, missingColumns, skippedRows };
}

/** Finds the profile for a start.gg entrant: by entrant id, then by tag, then by full name. */
export function findProfile(players: PlayerProfile[], entrant: Pick<Entrant, "id" | "tag" | "name"> | null | undefined): PlayerProfile | null {
  if (!entrant) return null;
  const byId = players.find((p) => p.startggEntrantId !== null && p.startggEntrantId === entrant.id);
  if (byId) return byId;
  const tag = normalizeTag(entrant.tag);
  const name = normalizeTag(entrant.name);
  return players.find((p) => normalizeTag(p.startggTag) === tag) ?? players.find((p) => normalizeTag(p.startggTag) === name) ?? null;
}
