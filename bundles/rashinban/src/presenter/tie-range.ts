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

/** Validate lazily: server rounds after our terminal round do not belong to this game. */
function* validatedCompletedRounds(state: DuelState): Generator<[RoundResult, RoundResult]> {
  const all = state.players.flatMap(player => player.results);
  const validRoundNumbers = all.filter(result => Number.isInteger(result.round) && result.round >= 1)
    .map(result => result.round);
  const currentRoundResolved = all.some(result => result.round === state.round);
  const completedByProgression = Math.max(0, state.round
    - (currentRoundResolved || (state.status === 'Finished' && !state.aborted) ? 0 : 1));
  const requiredThrough = Math.max(completedByProgression, 0, ...validRoundNumbers);
  for (let round = 1; round <= requiredThrough; round += 1) {
    const blue = state.players[0].results.filter(result => result.round === round);
    const red = state.players[1].results.filter(result => result.round === round);
    if (blue.length > 1 || red.length > 1) throw new Error(`Duplicate tie-range result at round ${round}`);
    const blueResult = blue[0];
    const redResult = red[0];
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
    yield [blueResult, redResult];
  }
  if (all.some(result => !Number.isInteger(result.round) || result.round < 1)) {
    throw new Error('Invalid tie-range round number');
  }
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

  const input = {
    initialHealth: state.initialHealth,
    individual: state.ruleOptions.individual,
    mutual: state.ruleOptions.mutual,
    delay: state.ruleOptions.delay,
    maxRounds: state.maxRounds ?? null,
    teamIds: [state.players[0].teamId, state.players[1].teamId] as [string, string],
    rounds: [] as Array<{ round: number; scores: [number, number] }>,
  };
  let folded = foldTieRange(input, mode);
  // Validate only the history belonging to the custom duel. Later native rounds
  // can be incomplete after an earlier custom knockout.
  for (const [blue, red] of validatedCompletedRounds(state)) {
    input.rounds.push({ round: blue.round, scores: [blue.score, red.score] });
    folded = foldTieRange(input, mode);
    if (folded.terminal !== null) break;
  }
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

  if (mode !== null && state.status === 'Finished' && !state.aborted && folded.terminal === null) {
    throw new Error('Server game finished before a custom outcome could be verified');
  }

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
  } else if (folded.rounds.length > 0) {
    const lastCompleted = folded.rounds.at(-1)!.round;
    const nextRound = derived.rounds.find(round => round.number > lastCompleted);
    if (nextRound) nextRound.multiplier = folded.currentMutualMultiplierTenths / 10;
  }

  return derived;
}
