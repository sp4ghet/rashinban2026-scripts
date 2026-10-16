import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createPartyManager } from '../../extension/party/manager.ts';
import { parseDuel, parseParty, settingsPatch } from '../state.ts';
import type { PartyStatus } from '../types.ts';
import { decodeSnapshot } from '../../presenter/protocol.ts';
import { DEFAULT_SETTINGS, type PresenterSettings } from '../../presenter/settings.ts';
import { presetSettings } from '../presets.ts';

const sample = (name: string) => JSON.parse(readFileSync(new URL(`../../../../../docs/geoguessr/samples/${name}`, import.meta.url), 'utf8'));
function harness() {
  const party = sample('party.json');
  const raw = sample('gs2-ws-DuelStarted-created-not-started.json');
  const duel = raw.duel?.state ?? raw.message?.duel?.state ?? raw;
  party.partyId = 'party'; party.lobbyId = duel.gameId; party.owner.userId = 'host';
  duel.context = { type: 'Party', id: 'party' }; duel.gameMasterId = 'host'; duel.gameServerNodeId = 'node';
  const members = [{ ...party.owner, userId: 'blue', isBenched: false }, { ...party.owner, userId: 'red', isBenched: false }];
  let state: PartyStatus; let now = 100000; let selection = { input: 'live' as 'live' | 'replay', partyId: 'party' as string | null, generation: 'initial' };
  const calls: { url: string; method: string; body: any }[] = [];
  let mutate: (url: string, body: any) => Response | Promise<Response> = () => new Response(null, { status: 204 });
  let activeId = 'party';
  let beforeRead: (url: string) => void | Promise<void> = () => {};
  let presentation = structuredClone(DEFAULT_SETTINGS), presentationRevision = 0, presentationSaves = 0, failPresentation = false, ignorePresentation = false;
  const manager = createPartyManager({ cookie: 'SECRET', clientVersion: 'fixture', partyId: null }, {
    now: () => now, selection: () => selection, publish: value => { state = value; },
    presentation: { get: () => ({ settings: presentation, revision: String(presentationRevision) }),
      save(settings: PresenterSettings, revision: string) {
        presentationSaves++;
        if (failPresentation || revision !== String(presentationRevision)) throw new Error('Presenter configuration changed');
        if (ignorePresentation) return;
        presentation = settings; presentationRevision++;
      } },
    fetch: async (input, init) => {
      const url = String(input); const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (method !== 'GET') return mutate(url, body);
      await beforeRead(url);
      if (url.endsWith('/profiles/')) return Response.json({ user: { id: 'host', nick: 'Host' } });
      if (url.endsWith('/active')) return Response.json({ ...party, partyId: activeId });
      if (url.includes('/members?')) return Response.json({ members, totalCount: members.length });
      if (url.includes('/phonebook/')) return Response.json({ gameId: duel.gameId, gameServerNodeId: 'node', status: 'Active' });
      if (url.endsWith('/game-master')) return Response.json(duel);
      return Response.json(party);
    },
  });
  return { manager, party, duel, members, calls, get state() { return state!; }, set mutate(fn: typeof mutate) { mutate = fn; },
    get presentation() { return presentation; }, get presentationRevision() { return String(presentationRevision); }, get presentationSaves() { return presentationSaves; },
    editPresentation(patch: Partial<PresenterSettings>) { presentation = { ...presentation, ...patch }; presentationRevision++; },
    failPresentation() { failPresentation = true; },
    ignorePresentation() { ignorePresentation = true; },
    advance(ms: number) { now += ms; }, select(input: 'live' | 'replay') { selection = { ...selection, input, generation: crypto.randomUUID() }; },
    active(id: string) { activeId = id; },
    onRead(fn: typeof beforeRead) { beforeRead = fn; },
    request(action: string, body: unknown = {}) { return { id: `req-${calls.length}`, action, partyId: 'party', gameId: state!.duel?.gameId ?? null, round: state!.duel?.round ?? null, sourceGeneration: state!.sourceGeneration, body }; },
  };
}

test('public snapshots omit credentials, join tokens and future panoramas', () => {
  const party = sample('party.json'); party.chatAccessToken = 'SECRET';
  assert.equal(JSON.stringify(parseParty(party)).includes('SECRET'), false);
  const h = harness(); h.duel.rounds.push({ ...h.duel.rounds[0], roundNumber: 90, panorama: { lat: 88, lng: 77, panoId: 'FUTURE' } });
  const publicDuel = parseDuel(h.duel);
  assert.equal(publicDuel.round, h.duel.currentRoundNumber);
  assert.equal(JSON.stringify(publicDuel).includes('FUTURE'), false);
});

test('a present player still in game/results blocks the next duel until they return to the lobby', async () => {
  const h = harness(); h.party.gameState = 'Finished';
  h.members[0].isPlaying = true; h.members[0].isInCurrentGame = false;
  await h.manager.refresh();
  await assert.rejects(h.manager.command(h.request('startGame')), /return to the lobby/i);
  assert.equal(h.calls.filter(c => c.method !== 'GET').length, 0);
  h.members[0].isPlaying = false;
  h.mutate = () => { h.party.gameState = 'Ongoing'; h.party.lobbyId = 'next-game'; h.duel.gameId = 'next-game'; return new Response(null, { status: 204 }); };
  await h.manager.command(h.request('startGame'));
  assert.equal(h.state.activity[0].outcome, 'confirmed');
});

test('Team Duels waits for every selected player, but not benched members, to return', async () => {
  const h = harness(); h.party.gameState = 'NoGame'; h.party.gameType = 'TeamDuels'; h.party.lobbyId = null;
  h.members[0].team = 'blue'; h.members[1].team = 'red';
  h.members.push({ ...h.members[1], userId: 'third', isPlaying: true });
  await h.manager.refresh();
  await assert.rejects(h.manager.command(h.request('startGame')), /return to the lobby/i);
  assert.equal(h.calls.filter(c => c.method !== 'GET').length, 0);
  h.members[2].isBenched = true;
  await h.manager.command(h.request('startGame'));
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
});

test('settings validate editable fields and preserve unrelated settings in the service', async () => {
  assert.throws(() => settingsPatch({ gameSettings: { initialHealth: -1 } }), /health|initialHealth/i);
  assert.throws(() => settingsPatch({ settings: { surprise: true } }), /Unsupported/);
  const h = harness(); h.party.gameState = 'NoGame'; h.party.lobbyId = null;
  h.party.gameSettings.futureOption = 42;
  await h.manager.refresh();
  h.mutate = (_url, body) => { h.party.gameSettings = body.gameSettings; h.party.partySettings = body.settings; return Response.json({ message: 'OK' }); };
  await h.manager.command({ ...h.request('settings', { gameSettings: { initialHealth: 9000 } }), settingsRevision: h.state.settingsRevision });
  assert.equal(h.calls.find(c => c.method === 'PUT')?.body.gameSettings.futureOption, 42);
  assert.equal(h.state.activity[0].outcome, 'confirmed');
  assert.equal(h.state.party?.gameSettings.initialHealth, 9000);
});

test('preset confirms GeoGuessr settings before saving only its presenter rules', async () => {
  const h = harness(); h.party.gameState = 'NoGame'; h.party.lobbyId = null;
  h.editPresentation({ muted: true, tieRange: { enabled: false, mode: 'full' } });
  await h.manager.refresh();
  const preset = presetSettings('day2-moving');
  await h.manager.command({ ...h.request('settings', { ...preset, presenterRevision: h.presentationRevision }), settingsRevision: h.state.settingsRevision });
  assert.equal(h.presentationSaves, 0, 'an accepted write without matching state cannot change scoring');
  h.party.gameType = preset.gameType; Object.assign(h.party.gameSettings, preset.gameSettings); Object.assign(h.party.partySettings, preset.settings);
  await h.manager.refresh();
  assert.equal(h.state.activity[0].outcome, 'confirmed');
  assert.equal(h.presentation.pinpointing.enabled, true);
  assert.equal(h.presentation.muted, true);
  assert.deepEqual(h.presentation.tieRange, { enabled: true, mode: 'half' });
  await h.manager.refresh(); assert.equal(h.presentationSaves, 1);
  assert.equal('presenterRules' in h.calls.find(c => c.method === 'PUT')!.body, false);
});

test('a presenter revision conflict rejects a preset before the GeoGuessr write', async () => {
  const h = harness(); h.party.gameState = 'NoGame'; h.party.lobbyId = null; await h.manager.refresh();
  const request = { ...h.request('settings', { ...presetSettings('day2-moving'), presenterRevision: h.presentationRevision }), settingsRevision: h.state.settingsRevision };
  h.editPresentation({ muted: true });
  await assert.rejects(h.manager.command(request), /presenter.*changed/i);
  assert.equal(h.calls.filter(c => c.method !== 'GET').length, 0);
});

test('rejected GeoGuessr settings leave presenter rules unchanged', async () => {
  const h = harness(); h.party.gameState = 'NoGame'; h.party.lobbyId = null; await h.manager.refresh();
  h.mutate = () => new Response(null, { status: 400 });
  await h.manager.command({ ...h.request('settings', { ...presetSettings('day2-moving'), presenterRevision: h.presentationRevision }), settingsRevision: h.state.settingsRevision });
  assert.equal(h.presentationSaves, 0); assert.equal(h.presentation.pinpointing.enabled, false);
  assert.equal(h.state.activity[0].outcome, 'failed');
});

test('presenter save failure after GeoGuessr confirmation stays uncertain without retrying', async () => {
  const h = harness(); h.party.gameState = 'NoGame'; h.party.lobbyId = null; await h.manager.refresh();
  h.mutate = (_url, body) => { h.party.gameSettings = body.gameSettings; h.party.partySettings = body.settings; return new Response(null, { status: 204 }); };
  h.failPresentation();
  await h.manager.command({ ...h.request('settings', { ...presetSettings('day2-moving'), presenterRevision: h.presentationRevision }), settingsRevision: h.state.settingsRevision });
  assert.equal(h.state.activity[0].outcome, 'uncertain'); assert.match(h.state.activity[0].message, /presenter/i);
  await h.manager.refresh(); h.advance(20000); await h.manager.refresh();
  assert.equal(h.presentationSaves, 1); assert.match(h.state.activity[0].message, /presenter/i);
  await assert.rejects(h.manager.command(h.request('startGame')), /pending/i);
});

test('changes while awaiting preset confirmation cannot overwrite presenter rules', async () => {
  for (const change of ['configuration', 'selection', 'game', 'owner']) {
    const h = harness(); h.party.gameState = 'NoGame'; h.party.lobbyId = null; await h.manager.refresh();
    const preset = presetSettings('day2-moving');
    await h.manager.command({ ...h.request('settings', { ...preset, presenterRevision: h.presentationRevision }), settingsRevision: h.state.settingsRevision });
    Object.assign(h.party.gameSettings, preset.gameSettings); Object.assign(h.party.partySettings, preset.settings);
    if (change === 'configuration') h.editPresentation({ muted: true });
    if (change === 'selection') h.select('live');
    if (change === 'game') { h.party.gameState = 'Ongoing'; h.party.lobbyId = h.duel.gameId; }
    if (change === 'owner') h.party.owner.userId = 'other';
    await h.manager.refresh();
    assert.equal(h.state.activity[0].outcome, 'uncertain', change);
    assert.equal(h.presentation.pinpointing.enabled, false, change);
    assert.equal(h.calls.filter(c => c.method !== 'GET').length, 1, change);
  }
});

test('a presenter configuration override cannot silently confirm an unapplied rule', async () => {
  const h = harness(); h.party.gameState = 'NoGame'; h.party.lobbyId = null; await h.manager.refresh();
  h.mutate = (_url, body) => { h.party.gameSettings = body.gameSettings; h.party.partySettings = body.settings; return new Response(null, { status: 204 }); };
  h.ignorePresentation();
  await h.manager.command({ ...h.request('settings', { ...presetSettings('day2-moving'), presenterRevision: h.presentationRevision }), settingsRevision: h.state.settingsRevision });
  assert.equal(h.state.activity[0].outcome, 'uncertain');
  assert.equal(h.presentation.pinpointing.enabled, false);
  await assert.rejects(h.manager.command(h.request('startGame')), /pending/i);
});

test('replay and active-party mismatch never issue mutations', async () => {
  const h = harness(); await h.manager.refresh(); h.active('other');
  await assert.rejects(h.manager.command(h.request('startRound')), /active party/i);
  h.select('replay'); await h.manager.refresh();
  await assert.rejects(h.manager.command(h.request('startRound')), /Replay/i);
  assert.equal(h.calls.filter(c => c.method !== 'GET').length, 0);
});

test('204 is accepted, duplicate commands blocked, and confirmation requires changed state', async () => {
  const h = harness(); await h.manager.refresh(); const request = h.request('startRound');
  await h.manager.command(request);
  assert.equal(h.state.activity[0].outcome, 'accepted');
  await assert.rejects(h.manager.command(request), /pending|already|progress/i);
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
  h.duel.status = 'Ongoing'; h.duel.version++; h.duel.rounds[0].startTime = new Date().toISOString();
  await h.manager.refresh();
  assert.equal(h.state.activity[0].outcome, 'confirmed');
});

test('stale settings draft and game identity changes reject before writing', async () => {
  const h = harness(); h.party.gameState = 'NoGame'; h.party.lobbyId = null;
  await h.manager.refresh(); const request = { ...h.request('settings', { gameSettings: { initialHealth: 5000 } }), settingsRevision: h.state.settingsRevision };
  h.party.gameSettings.initialHealth = 7000;
  await assert.rejects(h.manager.command(request), /settings.*changed/i);
  h.party.gameState = 'Ongoing'; h.party.lobbyId = h.duel.gameId;
  await h.manager.refresh(); const old = h.request('abort');
  h.duel.gameId = 'replacement'; h.party.lobbyId = 'replacement';
  await assert.rejects(h.manager.command(old), /game.*changed/i);
  assert.equal(h.calls.filter(c => c.method !== 'GET').length, 0);
});

test('ambiguous mutation is not retried and raw errors never leak secrets', async () => {
  const h = harness(); await h.manager.refresh();
  h.mutate = () => { throw new Error('SECRET network trace'); };
  await h.manager.command(h.request('startRound'));
  assert.equal(h.state.activity[0].outcome, 'uncertain');
  assert.equal(JSON.stringify(h.state).includes('SECRET'), false);
  await assert.rejects(h.manager.command(h.request('startRound')), /pending|uncertain|verify/i);
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
});

test('rollback requires paused state and confirms a newer version at the target round', async () => {
  const h = harness(); h.duel.status = 'Ongoing'; h.duel.currentRoundNumber = 2;
  h.duel.rounds.push({ ...h.duel.rounds[0], roundNumber: 2 });
  await h.manager.refresh();
  await assert.rejects(h.manager.command(h.request('rollback', { roundNumber: 1 })), /paused/i);
  h.duel.isPaused = true; await h.manager.refresh();
  await h.manager.command(h.request('rollback', { roundNumber: 1 }));
  assert.equal(h.state.activity[0].outcome, 'accepted');
  h.duel.currentRoundNumber = 1; h.duel.version++; h.duel.isPaused = false;
  h.duel.rounds[0].startTime = new Date().toISOString();
  await h.manager.refresh(); assert.equal(h.state.activity[0].outcome, 'confirmed');
});

test('a party game or owner changing at the final session check blocks a write', async () => {
  for (const change of ['game', 'owner', 'settings']) {
    const h = harness(); await h.manager.refresh(); let activeReads = 0;
    h.onRead(url => {
      if (url.endsWith('/active') && ++activeReads === 2) {
        if (change === 'game') h.party.lobbyId = 'replacement';
        if (change === 'owner') h.party.owner.userId = 'someone-else';
        if (change === 'settings') h.party.gameSettings.initialHealth = 9999;
      }
    });
    await assert.rejects(h.manager.command(h.request('startRound')), /changed/i);
    assert.equal(h.calls.filter(c => c.method !== 'GET').length, 0);
  }
});

test('lobby roster operations use exact routes and confirm from refreshed roster', async () => {
  const h = harness(); h.party.gameState = 'NoGame'; h.party.lobbyId = null; await h.manager.refresh();
  h.mutate = (url, body) => {
    if (url.endsWith('/blue/bench')) h.members[0].isBenched = true;
    if (url.endsWith('/blue/move')) { assert.deepEqual(body, { secondMemberId: 'red' }); h.members.reverse(); }
    return new Response(null, { status: 204 });
  };
  await h.manager.command(h.request('bench', { userId: 'blue' }));
  assert.equal(h.state.activity[0].outcome, 'confirmed');
  await h.manager.command(h.request('swap', { userId: 'blue', secondMemberId: 'red' }));
  assert.equal(h.state.activity[0].outcome, 'confirmed');
  assert.equal(h.calls.filter(c => c.method === 'PUT').length, 2);
});

test('accepted no-op remains locked until timeout and explicit acknowledgement', async () => {
  const h = harness(); await h.manager.refresh(); await h.manager.command(h.request('startRound'));
  await assert.rejects(h.manager.acknowledge(h.state.pending), /Wait/);
  h.advance(16000); await h.manager.refresh(); assert.equal(h.state.activity[0].outcome, 'uncertain');
  await h.manager.acknowledge(h.state.pending); assert.equal(h.state.pending, null);
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
});

test('pause events reach the presenter and preserve the held-round state', () => {
  const h = harness(); h.duel.status = 'Ongoing'; h.duel.isPaused = true;
  const decoded = decodeSnapshot({ code: 'DuelRoundPaused', duel: { state: h.duel } });
  assert.equal(decoded.state?.paused, true);
  assert.deepEqual(decoded.warnings, []);
});

test('non-host and live roster edits reject without mutating GeoGuessr', async () => {
  const h = harness(); await h.manager.refresh();
  await assert.rejects(h.manager.command(h.request('bench', { userId: 'blue' })), /between games/);
  h.party.owner.userId = 'different-host'; h.party.gameState = 'NoGame'; h.party.lobbyId = null;
  await h.manager.refresh(); await assert.rejects(h.manager.command(h.request('startGame')), /not the party host/i);
  assert.equal(h.calls.filter(c => c.method !== 'GET').length, 0);
});

test('releasing the last held result confirms when the duel finishes', async () => {
  const h = harness(); h.duel.status = 'Ongoing'; h.duel.isPaused = true; await h.manager.refresh();
  h.mutate = () => { h.party.gameState = 'Finished'; return new Response(null, { status: 204 }); };
  await h.manager.command(h.request('resume'));
  assert.equal(h.state.activity[0].outcome, 'confirmed'); assert.equal(h.state.pending, null);
});

test('prototype property names are not editable game settings', () => {
  assert.throws(() => settingsPatch({ gameSettings: { constructor: 5 } }), /Unsupported/);
});

test('abort can supersede a pending pause without retrying either command', async () => {
  const h = harness(); h.duel.status = 'Ongoing'; await h.manager.refresh();
  await h.manager.command(h.request('pause'));
  assert.equal(h.state.activity[0].outcome, 'accepted');
  await h.manager.command(h.request('abort'));
  await assert.rejects(h.manager.command(h.request('abort')), /pending/);
  assert.deepEqual(h.calls.filter(c => c.method === 'POST').map(c => c.url.split('/').at(-1)), ['pause', 'abort']);
  assert.match(h.state.activity[1].message, /superseded/i);
});

test('a new round during the last party read prevents a stale round command', async () => {
  const h = harness(); h.duel.status = 'Ongoing'; await h.manager.refresh(); let activeReads = 0;
  h.onRead(url => { if (url.endsWith('/active') && ++activeReads === 2) {
    h.duel.rounds.push({ ...h.duel.rounds[0], roundNumber: 2 }); h.duel.currentRoundNumber = 2; h.duel.version++;
  } });
  await assert.rejects(h.manager.command(h.request('pause')), /round.*changed/i);
  assert.equal(h.calls.filter(c => c.method !== 'GET').length, 0);
});

test('a full Duels roster asks for a swap rather than unbenching an extra player', async () => {
  const h = harness(); h.party.gameState = 'NoGame'; h.party.lobbyId = null;
  h.members.push({ ...h.members[0], userId: 'third', isBenched: true }); await h.manager.refresh();
  await assert.rejects(h.manager.command(h.request('unbench', { userId: 'third' })), /swap/i);
  assert.equal(h.calls.filter(c => c.method !== 'GET').length, 0);
});

test('a command from before reconnect to the same party is rejected', async () => {
  const h = harness(); await h.manager.refresh(); const old = h.request('startRound');
  h.select('live'); await h.manager.refresh();
  await assert.rejects(h.manager.command(old), /reconnect|source/i);
  assert.equal(h.calls.filter(c => c.method !== 'GET').length, 0);
});

test('an in-flight command cannot survive a replay roundtrip and reconnect', async () => {
  const h = harness(); await h.manager.refresh(); let activeReads = 0;
  h.onRead(url => { if (url.endsWith('/active') && ++activeReads === 2) { h.select('replay'); h.select('live'); } });
  await assert.rejects(h.manager.command(h.request('abort')), /selection|reconnect|source/i);
  assert.equal(h.calls.filter(c => c.method !== 'GET').length, 0);
});

test('background polling cannot replace the command’s original round boundary', async () => {
  const h = harness(); h.duel.status = 'Ongoing'; h.duel.rounds[0].hasProcessedRoundTimeout = true;
  await h.manager.refresh(); let activeReads = 0;
  h.onRead(async url => {
    if (url.endsWith('/active') && ++activeReads === 2) {
      h.duel.rounds.push({ ...h.duel.rounds[0], roundNumber: 2 }); h.duel.currentRoundNumber = 2; h.duel.version++;
      await h.manager.refresh();
    }
  });
  await assert.rejects(h.manager.command(h.request('startRound')), /round.*changed/i);
  assert.equal(h.calls.filter(c => c.method !== 'GET').length, 0);
});

test('a rejected abort restores the still-pending pause request', async () => {
  const h = harness(); h.duel.status = 'Ongoing'; await h.manager.refresh();
  await h.manager.command(h.request('pause')); const pauseId = h.state.pending;
  h.mutate = () => new Response(null, { status: 429 });
  await h.manager.command(h.request('abort'));
  assert.equal(h.state.pending, pauseId); assert.equal(h.state.activity[1].outcome, 'accepted');
  await assert.rejects(h.manager.command(h.request('pause')), /pending/);
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 2);
});

test('polling cannot confirm a no-op setting before its write response arrives', async () => {
  const h = harness(); h.party.gameState = 'NoGame'; h.party.lobbyId = null; await h.manager.refresh();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const response = new Promise<void>(resolve => { release = resolve; });
  h.mutate = async () => { entered(); await response; return new Response(null, { status: 204 }); };
  const work = h.manager.command({ ...h.request('settings', {}), settingsRevision: h.state.settingsRevision });
  await started; await h.manager.refresh();
  try { assert.equal(h.state.activity[0].outcome, 'sending'); }
  finally { release(); await work; }
  assert.equal(h.state.activity[0].outcome, 'confirmed');
});
