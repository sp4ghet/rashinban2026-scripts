import type { DuelState, RoundResult, TieRangeMode, TieRangeRound } from '../types/presenter.ts';
import { foldTieRange, tieRangeBand } from './tie-range-core.ts';

export { tieRangeBand };

export function deriveTieRange(state: DuelState, mode: TieRangeMode): DuelState {
  if (mode === 'off') return state;
  return deriveHealth(state, mode);
}

/** Replays the server's zero-band HP rules. Exported so captures can verify the shared fold. */
export function deriveServerHealthReplica(state: DuelState): DuelState {
  return deriveHealth(state, null);
}

function validRuleOptions(options: DuelState['ruleOptions']): options is NonNullable<DuelState['ruleOptions']> {
  return options !== undefined
    && Number.isInteger(options.individual) && options.individual >= 0
    && Number.isInteger(options.mutual) && options.mutual >= 0
    && Number.isInteger(options.delay) && options.delay >= 0;
}

function resultsByRound(results: RoundResult[], playerId: string): Map<number, RoundResult> {
  const mapped = new Map<number, RoundResult>();
  for (const result of results) {
    if (!Number.isInteger(result.round) || result.round < 1 || mapped.has(result.round)) {
      throw new Error(`Invalid tie-range result history for player ${playerId}`);
    }
    mapped.set(result.round, result);
  }
  return mapped;
}

function validatedCompletedRounds(state: DuelState): Array<[RoundResult, RoundResult]> {
  const blue = resultsByRound(state.players[0].results, state.players[0].id);
  const red = resultsByRound(state.players[1].results, state.players[1].id);
  const highest = Math.max(0, ...blue.keys(), ...red.keys());
  const completed: Array<[RoundResult, RoundResult]> = [];
  for (let round = 1; round <= highest; round += 1) {
    const blueResult = blue.get(round);
    const redResult = red.get(round);
    if (!blueResult && !redResult) throw new Error(`Tie-range result history has a gap at round ${round}`);
    if (!blueResult || !redResult) throw new Error(`Incomplete tie-range result history at round ${round}`);
    if (!state.rounds.some(candidate => candidate.number === round)) {
      throw new Error(`Tie-range panorama history has a gap at round ${round}`);
    }
    for (const result of [blueResult, redResult]) {
      if (!Number.isInteger(result.score) || result.score < 0 || result.score > 5000) {
        throw new Error(`Invalid tie-range score at round ${round}`);
      }
    }
    completed.push([blueResult, redResult]);
  }
  return completed;
}

function deriveHealth(state: DuelState, mode: Exclude<TieRangeMode, 'off'> | null): DuelState {
  if (!validRuleOptions(state.ruleOptions)) {
    throw new Error('Tie-range rule options are missing or invalid');
  }
  if (!Number.isInteger(state.initialHealth) || state.initialHealth <= 0) {
    throw new Error('Tie-range initial health is missing or invalid');
  }
  if (state.maxRounds !== undefined && state.maxRounds !== null
    && (!Number.isInteger(state.maxRounds) || state.maxRounds < 1)) {
    throw new Error('Tie-range maximum rounds is invalid');
  }

  const completed = validatedCompletedRounds(state);
  const folded = foldTieRange({
    initialHealth: state.initialHealth,
    individual: state.ruleOptions.individual,
    mutual: state.ruleOptions.mutual,
    delay: state.ruleOptions.delay,
    maxRounds: state.maxRounds ?? null,
    teamIds: [state.players[0].teamId, state.players[1].teamId],
    rounds: completed.map(([blue, red]) => ({ round: blue.round, scores: [blue.score, red.score] })),
  }, mode);
  const derived = structuredClone(state);
  const metadata: TieRangeRound[] = [];

  for (const foldedRound of folded.rounds) {
    if (mode !== null) metadata.push({
      round: foldedRound.round,
      band: foldedRound.band,
      withinBand: foldedRound.withinBand,
    });

    const round = derived.rounds.find(candidate => candidate.number === foldedRound.round)!;
    round.multiplier = foldedRound.mutualMultiplierTenths / 10;
    const derivedResults: [RoundResult, RoundResult] = [
      derived.players[0].results.find(candidate => candidate.round === foldedRound.round)!,
      derived.players[1].results.find(candidate => candidate.round === foldedRound.round)!,
    ];
    for (let index = 0; index < 2; index += 1) {
      derivedResults[index].healthBefore = foldedRound.healthBefore[index];
      derivedResults[index].healthAfter = foldedRound.healthAfter[index];
      derivedResults[index].damageDealt = foldedRound.damageDealt[index];
      derivedResults[index].multiplier = foldedRound.multiplierTenths[index] / 10;
    }
  }

  for (let index = 0; index < 2; index += 1) {
    derived.players[index].health = folded.currentHealth[index];
    derived.players[index].multiplier = folded.currentMultiplierTenths[index] / 10;
  }
  if (mode !== null) derived.tieRange = { mode, rounds: metadata };

  if (folded.terminal !== null) {
    const terminalRound = folded.terminal.round;
    derived.round = terminalRound;
    derived.status = 'Finished';
    derived.aborted = false;
    derived.winnerTeamId = folded.terminal.winnerTeamId;
    derived.isDraw = folded.terminal.isDraw;
    derived.rounds = derived.rounds.filter(round => round.number <= terminalRound);
    for (const player of derived.players) {
      player.pin = null;
      player.guesses = player.guesses.filter(guess => guess.round <= terminalRound);
      player.results = player.results.filter(result => result.round <= terminalRound);
    }
  } else if (completed.length > 0) {
    const lastCompleted = completed.at(-1)![0].round;
    const nextRound = derived.rounds.find(round => round.number > lastCompleted);
    if (nextRound) nextRound.multiplier = folded.currentMutualMultiplierTenths / 10;
  }

  return derived;
}
