import { intermissionContext, type Intermission } from '../../presenter/intermission.ts';
import type { SeriesState } from '../../types/presenter.ts';
import type { PresenterScene } from './scene.ts';

export function cameraScene(scene: PresenterScene, control: Intermission, series: SeriesState) {
  if (!['waiting', 'summary', 'aborted'].includes(scene.kind) || (scene.kind === 'waiting' && scene.gameId !== null)) return { view: 'none', winner: 'none', label: '' } as const;
  const last = control.context === intermissionContext(series) ? control.lastGame : null;
  if (control.view !== 'end-of-last-game' || !last) return { view: 'before-game', winner: 'none', label: '' } as const;
  const winner = !last.winnerCompetitorId ? 'none' : last.winnerCompetitorId === series.left.id ? 'left' : last.winnerCompetitorId === series.right.id ? 'right' : 'none';
  return { view: 'end-of-last-game', winner,
    label: last.aborted ? 'GAME CANCELLED' : last.draw ? 'DRAW' : winner === 'none' ? 'GAME FINISHED' : 'WINNER' } as const;
}

/** Reposition the existing camera elements so a scene change never reopens a feed. */
export function paintCameraScene(root: HTMLElement, scene: PresenterScene, control: Intermission, series: SeriesState) {
  const value = cameraScene(scene, control, series);
  root.dataset.intermission = value.view;
  root.dataset.cameraWinner = value.winner;
  if (value.view !== 'none') {
    for (const id of ['waiting-area', 'summary-area']) root.querySelector<HTMLElement>('#' + id)!.hidden = true;
  }
  const label = root.querySelector<HTMLElement>('#camera-scene-label');
  if (label) label.textContent = value.label;
}
