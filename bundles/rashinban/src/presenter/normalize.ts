import type { ApplyResult, DuelState } from '../types/presenter.ts';
import { decodeSnapshot } from './protocol.ts';

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
      ...(next.roundTimeMs === undefined ? {} : { roundTimeMs: next.roundTimeMs }) };
    return JSON.stringify(enriched) === JSON.stringify(previous)
      ? { state: previous, accepted: false, warnings: [] }
      : { state: enriched, accepted: true, warnings: decoded.warnings };
  }
  if (previous?.gameId === next.gameId && next.version <= previous.version) {
    return { state: previous, accepted: false, warnings: [] };
  }
  // A later generic spectator snapshot does not carry the abort event reason.
  // Keep its terminal history intact until a different duel is selected.
  if (previous?.gameId === next.gameId && previous.aborted && !next.aborted) {
    return { state: previous, accepted: false, warnings: [] };
  }

  if (previous?.gameId === next.gameId) {
    const rollback = next.round < previous.round
      || ((message as { code?: string }).code === 'DuelNewRound' && next.round === previous.round
        && next.rounds.find(round => round.number === next.round)?.startAtMs !== previous.rounds.find(round => round.number === previous.round)?.startAtMs)
      || next.players.some(player =>
      player.results.length < (previous.players.find(old => old.id === player.id)?.results.length ?? 0)
      || (next.round === previous.round && player.guesses.length < (previous.players.find(old => old.id === player.id)?.guesses.length ?? 0)));
    if (!rollback && !next.aborted && !previous.aborted) {
      next.rounds = [...next.rounds, ...previous.rounds.filter(round => round.number > next.round
        && !next.rounds.some(value => value.number === round.number))].sort((a, b) => a.number - b.number);
    }
    next.aborted ||= previous.aborted;
    next.roundStartingBehavior ??= previous.roundStartingBehavior;
    if (next.roundStartingBehavior) next.manualRoundStart = next.roundStartingBehavior === 'ManuallyStartAllRounds';
    if (next.maxRounds === undefined && previous.maxRounds !== undefined) next.maxRounds = previous.maxRounds;
    if (next.roundTimeMs === undefined && previous.roundTimeMs !== undefined) next.roundTimeMs = previous.roundTimeMs;
  }

  return { state: next, accepted: true, warnings: decoded.warnings };
}
