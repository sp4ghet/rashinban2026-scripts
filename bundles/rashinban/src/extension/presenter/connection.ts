import WebSocket from 'ws';

export type ConnectionConfig = {
  cookie: string;
  partyId: string | null;
  clientVersion: string;
};

export type ConnectionStatus = {
  state: 'disconnected' | 'connecting' | 'live' | 'stale' | 'auth-error' | 'unsupported';
  partyId: string | null;
  gameId: string | null;
  lastUpdateMs: number | null;
  error: string | null;
  serverOffsetMs: number;
};

export type ConnectionSink = {
  onMessage(message: unknown, receivedAtMs: number, bootstrap: boolean): void;
  onStatus(status: ConnectionStatus): void;
};

export type SocketPort = {
  send(text: string): void;
  close(): void;
  onOpen(callback: () => void): void;
  onMessage(callback: (text: string) => void): void;
  onClose(callback: (code: number) => void): void;
};

export type ConnectionDeps = {
  fetch: typeof fetch;
  openSocket(url: string, cookie: string): SocketPort;
  now(): number;
  schedule(callback: () => void, delayMs: number): () => void;
};

type WebSocketClient = {
  send(text: string): void;
  close(): void;
  on(event: 'open', callback: () => void): unknown;
  on(event: 'message', callback: (data: unknown) => void): unknown;
  on(event: 'close', callback: (code: number) => void): unknown;
  on(event: 'error', callback: (error: Error) => void): unknown;
};

type WebSocketConstructor = new (
  url: string,
  options: { headers: Record<string, string> },
) => WebSocketClient;

export type DefaultConnectionDepsOptions = {
  fetch?: typeof fetch;
  WebSocket?: WebSocketConstructor;
};

type RecordValue = Record<string, unknown>;

class AuthenticationError extends Error {}
class TransientConnectionError extends Error {}

const PARTY_POLL_MS = 5_000;
const HEARTBEAT_MS = 15_000;
const MAX_BACKOFF_MS = 30_000;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new AuthenticationError(message);
  return value;
}

function serverTimeMs(value: string | null): number | null {
  if (value === null) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function jitteredBackoff(attempt: number): number {
  const base = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** Math.max(0, attempt - 1));
  return Math.min(MAX_BACKOFF_MS, Math.round(base * (0.8 + Math.random() * 0.4)));
}

function assertTrustedUrl(url: string): void {
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    (parsed.hostname !== 'www.geoguessr.com' && parsed.hostname !== 'gs2.geoguessr.com')
  ) {
    throw new TransientConnectionError('GeoGuessr returned an unsupported endpoint');
  }
}

export function createDefaultConnectionDeps(
  options: DefaultConnectionDepsOptions = {},
): ConnectionDeps {
  const WebSocketImpl = options.WebSocket ?? (WebSocket as unknown as WebSocketConstructor);
  return {
    fetch: options.fetch ?? globalThis.fetch,
    openSocket(url, cookie) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'wss:' || parsed.hostname !== 'gs2.geoguessr.com') {
        throw new Error('Unsupported GeoGuessr WebSocket endpoint');
      }
      const xClient = parsed.searchParams.get('c');
      if (xClient === null || !xClient.startsWith('web-')) {
        throw new Error('Missing GeoGuessr client version');
      }
      const client = new WebSocketImpl(url, {
        headers: { Cookie: `_ncfa=${cookie}`, 'X-Client': xClient },
      });
      let closeCallback: (code: number) => void = () => {};
      let finished = false;
      const finish = (code: number): void => {
        if (finished) return;
        finished = true;
        closeCallback(code);
      };
      client.on('error', () => {
        client.close();
        finish(1006);
      });
      client.on('close', (code) => finish(code));
      return {
        send(text) {
          client.send(text);
        },
        close() {
          client.close();
        },
        onOpen(callback) {
          client.on('open', callback);
        },
        onMessage(callback) {
          client.on('message', (data) => callback(String(data)));
        },
        onClose(callback) {
          closeCallback = callback;
        },
      };
    },
    now: () => Date.now(),
    schedule(callback, delayMs) {
      const timer = setTimeout(callback, delayMs);
      return () => clearTimeout(timer);
    },
  };
}

export function createConnection(
  config: ConnectionConfig,
  sink: ConnectionSink,
  deps: ConnectionDeps,
): { start(): void; stop(): void; reconnect(): void } {
  let active = false;
  let partyHealthy = false;
  let socketHealthy = false;
  let sessionGeneration = 0;
  let lobbyGeneration = 0;
  let accountPlayerId: string | null = null;
  let currentLobbyId: string | null = null;
  let socket: SocketPort | null = null;
  let socketAttempt = 0;
  let partyRetryAttempt = 0;
  let lobbyRetryAttempt = 0;
  let authAbort: AbortController | null = null;
  let partyAbort: AbortController | null = null;
  let lobbyAbort: AbortController | null = null;
  let cancelPartyTimer: (() => void) | null = null;
  let cancelHeartbeat: (() => void) | null = null;
  let cancelPartyRetry: (() => void) | null = null;
  let cancelLobbyRetry: (() => void) | null = null;

  const status: ConnectionStatus = {
    state: 'disconnected',
    partyId: config.partyId,
    gameId: null,
    lastUpdateMs: null,
    error: null,
    serverOffsetMs: 0,
  };

  function publish(patch: Partial<ConnectionStatus>): void {
    Object.assign(status, patch);
    sink.onStatus({ ...status });
  }

  function sessionIsCurrent(generation: number, signal?: AbortSignal): boolean {
    return active && generation === sessionGeneration && !signal?.aborted;
  }

  function lobbyIsCurrent(generation: number, signal?: AbortSignal): boolean {
    return active && generation === lobbyGeneration && !signal?.aborted;
  }

  async function requestJson(url: string, signal: AbortSignal): Promise<unknown> {
    assertTrustedUrl(url);
    const startedAt = deps.now();
    const response = await deps.fetch(url, {
      headers: {
        Cookie: `_ncfa=${config.cookie}`,
        'X-Client': `web-${config.clientVersion}`,
      },
      redirect: 'manual',
      signal,
    });
    if (signal.aborted) throw new TransientConnectionError('Request replaced');
    if (response.status === 401 || response.status === 403) {
      throw new AuthenticationError('GeoGuessr authentication failed');
    }
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      throw new TransientConnectionError('GeoGuessr redirect rejected');
    }
    if (!response.ok) throw new TransientConnectionError('GeoGuessr request failed');

    const finishedAt = deps.now();
    const serverMs = serverTimeMs(response.headers.get('X-ServerTime'));
    if (serverMs !== null) status.serverOffsetMs = serverMs - (startedAt + finishedAt) / 2;
    try {
      return await response.json();
    } catch {
      throw new TransientConnectionError('GeoGuessr returned invalid JSON');
    }
  }

  function cancelSocketWork(): void {
    socketHealthy = false;
    cancelHeartbeat?.();
    cancelHeartbeat = null;
    cancelLobbyRetry?.();
    cancelLobbyRetry = null;
    const previous = socket;
    socket = null;
    previous?.close();
  }

  function schedulePartyPoll(generation: number, delayMs = PARTY_POLL_MS): void {
    if (!sessionIsCurrent(generation)) return;
    cancelPartyTimer?.();
    cancelPartyTimer = deps.schedule(() => {
      cancelPartyTimer = null;
      if (sessionIsCurrent(generation)) void pollParty(generation);
    }, delayMs);
  }

  function schedulePartyRetry(callback: () => void): void {
    cancelPartyRetry?.();
    partyRetryAttempt += 1;
    cancelPartyRetry = deps.schedule(() => {
      cancelPartyRetry = null;
      if (active) callback();
    }, jitteredBackoff(partyRetryAttempt));
  }

  function scheduleLobbyRetry(callback: () => void): void {
    cancelLobbyRetry?.();
    lobbyRetryAttempt += 1;
    cancelLobbyRetry = deps.schedule(() => {
      cancelLobbyRetry = null;
      if (active) callback();
    }, jitteredBackoff(lobbyRetryAttempt));
  }

  function failAuthentication(): void {
    active = false;
    partyHealthy = false;
    cancelPartyTimer?.();
    cancelPartyTimer = null;
    cancelPartyRetry?.();
    cancelPartyRetry = null;
    cancelSocketWork();
    authAbort?.abort();
    partyAbort?.abort();
    lobbyAbort?.abort();
    publish({ state: 'auth-error', error: 'GeoGuessr authentication failed' });
  }

  function publishTransient(generation: number, retry: () => void): void {
    if (!sessionIsCurrent(generation)) return;
    partyHealthy = false;
    publish({ state: 'stale', error: 'GeoGuessr connection interrupted' });
    schedulePartyRetry(retry);
  }

  async function authenticate(generation: number): Promise<void> {
    authAbort?.abort();
    const controller = new AbortController();
    authAbort = controller;
    try {
      const value = await requestJson('https://www.geoguessr.com/api/v3/profiles/', controller.signal);
      if (!sessionIsCurrent(generation, controller.signal)) return;
      if (!isRecord(value) || !isRecord(value.user)) throw new AuthenticationError('Invalid account');
      accountPlayerId = requiredString(value.user.id ?? value.user.userId, 'Invalid account');
      partyRetryAttempt = 0;
      void pollParty(generation);
    } catch (error) {
      if (!sessionIsCurrent(generation, controller.signal)) return;
      if (error instanceof AuthenticationError) {
        failAuthentication();
        return;
      }
      publishTransient(generation, () => void authenticate(generation));
    }
  }

  function replaceLobby(lobbyId: string | null): number {
    lobbyGeneration += 1;
    lobbyAbort?.abort();
    lobbyAbort = null;
    cancelSocketWork();
    currentLobbyId = lobbyId;
    socketAttempt = 0;
    lobbyRetryAttempt = 0;
    return lobbyGeneration;
  }

  function handleParty(value: unknown, generation: number): void {
    if (!isRecord(value)) throw new TransientConnectionError('Invalid party response');
    const resolvedPartyId = typeof value.partyId === 'string' ? value.partyId : config.partyId;
    status.partyId = resolvedPartyId;
    const lobbyId = typeof value.lobbyId === 'string' && value.lobbyId.length > 0 ? value.lobbyId : null;
    const gameState = value.gameState;
    if (gameState === 'NoGame' || lobbyId === null) {
      if (currentLobbyId !== null) replaceLobby(null);
      publish({ state: 'disconnected', gameId: null, error: null });
      return;
    }
    if (value.gameType !== 'Duels') {
      if (currentLobbyId !== null) replaceLobby(null);
      publish({ state: 'unsupported', gameId: lobbyId, error: 'Unsupported GeoGuessr game type' });
      return;
    }
    if (lobbyId !== currentLobbyId) {
      const nextLobbyGeneration = replaceLobby(lobbyId);
      publish({ state: 'connecting', gameId: lobbyId, error: null });
      void bootstrapLobby(generation, nextLobbyGeneration, lobbyId);
    }
  }

  async function pollParty(generation: number): Promise<void> {
    partyAbort?.abort();
    const controller = new AbortController();
    partyAbort = controller;
    const partyUrl = config.partyId
      ? `https://www.geoguessr.com/api/v4/parties/v2/${encodeURIComponent(config.partyId)}`
      : 'https://www.geoguessr.com/api/v4/parties/v2/active';
    try {
      const value = await requestJson(partyUrl, controller.signal);
      if (!sessionIsCurrent(generation, controller.signal)) return;
      handleParty(value, generation);
      partyHealthy = true;
      partyRetryAttempt = 0;
      if (socketHealthy && currentLobbyId !== null) {
        publish({ state: 'live', gameId: currentLobbyId, error: null });
      }
      if (sessionIsCurrent(generation, controller.signal)) schedulePartyPoll(generation);
    } catch (error) {
      if (!sessionIsCurrent(generation, controller.signal)) return;
      if (error instanceof AuthenticationError) {
        failAuthentication();
        return;
      }
      publishTransient(generation, () => void pollParty(generation));
    }
  }

  async function bootstrapLobby(
    session: number,
    lobby: number,
    lobbyId: string,
  ): Promise<void> {
    lobbyAbort?.abort();
    const controller = new AbortController();
    lobbyAbort = controller;
    try {
      const phonebookValue = await requestJson(
        `https://www.geoguessr.com/api/v4/game-server/phonebook/${encodeURIComponent(lobbyId)}`,
        controller.signal,
      );
      if (!sessionIsCurrent(session) || !lobbyIsCurrent(lobby, controller.signal)) return;
      if (!isRecord(phonebookValue)) throw new TransientConnectionError('Invalid phonebook response');
      if (phonebookValue.status !== 'Active') throw new TransientConnectionError('Game server unavailable');
      const nodeId =
        typeof phonebookValue.gameServerNodeId === 'string' && phonebookValue.gameServerNodeId.length > 0
          ? phonebookValue.gameServerNodeId
          : null;
      const gameId =
        typeof phonebookValue.gameId === 'string' && phonebookValue.gameId.length > 0
          ? phonebookValue.gameId
          : null;
      if (nodeId === null || gameId === null) throw new TransientConnectionError('Invalid phonebook response');
      const snapshot = await requestJson(
        `https://gs2.geoguessr.com/${encodeURIComponent(nodeId)}/${encodeURIComponent(lobbyId)}/spectator`,
        controller.signal,
      );
      if (!sessionIsCurrent(session) || !lobbyIsCurrent(lobby, controller.signal)) return;
      if (!isRecord(snapshot)) throw new TransientConnectionError('Invalid spectator response');
      const receivedAtMs = deps.now();
      sink.onMessage(
        { code: 'DuelStarted', gameId: snapshot.gameId ?? gameId, duel: { state: snapshot } },
        receivedAtMs,
        true,
      );
      status.lastUpdateMs = receivedAtMs;
      lobbyRetryAttempt = 0;
      openLobbySocket(session, lobby, lobbyId, nodeId, false);
    } catch (error) {
      if (!sessionIsCurrent(session) || !lobbyIsCurrent(lobby, controller.signal)) return;
      if (error instanceof AuthenticationError) {
        failAuthentication();
        return;
      }
      publish({ state: 'stale', error: 'GeoGuessr connection interrupted' });
      scheduleLobbyRetry(() => void bootstrapLobby(session, lobby, lobbyId));
    }
  }

  function openLobbySocket(
    session: number,
    lobby: number,
    lobbyId: string,
    nodeId: string,
    reconnecting: boolean,
  ): void {
    if (!sessionIsCurrent(session) || !lobbyIsCurrent(lobby) || accountPlayerId === null) return;
    socketAttempt += 1;
    const query = new URLSearchParams({
      c: `web-${config.clientVersion}`,
      tabId: crypto.randomUUID(),
      attempt: String(socketAttempt),
      visibility: 'visible',
    });
    if (reconnecting) query.set('reconnect', 'true');
    const url = `wss://gs2.geoguessr.com/${encodeURIComponent(nodeId)}/${encodeURIComponent(lobbyId)}/spectate/ws?${query}`;
    let opened: SocketPort;
    try {
      opened = deps.openSocket(url, config.cookie);
    } catch {
      publish({ state: 'stale', error: 'GeoGuessr connection interrupted' });
      scheduleLobbyRetry(() => openLobbySocket(session, lobby, lobbyId, nodeId, true));
      return;
    }
    socket = opened;
    let reconnectSnapshotPending = reconnecting;

    opened.onOpen(() => {
      if (socket !== opened || !sessionIsCurrent(session) || !lobbyIsCurrent(lobby)) return;
      try {
        opened.send(JSON.stringify({ code: 'SubscribeToLobby', gameId: lobbyId, playerId: accountPlayerId }));
        opened.send(
          JSON.stringify({ code: 'SubscribeToLiveStream', gameId: lobbyId, playerId: accountPlayerId }),
        );
      } catch {
        opened.close();
        return;
      }
      lobbyRetryAttempt = 0;
      socketHealthy = true;
      if (partyHealthy) publish({ state: 'live', gameId: lobbyId, error: null });
      const heartbeat = (): void => {
        if (socket !== opened || !sessionIsCurrent(session) || !lobbyIsCurrent(lobby)) return;
        try {
          opened.send(JSON.stringify({ code: 'HeartBeat' }));
        } catch {
          opened.close();
          return;
        }
        cancelHeartbeat = deps.schedule(heartbeat, HEARTBEAT_MS);
      };
      cancelHeartbeat?.();
      cancelHeartbeat = deps.schedule(heartbeat, HEARTBEAT_MS);
    });

    opened.onMessage((text) => {
      if (socket !== opened || !sessionIsCurrent(session) || !lobbyIsCurrent(lobby)) return;
      let message: unknown;
      try {
        message = JSON.parse(text);
      } catch {
        return;
      }
      const receivedAtMs = deps.now();
      const isReconnectSnapshot =
        reconnectSnapshotPending && isRecord(message) && message.code === 'DuelStarted';
      if (isReconnectSnapshot) reconnectSnapshotPending = false;
      sink.onMessage(message, receivedAtMs, isReconnectSnapshot);
      publish({ lastUpdateMs: receivedAtMs });
    });

    opened.onClose((code) => {
      if (socket !== opened || !sessionIsCurrent(session) || !lobbyIsCurrent(lobby)) return;
      socket = null;
      socketHealthy = false;
      cancelHeartbeat?.();
      cancelHeartbeat = null;
      if (code === 4100) {
        publish({ state: 'stale', error: 'GeoGuessr stopped the spectator session' });
        return;
      }
      if (code === 1000) {
        currentLobbyId = null;
        publish({ state: 'disconnected', gameId: null, error: null });
        schedulePartyPoll(session);
        return;
      }
      publish({ state: 'stale', error: 'GeoGuessr connection interrupted' });
      scheduleLobbyRetry(() => openLobbySocket(session, lobby, lobbyId, nodeId, true));
    });
  }

  function shutdown(publishStatus: boolean): void {
    active = false;
    partyHealthy = false;
    sessionGeneration += 1;
    lobbyGeneration += 1;
    authAbort?.abort();
    partyAbort?.abort();
    lobbyAbort?.abort();
    authAbort = null;
    partyAbort = null;
    lobbyAbort = null;
    cancelPartyTimer?.();
    cancelPartyTimer = null;
    cancelPartyRetry?.();
    cancelPartyRetry = null;
    cancelSocketWork();
    accountPlayerId = null;
    currentLobbyId = null;
    if (publishStatus) publish({ state: 'disconnected', gameId: null, error: null });
  }

  function start(): void {
    if (active) return;
    active = true;
    sessionGeneration += 1;
    publish({ state: 'connecting', error: null });
    void authenticate(sessionGeneration);
  }

  function stop(): void {
    shutdown(true);
  }

  function reconnect(): void {
    shutdown(false);
    start();
  }

  return { start, stop, reconnect };
}
