import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';
import type NodeCG from '@nodecg/types';

import { DEFAULT_APPLICATION_CONFIG } from '../schema.ts';
import type { ConfigStore, InstallationRoots } from '../types.ts';
import { initializeConfiguration, registerConfiguration } from '../../extension/config/register.ts';
import { createConfigStore } from '../../extension/config/store.ts';
import { registerSheet } from '../../extension/sheet.ts';
import { registerStartgg } from '../../extension/startgg.ts';
import { registerPresenter } from '../../extension/presenter/register.ts';
import { CONFIGURATION_MESSAGES, REPLICANTS, SHEET_MESSAGES, STARTGG_MESSAGES } from '../../types/replicants.ts';

type Handler = (data: unknown, ack?: (error: unknown, value?: unknown) => void) => void;

function fakeNodecg(proxyOwnership = false) {
  const replicants = new Map<string, EventEmitter & { value: any; options: any }>();
  const listeners = new Map<string, Handler>();
  const http = express();
  const owners = new WeakMap<object, string>();
  function own(input: unknown, name: string): unknown {
    if (!proxyOwnership || typeof input !== 'object' || input === null) return input;
    const prior = owners.get(input);
    if (prior && prior !== name) throw new Error(`Cross-Replicant object: ${prior} -> ${name}`);
    owners.set(input, name);
    for (const value of Object.values(input)) own(value, name);
    return new Proxy(input, {});
  }
  const nodecg = {
    bundleConfig: {},
    Replicant(name: string, options: any = {}) {
      const existing = replicants.get(name);
      if (existing) return existing;
      let stored = own(options.defaultValue, name);
      const rep = Object.assign(new EventEmitter(), { options }) as EventEmitter & { value: unknown; options: unknown };
      Object.defineProperty(rep, 'value', {
        enumerable: true,
        get() { return stored; },
        set(next: unknown) {
          const previous = stored;
          stored = own(next, name);
          rep.emit('change', stored, previous);
        },
      });
      replicants.set(name, rep);
      return rep;
    },
    listenFor(name: string, handler: Handler) { listeners.set(name, handler); },
    Router: express.Router,
    mount(route: string, router: express.Router) { http.use(route, router); },
    log: { info() {}, warn() {}, error() {} },
  } as unknown as NodeCG.ServerAPI;
  function message(name: string, data?: unknown): { error: unknown; value: unknown } {
    let response = { error: undefined as unknown, value: undefined as unknown };
    listeners.get(name)?.(data, (error, value) => { response = { error, value }; });
    return response;
  }
  return { nodecg, replicants, listeners, message, http };
}

function roots(): { directory: string; roots: InstallationRoots } {
  const directory = mkdtempSync(path.join(tmpdir(), 'rashinban-config-register-'));
  const sharedRoot = path.join(directory, 'main');
  const appRoot = path.join(directory, 'worktree');
  mkdirSync(path.join(sharedRoot, 'cfg'), { recursive: true });
  mkdirSync(path.join(appRoot, 'cfg'), { recursive: true });
  return { directory, roots: { appRoot, sharedRoot, isWorktree: true } };
}

test('dashboard settings save to a sparse local file through nonpersistent projections', () => {
  const fixture = roots();
  const sharedFile = path.join(fixture.roots.sharedRoot, 'cfg', 'rashinban.json');
  writeFileSync(sharedFile, `${JSON.stringify({ schemaVersion: 1, sheet: { ...DEFAULT_APPLICATION_CONFIG.sheet, sheetId: 'shared' } })}\n`);
  const store = createConfigStore({ roots: fixture.roots, watch: false });
  const app = fakeNodecg(true);
  registerConfiguration(app.nodecg, store, fixture.roots);
  registerSheet(app.nodecg, express.Router(), store);

  for (const name of [REPLICANTS.configurationStatus, REPLICANTS.presenterPublicConfig, REPLICANTS.presenterSettings,
    REPLICANTS.presenterMedia, REPLICANTS.sheetConfig, REPLICANTS.startggConfig]) {
    assert.equal(app.replicants.get(name)?.options.persistent, false, name);
  }
  const revision = app.replicants.get(REPLICANTS.configurationStatus)?.value.revision;
  const result = app.message(SHEET_MESSAGES.setConfig, { sheetUrl: 'https://docs.google.com/spreadsheets/d/local/edit#gid=9', revision });
  assert.equal(result.error, null);
  const local = JSON.parse(readFileSync(path.join(fixture.roots.appRoot, 'cfg', 'rashinban.local.json'), 'utf8'));
  assert.deepEqual(local, { sheet: { sheetId: 'local', playersGid: '9' } });
  assert.equal(JSON.parse(readFileSync(sharedFile, 'utf8')).sheet.sheetId, 'shared');
  assert.equal(app.replicants.get(REPLICANTS.sheetConfig)?.value.sheetId, 'local');
});

test('a failed settings write rejects the request and leaves every projection unchanged', () => {
  const fixture = roots();
  const store = createConfigStore({ roots: fixture.roots, watch: false, fileSystem: {
    writeAtomic() { throw new Error('test disk failure'); },
  } });
  const app = fakeNodecg();
  registerConfiguration(app.nodecg, store, fixture.roots);
  registerSheet(app.nodecg, express.Router(), store);
  const before = structuredClone(app.replicants.get(REPLICANTS.sheetConfig)?.value);
  const result = app.message(SHEET_MESSAGES.setConfig, { enabled: true, revision: store.status().revision });
  assert.match(String((result.error as Error)?.message), /test disk failure/);
  assert.deepEqual(app.replicants.get(REPLICANTS.sheetConfig)?.value, before);
  assert.deepEqual(store.get().sheet, before);
});

test('configuration updates publish detached values under NodeCG proxy ownership', () => {
  const fixture = roots();
  const store = createConfigStore({ roots: fixture.roots, watch: false });
  const app = fakeNodecg(true);
  registerConfiguration(app.nodecg, store, fixture.roots);

  assert.doesNotThrow(() => store.save('presenterSettings', {
    ...DEFAULT_APPLICATION_CONFIG.presenter.settings,
    viewSource: 'rendered',
  }));
  assert.equal(app.replicants.get(REPLICANTS.presenterSettings)?.value.viewSource, 'rendered');
  assert.equal(app.replicants.get(REPLICANTS.configurationStatus)?.value.error, null);
});

test('saving one section does not republish unrelated configuration projections', () => {
  const fixture = roots();
  const store = createConfigStore({ roots: fixture.roots, watch: false });
  const app = fakeNodecg(true);
  registerConfiguration(app.nodecg, store, fixture.roots);
  let settingsChanges = 0;
  let mediaChanges = 0;
  app.replicants.get(REPLICANTS.presenterSettings)?.on('change', () => { settingsChanges += 1; });
  app.replicants.get(REPLICANTS.presenterMedia)?.on('change', () => { mediaChanges += 1; });

  store.save('sheetConfig', { ...store.get().sheet, enabled: true });

  assert.equal(settingsChanges, 0);
  assert.equal(mediaChanges, 0);
});

test('reset and import are revision checked, worktree scoped, and import only the selected legacy section', () => {
  const fixture = roots();
  const imported = { ...DEFAULT_APPLICATION_CONFIG.sheet, sheetId: 'legacy' };
  const store = createConfigStore({ roots: fixture.roots, watch: false });
  const app = fakeNodecg();
  registerConfiguration(app.nodecg, store, fixture.roots, {
    readLegacy: () => ({ sheetConfig: imported, presenterSettings: { ...DEFAULT_APPLICATION_CONFIG.presenter.settings, muted: true } }),
  });

  const stale = app.message(CONFIGURATION_MESSAGES.importLocal, { section: 'sheetConfig', revision: 'stale' });
  assert.match(String((stale.error as Error)?.message), /stale/i);
  const importedResult = app.message(CONFIGURATION_MESSAGES.importLocal, { section: 'sheetConfig', revision: store.status().revision });
  assert.equal(importedResult.error, null);
  assert.equal(store.get().sheet.sheetId, 'legacy');
  assert.deepEqual(store.get().presenter.settings, DEFAULT_APPLICATION_CONFIG.presenter.settings);
  const reset = app.message(CONFIGURATION_MESSAGES.reset, { section: 'sheetConfig', revision: store.status().revision });
  assert.equal(reset.error, null);
  assert.deepEqual(store.get().sheet, DEFAULT_APPLICATION_CONFIG.sheet);
});

test('presenter settings save through the store without changing a running duel rule', () => {
  const fixture = roots();
  const sharedFile = path.join(fixture.roots.sharedRoot, 'cfg', 'rashinban.json');
  writeFileSync(sharedFile, `${JSON.stringify({ schemaVersion: 1, presenter: {
    input: 'replay', replayFixture: 'gs2-ws-full-duel-sequence-manual-rounds.json',
    settings: { ...DEFAULT_APPLICATION_CONFIG.presenter.settings, tieRange: { enabled: true, mode: 'full' } },
  } })}\n`);
  const store = createConfigStore({ roots: fixture.roots, watch: false });
  const app = fakeNodecg();
  registerConfiguration(app.nodecg, store, fixture.roots);
  const scheduled: Array<{ fn: () => void; at: number; active: boolean }> = [];
  let now = 1_900_000_000_000;
  registerPresenter(app.nodecg, {
    now: () => now,
    schedule(fn, delay) {
      const task = { fn, at: now + delay, active: true };
      scheduled.push(task);
      return () => { task.active = false; };
    },
  }, store);
  for (let index = 0; index < 100 && !app.replicants.get(REPLICANTS.presenterDuel)?.value; index += 1) {
    const next = scheduled.filter(task => task.active).sort((left, right) => left.at - right.at)[0];
    assert.ok(next);
    now = next.at;
    next.active = false;
    next.fn();
  }
  assert.equal(app.replicants.get(REPLICANTS.presenterDuel)?.value.tieRange.mode, 'full');

  const result = app.message('presenter:control', { action: 'settings', revision: store.status().revision, body: {
    ...store.get().presenter.settings,
    tieRange: { enabled: true, mode: 'half' },
  } });
  assert.equal(result.error, null);
  assert.equal(store.get().presenter.settings.tieRange.mode, 'half');
  assert.equal(app.replicants.get(REPLICANTS.presenterSettings)?.options.persistent, false);
  assert.equal(app.replicants.get(REPLICANTS.presenterDuel)?.value.tieRange.mode, 'full');
});

test('start.gg retains its normalization before saving to the store', () => {
  const fixture = roots();
  const store = createConfigStore({ roots: fixture.roots, watch: false });
  const app = fakeNodecg();
  registerConfiguration(app.nodecg, store, fixture.roots);
  registerStartgg(app.nodecg, express.Router(), store);
  const result = app.message(STARTGG_MESSAGES.setConfig, {
    eventSlug: 'https://www.start.gg/tournament/example/event/main/',
    tournamentSlug: '  tournament/example  ',
    pollIntervalMs: 1,
    revision: store.status().revision,
  });
  assert.equal(result.error, null);
  assert.equal(store.get().startgg.eventSlug, 'tournament/example/event/main');
  assert.equal(store.get().startgg.tournamentSlug, 'tournament/example');
  assert.equal(store.get().startgg.pollIntervalMs, 10_000);
});

test('initialization loads shared credentials before publishing launch-only public defaults', () => {
  const fixture = roots();
  writeFileSync(path.join(fixture.roots.sharedRoot, 'cfg', 'rashinban.json'), `${JSON.stringify({
    schemaVersion: 1, presenter: { googleMapsApiKey: 'temporary-public-maps-key' },
  })}\n`);
  writeFileSync(path.join(fixture.roots.sharedRoot, '.env'), 'STARTGG_TOKEN=temporary-token\nGEOGUESSR_NCFA=temporary-cookie\n');
  const app = fakeNodecg();
  const env: NodeJS.ProcessEnv = {
    RASHINBAN_PRESENTER_INPUT: 'replay',
    RASHINBAN_PRESENTER_REPLAY_FIXTURE: 'gs2-ws-full-duel-sequence.json',
  };
  const initialized = initializeConfiguration(app.nodecg, { roots: fixture.roots, env, watch: false });
  assert.equal(env.STARTGG_TOKEN, 'temporary-token');
  assert.equal(env.GEOGUESSR_NCFA, 'temporary-cookie');
  assert.deepEqual(app.replicants.get(REPLICANTS.presenterPublicConfig)?.value, {
    googleMapsApiKey: 'temporary-public-maps-key', input: 'replay', replayFixture: 'gs2-ws-full-duel-sequence.json', partyId: null, clientVersion: '1.7695-a61479c',
  });
  assert.doesNotMatch(JSON.stringify([...app.replicants.values()].map(rep => rep.value)), /temporary-(?:token|cookie)/);
  initialized.store.dispose();
});

test('an external shared-file change reaches a worktree projection', async () => {
  const fixture = roots();
  const sharedFile = path.join(fixture.roots.sharedRoot, 'cfg', 'rashinban.json');
  writeFileSync(sharedFile, `${JSON.stringify({ schemaVersion: 1, sheet: { ...DEFAULT_APPLICATION_CONFIG.sheet, sheetId: 'first' } })}\n`);
  const store = createConfigStore({ roots: fixture.roots, watch: true });
  const app = fakeNodecg(true);
  registerConfiguration(app.nodecg, store, fixture.roots);
  const changed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('shared configuration watcher timed out')), 2_000);
    app.replicants.get(REPLICANTS.sheetConfig)?.on('change', (value: any) => {
      if (value.sheetId === 'second') { clearTimeout(timer); resolve(); }
    });
  });
  writeFileSync(sharedFile, `${JSON.stringify({ schemaVersion: 1, sheet: { ...DEFAULT_APPLICATION_CONFIG.sheet, sheetId: 'second' } })}\n`);
  await changed;
  assert.equal(app.replicants.get(REPLICANTS.sheetConfig)?.value.sheetId, 'second');
  store.dispose();
});

test('external connection defaults do not switch active input and are used on explicit reconnect', async () => {
  const fixture = roots();
  const sharedFile = path.join(fixture.roots.sharedRoot, 'cfg', 'rashinban.json');
  writeFileSync(sharedFile, `${JSON.stringify({ schemaVersion: 1, presenter: {
    input: 'replay', replayFixture: 'gs2-ws-full-duel-sequence.json', partyId: 'old-party', clientVersion: 'fixture',
  } })}\n`);
  const store = createConfigStore({ roots: fixture.roots, watch: true });
  const app = fakeNodecg();
  registerConfiguration(app.nodecg, store, fixture.roots);
  const urls: string[] = [];
  const previousCookie = process.env.GEOGUESSR_NCFA;
  process.env.GEOGUESSR_NCFA = 'test-only';
  try {
    registerPresenter(app.nodecg, { now: () => 1_900_000_000_000, schedule: () => () => {}, connection: {
      now: () => 1_900_000_000_000,
      schedule: () => () => {},
      async fetch(url) {
        urls.push(String(url));
        return new Response(JSON.stringify(String(url).includes('/profiles/')
          ? { user: { id: 'spectator' } }
          : { partyId: 'new-party', lobbyId: null }));
      },
      openSocket() { throw new Error('No active lobby'); },
    } }, store);
    const updated = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('connection defaults watcher timed out')), 2_000);
      app.replicants.get(REPLICANTS.presenterConnection)?.on('change', (value: any) => {
        if (value.configuredPartyId === 'new-party') { clearTimeout(timer); resolve(); }
      });
    });
    writeFileSync(sharedFile, `${JSON.stringify({ schemaVersion: 1, presenter: {
      input: 'live', replayFixture: 'gs2-ws-full-duel-sequence-manual-rounds.json', partyId: 'new-party', clientVersion: 'fixture',
    } })}\n`);
    await updated;
    assert.equal(app.replicants.get(REPLICANTS.presenterConnection)?.value.input, 'replay');
    const result = app.message('presenter:control', { action: 'reconnect', body: { input: 'live' } });
    assert.equal(result.error, null);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(urls.some(url => url.endsWith('/new-party')));
  } finally {
    store.dispose();
    if (previousCookie === undefined) delete process.env.GEOGUESSR_NCFA;
    else process.env.GEOGUESSR_NCFA = previousCookie;
  }
});

test('presenter HTTP shortcuts use the same revision-checked store save while legacy callers remain valid', async () => {
  const fixture = roots();
  const store = createConfigStore({ roots: fixture.roots, watch: false, launchOverrides: { presenter: { input: 'replay' } } });
  const app = fakeNodecg();
  registerConfiguration(app.nodecg, store, fixture.roots);
  registerPresenter(app.nodecg, { now: () => 1_900_000_000_000, schedule: () => () => {} }, store);
  const server = app.http.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const post = (action: string, revision?: string) => fetch(`http://127.0.0.1:${address.port}/rashinban/presenter/${action}`, {
    method: 'POST', headers: revision ? { 'x-rashinban-config-revision': revision } : undefined,
  });
  try {
    const revision = store.status().revision;
    assert.equal((await post('mute', revision)).status, 200);
    assert.equal(store.get().presenter.settings.muted, true);
    const stale = await post('view/chroma', revision);
    assert.equal(stale.status, 400);
    assert.match((await stale.json() as { error: string }).error, /stale/i);
    assert.equal((await post('view/rendered')).status, 200);
    assert.equal(store.get().presenter.settings.viewSource, 'rendered');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.dispose();
  }
});
