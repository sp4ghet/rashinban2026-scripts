// Shared replicant names and value types.
// Every context (extension, dashboard, graphics) should reference these
// instead of retyping names/shapes.
import type { DuelState, SeriesState, Timeline, Views } from './presenter.ts';
import type { PresenterSettings } from '../presenter/settings.ts';
import type { Intermission } from '../presenter/intermission.ts';
import type { RuleContexts } from '../presenter/tie-range-context.ts';
import type { PartyStatus } from '../party/types.ts';
import type { PartyChat } from '../party/chat.ts';
import type { IntervalState } from '../interval/state.ts';
import type { ConnectionStatus } from '../extension/presenter/connection.ts';
import type { ClientReady, Lease } from '../presenter/clock.ts';
import type { MediaManifest, AudioStatus } from '../presenter/media.ts';
import type { ConfigStatus, PresenterPublicConfig } from '../config/types.ts';
export type PresenterMediaStatus = { generation: string | null; effect: string; status: 'idle' | 'pending' | 'missing' | 'complete' | 'failed' | 'watchdog' };

export type PresenterConnection = ConnectionStatus & {
  input: 'live' | 'replay'; replayFixture: string | null; warnings: string[];
  configuredPartyId?: string | null; selectedPartyId?: string | null;
  controlGeneration?: string;
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
import type { SheetConfig, SheetStatus } from "../sheet/types";
import type { BroadcastState } from "../broadcast/state.ts";
import type { CurrentMatchSelection } from "../match/current";
import type { MatchState, ResolvedMatch } from '../match/state.ts';
import type { EffectiveAssetInventory } from '../config/media-url.ts';
import type { BracketConfig, BracketFinals } from "../bracket/finals";
import type { Caster, CastersState } from "../casters/casters";

export const REPLICANTS = {
  banPick: "banPick",
  startggConfig: "startggConfig",
  startggBracket: "startggBracket",
  startggStatus: "startggStatus",
  sheetConfig: "sheetConfig",
  sheetStatus: "sheetStatus",
  players: "players",
  playersEn: "playersEn",
  castersEn: "castersEn",
  casters: "casters",
  castersState: "castersState",
  currentMatch: "currentMatch",
  matchState: 'matchState',
  matchResolved: 'matchResolved',
  nextMatchState: 'nextMatchState',
  nextMatchResolved: 'nextMatchResolved',
  broadcast: "broadcast",
  interval: "interval",
  intervalEn: "intervalEn",
  bracketConfig: "bracketConfig",
  bracketFinals: "bracketFinals",
  presenterConnection: 'presenterConnection',
  partyStatus: 'partyStatus',
  partyChat: 'partyChat',
  presenterDuel: 'presenterDuel',
  presenterViews: 'presenterViews',
  presenterSeries: 'presenterSeries',
  presenterSettings: 'presenterSettings',
  presenterIntermission: 'presenterIntermission',
  presenterRuleContexts: 'presenterRuleContexts',
  presenterTimeline: 'presenterTimeline',
  presenterRenderer: 'presenterRenderer',
  presenterClients: 'presenterClients',
  presenterMedia: 'presenterMedia',
  presenterMediaStatus: 'presenterMediaStatus',
  configurationStatus: 'configurationStatus',
  presenterPublicConfig: 'presenterPublicConfig',
  presenterAssets: 'presenterAssets',
} as const;

export interface ReplicantMap {
  [REPLICANTS.banPick]: BanPickState;
  [REPLICANTS.startggConfig]: StartggConfig;
  [REPLICANTS.startggBracket]: StartggBracket | null;
  [REPLICANTS.startggStatus]: StartggStatus;
  [REPLICANTS.sheetConfig]: SheetConfig;
  [REPLICANTS.sheetStatus]: SheetStatus;
  [REPLICANTS.players]: PlayerProfile[];
  [REPLICANTS.playersEn]: PlayerProfile[];
  [REPLICANTS.castersEn]: Caster[];
  [REPLICANTS.casters]: Caster[];
  [REPLICANTS.castersState]: CastersState;
  [REPLICANTS.currentMatch]: CurrentMatchSelection;
  [REPLICANTS.matchState]: MatchState;
  [REPLICANTS.matchResolved]: ResolvedMatch;
  [REPLICANTS.nextMatchState]: MatchState;
  [REPLICANTS.nextMatchResolved]: ResolvedMatch;
  [REPLICANTS.broadcast]: BroadcastState;
  [REPLICANTS.interval]: IntervalState;
  [REPLICANTS.intervalEn]: IntervalState;
  [REPLICANTS.bracketConfig]: BracketConfig;
  [REPLICANTS.bracketFinals]: BracketFinals;
  [REPLICANTS.presenterConnection]: PresenterConnection;
  [REPLICANTS.partyStatus]: PartyStatus;
  [REPLICANTS.partyChat]: PartyChat;
  [REPLICANTS.presenterDuel]: DuelState | null;
  [REPLICANTS.presenterViews]: Views | null;
  [REPLICANTS.presenterSeries]: SeriesState;
  [REPLICANTS.presenterSettings]: PresenterSettings;
  [REPLICANTS.presenterIntermission]: Intermission;
  [REPLICANTS.presenterRuleContexts]: RuleContexts;
  [REPLICANTS.presenterTimeline]: Timeline;
  [REPLICANTS.presenterRenderer]: PresenterRenderer;
  [REPLICANTS.presenterClients]: PresenterClients;
  [REPLICANTS.presenterMedia]: MediaManifest;
  [REPLICANTS.presenterMediaStatus]: PresenterMediaStatus;
  [REPLICANTS.configurationStatus]: ConfigStatus;
  [REPLICANTS.presenterPublicConfig]: PresenterPublicConfig;
  [REPLICANTS.presenterAssets]: EffectiveAssetInventory;
}

/** Messages the ban-pick extension listens for (nodecg.sendMessage). */
export const BANPICK_MESSAGES = {
  /** { optionId: number; player?: "A" | "B" } — apply the pending step. */
  act: "banpick:act",
  undo: "banpick:undo",
  reset: "banpick:reset",
  nextGame: "banpick:nextGame",
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
  nextApply: 'match:next:apply',
  nextLoad: 'match:next:load',
  nextSwap: 'match:next:swap',
  /** { revision, nextRevision } - promote the saved next match and clear its slot. */
  promoteNext: 'match:next:promote',
} as const;

/** Broadcast buses. output is "stream" | "led" | "en". */
export const BROADCAST_MESSAGES = {
  /** { output, patch: Patch<Layers> } — edit preview. */
  setPreview: "broadcast:setPreview",
  /** { output } — program = preview. */
  take: "broadcast:take",
  /** { output } — exchange preview and program. */
  swap: "broadcast:swap",
  /** { output } — hide every preview layer, retaining selections. */
  clearPreview: "broadcast:clearPreview",
  /** { output } — preview = program. */
  revertPreview: "broadcast:revertPreview",
} as const;

/** DAY2 bracket data source. */
export const BRACKET_MESSAGES = {
  /** Partial<BracketConfig> */
  setConfig: "bracket:setConfig",
  /** Re-read the current source now. */
  refresh: "bracket:refresh",
} as const;
