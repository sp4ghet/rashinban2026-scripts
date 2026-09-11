import type { Bounds, DuelState, Mode, Panorama, Phase, Point, Projection, Views } from '../../types/presenter.ts';

export type RenderFrame = { state: DuelState; views: Views; projection: Projection; source: 'rendered' | 'chroma'; displayedRound?: number | null; playerIds?: { left: string | null; right: string | null } };
export interface GameRenderer { render(frame: RenderFrame): void; dispose(): void }
export type RendererPlan = { panoramas: 0 | 1 | 2; playerMaps: 0 | 2; resultsMap: boolean };
export type MapFrame = { visible: boolean; inactive?: boolean; bounds: Bounds | null; pins: { point: Point; color: string; label: string }[]; lines: { from: Point; to: Point; color: string }[] };
export interface MapSurface { render(frame: MapFrame): void; dispose(): void }
export interface PanoramaSurface { render(panorama: Panorama | null): void; dispose(): void }
export interface RendererAdapter { map(slot: string): MapSurface; panorama(slot: string): PanoramaSurface }
export function rendererPlan(mode: Mode, source: 'rendered' | 'chroma', phase: Phase): RendererPlan {
  const live = phase === 'live' && source === 'rendered';
  return { panoramas: live ? mode === 'NMPZ' ? 1 : 2 : 0, playerMaps: live ? 2 : 0,
    resultsMap: ['results-reveal', 'between-rounds', 'waiting-host', 'finished'].includes(phase) };
}
export function resultBounds(points: Point[]): Bounds | null {
  if (!points.length) return null;
  const lngs = points.map(p => ((p.lng + 180) % 360 + 360) % 360 - 180).sort((a, b) => a - b);
  let gap = -1; let start = 0;
  for (let i = 0; i < lngs.length; i++) {
    const size = (i === lngs.length - 1 ? lngs[0] + 360 : lngs[i + 1]) - lngs[i];
    if (size > gap) { gap = size; start = i; }
  }
  return { north: Math.max(...points.map(p => p.lat)), south: Math.min(...points.map(p => p.lat)),
    west: lngs[(start + 1) % lngs.length], east: lngs[start] };
}
const sides = ['left', 'right'] as const;
const colors = { left: '#458af2', right: '#f05060' };
export function createRenderer(adapter: RendererAdapter, onError: (message: string) => void): GameRenderer {
  let key = ''; let failed = false; let disposed = false;
  const maps: MapSurface[] = []; const panos: PanoramaSurface[] = [];
  function clear() { maps.splice(0).forEach(map => map.dispose()); panos.splice(0).forEach(pano => pano.dispose()); }
  return {
    render(frame) {
      if (disposed) return;
      const { state, views, projection, source } = frame;
      const plan = rendererPlan(state.mode, source, projection.phase);
      plan.resultsMap &&= projection.answer !== null;
      // Replicants arrive independently; result geometry follows the same round
      // as the projection. Older callers without a displayed round use state.
      const displayedRound = frame.displayedRound === undefined ? state.round : frame.displayedRound;
      const nextKey = `${state.gameId}:${plan.resultsMap ? displayedRound : state.round}:${state.mode}:${source}:${JSON.stringify(plan)}`;
      if (key !== nextKey) { clear(); key = nextKey; failed = false; }
      if (failed) return;
      try {
        if (!panos.length && plan.panoramas) {
          for (const slot of plan.panoramas === 1 ? ['shared-panorama'] : ['left-view', 'right-view']) panos.push(adapter.panorama(slot));
        }
        if (!maps.length) {
          for (const slot of plan.resultsMap ? ['results-map'] : plan.playerMaps ? ['left-map', 'right-map'] : []) maps.push(adapter.map(slot));
        }
        const initial = state.rounds.find(round => round.number === state.round)?.panorama ?? null;
        const currentViews = views.gameId === state.gameId && views.round === state.round;
        const players = sides.map(side => {
          const id = frame.playerIds?.[side];
          return id && state.players.some(player => player.id === id) && currentViews ? views.players[id] : undefined;
        });
        panos.forEach((pano, i) => pano.render(plan.panoramas === 1 ? initial : players[i]?.panorama ?? null));
        if (plan.playerMaps) maps.forEach((map, i) => {
          const player = players[i];
          map.render({ visible: !!player && (plan.panoramas === 1 || player.mapActive || player.mapSticky), inactive: !!player && !player.mapActive && !player.mapSticky, bounds: player?.mapBounds ?? null,
            pins: player?.pin ? [{ point: player.pin, color: colors[sides[i]], label: sides[i] }] : [], lines: [] });
        });
        if (plan.resultsMap && projection.answer) {
          const answer = { lat: projection.answer.lat, lng: projection.answer.lng };
          const pins: MapFrame['pins'] = [{ point: answer, color: '#ffd55a', label: 'Answer' }];
          const lines: MapFrame['lines'] = [];
          for (const side of sides) {
            const player = state.players.find(player => player.id === frame.playerIds?.[side]);
            const guess = player?.results.find(result => result.round === displayedRound)?.bestGuess;
            if (!guess) continue;
            const point = { lat: guess.lat, lng: guess.lng };
            pins.push({ point, color: colors[side], label: side }); lines.push({ from: answer, to: point, color: colors[side] });
          }
          maps[0].render({ visible: true, bounds: resultBounds(pins.map(pin => pin.point)), pins, lines });
        }
      } catch { clear(); failed = true; onError('Google Maps view unavailable'); }
    },
    dispose() { clear(); disposed = true; },
  };
}
