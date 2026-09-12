import { playerRoundIdentity } from './tie-range-player-view-model.ts';
import { tieScoreRadius } from '../../bundles/rashinban/src/presenter/tie-range-geometry.ts';
import type { PlayerGameContext } from './tie-range-player-state.ts';
import type { PlayerTieRangeView } from './tie-range-player-controller.ts';

export type PlayerMapRound = {
  round: number;
  identity: string;
  answer: { lat: number; lng: number };
  maxErrorDistance: number | null;
  distances: [number | null, number | null];
};

function object(value: unknown): Record<string, any> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, any> : null;
}

/** Geometry is kept only in memory, and only for paired, accepted results. */
export function decodePlayerMapRounds(raw: unknown, context: PlayerGameContext): PlayerMapRound[] {
  const source = object(raw);
  if (!source || source.gameId !== context.gameId || source.version !== context.sourceVersion
    || !Array.isArray(source.rounds) || !Array.isArray(source.teams)) return [];
  const scale = source.options?.map?.maxErrorDistance;
  return context.input.rounds.flatMap(settled => {
    const round = source.rounds.find((value: any) => value?.roundNumber === settled.round);
    const start = context.roundStarts.find(value => value.round === settled.round)?.startTime;
    const answer = round?.panorama;
    if (!start || round?.startTime !== start || !Number.isFinite(answer?.lat) || Math.abs(answer.lat) > 90
      || !Number.isFinite(answer?.lng) || Math.abs(answer.lng) > 180) return [];
    const results = context.teamIds.map(id => source.teams.find((team: any) => team?.id === id)
      ?.roundResults?.find((result: any) => result?.roundNumber === settled.round));
    if (results.some((result, i) => result?.score !== settled.scores[i])) return [];
    const distances = results.map(result => {
      const distance = result?.bestGuess?.distance;
      return Number.isFinite(distance) && distance >= 0 ? distance : null;
    }) as [number | null, number | null];
    return [{ round: settled.round, identity: JSON.stringify([context.gameId, settled.round, start]),
      answer: { lat: answer.lat, lng: answer.lng }, distances,
      maxErrorDistance: Number.isFinite(scale) && scale > 0 ? scale : null }];
  });
}

export function playerCircleRadii(round: PlayerMapRound, scores: [number, number], band: number): number[] {
  if (scores.includes(5000)) {
    const radius = round.maxErrorDistance === null ? null : tieScoreRadius(5000, round.maxErrorDistance);
    return radius !== null && radius < Math.PI * 6371000 ? [radius] : [];
  }
  const index = scores[0] === scores[1]
    ? ((round.distances[0] ?? Infinity) <= (round.distances[1] ?? Infinity) ? 0 : 1)
    : scores[0] > scores[1] ? 0 : 1;
  const inner = round.distances[index];
  const outer = round.maxErrorDistance === null ? null : tieScoreRadius(Math.max(...scores) - band, round.maxErrorDistance);
  return [inner, outer].filter((radius): radius is number => radius !== null && radius < Math.PI * 6371000);
}

type NativeMap = { getDiv(): HTMLElement; getProjection(): unknown };
type NativeCircle = { setMap(map: NativeMap | null): void };
type MapsPage = Window & { google?: { maps?: { Circle?: new (options: Record<string, unknown>) => NativeCircle } } };

/** Read the existing React map reference; never patch Map, fetch, or WebSocket. */
export function findPlayerResultMap(root: HTMLElement): NativeMap | null {
  const candidates = [root, ...root.querySelectorAll<HTMLElement>('*')];
  const checked = new Set<unknown>();
  const inspect = (value: any, depth: number): NativeMap | null => {
    if (!value || typeof value !== 'object' || checked.has(value) || depth > 4) return null;
    checked.add(value);
    if (typeof value.getDiv === 'function' && typeof value.getProjection === 'function') {
      try { if (root.contains(value.getDiv())) return value as NativeMap; } catch { return null; }
    }
    for (const key of ['map', 'current', 'value', 'memoizedState', 'state', 'next']) {
      const found = inspect(value[key], depth + 1);
      if (found) return found;
    }
    if (Array.isArray(value)) for (const item of value.slice(0, 100)) {
      const found = inspect(item, depth + 1);
      if (found) return found;
    }
    return null;
  };
  for (const element of candidates) {
    const key = Object.getOwnPropertyNames(element).find(name => name.startsWith('__reactFiber$'));
    if (!key) continue;
    let fiber: any = (element as any)[key];
    for (let depth = 0; fiber && depth < 30; depth++, fiber = fiber.return) {
      const found = inspect(fiber.memoizedProps, 0) ?? inspect(fiber.memoizedState, 0) ?? inspect(fiber.stateNode, 0);
      if (found) return found;
    }
  }
  return null;
}

export function createPlayerMapOverlay(getPage: () => MapsPage) {
  let circles: NativeCircle[] = [];
  let currentMap: NativeMap | null = null;
  let currentKey: string | null = null;
  function clear(): void {
    for (const circle of circles) { try { circle.setMap(null); } catch { /* Detached native map. */ } }
    circles = []; currentMap = null; currentKey = null;
  }
  return {
    update(view: PlayerTieRangeView, resultRound: number | null): void {
      if (resultRound === null || !view.context || view.capturedMode === 'off') { clear(); return; }
      const geometry = view.mapRounds?.find(round => round.round === resultRound);
      const result = view.output?.rounds.find(round => round.round === resultRound);
      if (!geometry || !result || geometry.identity !== playerRoundIdentity(view.context, resultRound)) { clear(); return; }
      const page = getPage();
      const Circle = page.google?.maps?.Circle;
      const root = Array.from(page.document.querySelectorAll<HTMLElement>('[class*="duels_root__"] [class*="round-score_root__"]'))
        .find(element => Number(element.querySelector('[class*="round-score_roundNumber__"]')?.textContent?.match(/\d+/)?.[0]) === resultRound);
      // The native answer marker is a positive reveal signal; never draw an
      // answer-centered circle while only guesses have been revealed.
      const answerMarker = root?.querySelector<HTMLElement>('[class*="result-map_correctLocation__"], [data-qa="correct-location"]');
      if (!Circle || !root || !answerMarker || answerMarker.getClientRects().length === 0) { clear(); return; }
      for (let element: HTMLElement | null = answerMarker; element; element = element.parentElement) {
        const style = page.getComputedStyle(element);
        if (style.display === 'none' || Number.parseFloat(style.opacity) === 0
          || (element === answerMarker && style.visibility === 'hidden')) { clear(); return; }
      }
      const map = currentMap && root.contains(currentMap.getDiv()) ? currentMap : findPlayerResultMap(root);
      if (!map) { clear(); return; }
      const radii = playerCircleRadii(geometry, result.scores, result.band);
      const key = JSON.stringify([geometry.identity, radii, result.scores]);
      if (map === currentMap && key === currentKey) return;
      clear();
      const bestIndex = result.scores[0] === result.scores[1]
        ? ((geometry.distances[0] ?? Infinity) <= (geometry.distances[1] ?? Infinity) ? 0 : 1)
        : result.scores[0] > result.scores[1] ? 0 : 1;
      const color = result.scores.includes(5000) ? '#ffd55a' : bestIndex === 0 ? '#458af2' : '#f05060';
      try { radii.forEach((radius, index) => circles.push(new Circle({ map, center: geometry.answer, radius,
        strokeColor: color, strokeOpacity: index === 0 ? 1 : .7, strokeWeight: 2,
        fillOpacity: 0, clickable: false, zIndex: 2 }))); } catch { clear(); return; }
      currentMap = map; currentKey = key;
    },
    dispose: clear,
  };
}
