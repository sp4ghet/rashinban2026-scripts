// Shared replicant names and value types.
// Every context (extension, dashboard, graphics) should reference these
// instead of retyping names/shapes.
import type { DuelState, SeriesState, Timeline, Views } from './presenter.ts';
import type { PresenterSettings } from '../presenter/settings.ts';
import type { RuleContexts } from '../presenter/tie-range-context.ts';
import type { ConnectionStatus } from '../extension/presenter/connection.ts';
import type { ClientReady, Lease } from '../presenter/clock.ts';
import type { MediaManifest, AudioStatus } from '../presenter/media.ts';
import type { ConfigStatus, PresenterPublicConfig } from '../config/types.ts';
export type PresenterMediaStatus = { generation: string | null; effect: string; status: 'idle' | 'pending' | 'missing' | 'complete' | 'failed' | 'watchdog' };

export type PresenterConnection = ConnectionStatus & {
  input: 'live' | 'replay'; replayFixture: string | null; warnings: string[];
  configuredPartyId?: string | null; selectedPartyId?: string | null;
};
export const RENDERER_STATUSES = ['unreported', 'loading', 'api-ready', 'missing-key', 'api-error', 'view-error', 'pano-error'] as const;
export type RendererStatus = typeof RENDERER_STATUSES[number];
export type PresenterRenderer = { status: RendererStatus; updatedAtMs: number | null };
export type AudioLease = Lease & { mode: PresenterSettings['audioOutput']; token: number; releasing: boolean };
export type PresenterClient = ClientReady & { lastSeenMs: number; renderer: PresenterRenderer; audio?: AudioStatus; clockFresh?: boolean };
export type PresenterClients = { clients: PresenterClient[]; program: Lease | null; audio?: AudioLease | null };

import type { BanPickState } from "../banpick/rules";
import type { StartggBracket, StartggConfig, StartggStatus } from "../startgg/types";
import type { PlayerProfile } from "../sheet/players";
import type { PlayerCardsState, SheetConfig, SheetStatus } from "../sheet/types";
import type { CurrentMatchSelection } from "../match/current";
import type { MatchState, ResolvedMatch } from '../match/state.ts';

export const REPLICANTS = {
  banPick: "banPick",
  startggConfig: "startggConfig",
  startggBracket: "startggBracket",
  startggStatus: "startggStatus",
  sheetConfig: "sheetConfig",
  sheetStatus: "sheetStatus",
  players: "players",
  currentMatch: "currentMatch",
  matchState: 'matchState',
  matchResolved: 'matchResolved',
  playerCards: "playerCards",
  presenterConnection: 'presenterConnection',
  presenterDuel: 'presenterDuel',
  presenterViews: 'presenterViews',
  presenterSeries: 'presenterSeries',
  presenterSettings: 'presenterSettings',
  presenterRuleContexts: 'presenterRuleContexts',
  presenterTimeline: 'presenterTimeline',
  presenterRenderer: 'presenterRenderer',
  presenterClients: 'presenterClients',
  presenterMedia: 'presenterMedia',
  presenterMediaStatus: 'presenterMediaStatus',
  configurationStatus: 'configurationStatus',
  presenterPublicConfig: 'presenterPublicConfig',
} as const;

export interface ReplicantMap {
  [REPLICANTS.banPick]: BanPickState;
  [REPLICANTS.startggConfig]: StartggConfig;
  [REPLICANTS.startggBracket]: StartggBracket | null;
  [REPLICANTS.startggStatus]: StartggStatus;
  [REPLICANTS.sheetConfig]: SheetConfig;
  [REPLICANTS.sheetStatus]: SheetStatus;
  [REPLICANTS.players]: PlayerProfile[];
  [REPLICANTS.currentMatch]: CurrentMatchSelection;
  [REPLICANTS.matchState]: MatchState;
  [REPLICANTS.matchResolved]: ResolvedMatch;
  [REPLICANTS.playerCards]: PlayerCardsState;
  [REPLICANTS.presenterConnection]: PresenterConnection;
  [REPLICANTS.presenterDuel]: DuelState | null;
  [REPLICANTS.presenterViews]: Views | null;
  [REPLICANTS.presenterSeries]: SeriesState;
  [REPLICANTS.presenterSettings]: PresenterSettings;
  [REPLICANTS.presenterRuleContexts]: RuleContexts;
  [REPLICANTS.presenterTimeline]: Timeline;
  [REPLICANTS.presenterRenderer]: PresenterRenderer;
  [REPLICANTS.presenterClients]: PresenterClients;
  [REPLICANTS.presenterMedia]: MediaManifest;
  [REPLICANTS.presenterMediaStatus]: PresenterMediaStatus;
  [REPLICANTS.configurationStatus]: ConfigStatus;
  [REPLICANTS.presenterPublicConfig]: PresenterPublicConfig;
}

/** Messages the ban-pick extension listens for (nodecg.sendMessage). */
export const BANPICK_MESSAGES = {
  /** { optionId: number; player?: "A" | "B" } — apply the pending step. */
  act: "banpick:act",
  undo: "banpick:undo",
  reset: "banpick:reset",
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

export const CONFIGURATION_MESSAGES = {
  reset: 'configuration:reset',
  importLocal: 'configuration:importLocal',
} as const;

/** Authoritative current match; edits include the last observed revision. */
export const MATCH_MESSAGES = {
  apply: 'match:apply',
  load: 'match:load',
  swap: 'match:swap',
} as const;

/** Player cards presentation. Partial<PlayerCardsState>. */
export const PLAYERCARDS_MESSAGES = {
  set: "playercards:set",
} as const;
