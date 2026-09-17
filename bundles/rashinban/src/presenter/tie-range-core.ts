export type TieRangeBandMode = 'off' | 'full' | 'half';
/** `null` replays the server's zero-band health rules. */
export type TieRangeFoldMode = Exclude<TieRangeBandMode, 'off'> | null;

export type TieRangeSettledRound = {
  round: number;
  scores: [number, number];
};

export type TieRangeInput = {
  initialHealth: number;
  /** Individual multiplier increment in tenths. */
  individual: number;
  /** Mutual multiplier increment in tenths. */
  mutual: number;
  /** First round number after which multiplier increments apply. */
  delay: number;
  maxRounds: number | null;
  teamIds: [string, string];
  rounds: TieRangeSettledRound[];
};

export type TieRangeRoundOutput = {
  round: number;
  scores: [number, number];
  healthBefore: [number, number];
  healthAfter: [number, number];
  damageDealt: [number, number];
  multiplierTenths: [number, number];
  nextMultiplierTenths: [number, number];
  band: number;
  withinBand: boolean;
  mutualMultiplierTenths: number;
  nextMutualMultiplierTenths: number;
};

export type TieRangeTerminalOutcome = {
  round: number;
  winnerTeamId: string | null;
  isDraw: boolean;
};

export type TieRangeOutput = {
  teamIds: [string, string];
  initialHealth: [number, number];
  currentHealth: [number, number];
  initialMultiplierTenths: [number, number];
  currentMultiplierTenths: [number, number];
  initialMutualMultiplierTenths: number;
  currentMutualMultiplierTenths: number;
  rounds: TieRangeRoundOutput[];
  terminal: TieRangeTerminalOutcome | null;
};

export function tieRangeBand(bestScore: number, mode: TieRangeBandMode): number {
  if (mode === 'off') return 0;
  return Math.floor((5000 - bestScore) / (mode === 'full' ? 1 : 2));
}

function roundHalfEven(difference: number, multiplierTenths: number): number {
  const scaled = difference * multiplierTenths;
  const integer = Math.floor(scaled / 10);
  const remainder = scaled % 10;
  return integer + (remainder > 5 || (remainder === 5 && integer % 2 !== 0) ? 1 : 0);
}

function validateInput(input: TieRangeInput): void {
  if (!Number.isInteger(input.initialHealth) || input.initialHealth <= 0) {
    throw new Error('Tie-range initial health is missing or invalid');
  }
  if (!Number.isInteger(input.individual) || input.individual < 0
    || !Number.isInteger(input.mutual) || input.mutual < 0
    || !Number.isInteger(input.delay) || input.delay < 0) {
    throw new Error('Tie-range rule options are missing or invalid');
  }
  if (input.maxRounds !== null && (!Number.isInteger(input.maxRounds) || input.maxRounds < 1)) {
    throw new Error('Tie-range maximum rounds is invalid');
  }
  if (!Array.isArray(input.teamIds) || input.teamIds.length !== 2
    || input.teamIds.some(teamId => typeof teamId !== 'string')) {
    throw new Error('Tie-range team IDs are invalid');
  }
  if (!Array.isArray(input.rounds)) throw new Error('Tie-range result history is invalid');
  for (let index = 0; index < input.rounds.length; index += 1) {
    const settled = input.rounds[index];
    const expectedRound = index + 1;
    if (!settled || !Number.isInteger(settled.round) || settled.round < 1) {
      throw new Error(`Invalid tie-range result history at round ${expectedRound}`);
    }
    if (settled.round !== expectedRound) {
      throw new Error(`Tie-range result history has a gap at round ${expectedRound}`);
    }
    if (!Array.isArray(settled.scores) || settled.scores.length !== 2
      || settled.scores.some(score => !Number.isInteger(score) || score < 0 || score > 5000)) {
      throw new Error(`Invalid tie-range score at round ${settled.round}`);
    }
  }
}

export function foldTieRange(input: TieRangeInput, mode: TieRangeFoldMode): TieRangeOutput {
  validateInput(input);

  const initialHealth: [number, number] = [input.initialHealth, input.initialHealth];
  const initialMultiplierTenths: [number, number] = [10, 10];
  const health: [number, number] = [...initialHealth];
  const multiplierTenths: [number, number] = [...initialMultiplierTenths];
  let mutualMultiplierTenths = 10;
  let terminal: TieRangeTerminalOutcome | null = null;
  const rounds: TieRangeRoundOutput[] = [];

  for (const settled of input.rounds) {
    const healthBefore: [number, number] = [...health];
    const roundMultiplierTenths: [number, number] = [...multiplierTenths];
    const roundMutualMultiplierTenths = mutualMultiplierTenths;
    const bestScore = Math.max(settled.scores[0], settled.scores[1]);
    const band = mode === null ? 0 : tieRangeBand(bestScore, mode);
    const difference = Math.abs(settled.scores[0] - settled.scores[1]);
    const withinBand = difference <= band;
    const damageDealt: [number, number] = [0, 0];
    let winner: 0 | 1 | null = null;

    if (difference > 0) {
      winner = settled.scores[0] > settled.scores[1] ? 0 : 1;
      const loser = winner === 0 ? 1 : 0;
      const damage = roundHalfEven(difference, multiplierTenths[winner]);
      damageDealt[winner] = damage;
      health[loser] = Math.max(0, health[loser] - damage);
    }

    const knockout = health[0] === 0 || health[1] === 0;
    const roundLimit = input.maxRounds !== null && settled.round >= input.maxRounds;
    if (knockout || roundLimit) {
      terminal = {
        round: settled.round,
        winnerTeamId: health[0] === health[1]
          ? null
          : input.teamIds[health[0] > health[1] ? 0 : 1],
        isDraw: health[0] === health[1],
      };
    } else if (settled.round >= input.delay) {
      multiplierTenths[0] += input.mutual;
      multiplierTenths[1] += input.mutual;
      mutualMultiplierTenths += input.mutual;
      if (withinBand) {
        multiplierTenths[0] += input.individual;
        multiplierTenths[1] += input.individual;
      } else if (winner !== null) {
        multiplierTenths[winner] += input.individual;
      }
    }

    rounds.push({
      round: settled.round,
      scores: [...settled.scores],
      healthBefore,
      healthAfter: [...health],
      damageDealt,
      multiplierTenths: roundMultiplierTenths,
      nextMultiplierTenths: [...multiplierTenths],
      band,
      withinBand,
      mutualMultiplierTenths: roundMutualMultiplierTenths,
      nextMutualMultiplierTenths: mutualMultiplierTenths,
    });

    if (terminal !== null) break;
  }

  return {
    teamIds: [...input.teamIds],
    initialHealth,
    currentHealth: [...health],
    initialMultiplierTenths,
    currentMultiplierTenths: [...multiplierTenths],
    initialMutualMultiplierTenths: 10,
    currentMutualMultiplierTenths: mutualMultiplierTenths,
    rounds,
    terminal,
  };
}
