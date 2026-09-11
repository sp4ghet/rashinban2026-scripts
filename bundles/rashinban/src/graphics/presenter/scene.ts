import type { DuelState, Projection, SeriesState, Timeline } from '../../types/presenter.ts';
import { project } from '../../presenter/projection.ts';

export type SummaryRound = { round: number; players: { id: string; score: number | null; health: number | null; damage: number | null }[] };
export type PresenterScene = {
  gameId: string | null; serverRound: number | null; kind: 'waiting' | 'live' | 'preview' | 'results' | 'transition' | 'summary' | 'aborted';
  projection: Projection; previewRound: number | null; prewarmRound: number | null; countdown: number | null;
  paused: boolean; winnerTeamId: string | null; winnerPlayerId: string | null; draw: boolean;
  rounds: SummaryRound[]; pageRounds: SummaryRound[]; page: number; pages: number;
};

/** Local scene selection never advances the server round or starts a game. */
export function projectScene(state: DuelState | null, timeline: Timeline, nowMs: number, previous?: PresenterScene | null): PresenterScene {
  const projection = project(state, timeline, nowMs);
  const scene: PresenterScene = { gameId: state?.gameId ?? null, serverRound: state?.round ?? null,
    kind: 'waiting', projection, previewRound: null, prewarmRound: null, countdown: null,
    paused: false, winnerTeamId: null, winnerPlayerId: null, draw: false, rounds: [], pageRounds: [], page: 0, pages: 1 };
  if (!state || state.gameId !== timeline.gameId) return scene;
  scene.paused = state.paused && state.status !== 'Finished';
  const current = state.rounds.find(round => round.number === state.round);
  const resolved = state.players.every(player => player.results.some(result => result.round === timeline.round));
  const settled = resolved && timeline.effect === 'none' && timeline.holdAtMs !== null && nowMs >= timeline.holdAtMs;
  const sameRound = state.round === timeline.round;
  const next = state.rounds.find(round => round.number === state.round + 1);
  const limit = state.maxRounds ?? Infinity;
  const canContinue = state.round < limit && state.players.every(player => player.health > 0);
  if (state.aborted) scene.kind = 'aborted';
  else if (state.status === 'Finished' && sameRound && (settled || !resolved)) {
    scene.kind = 'summary'; scene.draw = state.isDraw;
    scene.winnerTeamId = state.isDraw ? null : state.winnerTeamId;
    scene.winnerPlayerId = state.players.find(player => player.teamId === scene.winnerTeamId)?.id ?? null;
  } else if (sameRound && !resolved && current && (state.status === 'Created' || current.startAtMs === null || projection.phase === 'pre-round')) {
    scene.kind = 'preview'; scene.previewRound = current.number;
    if (projection.phase === 'pre-round' && current.startAtMs !== null) {
      const seconds = Math.ceil((current.startAtMs - nowMs) / 1000);
      scene.countdown = seconds > 0 && seconds <= 3 ? seconds : null;
    }
  } else if (sameRound && resolved && state.status !== 'Finished' && canContinue && next) {
    scene.prewarmRound = next.number;
    if (settled && !scene.paused) { scene.kind = 'preview'; scene.previewRound = next.number; }
    else scene.kind = projection.answer ? 'results' : 'transition';
  } else scene.kind = projection.answer ? 'results' : projection.phase === 'live' ? 'live'
    : projection.phase === 'results-transition' ? 'transition' : 'waiting';

  if (scene.paused && previous?.gameId === scene.gameId && previous.serverRound === scene.serverRound
    && previous.kind === 'preview' && state.rounds.some(round => round.number === previous.previewRound)
    && (previous.previewRound === state.round && !resolved || previous.previewRound === state.round + 1 && settled && canContinue)) {
    scene.kind = 'preview'; scene.previewRound = previous.previewRound;
  }
  if (scene.kind === 'preview') {
    // Keep authoritative settled HP, without bringing old scores/answer into the preview.
    scene.projection = { ...projection, answer: null, scoring: undefined,
      players: projection.players.map(player => ({ ...player, locked: false, score: null, distanceM: null })) };
  }
  if (scene.paused) {
    scene.countdown = null; scene.projection = { ...scene.projection, remainingMs: null };
  }
  if (scene.kind === 'summary' || scene.kind === 'aborted') {
    const rounds = [...new Set(state.players.flatMap(player => player.results.map(result => result.round)))].filter(round => round <= state.round).sort((a, b) => a - b);
    scene.rounds = rounds.map(round => ({ round, players: state.players.map(player => {
      const result = player.results.find(result => result.round === round);
      return { id: player.id, score: result?.score ?? null, health: result?.healthAfter ?? null, damage: result?.damageDealt ?? null };
    }) }));
    scene.pages = Math.max(1, Math.ceil(scene.rounds.length / 10));
    scene.page = Math.floor(Math.max(0, nowMs - (timeline.holdAtMs ?? 0)) / 8000) % scene.pages;
    scene.pageRounds = scene.rounds.slice(scene.page * 10, (scene.page + 1) * 10);
    scene.projection = { ...projection, answer: null, scoring: undefined, remainingMs: null };
  }
  return scene;
}

/** DOM-only painter, also usable by isolated browser QA without Replicant writes. */
export function paintScene(root: HTMLElement, scene: PresenterScene, series: SeriesState): void {
  const el = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
  root.dataset.scene = scene.kind;
  el('preview-area').hidden = scene.kind !== 'preview';
  el('preview-countdown').hidden = scene.countdown === null;
  el('preview-countdown').textContent = scene.countdown === null ? '' : String(scene.countdown);
  el('preview-label').textContent = scene.projection.phase === 'pre-round' && !scene.paused ? 'ROUND STARTING' : `ROUND ${String(scene.previewRound ?? '').padStart(2, '0')} · WAITING FOR START`;
  el('review-banner').hidden = !scene.paused;
  el('waiting-area').hidden = scene.kind !== 'waiting';
  el('summary-area').hidden = scene.kind !== 'summary' && scene.kind !== 'aborted';
  const winner = [series.left, series.right].find(player => player.playerId === scene.winnerPlayerId);
  el('summary-title').textContent = scene.kind === 'aborted' ? 'GAME CANCELLED' : scene.draw ? 'DRAW' : winner ? `${winner.name} WINS` : 'GAME FINISHED';
  el('summary-title').dataset.winner = winner === series.left ? 'left' : winner === series.right ? 'right' : 'none';
  el('summary-left-name').textContent = series.left.name;
  el('summary-right-name').textContent = series.right.name;
  const label = scene.pageRounds.length ? `ROUNDS ${scene.pageRounds[0].round}–${scene.pageRounds.at(-1)!.round} OF ${scene.rounds.length}` : 'NO COMPLETED ROUNDS';
  el('summary-page').textContent = label;
  const rows = el('summary-rows');
  const signature = JSON.stringify([scene.pageRounds, series.left.playerId, series.right.playerId]);
  if (rows.dataset.content === signature) return;
  rows.dataset.content = signature;
  rows.replaceChildren(...scene.pageRounds.map(round => {
    const row = root.ownerDocument.createElement('tr');
    const cells = [String(round.round), ...[series.left, series.right].map(player => {
      const value = round.players.find(value => value.id === player.playerId);
      return value?.score == null ? '—' : `${value.score.toLocaleString('en-US')} pts · ${value.damage ?? 0} damage · ${value.health ?? '—'} HP`;
    })];
    cells.forEach(text => { const cell = root.ownerDocument.createElement('td'); cell.textContent = text; row.append(cell); });
    return row;
  }));
}
