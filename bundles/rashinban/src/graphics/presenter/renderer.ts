import type { Bounds, DuelState, Mode, Panorama, Phase, Point, Projection, Views } from '../../types/presenter.ts';
import { lockLayout } from './layout.ts';

export type RenderFrame = { state: DuelState; views: Views; projection: Projection; source: 'rendered' | 'chroma'; displayedRound?: number | null; playerIds?: { left: string | null; right: string | null }; frozen?: boolean; previewRound?: number | null; prewarmRound?: number | null; preparedResults?: MapFrame };
export interface GameRenderer { render(frame: RenderFrame): void; dispose(): void }
export type RendererPlan = { panoramas: 0 | 1 | 2; playerMaps: 0 | 2; resultsMap: boolean };
export type MapFrame = { visible: boolean; prepare?: boolean; inactive?: boolean; padding?: number; bounds: Bounds | null; pins: { point: Point; color: string; label: string; kind?: 'answer' }[]; lines: { from: Point; to: Point; color: string }[] };
export interface MapSurface { render(frame: MapFrame): void; dispose(): void }
export type PanoramaOptions = { visible: boolean; identity: string; frozen?: boolean };
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
/** Geometry may be prepared while hidden; only the gated projection makes it visible. */
export function resultMapFrame(state: DuelState, round: number | null, playerIds: RenderFrame['playerIds'], revealedAnswer?: Point): MapFrame | null {
  const panorama = state.rounds.find(item => item.number === round)?.panorama;
  if (!panorama || !state.players.every(player => player.results.some(result => result.round === round))) return null;
  const answer = { lat: revealedAnswer?.lat ?? panorama.lat, lng: revealedAnswer?.lng ?? panorama.lng };
  const pins: MapFrame['pins'] = [{ point: answer, color: '#ffd55a', label: 'Answer', kind: 'answer' }];
  const lines: MapFrame['lines'] = [];
  for (const side of sides) {
    const player = state.players.find(player => player.id === playerIds?.[side]);
    const guess = player?.results.find(result => result.round === round)?.bestGuess;
    if (!guess) continue;
    const point = { lat: guess.lat, lng: guess.lng };
    pins.push({ point, color: colors[side], label: side }); lines.push({ from: answer, to: point, color: colors[side] });
  }
  return { visible: false, prepare: true, bounds: resultBounds(pins.map(pin => pin.point)), pins, lines };
}
export function createRenderer(adapter: RendererAdapter, onError: (message: string) => void): GameRenderer {
  let key = ''; let failed = false; let disposed = false;
  const maps = new Map<string, MapSurface>(); const panos = new Map<string, PanoramaSurface>();
  function clear() { maps.forEach(map => map.dispose()); panos.forEach(pano => pano.dispose()); maps.clear(); panos.clear(); }
  return {
    render(frame) {
      if (disposed) return;
      const { state, views, projection, source } = frame;
      const plan = rendererPlan(state.mode, source, projection.phase);
      const previewPhase = ['waiting-host', 'pre-round', 'between-rounds', 'results-reveal'].includes(projection.phase);
      const warmNumber = frame.previewRound ?? frame.prewarmRound;
      const preview = state.status !== 'Finished' && !state.aborted && warmNumber != null
        && warmNumber >= state.round && warmNumber <= state.round + 1
        && warmNumber <= (state.maxRounds ?? Infinity) ? state.rounds.find(round => round.number === warmNumber) : undefined;
      const showPreview = !!preview && frame.previewRound === preview.number && previewPhase && projection.answer === null;
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
        const lock = lockLayout(frame);
        const locked = sides.map(side => lock === side || lock === 'both');
        const slots = state.mode === 'NMPZ' ? ['shared-panorama'] : ['left-view', 'right-view'];
        if (preview && source === 'rendered' && !panos.has('preview-panorama')) panos.set('preview-panorama', adapter.panorama('preview-panorama'));
        for (const slot of slots) {
          if (prepare && source === 'rendered' && !panos.has(slot)) panos.set(slot, adapter.panorama(slot));
        }
        panos.forEach((pano, slot) => {
          if (slot === 'preview-panorama') {
            pano.render(preview?.panorama ?? null, { visible: showPreview && source === 'rendered',
              identity: `${state.gameId}:${preview?.number ?? ''}:preview:${ids.join(':')}` });
            return;
          }
          const index = slot === 'right-view' ? 1 : 0;
          const shared = slot === 'shared-panorama';
          const value = prepare && slots.includes(slot)
            ? shared ? (ids.some(Boolean) ? initial : null) : ids[index] ? players[index]?.panorama ?? initial : null
            : null;
          const frozen = shared ? lock === 'both' : locked[index];
          pano.render(value, { visible: live && slots.includes(slot) && !frozen, frozen: frozen || frame.frozen,
            identity: `${state.gameId}:${state.round}:${shared ? 'shared' : ids[index] ?? ''}` });
        });
        if (plan.playerMaps) for (const slot of ['left-map', 'right-map']) {
          if (!maps.has(slot)) maps.set(slot, adapter.map(slot));
        }
        for (let i = 0; i < sides.length; i++) {
          const player = players[i];
          const pins: MapFrame['pins'] = [];
          for (let j = 0; j < sides.length; j++) {
            if (j !== i && !locked[i]) continue;
            const snapshotPlayer = state.players.find(value => value.id === ids[j]);
            const submitted = snapshotPlayer?.guesses.find(guess => guess.round === state.round);
            // A missing Views update can lag the current snapshot. An explicit
            // null in current telemetry remains authoritative (pin cleared).
            const view = players[j];
            const point = submitted ?? (view ? view.pin : snapshotPlayer?.pin);
            if (point) pins.push({ point: { lat: point.lat, lng: point.lng }, color: colors[sides[j]], label: sides[j] });
          }
          maps.get(`${sides[i]}-map`)?.render({ visible: live && !!ids[i], inactive: !locked[i] && !player?.mapActive && !player?.mapSticky,
            bounds: locked[i] ? resultBounds(pins.map(pin => pin.point)) : player?.mapBounds ?? null,
            padding: locked[i] ? 45 : 0, pins, lines: [] });
        }
        const resultFrame = plan.resultsMap && projection.answer
          ? resultMapFrame(state, displayedRound, frame.playerIds, projection.answer) : frame.preparedResults;
        if (resultFrame) {
          if (!maps.has('results-map')) maps.set('results-map', adapter.map('results-map'));
          maps.get('results-map')!.render({ ...resultFrame, visible: plan.resultsMap && projection.answer !== null });
        } else maps.get('results-map')?.render({ visible: false, bounds: null, pins: [], lines: [] });
        if (showPreview && source === 'rendered' && !maps.has('preview-map')) maps.set('preview-map', adapter.map('preview-map'));
        maps.get('preview-map')?.render({ visible: showPreview && source === 'rendered', bounds: null, pins: [], lines: [] });
      } catch { clear(); failed = true; onError('Google Maps view unavailable'); }
    },
    dispose() { clear(); disposed = true; },
  };
}
