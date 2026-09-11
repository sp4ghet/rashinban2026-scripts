import type { DuelState, RoundResult, TieRangeMode, TieRangeRound } from '../types/presenter.ts';

export function tieRangeBand(bestScore: number, mode: TieRangeMode): number {
  if (mode === 'off') return 0;
  return Math.floor((5000 - bestScore) / (mode === 'full' ? 1 : 2));
}

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

function roundHalfEven(difference: number, multiplierTenths: number): number {
  const scaled = difference * multiplierTenths;
  const integer = Math.floor(scaled / 10);
  const remainder = scaled % 10;
  return integer + (remainder > 5 || (remainder === 5 && integer % 2 !== 0) ? 1 : 0);
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
  const derived = structuredClone(state);
  const health = [state.initialHealth, state.initialHealth];
  const multiplierTenths = [10, 10];
  let mutualTenths = 10;
  let terminalRound: number | null = null;
  let terminalWinner: string | null = null;
  let terminalDraw = false;
  const metadata: TieRangeRound[] = [];

  for (const [blueSource, redSource] of completed) {
    const roundNumber = blueSource.round;
    const scores = [blueSource.score, redSource.score];
    const bestScore = Math.max(scores[0], scores[1]);
    const band = mode === null ? 0 : tieRangeBand(bestScore, mode);
    const difference = Math.abs(scores[0] - scores[1]);
    const withinBand = difference <= band;
    if (mode !== null) metadata.push({ round: roundNumber, band, withinBand });

    const round = derived.rounds.find(candidate => candidate.number === roundNumber)!;
    round.multiplier = mutualTenths / 10;
    const derivedResults: [RoundResult, RoundResult] = [
      derived.players[0].results.find(candidate => candidate.round === roundNumber)!,
      derived.players[1].results.find(candidate => candidate.round === roundNumber)!,
    ];
    for (let index = 0; index < 2; index += 1) {
      derivedResults[index].healthBefore = health[index];
      derivedResults[index].damageDealt = 0;
      derivedResults[index].multiplier = multiplierTenths[index] / 10;
    }

    let winner: number | null = null;
    if (difference > 0) {
      winner = scores[0] > scores[1] ? 0 : 1;
      const loser = winner === 0 ? 1 : 0;
      const damage = roundHalfEven(difference, multiplierTenths[winner]);
      derivedResults[winner].damageDealt = damage;
      health[loser] = Math.max(0, health[loser] - damage);
    }
    for (let index = 0; index < 2; index += 1) {
      derivedResults[index].healthAfter = health[index];
    }

    const knockout = health[0] === 0 || health[1] === 0;
    const roundLimit = state.maxRounds != null && roundNumber >= state.maxRounds;
    if (knockout || roundLimit) {
      terminalRound = roundNumber;
      if (health[0] === health[1]) {
        terminalDraw = true;
      } else {
        terminalWinner = derived.players[health[0] > health[1] ? 0 : 1].teamId;
      }
      break;
    }

    if (roundNumber >= state.ruleOptions.delay) {
      multiplierTenths[0] += state.ruleOptions.mutual;
      multiplierTenths[1] += state.ruleOptions.mutual;
      mutualTenths += state.ruleOptions.mutual;
      if (withinBand) {
        multiplierTenths[0] += state.ruleOptions.individual;
        multiplierTenths[1] += state.ruleOptions.individual;
      } else if (winner !== null) {
        multiplierTenths[winner] += state.ruleOptions.individual;
      }
    }
  }

  for (let index = 0; index < 2; index += 1) {
    derived.players[index].health = health[index];
    derived.players[index].multiplier = multiplierTenths[index] / 10;
  }
  if (mode !== null) derived.tieRange = { mode, rounds: metadata };

  if (terminalRound !== null) {
    derived.round = terminalRound;
    derived.status = 'Finished';
    derived.aborted = false;
    derived.winnerTeamId = terminalWinner;
    derived.isDraw = terminalDraw;
    derived.rounds = derived.rounds.filter(round => round.number <= terminalRound!);
    for (const player of derived.players) {
      player.pin = null;
      player.guesses = player.guesses.filter(guess => guess.round <= terminalRound!);
      player.results = player.results.filter(result => result.round <= terminalRound!);
    }
  } else if (completed.length > 0) {
    const lastCompleted = completed.at(-1)![0].round;
    const nextRound = derived.rounds.find(round => round.number > lastCompleted);
    if (nextRound) nextRound.multiplier = mutualTenths / 10;
  }

  return derived;
}
