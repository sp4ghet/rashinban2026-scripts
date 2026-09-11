import type { Bounds, DuelState, Mode, Panorama, Phase, Point, Projection, Views } from '../../types/presenter.ts';

export type RenderFrame = { state: DuelState; views: Views; projection: Projection; source: 'rendered' | 'chroma'; displayedRound?: number | null; playerIds?: { left: string | null; right: string | null } };
export interface GameRenderer { render(frame: RenderFrame): void; dispose(): void }
export type RendererPlan = { panoramas: 0 | 1 | 2; playerMaps: 0 | 2; resultsMap: boolean };
export type MapFrame = { visible: boolean; inactive?: boolean; bounds: Bounds | null; pins: { point: Point; color: string; label: string }[]; lines: { from: Point; to: Point; color: string }[] };
export interface MapSurface { render(frame: MapFrame): void; dispose(): void }
export type PanoramaOptions = { visible: boolean; identity: string };
export interface PanoramaSurface { render(panorama: Panorama | null, options?: PanoramaOptions): void; dispose(): void }
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
  const maps = new Map<string, MapSurface>(); const panos = new Map<string, PanoramaSurface>();
  function clear() { maps.forEach(map => map.dispose()); panos.forEach(pano => pano.dispose()); maps.clear(); panos.clear(); }
  return {
    render(frame) {
      if (disposed) return;
      const { state, views, projection, source } = frame;
      const plan = rendererPlan(state.mode, source, projection.phase);
      plan.resultsMap &&= projection.answer !== null;
      // Replicants arrive independently; result geometry follows the same round
      // as the projection. Older callers without a displayed round use state.
      const displayedRound = frame.displayedRound === undefined ? state.round : frame.displayedRound;
      const nextKey = `${state.gameId}:${state.round}:${state.mode}:${source}`;
      if (key !== nextKey) { key = nextKey; failed = false; }
      if (failed) return;
      try {
        const initial = state.rounds.find(round => round.number === state.round)?.panorama ?? null;
        const currentViews = views.gameId === state.gameId && views.round === state.round;
        const ids = sides.map(side => {
          const id = frame.playerIds?.[side];
          return id && state.players.some(player => player.id === id) ? id : null;
        });
        const players = sides.map(side => {
          const id = frame.playerIds?.[side];
          return id && state.players.some(player => player.id === id) && currentViews ? views.players[id] : undefined;
        });
        // Only prepare panorama metadata already present in this round's snapshot.
        // Projection visibility remains authoritative when Replicants arrive separately.
        const prepare = !['waiting-game', 'aborted', 'finished'].includes(projection.phase);
        const live = projection.phase === 'live' && displayedRound === state.round && source === 'rendered';
        const slots = state.mode === 'NMPZ' ? ['shared-panorama'] : ['left-view', 'right-view'];
        for (const slot of slots) {
          if (prepare && source === 'rendered' && !panos.has(slot)) panos.set(slot, adapter.panorama(slot));
        }
        panos.forEach((pano, slot) => {
          const index = slot === 'right-view' ? 1 : 0;
          const shared = slot === 'shared-panorama';
          const value = prepare && slots.includes(slot)
            ? shared ? (ids.some(Boolean) ? initial : null) : ids[index] ? players[index]?.panorama ?? initial : null
            : null;
          pano.render(value, { visible: live && slots.includes(slot), identity: `${state.gameId}:${state.round}:${shared ? 'shared' : ids[index] ?? ''}` });
        });
        if (plan.playerMaps) for (const slot of ['left-map', 'right-map']) {
          if (!maps.has(slot)) maps.set(slot, adapter.map(slot));
        }
        for (let i = 0; i < sides.length; i++) {
          const player = players[i];
          maps.get(`${sides[i]}-map`)?.render({ visible: live && !!ids[i], inactive: !player?.mapActive && !player?.mapSticky, bounds: player?.mapBounds ?? null,
            pins: player?.pin ? [{ point: player.pin, color: colors[sides[i]], label: sides[i] }] : [], lines: [] });
        }
        if (plan.resultsMap && projection.answer) {
          if (!maps.has('results-map')) maps.set('results-map', adapter.map('results-map'));
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
          maps.get('results-map')!.render({ visible: true, bounds: resultBounds(pins.map(pin => pin.point)), pins, lines });
        } else maps.get('results-map')?.render({ visible: false, bounds: null, pins: [], lines: [] });
      } catch { clear(); failed = true; onError('Google Maps view unavailable'); }
    },
    dispose() { clear(); disposed = true; },
  };
}
