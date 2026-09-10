// Shared replicant names and value types.
// Every context (extension, dashboard, graphics) should reference these
// instead of retyping names/shapes.
import type { DuelState, SeriesState, Timeline, Views } from './presenter.ts';
import type { PresenterSettings } from '../presenter/settings.ts';
import type { ConnectionStatus } from '../extension/presenter/connection.ts';

export type PresenterConnection = ConnectionStatus & {
  input: 'live' | 'replay'; replayFixture: string | null; warnings: string[];
};

export const REPLICANTS = {
  lowerThirdVisible: "lowerThirdVisible",
  round: "round",
  presenterConnection: 'presenterConnection',
  presenterDuel: 'presenterDuel',
  presenterViews: 'presenterViews',
  presenterSeries: 'presenterSeries',
  presenterSettings: 'presenterSettings',
  presenterTimeline: 'presenterTimeline',
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
}
