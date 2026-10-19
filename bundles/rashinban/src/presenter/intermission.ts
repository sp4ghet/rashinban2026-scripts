import type { DuelState, SeriesState } from '../types/presenter.ts';

export type IntermissionView = 'before-game' | 'end-of-last-game';
export type Intermission = {
  context: string | null;
  ignoredGameId: string | null;
  view: IntermissionView;
  lastGame: { gameId: string; winnerCompetitorId: string | null; draw: boolean; aborted: boolean } | null;
};
export const EMPTY_INTERMISSION: Intermission = { context: null, ignoredGameId: null, view: 'before-game', lastGame: null };

export function intermissionContext(series: SeriesState): string {
  // Game-player mappings can disappear in the lobby; competitor identity survives.
  return JSON.stringify([series.id, [series.left.id, series.right.id].sort()]);
}

/** Remember the result without changing the duel, score, or reveal timeline. */
export function updateIntermission(current: Intermission, state: DuelState | null, series: SeriesState): Intermission {
  const context = intermissionContext(series);
  const next = current.context === context ? current : { ...EMPTY_INTERMISSION, context,
    ignoredGameId: current.context !== null ? current.lastGame?.gameId ?? current.ignoredGameId : null };
  if (!state) return next;
  if (state.gameId === next.ignoredGameId) return next;
  const mapped = [series.left.playerId, series.right.playerId];
  if (mapped.some(id => !id || !state.players.some(player => player.id === id)) || mapped[0] === mapped[1]) return next;
  if (state.status !== 'Finished' && !state.aborted) {
    // A rollback of the completed game invalidates its old winner.
    return next.lastGame?.gameId === state.gameId ? { ...next, view: 'before-game', lastGame: null } : next;
  }
  const winnerPlayerId = state.isDraw || state.aborted ? null : state.players.find(p => p.teamId === state.winnerTeamId)?.id ?? null;
  const lastGame = { gameId: state.gameId,
    winnerCompetitorId: winnerPlayerId ? [series.left, series.right].find(p => p.playerId === winnerPlayerId)?.id ?? null : null,
    draw: state.isDraw, aborted: state.aborted };
  return { ...next, view: next.lastGame?.gameId === state.gameId ? next.view : 'end-of-last-game', lastGame };
}

export function selectIntermission(current: Intermission, input: unknown): Intermission {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid between-game view');
  const body = input as Record<string, unknown>;
  if (Object.keys(body).length !== 1 || (body.view !== 'before-game' && body.view !== 'end-of-last-game')) throw Error('Invalid between-game view');
  if (body.view === 'end-of-last-game' && !current.lastGame) throw Error('No completed game for this match');
  return { ...current, view: body.view };
}
