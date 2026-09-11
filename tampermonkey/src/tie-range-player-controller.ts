import type { TieRangeBandMode, TieRangeOutput } from '../../bundles/rashinban/src/presenter/tie-range-core.ts';
import {
  acceptPlayerSnapshot,
  loadPlayerContext,
  parsePlayerPageRoute,
  savePlayerContext,
  type PlayerDiagnostic,
  type PlayerGameContext,
  type PlayerPageRoute,
  type PlayerTieRangeStorage,
} from './tie-range-player-state.ts';

const DUEL_API = 'https://game-server.geoguessr.com/api/duels/';
const ACTIVE_PARTY_API = '/api/v4/parties/v2/active';
const PHONEBOOK_API = '/api/v4/game-server/phonebook/';
const LIVE_GAME_ORIGIN = 'https://gs2.geoguessr.com';
const SUCCESS_POLL_MS = 2500;
const REQUEST_TIMEOUT_MS = 8000;
const STALE_MS = 10000;
const MAX_BACKOFF_MS = 30000;
const NO_CONTENT = Symbol('no-content');

export type PlayerFetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type PlayerFetch = (
  url: string,
  init: { method: 'GET'; credentials: 'include'; signal: AbortSignal },
) => Promise<PlayerFetchResponse>;

export type PlayerTieRangeViewStatus =
  | 'inactive'
  | 'waiting'
  | 'loading'
  | 'off'
  | 'ready'
  | 'ended'
  | 'reconnecting'
  | 'stale'
  | 'auth-error'
  | 'unavailable';

export type PlayerTieRangeView = {
  status: PlayerTieRangeViewStatus;
  gameId: string | null;
  configuredMode: TieRangeBandMode;
  capturedMode: TieRangeBandMode | null;
  appliesToNextDuel: boolean;
  localTeamId: string | null;
  context: PlayerGameContext | null;
  output: TieRangeOutput | null;
  diagnostic: PlayerDiagnostic | null;
  message: string | null;
};

export type PlayerTieRangeControllerDependencies = {
  fetch: PlayerFetch;
  storage: PlayerTieRangeStorage;
  now(): number;
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
  getPath(): string;
  getUserId(): string | null;
  getConfiguredMode(): TieRangeBandMode;
  onView(view: PlayerTieRangeView): void;
};

export type PlayerTieRangeController = {
  start(): void;
  refresh(): void;
  routeChanged(): void;
  dispose(): void;
};

class HttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Player API returned HTTP ${status}`);
    this.status = status;
  }
}

type GameEndpoint = {
  gameId: string;
  kind: 'active' | 'archive';
  url: string;
};

function validPathId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value);
}

function readPhonebook(raw: unknown, gameId: string): GameEndpoint {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Game-server phonebook response is invalid');
  }
  const value = raw as Record<string, unknown>;
  if (value.gameId !== gameId) throw new Error('Game-server phonebook returned another game');
  if (value.status === 'Active') {
    if (!validPathId(value.gameServerNodeId)) throw new Error('Active game-server node ID is invalid');
    return {
      gameId,
      kind: 'active',
      url: `${LIVE_GAME_ORIGIN}/${value.gameServerNodeId}/${gameId}`,
    };
  }
  if (value.status === 'Inactive' || value.status === 'Archived') {
    return { gameId, kind: 'archive', url: `${DUEL_API}${encodeURIComponent(gameId)}` };
  }
  throw new Error('Game-server phonebook status is unavailable');
}

function routeKey(route: PlayerPageRoute): string {
  return route.kind === 'duel' ? `duel:${route.gameId}` : `party-lobby:${route.partyCode ?? ''}`;
}

function readActiveParty(raw: unknown): {
  gameId: string | null;
  partyId: string | null;
  waiting: boolean;
  gameMaster: boolean;
} {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Active party response is invalid');
  }
  const value = raw as Record<string, unknown>;
  const partyId = value.partyId === undefined ? null : value.partyId;
  if (partyId !== null && !validPathId(partyId)) throw new Error('Active party ID is invalid');
  if (value.gameState === 'NoGame') {
    return { gameId: null, partyId, waiting: true, gameMaster: false };
  }
  if (value.gameState !== 'Ongoing' && value.gameState !== 'Finished') {
    throw new Error('Active party game state is unsupported');
  }
  if (value.gameType !== 'Duels' && value.gameType !== 'TeamDuels') {
    throw new Error('Active party game type is unsupported');
  }
  if (typeof value.lobbyId !== 'string' || value.lobbyId.length === 0) {
    throw new Error('Active party lobby ID is missing');
  }
  if (!validPathId(value.lobbyId)) throw new Error('Active party lobby ID is invalid');
  const owner = typeof value.owner === 'object' && value.owner !== null
    ? value.owner as Record<string, unknown>
    : null;
  const settings = typeof value.partySettings === 'object' && value.partySettings !== null
    ? value.partySettings as Record<string, unknown>
    : null;
  return {
    gameId: value.lobbyId,
    partyId,
    waiting: false,
    gameMaster: settings?.masterControl === true && typeof owner?.userId === 'string',
  };
}

export function createPlayerTieRangeController(
  dependencies: PlayerTieRangeControllerDependencies,
): PlayerTieRangeController {
  let started = false;
  let generation = 0;
  let currentRoute: PlayerPageRoute | null = null;
  let currentRouteKey: string | null = null;
  let gameId: string | null = null;
  let context: PlayerGameContext | null = null;
  let output: TieRangeOutput | null = null;
  let diagnostic: PlayerDiagnostic | null = null;
  let schemaBlocked = false;
  let request: AbortController | null = null;
  let requestTimeout: { controller: AbortController; handle: unknown } | null = null;
  let wakeTimer: unknown = null;
  let pollToken: symbol | null = null;
  let failureCount = 0;
  let lastAcceptedAt: number | null = null;
  let nextAttemptAt: number | null = null;
  let problem: 'network' | 'auth' | null = null;
  let gameEndpoint: GameEndpoint | null = null;
  let currentPartyId: string | null = null;

  function configuredMode(): TieRangeBandMode {
    return dependencies.getConfiguredMode();
  }

  function localTeamId(): string | null {
    const userId = dependencies.getUserId();
    if (!context || !userId) return null;
    const index = context.playerIds.indexOf(userId);
    return index < 0 ? null : context.teamIds[index];
  }

  function publish(status: PlayerTieRangeViewStatus, message: string | null = null): void {
    const configured = configuredMode();
    const userId = dependencies.getUserId();
    const playerIsKnownOutsideGame = context !== null
      && context.mode !== 'off'
      && typeof userId === 'string'
      && userId.length > 0
      && localTeamId() === null;
    dependencies.onView({
      status: playerIsKnownOutsideGame ? 'unavailable' : status,
      gameId,
      configuredMode: configured,
      capturedMode: context?.mode ?? null,
      appliesToNextDuel: context !== null && context.mode !== configured,
      localTeamId: localTeamId(),
      context,
      output,
      diagnostic,
      message: playerIsKnownOutsideGame ? 'Current account is not a player in this duel' : message,
    });
  }

  function clearWake(): void {
    if (wakeTimer !== null) dependencies.clearTimeout(wakeTimer);
    wakeTimer = null;
  }

  function clearRequestTimeout(controller?: AbortController): void {
    if (requestTimeout === null || (controller && requestTimeout.controller !== controller)) return;
    dependencies.clearTimeout(requestTimeout.handle);
    requestTimeout = null;
  }

  function abortRequest(): void {
    const active = request;
    if (!active) return;
    clearRequestTimeout(active);
    active.abort();
    if (request === active) request = null;
  }

  function resetPolling(): void {
    clearWake();
    abortRequest();
    pollToken = null;
    failureCount = 0;
    lastAcceptedAt = null;
    nextAttemptAt = null;
    problem = null;
    gameEndpoint = null;
    currentPartyId = null;
  }

  function publishProblem(): void {
    if (problem === 'auth') {
      publish('auth-error', 'Sign in to GeoGuessr to refresh custom HP');
      return;
    }
    if (lastAcceptedAt !== null && dependencies.now() - lastAcceptedAt >= STALE_MS) {
      publish('stale', 'HP may be out of date');
      return;
    }
    publish('reconnecting', 'Reconnecting');
  }

  function scheduleWake(): void {
    clearWake();
    if (!started || currentRoute === null || nextAttemptAt === null) return;
    const now = dependencies.now();
    let at = nextAttemptAt;
    if (problem !== null && lastAcceptedAt !== null && now < lastAcceptedAt + STALE_MS) {
      at = Math.min(at, lastAcceptedAt + STALE_MS);
    }
    wakeTimer = dependencies.setTimeout(() => {
      wakeTimer = null;
      if (!started || currentRoute === null) return;
      const currentNow = dependencies.now();
      if (problem !== null && lastAcceptedAt !== null && currentNow >= lastAcceptedAt + STALE_MS) {
        publishProblem();
      }
      if (nextAttemptAt !== null && currentNow >= nextAttemptAt) {
        void poll(generation);
      } else {
        scheduleWake();
      }
    }, Math.max(0, at - now));
  }

  async function fetchJson(
    url: string,
    expectedGeneration: number,
    allowNoContent = false,
  ): Promise<unknown | typeof NO_CONTENT> {
    if (expectedGeneration !== generation || !started) throw new DOMException('Aborted', 'AbortError');
    const controller = new AbortController();
    request = controller;
    requestTimeout = {
      controller,
      handle: dependencies.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS),
    };
    try {
      const response = await dependencies.fetch(url, {
        method: 'GET',
        credentials: 'include',
        signal: controller.signal,
      });
      if (!response.ok) throw new HttpError(response.status);
      if (allowNoContent && response.status === 204) return NO_CONTENT;
      return await response.json();
    } finally {
      if (request === controller) request = null;
      clearRequestTimeout(controller);
    }
  }

  async function restoreGame(nextGameId: string, expectedGeneration: number): Promise<boolean> {
    if (gameId === nextGameId) return true;
    gameId = nextGameId;
    context = null;
    output = null;
    diagnostic = null;
    schemaBlocked = false;
    failureCount = 0;
    lastAcceptedAt = null;
    problem = null;
    gameEndpoint = null;
    publish('loading');
    const restored = await loadPlayerContext(dependencies.storage, nextGameId);
    if (!started || expectedGeneration !== generation) return false;
    context = restored.context;
    output = restored.output;
    diagnostic = restored.diagnostic;
    schemaBlocked = restored.diagnostic?.code === 'schema-mismatch';
    if (schemaBlocked) publish('unavailable', 'Custom HP unavailable');
    else if (context?.mode === 'off') publish('off');
    else if (output) publish('ready');
    else publish('loading');
    return true;
  }

  async function discoverPartyGame(expectedGeneration: number): Promise<string | null | undefined> {
    const raw = await fetchJson(ACTIVE_PARTY_API, expectedGeneration, true);
    if (raw === NO_CONTENT) {
      if (output?.terminal || context?.sourceStatus === 'Finished') {
        publish('ended', diagnostic?.message ?? 'Custom duel finished');
      } else {
        gameId = null;
        context = null;
        output = null;
        diagnostic = null;
        schemaBlocked = false;
        gameEndpoint = null;
        publish('waiting', 'Waiting for a duel');
      }
      return undefined;
    }
    const active = readActiveParty(raw);
    if (active.partyId !== null && currentPartyId !== null && active.partyId !== currentPartyId) {
      gameId = null;
      context = null;
      output = null;
      diagnostic = null;
      schemaBlocked = false;
      gameEndpoint = null;
    }
    if (active.partyId !== null) currentPartyId = active.partyId;
    if (active.waiting) {
      if (output?.terminal || context?.sourceStatus === 'Finished') {
        publish('ended', diagnostic?.message ?? 'Custom duel finished');
      } else {
        gameId = null;
        context = null;
        output = null;
        diagnostic = null;
        schemaBlocked = false;
        gameEndpoint = null;
        publish('waiting', 'Waiting for a duel');
      }
      return null;
    }
    const value = raw as Record<string, unknown>;
    const owner = value.owner as Record<string, unknown> | undefined;
    if (active.gameMaster && owner?.userId === dependencies.getUserId()) {
      gameId = active.gameId;
      context = null;
      output = null;
      diagnostic = null;
      schemaBlocked = true;
      publish('unavailable', 'Game master accounts are not player HUD targets');
      return null;
    }
    return active.gameId;
  }

  async function resolveGameEndpoint(
    targetGameId: string,
    expectedGeneration: number,
  ): Promise<GameEndpoint> {
    if (gameEndpoint?.gameId === targetGameId) return gameEndpoint;
    const raw = await fetchJson(
      `${PHONEBOOK_API}${encodeURIComponent(targetGameId)}`,
      expectedGeneration,
    );
    if (raw === NO_CONTENT) throw new Error('Game-server phonebook response is empty');
    gameEndpoint = readPhonebook(raw, targetGameId);
    return gameEndpoint;
  }

  async function fetchGameSnapshot(targetGameId: string, expectedGeneration: number): Promise<unknown> {
    const endpoint = await resolveGameEndpoint(targetGameId, expectedGeneration);
    try {
      return await fetchJson(endpoint.url, expectedGeneration);
    } catch (error) {
      if (endpoint.kind === 'active') gameEndpoint = null;
      if (!(error instanceof HttpError) || error.status !== 404 || endpoint.kind !== 'active') throw error;
      const refreshed = await resolveGameEndpoint(targetGameId, expectedGeneration);
      return await fetchJson(refreshed.url, expectedGeneration);
    }
  }

  function handleFailure(error: unknown, expectedGeneration: number): void {
    if (!started || expectedGeneration !== generation) return;
    problem = error instanceof HttpError && (error.status === 401 || error.status === 403)
      ? 'auth'
      : 'network';
    failureCount += 1;
    nextAttemptAt = dependencies.now()
      + Math.min(MAX_BACKOFF_MS, SUCCESS_POLL_MS * (2 ** failureCount));
    publishProblem();
    scheduleWake();
  }

  async function poll(expectedGeneration: number): Promise<void> {
    if (!started || expectedGeneration !== generation || currentRoute === null || pollToken !== null) return;
    const token = Symbol('poll');
    pollToken = token;
    clearWake();
    try {
      let targetGameId: string | null | undefined;
      if (currentRoute.kind === 'party-lobby') {
        targetGameId = await discoverPartyGame(expectedGeneration);
        if (!started || expectedGeneration !== generation) return;
        if (targetGameId === undefined) {
          failureCount = 0;
          problem = null;
          nextAttemptAt = dependencies.now() + SUCCESS_POLL_MS;
          scheduleWake();
          return;
        }
        if (targetGameId === null) {
          failureCount = 0;
          problem = null;
          nextAttemptAt = dependencies.now() + SUCCESS_POLL_MS;
          scheduleWake();
          return;
        }
      } else {
        targetGameId = currentRoute.gameId;
      }

      if (!await restoreGame(targetGameId, expectedGeneration)) return;
      if (schemaBlocked) {
        nextAttemptAt = dependencies.now() + SUCCESS_POLL_MS;
        scheduleWake();
        return;
      }
      const raw = await fetchGameSnapshot(targetGameId, expectedGeneration);
      if (!started || expectedGeneration !== generation || gameId !== targetGameId) return;
      const accepted = acceptPlayerSnapshot(context, raw, configuredMode());
      context = accepted.context;
      output = accepted.output;
      diagnostic = accepted.diagnostic;
      failureCount = 0;
      problem = null;
      nextAttemptAt = dependencies.now() + SUCCESS_POLL_MS;
      if (accepted.accepted) {
        lastAcceptedAt = dependencies.now();
        if (context) await savePlayerContext(dependencies.storage, context);
      }
      if (!started || expectedGeneration !== generation || gameId !== targetGameId) return;
      if (!accepted.accepted) publish('unavailable', 'Custom HP unavailable');
      else if (context?.mode === 'off') publish('off');
      else if (accepted.diagnostic?.code === 'source-ended') publish('ended', accepted.diagnostic.message);
      else if (output) publish('ready');
      else publish('unavailable', 'Custom HP unavailable');
      scheduleWake();
    } catch (error) {
      if (!started || expectedGeneration !== generation) return;
      handleFailure(error, expectedGeneration);
    } finally {
      if (pollToken === token) pollToken = null;
    }
  }

  function syncRoute(forceRefresh: boolean): void {
    if (!started) return;
    const parsed = parsePlayerPageRoute(dependencies.getPath());
    const nextKey = parsed ? routeKey(parsed) : null;
    if (nextKey === currentRouteKey) {
      if (forceRefresh && parsed) void poll(generation);
      return;
    }

    generation += 1;
    resetPolling();
    currentRoute = parsed;
    currentRouteKey = nextKey;
    gameId = null;
    context = null;
    output = null;
    diagnostic = null;
    schemaBlocked = false;
    currentPartyId = null;
    if (!parsed) {
      publish('inactive');
      return;
    }
    publish(parsed.kind === 'party-lobby' ? 'waiting' : 'loading');
    void poll(generation);
  }

  return {
    start(): void {
      if (started) return;
      started = true;
      syncRoute(true);
    },
    refresh(): void {
      syncRoute(true);
    },
    routeChanged(): void {
      syncRoute(true);
    },
    dispose(): void {
      if (!started) return;
      started = false;
      generation += 1;
      resetPolling();
      currentRoute = null;
      currentRouteKey = null;
      gameId = null;
      context = null;
      output = null;
      diagnostic = null;
      schemaBlocked = false;
      currentPartyId = null;
      publish('inactive');
    },
  };
}
