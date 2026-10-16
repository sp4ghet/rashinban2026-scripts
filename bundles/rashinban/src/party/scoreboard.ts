import type { PresenterSettings } from '../presenter/settings.ts';
import type { ConfiguredRules, RuleContexts } from '../presenter/tie-range-context.ts';
import { pinpointingWarning } from '../presenter/pinpointing.ts';
import type { DuelState } from '../types/presenter.ts';
import type { PresenterConnection } from '../types/replicants.ts';
import type { PartyStatus } from './types.ts';

export type ScoreboardInput = {
  status: PartyStatus; presenter: DuelState | null; settings: PresenterSettings | null;
  contexts: RuleContexts | null; connection: PresenterConnection | null;
};
export type ScoreTeam = {
  id: string; name: string; color: 'blue' | 'red'; amount: number | null; unit: 'HP' | 'points';
  target: number | null; multiplier: number | null; matchPoint: boolean; winner: boolean;
  guessed: number | null; players: number; helpRequested: boolean;
};
export type PartyScoreboard = {
  source: 'native' | 'presenter' | 'unavailable' | 'none'; rules: string; nextRules: string | null;
  teams: ScoreTeam[]; warning: string | null; result: string | null; lastRound: string | null;
};

function ruleLabel(rules: ConfiguredRules): string {
  return `${rules.pinpointing ? 'Pinpointing · first to 7' : 'Health duel'}${rules.mode === 'off' ? '' : ` · Tie range ${rules.mode === 'full' ? 'Full' : 'Half'}`}`;
}

/** Display the presenter's settled totals; never recalculate rules or use animated graphic values. */
export function buildPartyScoreboard({ status, presenter, settings, contexts, connection }: ScoreboardInput): PartyScoreboard {
  const name = (id: string) => status.members.find(member => member.userId === id)?.nick || id;
  const teams: ScoreTeam[] = (status.duel?.teams ?? []).map(team => ({
    id: team.id, name: team.players.map(player => name(player.id)).join(' / '),
    color: team.name === 'red' ? 'red' : 'blue', amount: team.health, unit: 'HP', target: null, multiplier: team.multiplier,
    matchPoint: false, winner: false, guessed: team.players.filter(player => player.guessed).length, players: team.players.length,
    helpRequested: team.players.some(player => player.helpRequested),
  }));
  const configured: ConfiguredRules = { mode: settings?.tieRange.enabled ? settings.tieRange.mode : 'off', pinpointing: settings?.pinpointing.enabled ?? false };
  const board: PartyScoreboard = { source: status.duel ? 'native' : 'none', rules: 'GeoGuessr health', nextRules: null, teams, warning: null, result: null, lastRound: null };
  if (!status.party || status.state === 'replay') {
    return { ...board, source: 'none', teams: [], rules: `Next duel: ${ruleLabel(configured)}` };
  }
  if (status.party.gameType !== 'Duels') {
    board.warning = 'The broadcast presenter supports custom scoring for 1v1 only. Team Duels shows GeoGuessr health.';
    return board;
  }
  const terminal = presenter?.status === 'Finished' || presenter?.aborted;
  const sameParty = connection?.input === 'live' && connection.partyId === status.party.partyId
    && (connection.controlGeneration ?? 'initial') === status.sourceGeneration;
  // The presenter retains a terminal result after GeoGuessr clears the aborted lobby.
  const gameId = status.duel?.gameId ?? status.party.lobbyId
    ?? (sameParty && terminal && presenter!.partyId === status.party.partyId ? presenter!.gameId : null);
  const context = contexts?.live?.source.gameId === gameId ? contexts.live : null;
  const captured: ConfiguredRules | null = presenter?.gameId === gameId
    ? { mode: presenter.tieRange?.mode ?? 'off', pinpointing: !!presenter.pinpointing } : null;
  const rules = context ?? captured ?? configured;
  board.rules = gameId ? `Active duel: ${ruleLabel(rules)}` : `Next duel: ${ruleLabel(configured)}`;
  if (context && (context.mode !== configured.mode || context.pinpointing !== configured.pinpointing)) board.nextRules = `Next duel: ${ruleLabel(configured)}`;
  if (!gameId) return board;
  const custom = rules.pinpointing || rules.mode !== 'off';
  if (!custom) { board.rules = context ? `Active duel: ${ruleLabel(rules)} · GeoGuessr HP` : 'GeoGuessr health'; return board; }

  if (!teams.length && context) {
    for (const player of context.source.players) teams.push({ id: player.teamId, name: name(player.id), color: player.teamColor,
      amount: null, unit: 'HP', target: null, multiplier: null, matchPoint: false, winner: false, guessed: null, players: 1, helpRequested: false });
  }
  const rollbackPending = context && status.duel && status.duel.version > context.source.version
    && (status.duel.round < context.source.round || !status.duel.resolved
      && context.source.players.some(player => player.results.some(result => result.round === status.duel!.round)));
  const matching = !rollbackPending && sameParty && context && presenter?.gameId === gameId && presenter.version === context.source.version
    && (presenter.partyId === undefined || presenter.partyId === status.party.partyId)
    && (context.source.partyId === undefined || context.source.partyId === status.party.partyId)
    && (connection.gameId === gameId || !status.duel && connection.gameId === null && terminal)
    && (presenter.tieRange?.mode ?? 'off') === rules.mode && !!presenter.pinpointing === rules.pinpointing
    && teams.length === 2 && teams.every(team => {
      const members = status.duel?.teams.find(candidate => candidate.id === team.id)?.players;
      return presenter.players.some(player => player.teamId === team.id && (!members || members.length === 1 && members[0].id === player.id));
    });
  if (!matching) {
    board.source = 'unavailable';
    board.warning = connection?.warnings.find(warning => /calculation unavailable/i.test(warning))
      ?? 'Waiting for presenter scores for this duel. Custom scores are unavailable until the live presenter and party agree.';
    board.teams = teams.map(team => ({ ...team, amount: null, multiplier: null, unit: rules.pinpointing ? 'points' : 'HP', target: rules.pinpointing ? 7 : null }));
    return board;
  }
  board.source = 'presenter';
  for (const team of teams) {
    const player = presenter.players.find(player => player.teamId === team.id)!;
    const points = presenter.pinpointing;
    const index = points?.teamIds.indexOf(team.id) ?? -1;
    team.amount = points ? points.totals[index] ?? null : player.health;
    team.unit = points ? 'points' : 'HP'; team.target = points?.firstTo ?? null;
    team.multiplier = points ? null : player.multiplier;
    team.matchPoint = points?.matchPoint[index] ?? false;
    team.winner = !presenter.aborted && presenter.status === 'Finished' && presenter.winnerTeamId === team.id;
  }
  const winner = teams.find(team => team.winner);
  board.result = presenter.aborted ? 'Duel aborted' : winner ? `${winner.name} wins` : presenter.isDraw ? 'Draw' : null;
  const lastPoints = presenter.pinpointing?.rounds.at(-1);
  if (lastPoints) {
    const winnerId = lastPoints.winner === null ? null : presenter.pinpointing!.teamIds[lastPoints.winner];
    const scorer = teams.find(team => team.id === winnerId);
    const reason = { 'solo-5k': 'SOLO 5K', 'fastest-5k': 'FASTEST 5K', closest: 'CLOSEST', tie: 'TIE' }[lastPoints.reason];
    board.lastRound = `Round ${lastPoints.round} · ${scorer && lastPoints.winner !== null ? `${scorer.name} +${lastPoints.points[lastPoints.winner]} · ${reason}`
      : lastPoints.fiveKs === 2 ? 'DOUBLE 5K · NO POINT' : 'TIE · NO POINT'}`;
  } else {
    const last = presenter.tieRange?.rounds.at(-1);
    if (last) board.lastRound = `Round ${last.round} · ${last.withinBand ? 'Inside' : 'Outside'} tie range · Band ${last.band}`;
  }
  if (presenter.status === 'Finished' && status.duel?.status === 'Ongoing') {
    board.warning = 'The presenter has finished this duel; GeoGuessr is still running. Abort the GeoGuessr duel when ready to return to the lobby.';
  } else board.warning = pinpointingWarning(presenter);
  if (!board.warning && connection.state !== 'live' && !terminal) board.warning = 'Presenter connection is not live. Showing its last confirmed scores.';
  return board;
}
