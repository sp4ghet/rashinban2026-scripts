import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate as waitForImmediate } from 'node:timers/promises';
import test from 'node:test';

import {
  createConnection,
  createDefaultConnectionDeps,
  type ConnectionDeps,
  type ConnectionStatus,
  type SocketPort,
} from '../../extension/presenter/connection.ts';
import { loadConnectionConfig } from '../../extension/presenter/secrets.ts';

type FetchCall = { url: string; init: RequestInit | undefined };

class FakeSocket implements SocketPort {
  readonly sent: string[] = [];
  closed = false;
  private opened: (() => void) | undefined;
  private messaged: ((text: string) => void) | undefined;
  private closedCallback: ((code: number) => void) | undefined;

  send(text: string): void {
    this.sent.push(text);
  }

  close(): void {
    this.closed = true;
  }

  onOpen(callback: () => void): void {
    this.opened = callback;
  }

  onMessage(callback: (text: string) => void): void {
    this.messaged = callback;
  }

  onClose(callback: (code: number) => void): void {
    this.closedCallback = callback;
  }

  open(): void {
    this.opened?.();
  }

  message(value: unknown): void {
    this.messaged?.(JSON.stringify(value));
  }

  closeFromServer(code: number): void {
    this.closedCallback?.(code);
  }
}

class FakeClock {
  nowMs = 1_000;
  readonly tasks: Array<{ callback: () => void; delayMs: number; active: boolean }> = [];

  readonly schedule = (callback: () => void, delayMs: number): (() => void) => {
    const task = { callback, delayMs, active: true };
    this.tasks.push(task);
    return () => {
      task.active = false;
    };
  };

  runDelay(delayMs: number): void {
    const task = this.tasks.find((candidate) => candidate.active && candidate.delayMs === delayMs);
    assert.ok(task, `missing active ${delayMs} ms task`);
    task.active = false;
    task.callback();
  }

  activeDelays(): number[] {
    return this.tasks.filter((task) => task.active).map((task) => task.delayMs);
  }
}

function json(value: unknown, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function profile(): Response {
  return json({ user: { id: 'account-player-id', userId: 'legacy-id' } });
}

function party(lobbyId: string | null, gameState = 'Ongoing', gameType = 'Duels'): Response {
  return json({ partyId: 'party-one', lobbyId, gameState, gameType });
}

function phonebook(lobbyId: string): Response {
  return json({ gameId: lobbyId, gameServerNodeId: `node-${lobbyId}`, status: 'Active' });
}

function spectator(lobbyId: string): Response {
  return json({ gameId: lobbyId, version: 3, status: 'Ongoing' });
}

function scriptedConnection(
  responses: Response[],
  overrides: Partial<ConnectionDeps> = {},
): {
  connection: ReturnType<typeof createConnection>;
  calls: FetchCall[];
  clock: FakeClock;
  sockets: FakeSocket[];
  socketUrls: string[];
  statuses: ConnectionStatus[];
  messages: Array<{ value: unknown; receivedAtMs: number; bootstrap: boolean }>;
} {
  const clock = new FakeClock();
  const calls: FetchCall[] = [];
  const sockets: FakeSocket[] = [];
  const socketUrls: string[] = [];
  const statuses: ConnectionStatus[] = [];
  const messages: Array<{ value: unknown; receivedAtMs: number; bootstrap: boolean }> = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const response = responses.shift();
    assert.ok(response, `unexpected fetch ${String(input)}`);
    return response;
  }) as typeof globalThis.fetch;
  const deps: ConnectionDeps = {
    fetch,
    openSocket(url) {
      socketUrls.push(url);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    now: () => clock.nowMs,
    schedule: clock.schedule,
    ...overrides,
  };
  const connection = createConnection(
    { cookie: 'test-only-secret', partyId: 'party-one', clientVersion: 'fixture-version' },
    {
      onMessage(value, receivedAtMs, bootstrap) {
        messages.push({ value, receivedAtMs, bootstrap });
      },
      onStatus(value) {
        statuses.push(value);
      },
    },
    deps,
  );
  return { connection, calls, clock, sockets, socketUrls, statuses, messages };
}

async function flush(): Promise<void> {
  await waitForImmediate();
  await waitForImmediate();
}

test('bootstrap delivers the latest server offset before a status publication', async () => {
  const responses = [profile(), party('lobby-one'), phonebook('lobby-one'),
    json({ gameId: 'lobby-one' }, { 'X-ServerTime': '1970-01-01T00:00:06.000Z' })];
  let delivered: number | undefined;
  let published = 0;
  const connection = createConnection(
    { cookie: 'test-only', partyId: 'p', clientVersion: 'fixture' },
    {
      onMessage(_value, _at, _bootstrap, offset) { delivered = offset; },
      onStatus(status) { published = status.serverOffsetMs; },
    },
    { fetch: async () => responses.shift()!, openSocket: () => new FakeSocket(), now: () => 1000, schedule: () => () => {} },
  );
  connection.start();
  await flush();
  assert.equal(delivered, 5000);
  assert.equal(published, 0);
  connection.stop();
});

test('authentication failure stops discovery', async () => {
  let status: ConnectionStatus | undefined;
  const pending: Array<() => void> = [];
  const connection = createConnection(
    { cookie: 'test-only', partyId: 'p', clientVersion: 'fixture' },
    {
      onMessage() {},
      onStatus(value) {
        status = value;
      },
    },
    {
      fetch: async () => new Response('', { status: 401 }),
      openSocket() {
        throw new Error('must not open');
      },
      now: () => 1000,
      schedule(fn) {
        pending.push(fn);
        return () => {};
      },
    },
  );

  connection.start();
  await waitForImmediate();

  assert.equal(status?.state, 'auth-error');
  assert.equal(pending.length, 0);
  connection.stop();
});

test('discovers the lobby, wraps REST state, and subscribes with the authenticated account', async () => {
  const harness = scriptedConnection([
    profile(),
    party('lobby-one'),
    phonebook('lobby-one'),
    spectator('lobby-one'),
  ]);

  harness.connection.start();
  await flush();

  assert.equal(harness.sockets.length, 1);
  assert.match(
    harness.calls[3].url,
    /^https:\/\/gs2\.geoguessr\.com\/node-lobby-one\/lobby-one\/spectator$/,
  );
  assert.deepEqual(harness.messages, [
    {
      value: {
        code: 'DuelStarted',
        gameId: 'lobby-one',
        duel: { state: { gameId: 'lobby-one', version: 3, status: 'Ongoing' } },
      },
      receivedAtMs: 1_000,
      bootstrap: true,
    },
  ]);
  for (const call of harness.calls) {
    assert.equal(new Headers(call.init?.headers).get('cookie'), '_ncfa=test-only-secret');
    assert.equal(new Headers(call.init?.headers).get('x-client'), 'web-fixture-version');
    assert.equal(call.init?.redirect, 'manual');
  }

  const socket = harness.sockets[0];
  socket.open();
  assert.match(harness.socketUrls[0], /^wss:\/\/gs2\.geoguessr\.com\/node-lobby-one\/lobby-one\/spectate\/ws\?/);
  assert.match(harness.socketUrls[0], /c=web-fixture-version/);
  assert.match(harness.socketUrls[0], /attempt=1/);
  assert.deepEqual(socket.sent.map((text) => JSON.parse(text)), [
    { code: 'SubscribeToLobby', gameId: 'lobby-one', playerId: 'account-player-id' },
    { code: 'SubscribeToLiveStream', gameId: 'lobby-one', playerId: 'account-player-id' },
  ]);
  assert.equal(harness.statuses.at(-1)?.state, 'live');
  harness.connection.stop();
});

test('sends heartbeat frames every fifteen seconds while the socket is open', async () => {
  const harness = scriptedConnection([
    profile(),
    party('lobby-one'),
    phonebook('lobby-one'),
    spectator('lobby-one'),
  ]);
  harness.connection.start();
  await flush();
  harness.sockets[0].open();

  harness.clock.runDelay(15_000);

  assert.deepEqual(JSON.parse(harness.sockets[0].sent.at(-1) ?? ''), { code: 'HeartBeat' });
  assert.ok(harness.clock.activeDelays().includes(15_000));
  harness.connection.stop();
  assert.equal(harness.sockets[0].closed, true);
  assert.deepEqual(harness.clock.activeDelays(), []);
});

test('1012 server restart backs off and marks the first reconnect snapshot as bootstrap', async () => {
  const harness = scriptedConnection([
    profile(),
    party('lobby-one'),
    phonebook('lobby-one'),
    spectator('lobby-one'),
  ]);
  harness.connection.start();
  await flush();
  harness.sockets[0].open();

  harness.sockets[0].closeFromServer(1012);

  assert.equal(harness.statuses.at(-1)?.state, 'stale');
  const retryDelay = harness.clock
    .activeDelays()
    .find((delay) => delay >= 800 && delay <= 1_200);
  assert.ok(retryDelay, 'expected jittered one-second retry');
  harness.clock.runDelay(retryDelay);
  assert.equal(harness.sockets.length, 2);
  assert.match(harness.socketUrls[1], /reconnect=true/);
  harness.sockets[1].open();
  harness.sockets[1].message({ code: 'DuelStarted', gameId: 'lobby-one', duel: { state: {} } });
  harness.sockets[1].message({ code: 'DuelPinPlaced', gameId: 'lobby-one', duel: { state: {} } });

  assert.equal(harness.messages.at(-2)?.bootstrap, true);
  assert.equal(harness.messages.at(-1)?.bootstrap, false);
  harness.connection.stop();
});

test('a failed party poll does not cancel a pending socket reconnect', async () => {
  let call = 0;
  const responses = [profile(), party('lobby-one'), phonebook('lobby-one'), spectator('lobby-one')];
  const fetch = (async () => {
    call += 1;
    if (call === 5) throw new Error('party poll offline');
    const response = responses.shift();
    assert.ok(response);
    return response;
  }) as typeof globalThis.fetch;
  const active = scriptedConnection([], { fetch });
  active.connection.start();
  await flush();
  active.sockets[0].open();
  active.sockets[0].closeFromServer(1012);
  const socketRetry = active.clock.activeDelays().find((delay) => delay < 5_000);
  assert.ok(socketRetry);

  active.clock.runDelay(5_000);
  await flush();

  assert.ok(active.clock.activeDelays().includes(socketRetry));
  active.connection.stop();
});

test('party polling recovery restores live only while the socket is healthy', async () => {
  let healthyCall = 0;
  const healthyResponses = [
    profile(),
    party('lobby-one'),
    phonebook('lobby-one'),
    spectator('lobby-one'),
    party('lobby-one'),
  ];
  const healthyFetch = (async () => {
    healthyCall += 1;
    if (healthyCall === 5) throw new Error('temporary party failure');
    const response = healthyResponses.shift();
    assert.ok(response);
    return response;
  }) as typeof globalThis.fetch;
  const healthy = scriptedConnection([], { fetch: healthyFetch });
  healthy.connection.start();
  await flush();
  healthy.sockets[0].open();

  healthy.clock.runDelay(5_000);
  await flush();
  assert.equal(healthy.statuses.at(-1)?.state, 'stale');
  const partyRetry = healthy.clock.activeDelays().find((delay) => delay < 5_000);
  assert.ok(partyRetry);
  healthy.clock.runDelay(partyRetry);
  await flush();
  healthy.sockets[0].message({ code: 'DuelPinPlaced', gameId: 'lobby-one', duel: { state: {} } });

  assert.equal(healthy.statuses.at(-1)?.state, 'live');
  assert.equal(healthy.statuses.at(-1)?.error, null);
  healthy.connection.stop();

  const stale = scriptedConnection([
    profile(),
    party('lobby-one'),
    phonebook('lobby-one'),
    spectator('lobby-one'),
    party('lobby-one'),
  ]);
  stale.connection.start();
  await flush();
  stale.sockets[0].open();
  stale.sockets[0].closeFromServer(1012);

  stale.clock.runDelay(5_000);
  await flush();

  assert.equal(stale.statuses.at(-1)?.state, 'stale');
  assert.equal(stale.statuses.at(-1)?.error, 'GeoGuessr connection interrupted');
  stale.connection.stop();
});

test('valid server time uses the request midpoint to estimate clock offset', async () => {
  const harness = scriptedConnection([
    json(
      { user: { id: 'account-player-id' } },
      { 'X-ServerTime': '1970-01-01T00:00:02.000Z' },
    ),
    party('lobby-one'),
    phonebook('lobby-one'),
    spectator('lobby-one'),
  ]);

  harness.connection.start();
  await flush();
  harness.sockets[0].open();

  assert.equal(harness.statuses.at(-1)?.serverOffsetMs, 1_000);
  harness.connection.stop();
});

test('4100 stops socket retry but party discovery remains active', async () => {
  const harness = scriptedConnection([
    profile(),
    party('lobby-one'),
    phonebook('lobby-one'),
    spectator('lobby-one'),
  ]);
  harness.connection.start();
  await flush();
  harness.sockets[0].open();

  harness.sockets[0].closeFromServer(4100);

  assert.equal(harness.statuses.at(-1)?.state, 'stale');
  assert.deepEqual(harness.clock.activeDelays(), [5_000]);
  harness.connection.stop();
});

test('normal ended session returns to party discovery', async () => {
  const harness = scriptedConnection([
    profile(),
    party('lobby-one'),
    phonebook('lobby-one'),
    spectator('lobby-one'),
    party(null, 'NoGame'),
  ]);
  harness.connection.start();
  await flush();
  harness.sockets[0].open();

  harness.sockets[0].closeFromServer(1000);
  harness.clock.runDelay(5_000);
  await flush();

  assert.equal(harness.calls.at(-1)?.url, 'https://www.geoguessr.com/api/v4/parties/v2/party-one');
  assert.equal(harness.statuses.at(-1)?.state, 'disconnected');
  harness.connection.stop();
});

test('a replacement lobby wins when the old spectator fetch completes late', async () => {
  let resolveOld: ((response: Response) => void) | undefined;
  let partyFetches = 0;
  const oldSpectator = new Promise<Response>((resolve) => {
    resolveOld = resolve;
  });
  const fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/v3/profiles/')) return profile();
    if (url.includes('/api/v4/parties/v2/')) {
      partyFetches += 1;
      return party(partyFetches === 1 ? 'old-lobby' : 'new-lobby');
    }
    if (url.includes('/phonebook/old-lobby')) return phonebook('old-lobby');
    if (url.includes('/phonebook/new-lobby')) return phonebook('new-lobby');
    if (url.includes('/old-lobby/spectator')) return oldSpectator;
    if (url.includes('/new-lobby/spectator')) return spectator('new-lobby');
    throw new Error(`unexpected URL ${url}`);
  }) as typeof globalThis.fetch;
  const harness = scriptedConnection([], { fetch });

  harness.connection.start();
  await flush();
  harness.clock.runDelay(5_000);
  await flush();
  resolveOld?.(spectator('old-lobby'));
  await flush();

  assert.equal(harness.sockets.length, 1);
  assert.deepEqual(harness.messages.map((message) => message.value), [
    {
      code: 'DuelStarted',
      gameId: 'new-lobby',
      duel: { state: { gameId: 'new-lobby', version: 3, status: 'Ongoing' } },
    },
  ]);
  harness.connection.stop();
});

test('errors and status snapshots never expose the configured cookie', async () => {
  const harness = scriptedConnection([], {
    fetch: async () => {
      throw new Error('request included test-only-secret');
    },
  });

  harness.connection.start();
  await flush();

  assert.equal(harness.statuses.at(-1)?.state, 'stale');
  assert.doesNotMatch(JSON.stringify(harness.statuses), /test-only-secret/);
  assert.ok(harness.clock.activeDelays().some((delay) => delay >= 800 && delay <= 1_200));
  harness.connection.stop();
});

test('transient retries remain capped at thirty seconds after jitter', async () => {
  const originalRandom = Math.random;
  Math.random = () => 1;
  try {
    const harness = scriptedConnection([], {
      fetch: async () => {
        throw new Error('offline');
      },
    });
    harness.connection.start();
    await flush();
    const delays: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const delay = harness.clock.activeDelays()[0];
      assert.ok(delay !== undefined);
      delays.push(delay);
      harness.clock.runDelay(delay);
      await flush();
    }

    assert.ok(delays.every((delay) => delay <= 30_000), `uncapped delays: ${delays.join(', ')}`);
    harness.connection.stop();
  } finally {
    Math.random = originalRandom;
  }
});

test('server-only config loader reads the ignored secret without accepting a public cookie', () => {
  const publicConfig = {
    partyId: null,
    clientVersion: 'fixture-version',
    cookieFile: '.secrets/geoguessr.json',
  };
  let readPath = '';

  const config = loadConnectionConfig(publicConfig, {
    baseDir: 'C:\\nodecg',
    env: {},
    readFile(path) {
      readPath = path;
      return JSON.stringify({ cookie: 'private-cookie' });
    },
  });

  assert.equal(config.cookie, 'private-cookie');
  assert.equal(config.partyId, null);
  assert.match(readPath, /[\\/]nodecg[\\/]\.secrets[\\/]geoguessr\.json$/);
  assert.doesNotMatch(JSON.stringify(publicConfig), /private-cookie/);
  assert.throws(
    () =>
      loadConnectionConfig({ ...publicConfig, cookie: 'public-cookie' } as typeof publicConfig, {
        env: { GEOGUESSR_NCFA: 'environment-cookie' },
      }),
    (error: unknown) => error instanceof Error && !error.message.includes('public-cookie'),
  );
});

test('server-only config loader sanitizes file and payload errors', () => {
  const publicConfig = {
    partyId: 'party-one',
    clientVersion: 'fixture-version',
    cookieFile: '.secrets/geoguessr.json',
  };
  for (const readFile of [
    () => {
      throw new Error('private-cookie path failed');
    },
    () => JSON.stringify({ cookie: '' }),
  ]) {
    assert.throws(
      () => loadConnectionConfig(publicConfig, { env: {}, readFile }),
      (error: unknown) =>
        error instanceof Error &&
        error.message === 'Unable to load GeoGuessr credentials' &&
        !error.message.includes('private-cookie'),
    );
  }
});

test('default ws adapter authenticates the handshake and handles error events', () => {
  let ws: FakeWs | undefined;
  class FakeWs extends EventEmitter {
    static readonly OPEN = 1;
    readonly readyState = FakeWs.OPEN;
    readonly sent: string[] = [];
    readonly url: string;
    readonly options: { headers?: Record<string, string> };
    closed = false;

    constructor(url: string, options: { headers?: Record<string, string> }) {
      super();
      this.url = url;
      this.options = options;
      ws = this;
    }

    send(text: string): void {
      this.sent.push(text);
    }

    close(): void {
      this.closed = true;
    }
  }
  const deps = createDefaultConnectionDeps({
    WebSocket: FakeWs,
    fetch: async () => new Response(),
  });
  const port = deps.openSocket(
    'wss://gs2.geoguessr.com/node/lobby/spectate/ws?c=web-fixture-version',
    'private-cookie',
  );
  let closeCode: number | undefined;
  port.onClose((code) => {
    closeCode = code;
  });

  assert.equal(ws?.options.headers?.Cookie, '_ncfa=private-cookie');
  assert.equal(ws?.options.headers?.['X-Client'], 'web-fixture-version');
  assert.doesNotThrow(() => ws?.emit('error', new Error('handshake failed with private-cookie')));
  assert.equal(closeCode, 1006);
  assert.equal(ws?.closed, true);
});
