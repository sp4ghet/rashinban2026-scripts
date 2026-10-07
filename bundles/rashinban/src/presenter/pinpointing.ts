import type { DuelPlayer, DuelState, TieRangeMode, TieRangeRound } from '../types/presenter.ts';
import { foldPinpointing, type PinpointingInput, type PinpointingSettledRound } from './pinpointing-core.ts';
import { validatedCompletedRounds } from './tie-range.ts';

/** Server time of the player's first guess made before the round deadline; timeout guesses do not count. */
function guessedAtMs(player: DuelPlayer, round: number, endAtMs: number): number | null {
  const times = player.guesses
    .filter(guess => guess.round === round && Number.isFinite(guess.createdAtMs) && guess.createdAtMs < endAtMs)
    .map(guess => guess.createdAtMs);
  return times.length ? Math.min(...times) : null;
}

/** Derive Pinpointing Duels points from settled rounds; the server's HP is left untouched. */
export function derivePinpointing(state: DuelState, mode: TieRangeMode): DuelState {
  const input: PinpointingInput = {
    teamIds: [state.players[0].teamId, state.players[1].teamId],
    tieRange: mode,
    rounds: [] as PinpointingSettledRound[],
  };
  let folded = foldPinpointing(input);
  for (const [blue, red] of validatedCompletedRounds(state)) {
    const round = state.rounds.find(candidate => candidate.number === blue.round)!;
    if (round.endAtMs === null) throw new Error(`Pinpointing round ${blue.round} has no deadline`);
    input.rounds.push({
      round: blue.round,
      scores: [blue.score, red.score],
      guessedAtMs: [guessedAtMs(state.players[0], blue.round, round.endAtMs), guessedAtMs(state.players[1], blue.round, round.endAtMs)],
    });
    folded = foldPinpointing(input);
    if (folded.terminal !== null) break;
  }

  const derived = structuredClone(state);
  derived.pinpointing = folded;
  if (mode !== 'off') {
    const metadata: TieRangeRound[] = folded.rounds.map(round => ({ round: round.round, band: round.band, withinBand: round.withinBand }));
    derived.tieRange = { mode, rounds: metadata };
  }

  if (folded.terminal !== null) {
    const terminalRound = folded.terminal.round;
    derived.round = terminalRound;
    derived.status = 'Finished';
    derived.aborted = false;
    derived.winnerTeamId = folded.terminal.winnerTeamId;
    derived.isDraw = false;
    derived.rounds = derived.rounds.filter(round => round.number <= terminalRound);
    for (const player of derived.players) {
      player.pin = null;
      player.guesses = player.guesses.filter(guess => guess.round <= terminalRound);
      player.results = player.results.filter(result => result.round <= terminalRound);
    }
  } else if (state.status === 'Finished' && !state.aborted) {
    // The server ended its health duel first; nobody reached the point target.
    derived.winnerTeamId = null;
    derived.isDraw = false;
  }
  return derived;
}

/** Warning text for a server finish that pre-empted the point target, else null. */
export function pinpointingWarning(derived: DuelState): string | null {
  return derived.pinpointing && derived.status === 'Finished' && !derived.aborted && derived.pinpointing.terminal === null
    ? `Server duel finished before a player reached ${derived.pinpointing.firstTo} points.` : null;
}
