import type { Point, Views } from '../types/presenter.ts';
import type { ScoreboardInput } from './scoreboard.ts';
import { roundHalfEven } from '../presenter/tie-range-core.ts';
import { foldPinpointing } from '../presenter/pinpointing-core.ts';

export type PredictionInput = ScoreboardInput & { views: Views | null; nowMs: number };
export type PredictedPlayer = {
  id: string; teamId: string; color: 'blue' | 'red'; score: number | null; locked: boolean;
  before: number; after: number | null; change: number | null; outcome: 'win' | 'loss' | 'draw' | 'continues' | null;
};
export type RoundPrediction = {
  state: 'inactive' | 'waiting' | 'unavailable' | 'ready'; round: number | null; message: string;
  ending: boolean | null; unit: 'HP' | 'points'; players: PredictedPlayer[];
};
function validPoint(value: Point | null | undefined): value is Point {
  return !!value && Number.isFinite(value.lat) && Math.abs(value.lat) <= 90 && Number.isFinite(value.lng) && Math.abs(value.lng) <= 180;
}
const validScore = (value: number) => Number.isInteger(value) && value >= 0 && value <= 5000;
const radians = (value: number) => value * Math.PI / 180;

/** Unsubmitted pin estimate; locked guesses always use GeoGuessr's supplied score. */
export function scoreAtPin(answer: Point, pin: Point, maxErrorDistance: number | null | undefined): number | null {
  if (!validPoint(answer) || !validPoint(pin) || typeof maxErrorDistance !== 'number' || !Number.isFinite(maxErrorDistance) || maxErrorDistance <= 0) return null;
  const a = Math.sin(radians(pin.lat - answer.lat) / 2) ** 2
    + Math.cos(radians(answer.lat)) * Math.cos(radians(pin.lat)) * Math.sin(radians(pin.lng - answer.lng) / 2) ** 2;
  const distance = 2 * 6_371_000 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, a))));
  return distance < 25 ? 5000 : Math.round(5000 * Math.exp(-10 * distance / maxErrorDistance));
}

/** Operator-only forecast. Never modify source pins, settled scores, or game state. */
export function predictRound({ status, presenter, contexts, connection, views, nowMs }: PredictionInput): RoundPrediction {
  const result: RoundPrediction = { state: 'inactive', round: status.duel?.round ?? null, message: '', ending: null, unit: 'HP', players: [] };
  const native = status.duel, party = status.party, context = contexts?.live, source = context?.source;
  if (!native || !party || party.gameState !== 'Ongoing' || native.status !== 'Ongoing' || native.resolved || status.state === 'replay') return result;
  result.state = 'unavailable'; result.message = 'Waiting for matching live presenter data.';
  const fresh = (at: number | null | undefined) => at != null && Number.isFinite(at) && nowMs >= at - 5000 && nowMs - at < 15000;
  if (party.gameType !== 'Duels') { result.message = 'Round prediction supports 1v1 Duels.'; return result; }
  if (status.state !== 'ready' || !fresh(status.updatedAtMs) || !connection || connection.input !== 'live' || connection.state !== 'live'
    || !fresh(connection.lastUpdateMs) || connection.partyId !== party.partyId || connection.gameId !== native.gameId
    || (connection.controlGeneration ?? 'initial') !== status.sourceGeneration
    || !source || !context || !presenter || source.gameId !== native.gameId || presenter.gameId !== native.gameId
    || source.partyId !== party.partyId || presenter.partyId !== party.partyId || native.partyId !== party.partyId
    || source.round !== native.round || presenter.round !== source.round || presenter.version !== source.version || native.version > source.version
    || (presenter.tieRange?.mode ?? 'off') !== context.mode || !!presenter.pinpointing !== context.pinpointing
    || native.teams.length !== 2 || !source.players.every(p => native.teams.some(t => t.id === p.teamId && t.players.length === 1 && t.players[0].id === p.id)
      && presenter.players.some(other => other.id === p.id && other.teamId === p.teamId))) return result;
  if (source.status !== 'Ongoing' || presenter.status !== 'Ongoing' || source.aborted || presenter.aborted
    || source.players.some(p => p.results.some(r => r.round >= source.round)) || presenter.players.some(p => p.results.some(r => r.round >= source.round))) {
    return { ...result, state: 'inactive', message: '' };
  }
  const round = source.rounds.find(r => r.number === source.round);
  if (!round || round.startAtMs === null || round.startAtMs > nowMs) return { ...result, state: 'inactive', message: '' };
  if (!source.paused && round.endAtMs !== null && round.endAtMs <= nowMs) {
    result.message = 'Round time ended — waiting for the result.'; return result;
  }
  if (!context.pinpointing && context.mode === 'off' && party.gameSettings.disableHealing !== true) {
    result.message = 'Health prediction is unavailable while healing is enabled.'; return result;
  }
  result.unit = context.pinpointing ? 'points' : 'HP';
  const guesses = source.players.map(p => p.guesses.filter(g => g.round === source.round));
  const activeViews = views?.gameId === source.gameId && views.round === source.round ? views : null;
  let missingScale = false, invalidGuess = false;
  result.players = source.players.map((player, index) => {
    const current = presenter.players.find(p => p.id === player.id)!;
    const guess = guesses[index][0];
    const view = activeViews?.players[player.id];
    const pinAt = Math.max(view?.lastByType.PinPosition ?? -Infinity, view?.lastByType.GuessWithLatLng ?? -Infinity);
    const pin = view && pinAt >= round.startAtMs! && pinAt <= nowMs + 5000 ? view.pin : player.pin;
    const score = guess ? validPoint(guess) && validScore(guess.score) && guesses[index].length === 1 ? guess.score : null
      : validPoint(pin) ? scoreAtPin(round.panorama, pin, source.ruleOptions?.maxErrorDistance) : null;
    missingScale ||= !guess && validPoint(pin) && score === null;
    invalidGuess ||= !!guess && score === null;
    const before = presenter.pinpointing ? presenter.pinpointing.totals[presenter.pinpointing.teamIds.indexOf(player.teamId)] : current.health;
    return { id: player.id, teamId: player.teamId, color: player.teamColor, score, locked: !!guess,
      before, after: null, change: null, outcome: null };
  });
  if (result.players.some(p => !Number.isFinite(p.before) || p.before < 0)) {
    result.players = []; result.message = 'Current scores are unavailable.'; return result;
  }
  if (result.players.some(p => p.score === null)) {
    result.state = missingScale || invalidGuess ? 'unavailable' : 'waiting';
    result.message = invalidGuess ? 'Waiting for valid current-round guesses.' : missingScale ? 'Map scoring scale is unavailable for a pin estimate.' : 'Waiting for both players to place a pin.';
    return result;
  }
  const [blue, red] = result.players;
  const limit = typeof source.maxRounds === 'number' && source.maxRounds > 0 && source.round >= source.maxRounds;
  let winner: string | null = null;
  if (context.pinpointing) {
    const points = presenter.pinpointing!;
    if (blue.score === 5000 && red.score === 5000 && (!blue.locked || !red.locked)) {
      result.state = 'waiting'; result.message = 'Double 5K — waiting for confirmed guess order.'; return result;
    }
    try {
      const ordered = points.teamIds.map(id => result.players.find(p => p.teamId === id)!);
      if (points.rounds.length !== source.round - 1 || points.terminal) return result;
      const times = ordered.map(p => {
        const guess = source.players.find(player => player.id === p.id)!.guesses.find(g => g.round === source.round);
        return guess && Number.isFinite(guess.createdAtMs) && guess.createdAtMs >= round.startAtMs! && round.endAtMs !== null && guess.createdAtMs < round.endAtMs
          ? guess.createdAtMs : null;
      }) as [number | null, number | null];
      const folded = foldPinpointing({ teamIds: points.teamIds, tieRange: context.mode,
        rounds: [...points.rounds, { round: source.round, scores: ordered.map(p => p.score!) as [number, number], guessedAtMs: times }] });
      const projected = folded.rounds.at(-1)!;
      if (ordered.some((p, index) => p.before !== projected.totalsBefore[index])) return result;
      for (const player of result.players) player.after = folded.totals[folded.teamIds.indexOf(player.teamId)];
      winner = folded.terminal?.winnerTeamId ?? null;
      result.ending = !!winner;
      if (limit && !winner) {
        result.message = 'GeoGuessr round limit reached without a Pinpointing winner.';
        result.ending = null;
      }
    } catch { return result; }
  } else {
    const multipliers = source.players.map(p => presenter.players.find(other => other.id === p.id)!.multiplier * 10);
    if (multipliers.some(m => !Number.isFinite(m) || m < 10 || Math.abs(m - Math.round(m)) > 1e-7)) return result;
    blue.after = blue.before; red.after = red.before;
    const difference = Math.abs(blue.score! - red.score!);
    if (difference > 0) {
      const winningIndex = blue.score! > red.score! ? 0 : 1, losingIndex = 1 - winningIndex;
      result.players[losingIndex].after = Math.max(0, result.players[losingIndex].before - roundHalfEven(difference, Math.round(multipliers[winningIndex])));
    }
    result.ending = blue.after === 0 || red.after === 0 || limit;
    if (result.ending && blue.after !== red.after) winner = blue.after! > red.after! ? blue.teamId : red.teamId;
  }
  for (const player of result.players) {
    player.change = player.after === null ? null : player.after - player.before;
    player.outcome = result.ending === null ? null : !result.ending ? 'continues' : winner === null ? 'draw' : winner === player.teamId ? 'win' : 'loss';
  }
  result.state = 'ready';
  if (result.ending !== null) result.message = result.ending
    ? winner ? 'Duel would end this round if these pins hold.' : 'Duel would end in a draw at the round limit.'
    : 'Duel would continue if these pins hold.';
  return result;
}
