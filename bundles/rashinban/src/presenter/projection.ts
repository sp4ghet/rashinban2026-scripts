import type { DuelState, Projection, Timeline } from '../types/presenter.ts';

function progress(nowMs: number, startMs: number | null, endMs: number | null): number {
  if (startMs === null || endMs === null || nowMs < startMs) return 0;
  return endMs <= startMs ? 1 : Math.min(1, (nowMs - startMs) / (endMs - startMs));
}

export function project(state: DuelState | null, timeline: Timeline, nowMs: number): Projection {
  const empty: Projection = { phase: timeline.phase, remainingMs: null, answer: null, players: [] };
  if (state === null || state.gameId !== timeline.gameId) return empty;
  const round = state.rounds.find(item => item.number === timeline.round);
  const resolved = state.players.every(player => player.results.some(result => result.round === timeline.round));
  const revealed = resolved && timeline.phase !== 'aborted' && timeline.phase !== 'live'
    && timeline.phase !== 'pre-round' && timeline.revealAtMs !== null && nowMs >= timeline.revealAtMs;
  const scoreProgress = progress(nowMs, timeline.revealAtMs, timeline.damageAtMs);
  const damageProgress = progress(nowMs, timeline.damageAtMs, timeline.holdAtMs);
  const deadline = timeline.phase === 'pre-round' ? round?.startAtMs : timeline.phase === 'live' ? round?.endAtMs : null;
  return {
    phase: timeline.phase,
    remainingMs: deadline == null ? null : Math.max(0, deadline - nowMs),
    answer: revealed ? round?.panorama ?? null : null,
    players: state.players.map(player => {
      const result = player.results.find(item => item.round === timeline.round);
      return {
        id: player.id,
        health: result && timeline.phase !== 'aborted'
          ? Math.round(result.healthBefore + (result.healthAfter - result.healthBefore) * (revealed ? damageProgress : 0))
          : player.health,
        locked: player.guesses.some(guess => guess.round === timeline.round),
        score: revealed && result ? Math.round(result.score * scoreProgress) : null,
        distanceM: revealed ? result?.bestGuess?.distanceM ?? null : null,
      };
    }),
  };
}
