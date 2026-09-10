import type { Mode } from '../../types/presenter.ts';
import type { DuelState, Timeline } from '../../types/presenter.ts';

export function multiplierLabel(state: DuelState | null, timeline: Timeline, sides: { left: string | null; right: string | null }): string {
  const results = !['waiting-game', 'pre-round', 'live', 'aborted'].includes(timeline.phase);
  const values = [sides.left, sides.right].map(id => {
    const player = state?.gameId === timeline.gameId ? state.players.find(player => player.id === id) : undefined;
    return player ? (results ? player.results.find(result => result.round === timeline.round)?.multiplier : undefined) ?? player.multiplier : null;
  });
  const label = (value: number | null) => value === null ? '—' : `×${value}`;
  return values[0] === values[1] ? label(values[0]) : `L ${label(values[0])} · R ${label(values[1])}`;
}

export function layoutKind(mode: Mode, source: 'rendered' | 'chroma'): 'shared' | 'dual' {
  return mode === 'NMPZ' && source === 'rendered' ? 'shared' : 'dual';
}

export function distanceLabel(distanceM: number | null | undefined, score: number | null | undefined): string {
  return distanceM == null ? score == null ? '—' : 'N/A' : distanceM < 1000 ? `${Math.round(distanceM)} m` : `${(distanceM / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} km`;
}
