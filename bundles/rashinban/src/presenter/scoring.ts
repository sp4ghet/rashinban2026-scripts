import type { DuelState, ScoreCalculation, ScoreProjection, ScoreSequence, Timing } from '../types/presenter.ts';

export function scoreCalculation(state: DuelState, round: number): ScoreCalculation {
  const results = state.players.map(player => player.results.find(result => result.round === round)!);
  const losses = results.map(result => Math.max(0, result.healthBefore - result.healthAfter));
  const hasDamage = losses.some(loss => loss > 0);
  const tied = results[0].score === results[1].score && !hasDamage;
  const loser = hasDamage ? losses[0] > losses[1] ? 0 : 1 : results[0].score < results[1].score ? 0 : 1;
  const winner = 1 - loser;
  return { tied, hasDamage, winnerId: tied ? null : state.players[winner].id, loserId: tied ? null : state.players[loser].id,
    difference: Math.abs(results[0].score - results[1].score),
    damage: hasDamage ? results[winner].damageDealt > 0 ? results[winner].damageDealt : losses[loser] : 0,
    multiplier: results[winner].multiplier };
}

export function scoreSequence(calculation: ScoreCalculation, revealAtMs: number, timing: Timing): ScoreSequence {
  const immediate = timing.countMs === 0 && timing.damageMs === 0;
  const duration = (ms: number) => immediate ? 0 : ms;
  const countAtMs = revealAtMs + duration(1210);
  const countEndAtMs = countAtMs + timing.countMs;
  const subtractAtMs = countEndAtMs + duration(1000);
  const differenceAtMs = subtractAtMs + duration(350);
  const collisionAtMs = subtractAtMs + duration(calculation.tied ? 350 : 250);
  const multiplied = !calculation.tied && calculation.multiplier !== 1;
  const multiplierAtMs = multiplied ? subtractAtMs + duration(1000) : null;
  const flightAtMs = calculation.hasDamage ? subtractAtMs + duration(multiplied ? 2000 : 1500) : null;
  const impactAtMs = flightAtMs === null ? null : flightAtMs + duration(350);
  const healthEndAtMs = (impactAtMs ?? differenceAtMs) + timing.damageMs;
  const completeAtMs = calculation.tied ? subtractAtMs + duration(700)
    : impactAtMs === null ? subtractAtMs + duration(multiplied ? 2000 : 1500) : impactAtMs + Math.max(duration(2000), timing.damageMs);
  return { ...calculation, countAtMs, countEndAtMs, subtractAtMs, collisionAtMs, differenceAtMs, multiplierAtMs, flightAtMs, impactAtMs, healthEndAtMs, completeAtMs };
}

export function fraction(now: number, from: number | null, to: number | null): number {
  if (from === null || to === null || now < from) return 0;
  return to <= from ? 1 : Math.min(1, (now - from) / (to - from));
}

export function scoreProjection(sequence: ScoreSequence, revealAtMs: number, now: number): ScoreProjection {
  const s = sequence;
  const stage = now >= s.completeAtMs ? 'complete' : now < s.countAtMs ? 'entry' : now < s.countEndAtMs ? 'count'
    : now < s.subtractAtMs ? 'score-hold' : s.tied ? 'tie' : s.impactAtMs !== null && now >= s.impactAtMs ? 'impact'
    : s.flightAtMs !== null && now >= s.flightAtMs ? 'flight' : s.multiplierAtMs !== null && now >= s.multiplierAtMs ? 'multiplier'
    : now >= s.differenceAtMs ? 'difference' : 'subtract';
  return { tied: s.tied, hasDamage: s.hasDamage, winnerId: s.winnerId, loserId: s.loserId, difference: s.difference, damage: s.damage, multiplier: s.multiplier,
    stage, entryProgress: fraction(now, revealAtMs, revealAtMs + 700), subtractProgress: fraction(now, s.subtractAtMs, s.subtractAtMs + 400),
    multiplierProgress: fraction(now, s.multiplierAtMs, s.multiplierAtMs === null ? null : s.multiplierAtMs + 1000),
    flightProgress: fraction(now, s.flightAtMs, s.flightAtMs === null ? null : s.flightAtMs + 400),
    impactProgress: fraction(now, s.impactAtMs, s.impactAtMs === null ? null : s.impactAtMs + 350),
    tieProgress: fraction(now, s.collisionAtMs, s.completeAtMs) };
}

/** Deterministic damped spring; normalize its finite endpoint to the authoritative value. */
export function healthProgress(now: number, start: number | null, end: number | null, stiff = false): number {
  const p = fraction(now, start, end);
  if (p === 0 || p === 1 || start === null || end === null) return p;
  const tension = stiff ? 210 : 170; const friction = stiff ? 20 : 26;
  const damping = friction / 2; const frequency = Math.sqrt(tension - damping * damping);
  const spring = (seconds: number) => 1 - Math.exp(-damping * seconds) * (Math.cos(frequency * seconds) + damping / frequency * Math.sin(frequency * seconds));
  return spring((now - start) / 1000) / spring((end - start) / 1000);
}
