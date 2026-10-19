import { resolveMatch, type MatchState } from "../match/state.ts";
import type { PlayerProfile } from "../sheet/players.ts";

export type UpcomingMatch = { playerOne: string; playerTwo: string };
export type IntervalContent = { title: string; upcomingLabel: string; matchSource: "manual" | "next"; matches: UpcomingMatch[] };
export type IntervalTimer = { endsAtMs: number | null; remainingMs: number | null };
export type IntervalState = { content: IntervalContent; timer: IntervalTimer };

export const INTERVAL_MESSAGES = { content: "interval:content", timer: "interval:timer", clock: "interval:clock" } as const;
const DAY_MS = 86_400_000;
const MAX_DATE_MS = 8_640_000_000_000_000;

export function defaultInterval(): IntervalState {
  return {
    content: { title: "INTERVAL", upcomingLabel: "COMING UP", matchSource: "next", matches: [] },
    timer: { endsAtMs: null, remainingMs: null },
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid interval data.");
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number, name: string, required = false): string {
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) {
    throw new Error(`${name}: ${required ? "enter " : "use up to "}${max} characters or fewer.`);
  }
  return value.trim();
}

export function updateContent(state: IntervalState, value: unknown): IntervalState {
  const data = record(value);
  if (!Array.isArray(data.matches) || data.matches.length > 4) throw new Error("Enter up to four upcoming matches.");
  // Saved content from before Next Match support stays on the manual list.
  const matchSource = data.matchSource ?? "manual";
  if (matchSource !== "manual" && matchSource !== "next") throw new Error("Choose an upcoming match source.");
  const content: IntervalContent = {
    title: text(data.title, 40, "Title", true),
    upcomingLabel: text(data.upcomingLabel, 40, "Upcoming heading", true),
    matchSource,
    matches: data.matches.map(value => {
      const match = record(value);
      return { playerOne: text(match.playerOne, 60, "Player 1", true),
        playerTwo: text(match.playerTwo, 60, "Player 2", true) };
    }),
  };
  return { ...state, content };
}

/** Derive names from the saved staging slot; never copy them into manual content. */
export function upcomingMatches(content: IntervalContent, next: MatchState | null, profiles: PlayerProfile[]): UpcomingMatch[] {
  if (content.matchSource === "manual") return content.matches;
  if (!next || ![next.left, next.right].every(side => side.uid || side.entrantId || side.name || side.tag)) return [];
  const resolved = resolveMatch(next, profiles);
  return [{ playerOne: resolved.left.name, playerTwo: resolved.right.name }];
}

const validNumber = (value: unknown, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;

/** Repair persisted state without restarting or rolling an expired countdown to tomorrow. */
export function restoreInterval(value: unknown): IntervalState {
  let state = defaultInterval();
  if (!value || typeof value !== "object") return state;
  const saved = value as Partial<IntervalState>;
  try { state = updateContent(state, saved.content); } catch { /* invalid saved content uses safe defaults */ }
  if (saved.timer && validNumber(saved.timer.endsAtMs, MAX_DATE_MS)) {
    state.timer = { endsAtMs: saved.timer.endsAtMs, remainingMs: null };
  } else if (saved.timer && validNumber(saved.timer.remainingMs, MAX_DATE_MS)) {
    state.timer = { endsAtMs: null, remainingMs: saved.timer.remainingMs };
  }
  return state;
}

export function remainingMs(timer: IntervalTimer, now: number): number | null {
  return timer.endsAtMs !== null ? Math.max(0, timer.endsAtMs - now) : timer.remainingMs;
}

export function countdownText(timer: IntervalTimer, now: number): string {
  const remaining = remainingMs(timer, now);
  if (remaining === null) return "";
  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  const hh = Math.floor(seconds / 3600), mm = Math.floor(seconds / 60) % 60, ss = seconds % 60;
  return `${hh ? `${hh}:` : ""}${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function timerCommand(state: IntervalState, value: unknown, now: number): IntervalState {
  const command = record(value);
  let timer = { ...state.timer };
  switch (command.action) {
    case "start":
      if (!validNumber(command.durationSeconds, DAY_MS / 1000) || command.durationSeconds <= 0) {
        throw new Error("Duration must be greater than zero and at most 24 hours.");
      }
      timer = { endsAtMs: now + command.durationSeconds * 1000, remainingMs: null };
      break;
    case "startAtTime":
      timer = { endsAtMs: nextJstTime(command.time, now), remainingMs: null };
      break;
    case "startAt":
      if (!validNumber(command.endsAtMs, MAX_DATE_MS) || command.endsAtMs <= now) throw new Error("Choose a future restart time (JST).");
      timer = { endsAtMs: command.endsAtMs, remainingMs: null };
      break;
    case "pause":
      if (timer.endsAtMs !== null) timer = { endsAtMs: null, remainingMs: remainingMs(timer, now) };
      break;
    case "resume":
      if (timer.remainingMs !== null) timer = { endsAtMs: now + timer.remainingMs, remainingMs: null };
      break;
    case "clear": timer = { endsAtMs: null, remainingMs: null }; break;
    default: throw new Error("Unknown countdown action.");
  }
  return { ...state, timer };
}

/** Resolve HH:mm against the server's JST day, rolling past times to tomorrow. */
export function nextJstTime(value: unknown, now: number): number {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error("Choose a restart time (JST).");
  }
  const day = new Date(now + 9 * 3600000).toISOString().slice(0, 10);
  const deadline = Date.parse(`${day}T${value}:00+09:00`);
  return deadline > now ? deadline : deadline + DAY_MS;
}
