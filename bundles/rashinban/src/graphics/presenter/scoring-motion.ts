import type { ScoreProjection } from '../../types/presenter.ts';

// Captured GeoGuessr eG, including its intentional negative anticipation.
// docs/geoguessr/samples/scoring-animation/geoguessr-source.json
const travel = (p: number) => p === 0 || p === 1 ? p : 2.80158 * p ** 3 - 1.80158 * p ** 2;

/** Unit-mass React Spring step response, sampled from the shared clock. */
function spring(seconds: number, wobbly = false): number {
  if (seconds <= 0) return 0;
  const damping = wobbly ? 6 : 13;
  const frequency = Math.sqrt((wobbly ? 180 : 170) - damping ** 2);
  return 1 - Math.exp(-damping * seconds) * (Math.cos(frequency * seconds) + damping / frequency * Math.sin(frequency * seconds));
}

function bezier(p: number, x1: number, y1: number, x2: number, y2: number): number {
  if (p <= 0 || p >= 1) return p;
  const axis = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  let low = 0; let high = 1;
  for (let i = 0; i < 20; i++) {
    const t = (low + high) / 2;
    if (axis(t, x1, x2) < p) low = t; else high = t;
  }
  return axis((low + high) / 2, y1, y2);
}

export function scoreMotion(s: ScoreProjection) {
  const collision = spring(s.differenceProgress);
  const impact = spring(s.impactProgress);
  const multiplier = spring(s.multiplierProgress, true);
  const damageScale = 1 + 0.3 * multiplier;
  // A 30px target for 50ms followed by a return to zero, preserving velocity.
  const wobble = 30 * (spring(s.differenceProgress, true) - spring(s.differenceProgress - 0.05, true));
  const tie = spring(s.tieProgress * 0.35);
  return {
    entry: bezier(s.entryProgress, 0.05, 0.75, 0.49, 1),
    rise: spring(s.countProgress * 0.75),
    travel: travel(s.subtractProgress), flight: travel(s.flightProgress),
    collisionOpacity: 1 - collision, collisionScale: 1 + 0.5 * collision, wobble,
    damageScale, impactOpacity: 1 - impact,
    impactScale: damageScale + (1.75 - damageScale) * impact,
    tieOpacity: 1 - tie, tieScale: 1 + 0.5 * tie,
    multiplierScale: bezier(Math.min(1, s.multiplierProgress / 0.3), 0.34, 1.56, 0.64, 1),
    multiplierOpacity: 1 - s.multiplierFadeProgress,
  };
}

/** Hold the points award for 600ms, then fade over 400ms on the shared clock. */
export function pointAwardMotion(s: ScoreProjection) {
  return {
    scale: 0.6 + 0.4 * spring(s.verdictProgress * 0.4, true),
    // differenceProgress starts at the points verdict and spans one second.
    opacity: Math.min(1, (1 - s.differenceProgress) / 0.4),
  };
}
