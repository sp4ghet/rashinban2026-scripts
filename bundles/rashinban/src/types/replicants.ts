// Shared replicant names and value types.
// Every context (extension, dashboard, graphics) should reference these
// instead of retyping names/shapes.
import type { DuelState, SeriesState, Timeline, Views } from './presenter.ts';
import type { PresenterSettings } from '../presenter/settings.ts';
import type { ConnectionStatus } from '../extension/presenter/connection.ts';
import type { ClientReady, Lease } from '../presenter/clock.ts';

export type PresenterConnection = ConnectionStatus & {
  input: 'live' | 'replay'; replayFixture: string | null; warnings: string[];
};
export const RENDERER_STATUSES = ['unreported', 'loading', 'api-ready', 'missing-key', 'api-error', 'view-error', 'pano-error'] as const;
export type RendererStatus = typeof RENDERER_STATUSES[number];
export type PresenterRenderer = { status: RendererStatus; updatedAtMs: number | null };
export type PresenterClient = ClientReady & { lastSeenMs: number; renderer: PresenterRenderer };
export type PresenterClients = { clients: PresenterClient[]; program: Lease | null };

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
}
