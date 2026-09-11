import type { DuelState, Point } from '../types/presenter.ts';

const EARTH_RADIUS_M = 6_371_000;
const HALF_CIRCUMFERENCE_M = Math.PI * EARTH_RADIUS_M;
const COLORS = { left: '#458af2', right: '#f05060', neutral: '#f5f7fc', gold: '#ffd55a' } as const;

export type TieRangeCircle = {
  kind: 'inner' | 'five-k';
  center: Point;
  radiusM: number;
  color: string;
};

export type TieRangeMapGeometry = {
  circles: TieRangeCircle[];
  circlePaths: Point[][];
  outerRadiusM?: number;
  outerPath?: Point[];
  annulus?: [Point[], Point[]];
  framePoints: Point[];
  fullLongitude: boolean;
  world: boolean;
  label: string;
};

export function tieScoreRadius(threshold: number, maxErrorDistance: number): number | null {
  if (!Number.isFinite(threshold) || threshold < 1 || threshold > 5000
    || !Number.isFinite(maxErrorDistance) || maxErrorDistance <= 0) return null;
  return Math.max(25, -(maxErrorDistance / 10) * Math.log((threshold - 0.5) / 5000));
}

export function sampleGeodesicCircle(_center: Point, _radiusM: number, _segments = 128): Point[] {
  const center = _center; const radiusM = _radiusM; const segments = Math.max(8, Math.floor(_segments));
  if (!validPoint(center) || !Number.isFinite(radiusM) || radiusM < 0) return [];
  const angular = Math.min(Math.PI, radiusM / EARTH_RADIUS_M);
  const lat1 = radians(center.lat); const lng1 = radians(center.lng);
  const path: Point[] = [];
  for (let index = 0; index < segments; index++) {
    const bearing = 2 * Math.PI * index / segments;
    const lat = Math.asin(Math.sin(lat1) * Math.cos(angular)
      + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
    const lng = lng1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat));
    path.push({ lat: degrees(lat), lng: normalizeLongitude(degrees(lng)) });
  }
  path.push(path[0]);
  return path;
}

export function tieRangeMapGeometry(
  state: DuelState,
  round: number,
  playerIds: { left: string | null; right: string | null } | undefined,
  answer: Point,
): TieRangeMapGeometry | null {
  const metadata = state.tieRange?.rounds.find(value => value.round === round);
  if (!metadata || !validPoint(answer)) return null;
  const mapped = (['left', 'right'] as const).map(side => ({
    side,
    player: state.players.find(player => player.id === playerIds?.[side]),
  }));
  const results = mapped.map(value => ({ ...value, result: value.player?.results.find(result => result.round === round) }));
  if (results.some(value => !value.result) || results.some(value => !validScore(value.result!.score))) return null;
  const scores = results.map(value => value.result!.score);
  const best = Math.max(...scores); const threshold = best - metadata.band;
  const terminal = state.status === 'Finished' || results.some(value => value.result!.healthAfter <= 0);
  const circles: TieRangeCircle[] = []; const circlePaths: Point[][] = []; const framePoints: Point[] = [];
  let fullLongitude = false;
  const pushCircle = (circle: TieRangeCircle) => {
    circles.push(circle);
    const path = sampleGeodesicCircle(circle.center, circle.radiusM);
    circlePaths.push(path); framePoints.push(...path);
    fullLongitude ||= crossesPole(circle.center, circle.radiusM);
  };

  if (scores.some(score => score === 5000)) {
    const radiusM = state.ruleOptions?.maxErrorDistance == null ? null : tieScoreRadius(5000, state.ruleOptions.maxErrorDistance);
    if (radiusM != null && radiusM < HALF_CIRCUMFERENCE_M) pushCircle({ kind: 'five-k', center: answer, radiusM, color: COLORS.gold });
    const world = radiusM != null && radiusM >= HALF_CIRCUMFERENCE_M;
    return {
      circles,
      circlePaths,
      framePoints,
      fullLongitude,
      world,
      label: world ? 'Entire map within 5K range' : scores.every(score => score === 5000) ? 'Both 5K' : '5K required to tie',
    };
  }

  const closer = closerResult(results);
  const closerGuess = closer?.result?.bestGuess;
  if (closer && closerGuess && validGuess(closerGuess)) {
    const neutral = scores[0] === scores[1] && results[0].result!.bestGuess?.distanceM === results[1].result!.bestGuess?.distanceM;
    pushCircle({ kind: 'inner', center: answer, radiusM: closerGuess.distanceM,
      color: neutral ? COLORS.neutral : COLORS[closer.side] });
  }

  const ordinaryLabel = resultLabel(metadata.band, metadata.withinBand, scores, terminal, round, state.ruleOptions);
  if (threshold <= 0) return { circles, circlePaths, framePoints, fullLongitude, world: true, label: 'All guesses within tie range' };
  const radiusM = state.ruleOptions?.maxErrorDistance == null ? null : tieScoreRadius(threshold, state.ruleOptions.maxErrorDistance);
  if (radiusM == null) return { circles, circlePaths, framePoints, fullLongitude, world: false, label: ordinaryLabel };
  if (radiusM >= HALF_CIRCUMFERENCE_M) return { circles, circlePaths, framePoints, fullLongitude: true, world: true, label: 'Entire map within tie range' };

  const outerPath = sampleGeodesicCircle(answer, radiusM);
  framePoints.push(...outerPath);
  fullLongitude ||= crossesPole(answer, radiusM);
  const inner = circles.find(circle => circle.kind === 'inner');
  const annulus = inner && inner.radiusM < radiusM
    ? [outerPath, sampleGeodesicCircle(answer, inner.radiusM).reverse()] as [Point[], Point[]]
    : undefined;
  return { circles, circlePaths, outerRadiusM: radiusM, outerPath, annulus, framePoints, fullLongitude, world: false, label: ordinaryLabel };
}

function radians(value: number): number { return value * Math.PI / 180; }
function degrees(value: number): number { return value * 180 / Math.PI; }
function normalizeLongitude(value: number): number { return ((value + 180) % 360 + 360) % 360 - 180; }
function validPoint(point: Point): boolean {
  return Number.isFinite(point.lat) && point.lat >= -90 && point.lat <= 90 && Number.isFinite(point.lng);
}
function validScore(score: number): boolean { return Number.isInteger(score) && score >= 0 && score <= 5000; }
function validGuess(guess: Point & { distanceM: number }): boolean {
  return validPoint(guess) && Number.isFinite(guess.distanceM) && guess.distanceM >= 0 && guess.distanceM < HALF_CIRCUMFERENCE_M;
}
function crossesPole(center: Point, radiusM: number): boolean {
  return radiusM >= HALF_CIRCUMFERENCE_M || Math.abs(center.lat) + degrees(radiusM / EARTH_RADIUS_M) >= 90;
}
function closerResult<T extends { side: 'left' | 'right'; result: { score: number; bestGuess: (Point & { distanceM: number }) | null } | undefined }>(values: T[]): T | undefined {
  if (values[0].result!.score !== values[1].result!.score) {
    return values[0].result!.score > values[1].result!.score ? values[0] : values[1];
  }
  const usable = values.filter(value => value.result?.bestGuess && validGuess(value.result.bestGuess));
  return usable.sort((left, right) => left.result!.bestGuess!.distanceM - right.result!.bestGuess!.distanceM)[0];
}
function resultLabel(
  band: number,
  withinBand: boolean,
  scores: number[],
  terminal: boolean,
  round: number,
  options: DuelState['ruleOptions'],
): string {
  const prefix = `Tie band: ${band.toLocaleString('en-US')} ${band === 1 ? 'point' : 'points'} · `;
  const verdict = withinBand ? 'Within tie range' : 'Outside tie range';
  if (terminal || !options || round < options.delay) return `${prefix}${verdict}`;
  const deltas = [options.mutual, options.mutual];
  if (withinBand) { deltas[0] += options.individual; deltas[1] += options.individual; }
  else if (scores[0] !== scores[1]) deltas[scores[0] > scores[1] ? 0 : 1] += options.individual;
  if (deltas[0] > 0 && deltas[1] > 0) return `${prefix}Both multipliers increase`;
  if (deltas[0] > 0) return `${prefix}Left multiplier increases`;
  if (deltas[1] > 0) return `${prefix}Right multiplier increases`;
  return `${prefix}${verdict}`;
}
