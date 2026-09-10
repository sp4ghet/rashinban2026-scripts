import type { Cue, DuelState, Point, Timeline, Timing } from '../types/presenter.ts';

/** Future cues can be scheduled; only count is an interval that may be joined late. */
export function canPlayCue(cue: Cue, nowMs: number, played: ReadonlySet<string>): boolean {
  return !played.has(cue.id) && nowMs < cue.untilMs && (cue.kind === 'count' || nowMs < cue.atMs + 250);
}
export function samePin(a: Point | null | undefined, b: Point | null | undefined): boolean {
  return a?.lat === b?.lat && a?.lng === b?.lng;
}
export function pinCue(playerId: string, previous: Point | null, next: Point | null, lastCueMs: number, nowMs: number, generation: string): Cue | null {
  return next && !samePin(previous, next) && nowMs - lastCueMs >= 150
    ? { id: `${generation}:pin:${playerId}:${nowMs}`, kind: 'pin', atMs: nowMs, untilMs: nowMs + 250, playerId } : null;
}
export function interactionCues(previous: DuelState, next: DuelState, nowMs: number): Cue[] {
  if (previous.gameId !== next.gameId || previous.round !== next.round) return [];
  return next.players.flatMap(player => {
    const before = previous.players.find(p => p.id === player.id);
    return before && !before.guesses.some(g => g.round === next.round) && player.guesses.some(g => g.round === next.round)
      ? [{ id: `${next.gameId}/${next.round}/${player.id}/guess`, kind: 'guess' as const, atMs: nowMs, untilMs: nowMs + 250, playerId: player.id }] : [];
  });
}
/** Both accepted telemetry and changed snapshot pins use this observation cache. */
export function applyPinCues(timeline: Timeline, pins: Record<string, Point | null>, nowMs: number, timing: Timing): Timeline {
  const observed = { ...timeline.observed }; const cues = [...timeline.cues];
  for (const [id, pin] of Object.entries(pins)) {
    const old = observed[id]; if (!old) continue;
    const last = old.pinCueAtMs ?? -Infinity;
    const sound = timeline.phase === 'live' && !old.guessed && nowMs - last >= (timing.pinRateLimitMs ?? 150)
      ? pinCue(id, old.pin, pin, last, nowMs, timeline.generation) : null;
    if (sound) cues.push({ ...sound, atMs: sound.atMs + timing.leadMs, untilMs: sound.untilMs + timing.leadMs });
    observed[id] = { ...old, pin, pinCueAtMs: sound ? nowMs : old.pinCueAtMs };
  }
  return { ...timeline, observed, cues };
}
