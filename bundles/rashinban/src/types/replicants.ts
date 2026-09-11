// Shared replicant names and value types.
// Every context (extension, dashboard, graphics) should reference these
// instead of retyping names/shapes.

import type { BanPickState } from "../banpick/rules";
import type { StartggBracket, StartggConfig, StartggStatus } from "../startgg/types";
import type { PlayerProfile } from "../sheet/players";
import type { PlayerCardsState, SheetConfig, SheetStatus } from "../sheet/types";
import type { CurrentMatchSelection } from "../match/current";

export const REPLICANTS = {
  lowerThirdVisible: "lowerThirdVisible",
  round: "round",
  banPick: "banPick",
  startggConfig: "startggConfig",
  startggBracket: "startggBracket",
  startggStatus: "startggStatus",
  sheetConfig: "sheetConfig",
  sheetStatus: "sheetStatus",
  players: "players",
  currentMatch: "currentMatch",
  playerCards: "playerCards",
} as const;

export interface ReplicantMap {
  [REPLICANTS.lowerThirdVisible]: boolean;
  [REPLICANTS.round]: number;
  [REPLICANTS.banPick]: BanPickState;
  [REPLICANTS.startggConfig]: StartggConfig;
  [REPLICANTS.startggBracket]: StartggBracket | null;
  [REPLICANTS.startggStatus]: StartggStatus;
  [REPLICANTS.sheetConfig]: SheetConfig;
  [REPLICANTS.sheetStatus]: SheetStatus;
  [REPLICANTS.players]: PlayerProfile[];
  [REPLICANTS.currentMatch]: CurrentMatchSelection;
  [REPLICANTS.playerCards]: PlayerCardsState;
}

/** Messages the ban-pick extension listens for (nodecg.sendMessage). */
export const BANPICK_MESSAGES = {
  /** { optionId: number; player?: "A" | "B" } — apply the pending step. */
  act: "banpick:act",
  undo: "banpick:undo",
  reset: "banpick:reset",
  /** { A?: string; B?: string } */
  setPlayers: "banpick:setPlayers",
  swapPlayers: "banpick:swapPlayers",
  /** { visible: boolean } */
  setVisible: "banpick:setVisible",
} as const;

/** Messages the start.gg poller listens for. */
export const STARTGG_MESSAGES = {
  /** Fetch now; ack carries StartggStatus or an Error. */
  refresh: "startgg:refresh",
  /** Partial<StartggConfig> */
  setConfig: "startgg:setConfig",
} as const;

/** Google Sheet poller messages. */
export const SHEET_MESSAGES = {
  refresh: "sheet:refresh",
  /** Partial<SheetConfig> plus optional sheetUrl (full URL, parsed into id/gid). */
  setConfig: "sheet:setConfig",
} as const;

/** Current-match selection. Partial<CurrentMatchSelection>. */
export const MATCH_MESSAGES = {
  setSelection: "match:setSelection",
} as const;

/** Player cards presentation. Partial<PlayerCardsState>. */
export const PLAYERCARDS_MESSAGES = {
  set: "playercards:set",
} as const;
