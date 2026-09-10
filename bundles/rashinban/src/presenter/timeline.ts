import type { Cue, CueKind, DuelState, EffectKind, Timeline, Timing } from '../types/presenter.ts';

export function effectFor(scores: readonly number[]): EffectKind {
  const perfect = scores.filter(score => score === 5000).length;
  return perfect === 2 ? 'double-5k' : perfect === 1 ? 'single-5k' : 'none';
}

export const DEFAULT_TIMING: Timing = { leadMs: 200, countMs: 1200, damageMs: 800, effectWatchdogMs: 10000 };

function fresh(previous: Timeline | null, state: DuelState | null, nowMs: number): Timeline {
  const revision = (previous?.revision ?? 0) + 1;
  return {
    generation: `${state?.gameId ?? 'idle'}:${state?.round ?? 0}:${nowMs}:${revision}`,
    revision,
    gameId: state?.gameId ?? null,
    round: state?.round ?? null,
    phase: 'waiting-game',
    musicEpochMs: previous && previous.gameId === (state?.gameId ?? null) ? previous.musicEpochMs : nowMs,
    music: 'idle',
    effect: 'none',
    effectDeadlineMs: null,
    revealAtMs: null,
    damageAtMs: null,
    holdAtMs: null,
    cues: [],
    observed: {},
    countdownEndAtMs: null,
  };
}

function cue(timeline: Timeline, kind: CueKind, atMs: number, untilMs: number, playerId: string | null = null): Cue {
  return { id: `${timeline.generation}:${kind}:${playerId ?? 'all'}:${atMs}`, kind, atMs, untilMs, playerId };
}

function scheduleReveal(timeline: Timeline, atMs: number, timing: Timing): Timeline {
  const revealAtMs = atMs + timing.leadMs;
  const damageAtMs = revealAtMs + timing.countMs;
  const holdAtMs = damageAtMs + timing.damageMs;
  return {
    ...timeline,
    effect: 'none',
    effectDeadlineMs: null,
    revealAtMs,
    damageAtMs,
    holdAtMs,
    cues: [
      cue(timeline, 'results', revealAtMs, revealAtMs + 200),
      cue(timeline, 'count', revealAtMs, damageAtMs),
      cue(timeline, 'damage', damageAtMs, holdAtMs),
    ],
  };
}

/** Only the registered program graphic should be allowed to call this through NodeCG. */
export function finishEffect(timeline: Timeline, generation: string, nowMs: number, timing: Timing): Timeline {
  const effectStart = timeline.cues.find(item => item.kind === 'five-k')?.atMs;
  if (timeline.generation !== generation || timeline.effect === 'none'
    || timeline.phase !== 'results-transition' || effectStart === undefined || nowMs < effectStart) return timeline;
  // A late callback must use the same boundary as the watchdog tick.
  return scheduleReveal(timeline, Math.min(nowMs, timeline.effectDeadlineMs ?? nowMs), timing);
}

function liveCues(timeline: Timeline, state: DuelState, nowMs: number, bootstrap: boolean, timing: Timing): Timeline {
  const cues = timeline.cues.filter(item => item.untilMs > nowMs);
  const observed: Timeline['observed'] = {};
  for (const player of state.players) {
    const old = timeline.observed[player.id];
    const guessed = player.guesses.some(guess => guess.round === timeline.round);
    let pinCueAtMs = old?.pinCueAtMs ?? null;
    if (!bootstrap && timeline.phase === 'live') {
      const changed = player.pin !== null && (player.pin.lat !== old?.pin?.lat || player.pin.lng !== old?.pin?.lng);
      if (changed && !guessed && (pinCueAtMs === null || nowMs - pinCueAtMs >= (timing.pinRateLimitMs ?? 250))) {
        pinCueAtMs = nowMs;
        cues.push(cue(timeline, 'pin', nowMs + timing.leadMs, nowMs + timing.leadMs + 200, player.id));
      }
      if (guessed && !old?.guessed) cues.push(cue(timeline, 'guess', nowMs + timing.leadMs, nowMs + timing.leadMs + 500, player.id));
    }
    observed[player.id] = { pin: player.pin, guessed, pinCueAtMs };
  }
  const round = state.rounds.find(item => item.number === timeline.round);
  const end = round?.endAtMs ?? null;
  const countdownEndAtMs = timeline.phase === 'live' || timeline.phase === 'pre-round' ? end : null;
  if (countdownEndAtMs !== timeline.countdownEndAtMs) {
    // First guess can replace the maximum-round deadline: remove its scheduled ticks.
    for (let i = cues.length - 1; i >= 0; i--) if (cues[i].kind === 'countdown') cues.splice(i, 1);
    if (countdownEndAtMs !== null) {
      for (let seconds = 15; seconds >= 1; seconds--) {
        const atMs = countdownEndAtMs - seconds * 1000;
        if (atMs >= nowMs + timing.leadMs && atMs >= (round?.startAtMs ?? 0)) {
          cues.push(cue(timeline, 'countdown', atMs, atMs + 200));
        }
      }
    }
  }
  return { ...timeline, cues, observed, countdownEndAtMs };
}

/** Accept normalized authoritative state; call again on time boundaries even without a new snapshot. */
export function advanceTimeline(previous: Timeline | null, state: DuelState | null, nowMs: number, bootstrap: boolean, timing: Timing,
  effectWatchdogs: Partial<Record<Exclude<EffectKind, 'none'>, number>> = {}): Timeline {
  const replace = bootstrap || previous === null || previous.gameId !== (state?.gameId ?? null)
    || previous.round !== (state?.round ?? null) || (state?.aborted && previous.phase !== 'aborted');
  let timeline = replace ? fresh(previous, state, nowMs) : { ...previous! };
  if (state === null) return timeline;
  if (state.aborted) return { ...timeline, phase: 'aborted', music: 'idle' };

  const resolved = state.players.every(player => player.results.some(result => result.round === timeline.round));
  if (resolved) {
    if (bootstrap) {
      timeline = { ...timeline, revealAtMs: nowMs, damageAtMs: nowMs, holdAtMs: nowMs };
    } else if (timeline.revealAtMs === null && timeline.effect === 'none') {
      const scores = state.players.map(player => player.results.find(result => result.round === timeline.round)!.score);
      const effect = effectFor(scores);
      timeline = { ...timeline, phase: 'results-transition', music: 'results', cues: [], effect };
      if (effect === 'none') timeline = scheduleReveal(timeline, nowMs, timing);
      else {
        const startAtMs = nowMs + timing.leadMs;
        const watchdogMs = effectWatchdogs[effect] ?? timing.effectWatchdogMs;
        timeline = {
          ...timeline,
          effectDeadlineMs: startAtMs + watchdogMs,
          cues: [cue(timeline, 'five-k', startAtMs, startAtMs + watchdogMs)],
        };
      }
    }
    if (timeline.effectDeadlineMs !== null && nowMs >= timeline.effectDeadlineMs) {
      timeline = finishEffect(timeline, timeline.generation, timeline.effectDeadlineMs, timing);
    }
    const phase = timeline.holdAtMs !== null && nowMs >= timeline.holdAtMs
      ? state.status === 'Finished' ? 'finished' : state.manualRoundStart ? 'waiting-host' : 'between-rounds'
      : timeline.revealAtMs !== null && nowMs >= timeline.revealAtMs ? 'results-reveal' : 'results-transition';
    return { ...timeline, phase, music: phase === 'finished' ? 'idle' : 'results' };
  }

  const round = state.rounds.find(item => item.number === timeline.round);
  const phase = state.status === 'Finished' ? 'finished'
    : state.status === 'Created' || round?.startAtMs == null ? 'waiting-host'
    : nowMs < round.startAtMs ? 'pre-round' : 'live';
  const urgent = state.players.some(player => player.guesses.some(guess => guess.round === timeline.round))
    || (round?.endAtMs != null && round.endAtMs - nowMs <= 15000);
  timeline = {
    ...timeline,
    phase,
    music: phase === 'live' ? urgent ? 'urgent' : 'round' : phase === 'pre-round' ? 'round' : 'idle',
  };
  return liveCues(timeline, state, nowMs, bootstrap, timing);
}

/** Next coordinator wakeup. Browser sources schedule the individual timestamped cues themselves. */
export function nextTimelineWakeAtMs(timeline: Timeline, state: DuelState | null, nowMs: number): number | null {
  const boundaries = [timeline.effectDeadlineMs, timeline.revealAtMs, timeline.damageAtMs, timeline.holdAtMs];
  if (state?.gameId === timeline.gameId && (timeline.phase === 'pre-round' || timeline.phase === 'live')) {
    const round = state.rounds.find(item => item.number === timeline.round);
    boundaries.push(round?.startAtMs ?? null, round?.endAtMs == null ? null : round.endAtMs - 15000, round?.endAtMs ?? null);
  }
  const future = boundaries.filter((at): at is number => at !== null && at > nowMs);
  return future.length ? Math.min(...future) : null;
}
