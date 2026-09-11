import type { DuelState, TieRangeMode } from '../types/presenter.ts';

export type RuleContext = { mode: TieRangeMode; source: DuelState };
export type RuleContexts = { live: RuleContext | null; replay: RuleContext | null; replayFixture?: string };

function validScore(score: number): boolean {
  return Number.isInteger(score) && score >= 0 && score <= 5000;
}

/** Capture only uniquely paired valid results. Explicit rollback releases their frozen inputs. */
export function updateRuleContext(previous: RuleContext | null, source: DuelState,
  configured: TieRangeMode, rollbackRound?: number): RuleContext {
  // Replicant values are proxies; structuredClone cannot clone them.
  const next = JSON.parse(JSON.stringify(source)) as DuelState;
  if (!previous || previous.source.gameId !== source.gameId) return { mode: configured, source: next };
  if (previous.mode === 'off') return { mode: 'off', source: next };
  const settled = new Set(previous.source.players[0].results
    .filter(result => (rollbackRound === undefined || result.round < rollbackRound)
      && previous.source.players[0].results.filter(other => other.round === result.round).length === 1
      && previous.source.players[1].results.filter(other => other.round === result.round).length === 1
      && validScore(result.score)
      && validScore(previous.source.players[1].results.find(other => other.round === result.round)!.score))
    .map(result => result.round));
  for (const player of next.players) {
    const old = previous.source.players.find(value => value.id === player.id);
    if (!old) continue;
    player.results = [
      ...player.results.filter(result => !settled.has(result.round)),
      ...old.results.filter(result => settled.has(result.round)),
    ].sort((a, b) => a.round - b.round);
    player.guesses = [...player.guesses.filter(guess => !settled.has(guess.round)),
      ...old.guesses.filter(guess => settled.has(guess.round))].sort((a, b) => a.round - b.round || a.createdAtMs - b.createdAtMs);
  }
  const frozenRounds = new Set(previous.source.rounds
    .filter(round => settled.has(round.number)).map(round => round.number));
  next.rounds = [...next.rounds.filter(round => !frozenRounds.has(round.number)),
    ...previous.source.rounds.filter(round => frozenRounds.has(round.number))].sort((a, b) => a.number - b.number);
  // Detach inherited results/rounds before the next Replicant publication.
  return JSON.parse(JSON.stringify({ mode: previous.mode, source: next })) as RuleContext;
}
