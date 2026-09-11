import type { ApplyResult, DuelState } from '../types/presenter.ts';
import { decodeSnapshot } from './protocol.ts';

/** Share the protocol's rollback decision with the persistent scoring context. */
export function rollbackRound(previous: DuelState | null, next: DuelState, message: unknown): number | undefined {
  if (!previous || previous.gameId !== next.gameId || next.version <= previous.version
    || (message as { code?: string })?.code === 'DuelMasterSnapshot') return undefined;
  const restarted = (message as { code?: string })?.code === 'DuelNewRound' && next.round === previous.round
    && next.rounds.find(round => round.number === next.round)?.startAtMs !== previous.rounds.find(round => round.number === previous.round)?.startAtMs;
  const truncated = next.players.some(player => {
    const old = previous.players.find(value => value.id === player.id);
    return player.results.length < (old?.results.length ?? 0)
      || (next.round === previous.round && player.guesses.length < (old?.guesses.length ?? 0));
  });
  return next.round < previous.round || restarted || truncated ? next.round : undefined;
}

export function applySnapshot(previous: DuelState | null, message: unknown): ApplyResult {
  const decoded = decodeSnapshot(message);
  if (decoded.state === null) {
    return { state: previous, accepted: false, warnings: decoded.warnings };
  }

  const next = decoded.state;
  const master = (message as { code?: string }).code === 'DuelMasterSnapshot';
  if (master) {
    // HTTP enriches knowledge, never authoritative game progression. In-flight
    // snapshots from before a rollback or round advance must not resurrect data.
    if (!previous || previous.gameId !== next.gameId || next.version < previous.version
      || next.round !== previous.round || previous.aborted) return { state: previous, accepted: false, warnings: [] };
    const future = next.rounds.filter(round => round.number > previous.round)
      .map(round => ({ ...round, startAtMs: null, timerStartAtMs: null, endAtMs: null }));
    const rounds = [...previous.rounds.filter(round => !future.some(value => value.number === round.number)), ...future]
      .sort((a, b) => a.number - b.number);
    const enriched = { ...previous, rounds,
      ...(next.roundStartingBehavior === undefined ? {} : { roundStartingBehavior: next.roundStartingBehavior, manualRoundStart: next.manualRoundStart }),
      ...(next.maxRounds === undefined ? {} : { maxRounds: next.maxRounds }),
      ...(next.roundTimeMs === undefined ? {} : { roundTimeMs: next.roundTimeMs }),
      ...(next.ruleOptions === undefined ? {} : { ruleOptions: next.ruleOptions }) };
    return JSON.stringify(enriched) === JSON.stringify(previous)
      ? { state: previous, accepted: false, warnings: [] }
      : { state: enriched, accepted: true, warnings: decoded.warnings };
  }
  if (previous?.gameId === next.gameId && next.version <= previous.version) {
    return { state: previous, accepted: false, warnings: [] };
  }
  // A later generic spectator snapshot does not carry the abort event reason.
  // Keep its terminal history intact until a different duel is selected.
  const explicitRollback = (message as { code?: string }).code === 'DuelNewRound'
    && rollbackRound(previous, next, message) !== undefined;
  if (previous?.gameId === next.gameId && previous.aborted && !next.aborted && !explicitRollback) {
    return { state: previous, accepted: false, warnings: [] };
  }

  if (previous?.gameId === next.gameId) {
    const rollback = rollbackRound(previous, next, message) !== undefined;
    if (!rollback && !next.aborted && !previous.aborted) {
      next.rounds = [...next.rounds, ...previous.rounds.filter(round => round.number > next.round
        && !next.rounds.some(value => value.number === round.number))].sort((a, b) => a.number - b.number);
    }
    next.aborted ||= previous.aborted && !explicitRollback;
    next.roundStartingBehavior ??= previous.roundStartingBehavior;
    if (next.roundStartingBehavior) next.manualRoundStart = next.roundStartingBehavior === 'ManuallyStartAllRounds';
    if (next.maxRounds === undefined && previous.maxRounds !== undefined) next.maxRounds = previous.maxRounds;
    if (next.roundTimeMs === undefined && previous.roundTimeMs !== undefined) next.roundTimeMs = previous.roundTimeMs;
    next.ruleOptions ??= previous.ruleOptions;
  }

  return { state: next, accepted: true, warnings: decoded.warnings };
}
