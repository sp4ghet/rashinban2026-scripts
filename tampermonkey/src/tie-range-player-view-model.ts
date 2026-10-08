import type {
  TieRangeBandMode,
  TieRangeRoundOutput,
} from '../../bundles/rashinban/src/presenter/tie-range-core.ts';
import type { PinpointingReason, PinpointingRoundOutput } from '../../bundles/rashinban/src/presenter/pinpointing-core.ts';
import type { PlayerTieRangeView } from './tie-range-player-controller.ts';
import type { PlayerGameContext } from './tie-range-player-state.ts';

export type PlayerTieRangeDisplayTeam = {
  teamId: string;
  label: string;
  side: 'blue' | 'red';
  health: number;
  maximumHealth: number;
  multiplierTenths: number;
  /** Pinpointing Duels only. */
  points?: number;
  firstTo?: number;
  matchPoint?: boolean;
};

export type PlayerTieRangeDisplayResult = {
  round: number;
  scores: [number, number];
  damageDealt: [number, number];
  usedMultiplierTenths: [number, number];
  nextMultiplierTenths: [number, number];
  band: number;
  withinBand: boolean;
  /** Pinpointing Duels only. */
  points?: [number, number];
  reason?: PinpointingReason;
};

export type PlayerTieRangeDisplayTerminal = {
  headline: string;
  detail: string;
  round: number | null;
};

export type PlayerTieRangeDisplay = {
  showHud: boolean;
  showDiagnostic: boolean;
  suppressNative: boolean;
  pinpointing: boolean;
  mode: TieRangeBandMode;
  modeLabel: string;
  appliesToNextDuel: boolean;
  teams: [PlayerTieRangeDisplayTeam, PlayerTieRangeDisplayTeam] | null;
  result: PlayerTieRangeDisplayResult | null;
  terminal: PlayerTieRangeDisplayTerminal | null;
  diagnostic: string | null;
};

function pair<T>(values: [T, T], order: [number, number]): [T, T] {
  return [values[order[0]], values[order[1]]];
}

function resultIsDisclosed(
  round: TieRangeRoundOutput | PinpointingRoundOutput,
  currentRoundNumber: number,
  nativeResultVisible: boolean,
): boolean {
  return nativeResultVisible || currentRoundNumber > round.round;
}

function terminalLabel(view: PlayerTieRangeView, order: [number, number]): string {
  const terminal = view.output?.terminal;
  if (!terminal || terminal.isDraw || terminal.winnerTeamId === null) return 'Draw';
  if (view.localTeamId !== null) return terminal.winnerTeamId === view.localTeamId ? 'You win' : 'You lose';
  const winningIndex = view.output?.teamIds.indexOf(terminal.winnerTeamId) ?? -1;
  if (winningIndex < 0) return 'Duel ended';
  return `${order.indexOf(winningIndex) === 0 ? 'Blue' : 'Red'} wins`;
}

function diagnosticText(view: PlayerTieRangeView): string | null {
  if (view.diagnostic && view.diagnostic.code !== 'source-ended') return view.diagnostic.message;
  if (view.message) return view.message;
  if (view.status === 'reconnecting') return 'Reconnecting';
  if (view.status === 'stale') return 'HP may be out of date';
  if (view.status === 'auth-error') return 'Sign in to refresh custom HP';
  if (view.status === 'unavailable') return 'Custom HP unavailable';
  return null;
}

export function playerRoundIdentity(context: PlayerGameContext, round: number): string | null {
  const startTime = context.roundStarts.find(start => start.round === round)?.startTime;
  return startTime === undefined ? null : JSON.stringify([context.gameId, round, startTime]);
}

export function playerDisclosureMustReset(
  previous: PlayerTieRangeView,
  next: PlayerTieRangeView,
): boolean {
  if (previous.gameId !== next.gameId || next.status === 'inactive' || next.status === 'off') return true;
  if (previous.context === null) return false;
  if (next.context === null) return true;
  if (next.context.currentRoundNumber < previous.context.currentRoundNumber
    || next.context.input.rounds.length < previous.context.input.rounds.length
    || next.context.roundStarts.length < previous.context.roundStarts.length) return true;
  return previous.context.roundStarts.some(previousStart => {
    const nextStart = next.context?.roundStarts.find(start => start.round === previousStart.round);
    return nextStart !== undefined && nextStart.startTime !== previousStart.startTime;
  });
}

function sideLabels(context: PlayerGameContext, localIndex: number): [string, string] {
  if (localIndex < 0) return ['Blue', 'Red'];
  return context.playerIds.some(team => team.length > 1) ? ['Your team', 'Opponents'] : ['You', 'Opponent'];
}

function modeLabel(mode: TieRangeBandMode, pinpointing = false): string {
  const tieRange = mode === 'full' ? 'Full tie-range' : mode === 'half' ? 'Half tie-range' : null;
  if (pinpointing) return tieRange ? `Pinpointing Duels · ${tieRange}` : 'Pinpointing Duels';
  return tieRange ?? 'Off';
}

function pointsHeadline(view: PlayerTieRangeView, order: [number, number], totals: [number, number]): string {
  const terminal = view.pinpointing?.terminal;
  if (!terminal || !view.pinpointing) return 'Duel ended';
  const winningIndex = view.pinpointing.teamIds.indexOf(terminal.winnerTeamId);
  const score = `${totals[order[0]]}–${totals[order[1]]}`;
  if (view.localTeamId !== null) return `${terminal.winnerTeamId === view.localTeamId ? 'You win' : 'You lose'} ${score}`;
  return `${winningIndex === 0 ? 'Blue' : 'Red'} wins ${score}`;
}

function derivePinpointingDisplay(
  view: PlayerTieRangeView,
  nativeResultVisible: boolean,
  revealedRoundIdentity: string | null,
): PlayerTieRangeDisplay {
  const context = view.context!;
  const points = view.pinpointing!;
  const localIndex = view.localTeamId === null ? -1 : points.teamIds.indexOf(view.localTeamId);
  const order: [number, number] = localIndex === 1 ? [1, 0] : [0, 1];
  const latest = points.rounds.at(-1) ?? null;
  const latestIdentity = latest ? playerRoundIdentity(context, latest.round) : null;
  const retainedDisclosure = latestIdentity !== null && latestIdentity === revealedRoundIdentity;
  const disclosed = latest === null || view.status === 'ended' || retainedDisclosure
    || resultIsDisclosed(latest, context.currentRoundNumber, nativeResultVisible);
  const totals: [number, number] = latest && !disclosed ? latest.totalsBefore : points.totals;
  const onMatchPoint = (total: number) => total >= points.firstTo - 2 && total < points.firstTo;
  const matchPoint: [boolean, boolean] = disclosed ? points.matchPoint : [onMatchPoint(totals[0]), onMatchPoint(totals[1])];
  const labels = sideLabels(context, localIndex);
  const teams = order.map((index, position) => ({
    teamId: points.teamIds[index],
    label: labels[position],
    side: index === 0 ? 'blue' : 'red',
    health: totals[index],
    maximumHealth: points.firstTo,
    multiplierTenths: 10,
    points: totals[index],
    firstTo: points.firstTo,
    matchPoint: matchPoint[index],
  })) as [PlayerTieRangeDisplayTeam, PlayerTieRangeDisplayTeam];
  const result: PlayerTieRangeDisplayResult | null = latest && nativeResultVisible ? {
    round: latest.round,
    scores: pair(latest.scores, order),
    damageDealt: [0, 0],
    usedMultiplierTenths: [10, 10],
    nextMultiplierTenths: [10, 10],
    band: latest.band,
    withinBand: latest.withinBand,
    points: pair(latest.points, order),
    reason: latest.reason,
  } : null;
  let terminal: PlayerTieRangeDisplayTerminal | null = null;
  const terminalIdentity = points.terminal ? playerRoundIdentity(context, points.terminal.round) : null;
  if (points.terminal && (view.status === 'ended'
    || (terminalIdentity !== null && terminalIdentity === revealedRoundIdentity)
    || context.currentRoundNumber > points.terminal.round
    || (nativeResultVisible && latest?.round === points.terminal.round))) {
    terminal = {
      headline: pointsHeadline(view, order, points.totals),
      detail: 'Custom duel finished — wait for the host',
      round: points.terminal.round,
    };
  } else if (view.status === 'ended') {
    terminal = { headline: 'Duel ended', detail: 'No custom winner was determined', round: null };
  }
  const diagnostic = diagnosticText(view);
  return {
    showHud: true,
    showDiagnostic: diagnostic !== null,
    suppressNative: true,
    pinpointing: true,
    mode: context.mode,
    modeLabel: modeLabel(context.mode, true),
    appliesToNextDuel: view.appliesToNextDuel,
    teams,
    result,
    terminal,
    diagnostic,
  };
}

export function derivePlayerTieRangeDisplay(
  view: PlayerTieRangeView,
  nativeResultVisible: boolean,
  revealedRoundIdentity: string | null = null,
): PlayerTieRangeDisplay {
  const mode = view.capturedMode ?? view.configuredMode;
  const pinpointing = view.capturedPinpointing ?? view.configuredPinpointing;
  const accountIsNotAPlayer = view.status === 'unavailable'
    && view.message === 'Current account is not a player in this duel';
  if (view.context !== null && view.pinpointing !== null && view.context.pinpointing && !accountIsNotAPlayer) {
    return derivePinpointingDisplay(view, nativeResultVisible, revealedRoundIdentity);
  }
  if (mode === 'off' || view.context === null || view.output === null || accountIsNotAPlayer) {
    const diagnostic = diagnosticText(view);
    return {
      showHud: false,
      showDiagnostic: (mode !== 'off' || pinpointing) && view.status !== 'inactive' && view.status !== 'waiting'
        && view.status !== 'loading' && diagnostic !== null,
      suppressNative: false,
      pinpointing,
      mode,
      modeLabel: modeLabel(view.configuredMode, view.configuredPinpointing),
      appliesToNextDuel: view.appliesToNextDuel,
      teams: null,
      result: null,
      terminal: null,
      diagnostic,
    };
  }

  const { context, output } = view;
  const localIndex = view.localTeamId === null ? -1 : output.teamIds.indexOf(view.localTeamId);
  const order: [number, number] = localIndex === 1 ? [1, 0] : [0, 1];
  const latest = output.rounds.at(-1) ?? null;
  const latestIdentity = latest ? playerRoundIdentity(context, latest.round) : null;
  const retainedDisclosure = latestIdentity !== null && latestIdentity === revealedRoundIdentity;
  const disclosed = latest === null || view.status === 'ended' || retainedDisclosure
    || resultIsDisclosed(latest, context.currentRoundNumber, nativeResultVisible);
  const health = latest && !disclosed ? latest.healthBefore : output.currentHealth;
  const multipliers = latest && !disclosed ? latest.multiplierTenths : output.currentMultiplierTenths;
  const labels = sideLabels(context, localIndex);
  const orderedHealth = pair(health, order);
  const orderedMaximum = pair(output.initialHealth, order);
  const orderedMultipliers = pair(multipliers, order);
  const teams: [PlayerTieRangeDisplayTeam, PlayerTieRangeDisplayTeam] = order.map((index, position) => ({
    teamId: output.teamIds[index],
    label: labels[position],
    side: index === 0 ? 'blue' : 'red',
    health: orderedHealth[position],
    maximumHealth: orderedMaximum[position],
    multiplierTenths: orderedMultipliers[position],
  })) as [PlayerTieRangeDisplayTeam, PlayerTieRangeDisplayTeam];

  const result: PlayerTieRangeDisplayResult | null = latest && nativeResultVisible ? {
    round: latest.round,
    scores: pair(latest.scores, order),
    damageDealt: pair(latest.damageDealt, order),
    usedMultiplierTenths: pair(latest.multiplierTenths, order),
    nextMultiplierTenths: pair(latest.nextMultiplierTenths, order),
    band: latest.band,
    withinBand: latest.withinBand,
  } : null;

  let terminal: PlayerTieRangeDisplayTerminal | null = null;
  const terminalIdentity = output.terminal
    ? playerRoundIdentity(context, output.terminal.round)
    : null;
  if (output.terminal && (view.status === 'ended'
    || (terminalIdentity !== null && terminalIdentity === revealedRoundIdentity)
    || context.currentRoundNumber > output.terminal.round
    || (nativeResultVisible && latest?.round === output.terminal.round))) {
    terminal = {
      headline: terminalLabel(view, order),
      detail: 'Custom duel finished — wait for the host',
      round: output.terminal.round,
    };
  } else if (view.status === 'ended') {
    terminal = {
      headline: 'Duel ended',
      detail: 'No custom winner was determined',
      round: null,
    };
  }

  const diagnostic = diagnosticText(view);
  return {
    showHud: true,
    showDiagnostic: diagnostic !== null,
    suppressNative: true,
    pinpointing: false,
    mode,
    modeLabel: modeLabel(mode),
    appliesToNextDuel: view.appliesToNextDuel,
    teams,
    result,
    terminal,
    diagnostic,
  };
}
