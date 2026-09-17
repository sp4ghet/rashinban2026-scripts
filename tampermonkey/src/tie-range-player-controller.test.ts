import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createPlayerTieRangeController,
  type PlayerFetch,
  type PlayerTieRangeView,
} from './tie-range-player-controller.ts';
import {
  acceptPlayerSnapshot,
  savePlayerContext,
  type PlayerTieRangeStorage,
} from './tie-range-player-state.ts';

const captured = JSON.parse(readFileSync(
  new URL('../../docs/geoguessr/samples/player-tie-range/player-rest-full.json', import.meta.url),
  'utf8',
)) as any;

function game(gameId = 'player-rest-full', version = 49): unknown {
  const value = structuredClone(captured);
  value.gameId = gameId;
  value.version = version;
  return value;
}

class MemoryStorage implements PlayerTieRangeStorage {
  readonly values = new Map<string, unknown>();
  get(key: string): unknown { return this.values.get(key); }
  set(key: string, value: unknown): void { this.values.set(key, value); }
  remove(key: string): void { this.values.delete(key); }
}

class FakeClock {
  nowMs = 0;
  private nextId = 1;
  private tasks = new Map<number, { at: number; callback: () => void }>();

  readonly setTimeout = (callback: () => void, delay: number): number => {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.nowMs + Math.max(0, delay), callback });
    return id;
  };

  readonly clearTimeout = (id: unknown): void => {
    this.tasks.delete(id as number);
  };

  async advance(ms: number): Promise<void> {
    const target = this.nowMs + ms;
    for (;;) {
      const due = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (!due) break;
      this.tasks.delete(due[0]);
      this.nowMs = due[1].at;
      due[1].callback();
      await flush();
    }
    this.nowMs = target;
    await flush();
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 40; index += 1) await Promise.resolve();
}

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const PHONEBOOK_PREFIX = '/api/v4/game-server/phonebook/';

function activeFetch(
  fetchGame: PlayerFetch,
  nodeForGame: (gameId: string) => string = () => 'node-1',
): PlayerFetch {
  return async (url, init) => {
    if (url.startsWith(PHONEBOOK_PREFIX)) {
      const gameId = decodeURIComponent(url.slice(PHONEBOOK_PREFIX.length));
      return response({
        gameId,
        gameServerNodeId: nodeForGame(gameId),
        status: 'Active',
      });
    }
    return fetchGame(url, init);
  };
}

function harness(fetch: PlayerFetch, overrides: {
  path?: string;
  mode?: 'off' | 'full' | 'half';
  storage?: MemoryStorage;
  userId?: string | null;
} = {}) {
  const clock = new FakeClock();
  const storage = overrides.storage ?? new MemoryStorage();
  let path = overrides.path ?? '/ja/duels/player-rest-full';
  let mode = overrides.mode ?? 'full';
  const views: PlayerTieRangeView[] = [];
  const controller = createPlayerTieRangeController({
    fetch,
    storage,
    now: () => clock.nowMs,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    getPath: () => path,
    getUserId: () => overrides.userId === undefined ? 'player-blue' : overrides.userId,
    getConfiguredMode: () => mode,
    onView: view => views.push(view),
  });
  return {
    clock,
    storage,
    views,
    controller,
    setPath(value: string) { path = value; },
    setMode(value: 'off' | 'full' | 'half') { mode = value; },
  };
}

test('resolves the live game node and fetches player state immediately with credentials only', async () => {
  const calls: Array<{ url: string; init: Parameters<PlayerFetch>[1] }> = [];
  const h = harness(async (url, init) => {
    calls.push({ url, init });
    if (url.startsWith(PHONEBOOK_PREFIX)) {
      return response({
        gameId: 'player-rest-full',
        gameServerNodeId: 'node-1',
        status: 'Active',
      });
    }
    return response(game());
  });

  h.controller.start();
  await flush();

  assert.deepEqual(calls.map(call => call.url), [
    '/api/v4/game-server/phonebook/player-rest-full',
    'https://gs2.geoguessr.com/node-1/player-rest-full',
  ]);
  for (const call of calls) {
    assert.deepEqual({
      method: call.init.method,
      credentials: call.init.credentials,
    }, { method: 'GET', credentials: 'include' });
    assert.ok(call.init.signal instanceof AbortSignal);
  }
  assert.equal(h.views.at(-1)?.status, 'ready');
  assert.equal(h.views.at(-1)?.localTeamId, 'team-blue');
  assert.deepEqual(h.views.at(-1)?.output?.currentHealth, [0, 5644]);
});

test('discovers a party lobby duel before reading its player state', async () => {
  const calls: string[] = [];
  const h = harness(async url => {
    calls.push(url);
    if (url.endsWith('/api/v4/parties/v2/active')) {
      return response({
        partyId: 'party-1',
        lobbyId: 'player-rest-full',
        gameState: 'Ongoing',
        gameType: 'TeamDuels',
        owner: { userId: 'host-user' },
        partySettings: { masterControl: true },
      });
    }
    if (url === `${PHONEBOOK_PREFIX}player-rest-full`) {
      return response({ gameId: 'player-rest-full', gameServerNodeId: 'node-1', status: 'Active' });
    }
    return response(game());
  }, { path: '/ja/party/lobby/JOIN?from=invite' });

  h.controller.start();
  await flush();

  assert.deepEqual(calls, [
    '/api/v4/parties/v2/active',
    '/api/v4/game-server/phonebook/player-rest-full',
    'https://gs2.geoguessr.com/node-1/player-rest-full',
  ]);
  assert.equal(h.views.at(-1)?.status, 'ready');
  assert.equal(h.views.at(-1)?.gameId, 'player-rest-full');
});

test('retains the discovered terminal HUD when active-party discovery becomes 204', async () => {
  let calls = 0;
  const h = harness(async url => {
    calls += 1;
    if (calls === 1) {
      return response({
        partyId: 'party-1',
        lobbyId: 'player-rest-full',
        gameState: 'Ongoing',
        gameType: 'Duels',
        owner: { userId: 'host-user' },
      });
    }
    if (calls === 2) {
      return response({ gameId: 'player-rest-full', gameServerNodeId: 'node-1', status: 'Active' });
    }
    if (calls === 3) return response(game());
    assert.ok(url.endsWith('/api/v4/parties/v2/active'));
    return { ok: true, status: 204, json: async () => { throw new Error('no body'); } };
  }, { path: '/party/lobby' });

  h.controller.start();
  await flush();
  assert.equal(h.views.at(-1)?.status, 'ready');
  await h.clock.advance(2500);

  assert.equal(calls, 4);
  assert.equal(h.views.at(-1)?.status, 'ended');
  assert.equal(h.views.at(-1)?.gameId, 'player-rest-full');
  assert.deepEqual(h.views.at(-1)?.output?.terminal, {
    round: 5,
    winnerTeamId: 'team-red',
    isDraw: false,
  });
});

test('retains a same-party terminal NoGame but clears it for a different party', async () => {
  let activeCalls = 0;
  const h = harness(async url => {
    if (url.endsWith('/api/v4/parties/v2/active')) {
      activeCalls += 1;
      if (activeCalls === 1) {
        return response({
          partyId: 'party-1',
          lobbyId: 'player-rest-full',
          gameState: 'Ongoing',
          gameType: 'Duels',
          owner: { userId: 'host-user' },
        });
      }
      return response({
        partyId: activeCalls === 2 ? 'party-1' : 'party-2',
        gameState: 'NoGame',
      });
    }
    if (url.startsWith(PHONEBOOK_PREFIX)) {
      return response({ gameId: 'player-rest-full', gameServerNodeId: 'node-1', status: 'Active' });
    }
    return response(game());
  }, { path: '/party/lobby' });

  h.controller.start();
  await flush();
  await h.clock.advance(2500);
  assert.equal(h.views.at(-1)?.status, 'ended');
  assert.equal(h.views.at(-1)?.gameId, 'player-rest-full');
  assert.ok(h.views.at(-1)?.output?.terminal);

  await h.clock.advance(2500);
  assert.equal(h.views.at(-1)?.status, 'waiting');
  assert.equal(h.views.at(-1)?.gameId, null);
  assert.equal(h.views.at(-1)?.output, null);
});

test('does not attach a master-control party owner as a player', async () => {
  const h = harness(async url => {
    assert.ok(url.endsWith('/api/v4/parties/v2/active'));
    return response({
      partyId: 'party-1',
      lobbyId: 'player-rest-full',
      gameState: 'Ongoing',
      gameType: 'Duels',
      owner: { userId: 'player-blue' },
      partySettings: { masterControl: true },
    });
  }, { path: '/party/lobby' });

  h.controller.start();
  await flush();

  assert.equal(h.views.at(-1)?.status, 'unavailable');
  assert.match(h.views.at(-1)?.message ?? '', /game master/i);
});

test('does not expose a custom player HUD to a known account outside both teams', async () => {
  const h = harness(activeFetch(async () => response(game())), { userId: 'spectator-user' });

  h.controller.start();
  await flush();

  assert.equal(h.views.at(-1)?.status, 'unavailable');
  assert.match(h.views.at(-1)?.message ?? '', /not a player/i);
  assert.equal(h.views.at(-1)?.localTeamId, null);
});

test('discards an old-game response that resolves after navigation', async () => {
  const old = deferred<ReturnType<typeof response>>();
  const calls: string[] = [];
  const h = harness(activeFetch(async url => {
    calls.push(url);
    return calls.length === 1 ? old.promise : response(game('new-game', 1));
  }));

  h.controller.start();
  await flush();
  h.setPath('/duels/new-game');
  h.controller.routeChanged();
  await flush();
  old.resolve(response(game('player-rest-full', 50)));
  await flush();

  assert.equal(calls.length, 2);
  assert.equal(h.views.at(-1)?.gameId, 'new-game');
  assert.equal(h.views.at(-1)?.context?.sourceVersion, 1);
});

test('a late old request cannot clear the replacement request timeout', async () => {
  const old = deferred<ReturnType<typeof response>>();
  let calls = 0;
  const replacement = { signal: null as AbortSignal | null };
  const h = harness(activeFetch(async (_url, init) => {
    calls += 1;
    if (calls === 1) return old.promise;
    replacement.signal = init.signal;
    return new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  }));

  h.controller.start();
  await flush();
  h.setPath('/duels/new-game');
  h.controller.routeChanged();
  await flush();
  old.resolve(response(game()));
  await flush();
  h.controller.refresh();
  await flush();
  assert.equal(calls, 2);
  await h.clock.advance(8000);

  assert.equal(replacement.signal?.aborted, true);
  assert.equal(h.views.at(-1)?.status, 'reconnecting');
});

test('coalesces repeated focus refreshes while a request is in flight', async () => {
  const pending = deferred<ReturnType<typeof response>>();
  let active = 0;
  let maximum = 0;
  let calls = 0;
  const h = harness(activeFetch(async () => {
    calls += 1;
    active += 1;
    maximum = Math.max(maximum, active);
    const value = await pending.promise;
    active -= 1;
    return value;
  }));

  h.controller.start();
  await flush();
  h.controller.refresh();
  h.controller.refresh();
  await flush();
  assert.equal(calls, 1);
  assert.equal(maximum, 1);

  pending.resolve(response(game()));
  await flush();
  assert.equal(calls, 1);
});

test('keeps verified output through failures and marks it stale after ten seconds', async () => {
  let calls = 0;
  const h = harness(activeFetch(async () => {
    calls += 1;
    if (calls === 1) return response(game());
    throw new Error('offline');
  }));

  h.controller.start();
  await flush();
  await h.clock.advance(2500);
  assert.equal(h.views.at(-1)?.status, 'reconnecting');
  assert.deepEqual(h.views.at(-1)?.output?.currentHealth, [0, 5644]);

  await h.clock.advance(7500);
  assert.equal(h.views.at(-1)?.status, 'stale');
  assert.equal(h.views.at(-1)?.message, 'HP may be out of date');
  assert.deepEqual(h.views.at(-1)?.output?.currentHealth, [0, 5644]);
});

test('aborts requests after eight seconds and retries with capped exponential backoff', async () => {
  const callTimes: number[] = [];
  const h = harness(activeFetch((_url, init) => {
    callTimes.push(h.clock.nowMs);
    return new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  }));

  h.controller.start();
  await flush();
  await h.clock.advance(8000);
  assert.equal(h.views.at(-1)?.status, 'reconnecting');
  await h.clock.advance(4999);
  assert.deepEqual(callTimes, [0]);
  await h.clock.advance(1);
  assert.deepEqual(callTimes, [0, 13000]);

  await h.clock.advance(8000 + 10000 + 8000 + 20000 + 8000 + 30000);
  assert.deepEqual(callTimes, [0, 13000, 31000, 59000, 97000]);
});

test('shows auth failures gracefully and stops polling when navigation leaves a duel', async () => {
  let calls = 0;
  const h = harness(activeFetch(async () => {
    calls += 1;
    return calls === 1 ? response(game()) : response({}, 401);
  }));

  h.controller.start();
  await flush();
  await h.clock.advance(2500);
  assert.equal(h.views.at(-1)?.status, 'auth-error');
  assert.deepEqual(h.views.at(-1)?.output?.currentHealth, [0, 5644]);

  h.setPath('/maps/world');
  h.controller.routeChanged();
  await flush();
  assert.equal(h.views.at(-1)?.status, 'inactive');
  await h.clock.advance(60000);
  assert.equal(calls, 2);
});

test('restores the captured mode and output before the refresh resolves', async () => {
  const storage = new MemoryStorage();
  const saved = acceptPlayerSnapshot(null, game(), 'half').context;
  assert.ok(saved);
  await savePlayerContext(storage, saved);
  const pending = deferred<ReturnType<typeof response>>();
  const h = harness(activeFetch(async () => pending.promise), { mode: 'full', storage });

  h.controller.start();
  await flush();

  assert.equal(h.views.at(-1)?.status, 'stale');
  assert.equal(h.views.at(-1)?.capturedMode, 'half');
  assert.equal(h.views.at(-1)?.configuredMode, 'full');
  assert.equal(h.views.at(-1)?.appliesToNextDuel, true);
  assert.ok(h.views.at(-1)?.output);
  h.controller.dispose();
});

test('uses the legacy archive after the observed Finished phonebook status', async () => {
  const calls: string[] = [];
  const h = harness(async url => {
    calls.push(url);
    if (url.startsWith(PHONEBOOK_PREFIX)) {
      return response({ gameId: 'player-rest-full', gameServerNodeId: null, status: 'Finished' });
    }
    return response(game());
  });

  h.controller.start();
  await flush();

  assert.deepEqual(calls, [
    '/api/v4/game-server/phonebook/player-rest-full',
    'https://game-server.geoguessr.com/api/duels/player-rest-full',
  ]);
  assert.equal(h.views.at(-1)?.status, 'ready');
});

test('refreshes a stale active node after 404 without accepting the archive endpoint', async () => {
  const calls: string[] = [];
  let phonebookCalls = 0;
  const h = harness(async url => {
    calls.push(url);
    if (url.startsWith(PHONEBOOK_PREFIX)) {
      phonebookCalls += 1;
      return response({
        gameId: 'player-rest-full',
        gameServerNodeId: phonebookCalls === 1 ? 'node-old' : 'node-new',
        status: 'Active',
      });
    }
    if (url.includes('/node-old/')) return response({}, 404);
    return response(game());
  });

  h.controller.start();
  await flush();

  assert.deepEqual(calls, [
    '/api/v4/game-server/phonebook/player-rest-full',
    'https://gs2.geoguessr.com/node-old/player-rest-full',
    '/api/v4/game-server/phonebook/player-rest-full',
    'https://gs2.geoguessr.com/node-new/player-rest-full',
  ]);
  assert.equal(h.views.at(-1)?.status, 'ready');
  assert.ok(calls.every(url => !url.includes('/api/duels/')));
});

test('a response body for another game never attaches under the requested route', async () => {
  const h = harness(activeFetch(async () => response(game('wrong-game'))));
  h.controller.start();
  await flush();
  assert.equal(h.views.at(-1)?.context, null);
  assert.equal(h.views.at(-1)?.output, null);
  assert.equal(h.views.at(-1)?.status, 'reconnecting');
  h.controller.dispose();
});

test('saved HP is stale when a reload cannot fetch current state', async () => {
  const storage = new MemoryStorage();
  await savePlayerContext(storage, acceptPlayerSnapshot(null, game(), 'full').context!);
  const h = harness(activeFetch(async () => { throw Error('offline'); }), {storage});
  h.controller.start();
  await flush();
  await h.clock.advance(10000);
  assert.equal(h.views.at(-1)?.status, 'stale');
  assert.deepEqual(h.views.at(-1)?.output?.currentHealth, [0, 5644]);
  h.controller.dispose();
});

test('an old party discovery response cannot clear a newer direct duel', async () => {
  const pending = deferred<ReturnType<typeof response>>();
  const h = harness(activeFetch(async url => url.endsWith('/parties/v2/active')
    ? pending.promise : response(game('new-game'))), {path:'/party/lobby'});
  h.controller.start();
  await flush();
  h.setPath('/duels/new-game');
  h.controller.routeChanged();
  await flush();
  assert.equal(h.views.at(-1)?.context?.gameId, 'new-game');
  pending.resolve(response({partyId:'old-party',gameState:'NoGame'}));
  await flush();
  assert.equal(h.views.at(-1)?.context?.gameId, 'new-game');
  assert.equal(h.views.at(-1)?.status, 'ready');
  h.controller.dispose();
});
test('retains a same-party terminal Finished with no lobby ID but clears it for a different party', async () => {
  let activeCalls = 0;
  const h = harness(async url => {
    if (url.endsWith('/api/v4/parties/v2/active')) {
      activeCalls += 1;
      if (activeCalls === 1) {
        return response({
          partyId: 'party-1',
          lobbyId: 'player-rest-full',
          gameState: 'Ongoing',
          gameType: 'Duels',
          owner: { userId: 'host-user' },
        });
      }
      return response({
        partyId: activeCalls === 2 ? 'party-1' : 'party-2',
        gameState: 'Finished', lobbyId: null,
      });
    }
    if (url.startsWith(PHONEBOOK_PREFIX)) {
      return response({ gameId: 'player-rest-full', gameServerNodeId: 'node-1', status: 'Active' });
    }
    return response(game());
  }, { path: '/party/lobby' });

  h.controller.start();
  await flush();
  await h.clock.advance(2500);
  assert.equal(h.views.at(-1)?.status, 'ended');
  assert.equal(h.views.at(-1)?.gameId, 'player-rest-full');
  assert.ok(h.views.at(-1)?.output?.terminal);

  await h.clock.advance(2500);
  assert.equal(h.views.at(-1)?.status, 'waiting');
  assert.equal(h.views.at(-1)?.gameId, null);
  assert.equal(h.views.at(-1)?.output, null);
});
