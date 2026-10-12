// Ban & Pick rules for DAY 2 matches (rulebook 4.4.1).
// Pure module: no NodeCG imports so it can be unit-tested and shared by the
// extension, dashboard, and graphics.

export type Player = "A" | "B";
export type ActionKind = "ban" | "pick";
export type Game = 1 | 2 | 3;

export interface BanPickOption {
  id: number;
  mode: string;
  map: string;
}

export interface Step {
  player: Player;
  kind: ActionKind;
  /** Which game a pick decides. Only set for picks. */
  game?: 1 | 2;
}

export interface BanPickAction {
  player: Player;
  kind: ActionKind;
  optionId: number;
}

export interface BanPickState {
  /** Operator-controlled stage. Optional only for persisted pre-stage state. */
  game?: Game;
  players: Record<Player, string>;
  options: BanPickOption[];
  /** Ordered history; index i corresponds to STEPS[i]. */
  actions: BanPickAction[];
}

/** Step order from the rulebook. The single option left over is Game 3. */
export const STEPS: readonly Step[] = [
  { player: "A", kind: "ban" },
  { player: "B", kind: "ban" },
  { player: "A", kind: "pick", game: 1 },
  { player: "B", kind: "pick", game: 2 },
  { player: "B", kind: "ban" },
  { player: "A", kind: "ban" },
  { player: "A", kind: "ban" },
  { player: "B", kind: "ban" },
];

export const MODE_MOVE = "Move (Pinpointing Duels)";
export const MODE_NM = "NM";
export const MODE_NMPZ = "NMPZ";

export const DEFAULT_OPTIONS: readonly BanPickOption[] = [
  { id: 1, mode: MODE_MOVE, map: "A 5kable World" },
  { id: 2, mode: MODE_MOVE, map: "A Moving World" },
  { id: 3, mode: MODE_MOVE, map: "An Arbitrary Rural Intersectionguessr" },
  { id: 4, mode: MODE_NM, map: "An Official World" },
  { id: 5, mode: MODE_NM, map: "A Pro World" },
  { id: 6, mode: MODE_NM, map: "GeoGuessr Saturday" },
  { id: 7, mode: MODE_NMPZ, map: "An Arbitrary Rural World" },
  { id: 8, mode: MODE_NMPZ, map: "A Rainbolt World" },
  { id: 9, mode: MODE_NMPZ, map: "A Rural World" },
];

export function createInitialState(): BanPickState {
  return {
    game: 1,
    players: { A: "Player A", B: "Player B" },
    options: DEFAULT_OPTIONS.map((o) => ({ ...o })),
    actions: [],
  };
}

const GAME_START = { 1: 0, 2: 3, 3: 4 } as const;
const GAME_END = { 1: 3, 2: 4, 3: 8 } as const;

/** Old saved state stays on the game most recently selected, including pauses. */
export function currentGame(state: BanPickState): Game {
  const count = state.actions.length;
  const minimum = count <= 3 ? 1 : count === 4 ? 2 : 3;
  const maximum = count < 3 ? 1 : count === 3 ? 2 : 3;
  const requested = state.game === 1 || state.game === 2 || state.game === 3 ? state.game : minimum;
  return Math.max(minimum, Math.min(maximum, requested)) as Game;
}

export function isGameReady(state: BanPickState): boolean {
  return state.actions.length >= GAME_END[currentGame(state)];
}

/** Null while the selected game is being played, and after Game 3 is decided. */
export function currentStep(state: BanPickState): Step | null {
  if (isGameReady(state)) return null;
  return STEPS[state.actions.length] ?? null;
}

export function isComplete(state: BanPickState): boolean {
  return state.actions.length >= STEPS.length;
}

export class BanPickError extends Error {}

export function nextGame(state: BanPickState): BanPickState {
  const game = currentGame(state);
  if (!isGameReady(state)) throw new BanPickError("Finish this game's Ban & Pick first");
  if (game === 3) throw new BanPickError("There is no next game");
  return { ...state, game: (game + 1) as Game };
}

/**
 * Apply the next step to `optionId`. Returns a new state; throws
 * BanPickError when the move is not allowed. `player`, when given, must be
 * the player whose turn it is (used by tablets locked to one player).
 */
export function applyAction(
  state: BanPickState,
  optionId: number,
  player?: Player,
): BanPickState {
  const step = currentStep(state);
  if (!step) throw new BanPickError(isComplete(state)
    ? "Ban & Pick is already complete"
    : "Waiting for the operator to press Next game");
  if (player && player !== step.player) {
    throw new BanPickError(`It is Player ${step.player}'s turn`);
  }
  if (!state.options.some((o) => o.id === optionId)) {
    throw new BanPickError(`Unknown option ${optionId}`);
  }
  if (state.actions.some((a) => a.optionId === optionId)) {
    throw new BanPickError(`Option ${optionId} was already banned or picked`);
  }
  return {
    ...state,
    game: currentGame(state),
    actions: [...state.actions, { player: step.player, kind: step.kind, optionId }],
  };
}

export function undo(state: BanPickState): BanPickState {
  const game = currentGame(state);
  // Advancing is reversible without losing the preceding game's pick.
  if (game > 1 && state.actions.length === GAME_START[game]) {
    return { ...state, game: (game - 1) as Game };
  }
  return { ...state, game, actions: state.actions.slice(0, -1) };
}

export function reset(state: BanPickState): BanPickState {
  return { ...state, game: 1, actions: [] };
}

export type OptionStatus = "open" | "banned" | "picked" | "remaining";

export interface OptionView {
  option: BanPickOption;
  status: OptionStatus;
  /** Who banned/picked it. Undefined for open and remaining options. */
  by?: Player;
  /** 1-based step at which it was banned/picked. */
  stepIndex?: number;
  /** Game number for picked (1, 2) and remaining (3) options. */
  game?: 1 | 2 | 3;
}

export interface BoardView {
  game: Game;
  ready: boolean;
  options: OptionView[];
  step: Step | null;
  /** 0-based index of the pending step; equals STEPS.length when complete. */
  stepIndex: number;
  complete: boolean;
  /** Games 1..3 as [game1, game2, game3]; null until decided. */
  games: [OptionView | null, OptionView | null, OptionView | null];
}

export function deriveView(state: BanPickState): BoardView {
  const byOption = new Map<number, { action: BanPickAction; stepIndex: number }>();
  state.actions.forEach((action, i) => byOption.set(action.optionId, { action, stepIndex: i + 1 }));

  const complete = isComplete(state);
  const untouched = state.options.filter((o) => !byOption.has(o.id));
  const remainingId = complete && untouched.length === 1 ? untouched[0]!.id : undefined;

  const options: OptionView[] = state.options.map((option) => {
    const hit = byOption.get(option.id);
    if (hit) {
      const step = STEPS[hit.stepIndex - 1]!;
      return {
        option,
        status: hit.action.kind === "pick" ? "picked" : "banned",
        by: hit.action.player,
        stepIndex: hit.stepIndex,
        ...(step.game ? { game: step.game } : {}),
      };
    }
    if (option.id === remainingId) return { option, status: "remaining", game: 3 };
    return { option, status: "open" };
  });

  const gameOf = (n: 1 | 2 | 3) => options.find((v) => v.game === n) ?? null;
  return {
    game: currentGame(state),
    ready: isGameReady(state),
    options,
    step: currentStep(state),
    stepIndex: state.actions.length,
    complete,
    games: [gameOf(1), gameOf(2), gameOf(3)],
  };
}

/** Broadcast history for this game only, with the newest selection at the top. */
export function deriveStack(state: BanPickState) {
  const view = deriveView(state);
  const entries = view.options.filter((entry) =>
    (entry.status === "remaining" && view.game === 3) ||
    (entry.stepIndex !== undefined && entry.stepIndex > GAME_START[view.game] &&
      entry.stepIndex <= GAME_END[view.game]),
  ).sort((a, b) => (b.stepIndex ?? 9) - (a.stepIndex ?? 9));
  return { game: view.game, ready: view.ready, step: view.step, entries };
}
