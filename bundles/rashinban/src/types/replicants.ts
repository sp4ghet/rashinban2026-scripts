// Shared replicant names and value types.
// Every context (extension, dashboard, graphics) should reference these
// instead of retyping names/shapes.
import type { DuelState, SeriesState, Timeline, Views } from './presenter.ts';
import type { PresenterSettings } from '../presenter/settings.ts';
import type { ConnectionStatus } from '../extension/presenter/connection.ts';
import type { ClientReady, Lease } from '../presenter/clock.ts';
import type { MediaManifest, AudioStatus } from '../presenter/media.ts';
export type PresenterMediaStatus = { generation: string | null; effect: string; status: 'idle' | 'pending' | 'missing' | 'complete' | 'failed' | 'watchdog' };

export type PresenterConnection = ConnectionStatus & {
  input: 'live' | 'replay'; replayFixture: string | null; warnings: string[];
};
export const RENDERER_STATUSES = ['unreported', 'loading', 'api-ready', 'missing-key', 'api-error', 'view-error', 'pano-error'] as const;
export type RendererStatus = typeof RENDERER_STATUSES[number];
export type PresenterRenderer = { status: RendererStatus; updatedAtMs: number | null };
export type AudioLease = Lease & { mode: PresenterSettings['audioOutput']; token: number; releasing: boolean };
export type PresenterClient = ClientReady & { lastSeenMs: number; renderer: PresenterRenderer; audio?: AudioStatus; clockFresh?: boolean };
export type PresenterClients = { clients: PresenterClient[]; program: Lease | null; audio?: AudioLease | null };

export const REPLICANTS = {
  lowerThirdVisible: "lowerThirdVisible",
  round: "round",
  presenterConnection: 'presenterConnection',
  presenterDuel: 'presenterDuel',
  presenterViews: 'presenterViews',
  presenterSeries: 'presenterSeries',
  presenterSettings: 'presenterSettings',
  presenterTimeline: 'presenterTimeline',
  presenterRenderer: 'presenterRenderer',
  presenterClients: 'presenterClients',
  presenterMedia: 'presenterMedia',
  presenterMediaStatus: 'presenterMediaStatus',
} as const;

export interface ReplicantMap {
  [REPLICANTS.lowerThirdVisible]: boolean;
  [REPLICANTS.round]: number;
  [REPLICANTS.presenterConnection]: PresenterConnection;
  [REPLICANTS.presenterDuel]: DuelState | null;
  [REPLICANTS.presenterViews]: Views | null;
  [REPLICANTS.presenterSeries]: SeriesState;
  [REPLICANTS.presenterSettings]: PresenterSettings;
  [REPLICANTS.presenterTimeline]: Timeline;
  [REPLICANTS.presenterRenderer]: PresenterRenderer;
  [REPLICANTS.presenterClients]: PresenterClients;
  [REPLICANTS.presenterMedia]: MediaManifest;
  [REPLICANTS.presenterMediaStatus]: PresenterMediaStatus;
}
