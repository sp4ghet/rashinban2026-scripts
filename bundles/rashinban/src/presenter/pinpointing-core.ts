import { tieRangeBand, type TieRangeBandMode } from './tie-range-core.ts';

/** Points needed to win a Pinpointing Duel (RASHINBAN 2026 rulebook). */
export const FIRST_TO = 7;

export type PinpointingReason = 'fastest-5k' | 'solo-5k' | 'closest' | 'tie';

export type PinpointingSettledRound = {
  round: number;
  scores: [number, number];
  /** Server time of each side's first deliberate guess (before the round deadline), or null. */
  guessedAtMs: [number | null, number | null];
};

export type PinpointingInput = {
  teamIds: [string, string];
  tieRange: TieRangeBandMode;
  rounds: PinpointingSettledRound[];
};

export type PinpointingRoundOutput = PinpointingSettledRound & {
  points: [number, number];
  totalsBefore: [number, number];
  totalsAfter: [number, number];
  winner: 0 | 1 | null;
  reason: PinpointingReason;
  band: number;
  withinBand: boolean;
  fiveKs: 0 | 1 | 2;
};

export type PinpointingTerminalOutcome = { round: number; winnerTeamId: string };

export type PinpointingOutput = {
  teamIds: [string, string];
  firstTo: number;
  tieRange: TieRangeBandMode;
  rounds: PinpointingRoundOutput[];
  totals: [number, number];
  matchPoint: [boolean, boolean];
  terminal: PinpointingTerminalOutcome | null;
};

function validateInput(input: PinpointingInput): void {
  if (!Array.isArray(input.teamIds) || input.teamIds.length !== 2
    || input.teamIds.some(teamId => typeof teamId !== 'string') || input.teamIds[0] === input.teamIds[1]) {
    throw new Error('Pinpointing team IDs are invalid');
  }
  if (input.tieRange !== 'off' && input.tieRange !== 'full' && input.tieRange !== 'half') {
    throw new Error('Pinpointing tie range mode is invalid');
  }
  if (!Array.isArray(input.rounds)) throw new Error('Pinpointing result history is invalid');
  for (let index = 0; index < input.rounds.length; index += 1) {
    const settled = input.rounds[index];
    const expectedRound = index + 1;
    if (!settled || !Number.isInteger(settled.round) || settled.round < 1) {
      throw new Error(`Invalid pinpointing result history at round ${expectedRound}`);
    }
    if (settled.round !== expectedRound) {
      throw new Error(`Pinpointing result history has a gap at round ${expectedRound}`);
    }
    if (!Array.isArray(settled.scores) || settled.scores.length !== 2
      || settled.scores.some(score => !Number.isInteger(score) || score < 0 || score > 5000)) {
      throw new Error(`Invalid pinpointing score at round ${settled.round}`);
    }
    if (!Array.isArray(settled.guessedAtMs) || settled.guessedAtMs.length !== 2
      || settled.guessedAtMs.some(at => at !== null && !Number.isFinite(at))) {
      throw new Error(`Invalid pinpointing guess time at round ${settled.round}`);
    }
  }
}

/** Fold settled rounds into points; stops after the round that reaches FIRST_TO. */
export function foldPinpointing(input: PinpointingInput): PinpointingOutput {
  validateInput(input);
  const totals: [number, number] = [0, 0];
  const rounds: PinpointingRoundOutput[] = [];
  let terminal: PinpointingTerminalOutcome | null = null;

  for (const settled of input.rounds) {
    const [blue, red] = settled.scores;
    const fiveKs = (Number(blue === 5000) + Number(red === 5000)) as 0 | 1 | 2;
    const points: [number, number] = [0, 0];
    let winner: 0 | 1 | null = null;
    let reason: PinpointingReason;
    let band = 0;
    if (fiveKs === 2) {
      reason = 'fastest-5k';
      const [blueAt, redAt] = settled.guessedAtMs;
      if (blueAt !== null && redAt !== null && blueAt !== redAt) winner = blueAt < redAt ? 0 : 1;
      if (winner !== null) points[winner] = 1;
    } else if (fiveKs === 1) {
      reason = 'solo-5k';
      winner = blue === 5000 ? 0 : 1;
      points[winner] = 2;
    } else {
      band = tieRangeBand(Math.max(blue, red), input.tieRange);
      if (Math.abs(blue - red) > band) {
        reason = 'closest';
        winner = blue > red ? 0 : 1;
        points[winner] = 1;
      } else {
        reason = 'tie';
      }
    }
    const totalsBefore: [number, number] = [...totals];
    totals[0] += points[0];
    totals[1] += points[1];
    rounds.push({
      round: settled.round,
      scores: [...settled.scores],
      guessedAtMs: [...settled.guessedAtMs],
      points,
      totalsBefore,
      totalsAfter: [...totals],
      winner,
      reason,
      band,
      withinBand: winner === null && fiveKs === 0,
      fiveKs,
    });
    if (totals[0] >= FIRST_TO || totals[1] >= FIRST_TO) {
      terminal = { round: settled.round, winnerTeamId: input.teamIds[totals[0] >= FIRST_TO ? 0 : 1] };
      break;
    }
  }

  return {
    teamIds: [...input.teamIds],
    firstTo: FIRST_TO,
    tieRange: input.tieRange,
    rounds,
    totals: [...totals],
    // A solo 5K scores 2, so 5 can finish; a side that has already won is not "on match point".
    matchPoint: [totals[0] >= FIRST_TO - 2 && totals[0] < FIRST_TO, totals[1] >= FIRST_TO - 2 && totals[1] < FIRST_TO],
    terminal,
  };
}
