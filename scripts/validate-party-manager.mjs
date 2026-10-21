// Browser -> NodeCG message adapter -> real manager -> fixture GeoGuessr API -> browser.
// No live account, party, NodeCG server, or credentials are used.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerMatch } from '../bundles/rashinban/src/extension/match.ts';
import { EMPTY_INTERMISSION, selectIntermission } from '../bundles/rashinban/src/presenter/intermission.ts';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { createPartyManager } from '../bundles/rashinban/src/extension/party/manager.ts';
import { applySnapshot } from '../bundles/rashinban/src/presenter/normalize.ts';
import { deriveTieRange } from '../bundles/rashinban/src/presenter/tie-range.ts';
import { derivePinpointing } from '../bundles/rashinban/src/presenter/pinpointing.ts';
import { DEFAULT_SETTINGS } from '../bundles/rashinban/src/presenter/settings.ts';
import { seedViews } from '../bundles/rashinban/src/presenter/telemetry.ts';
const root = process.cwd(), artifacts = path.join(root, 'artifacts/party-manager');
await mkdir(artifacts, { recursive: true });
const sample = async name => JSON.parse(await readFile(path.join(root, 'docs/geoguessr/samples', name), 'utf8'));
const party = await sample('party.json');
const captured = await sample('gs2-ws-DuelStarted-created-not-started.json');
const duel = captured.duel.state;
party.partyId = 'fixture-party'; party.owner.userId = 'fixture-host'; party.owner.nick = 'Broadcast host';
party.gameState = 'NoGame'; party.lobbyId = null; party.joinCode = { code: 'PRIVATE-FIXTURE' };
party.partySettings.masterControl = true; party.partySettings.masterControlAutoStartRounds = false;
duel.context = { type: 'Party', id: party.partyId }; duel.gameMasterId = party.owner.userId; duel.gameServerNodeId = 'fixture-node'; duel.gameId = 'fixture-game';
duel.options.masterControlAutoStartRounds = false; duel.options.roundStartingBehavior = 'ManuallyStartAllRounds';
let members = [party.owner, ...duel.teams.map((team, i) => ({ ...party.owner, userId: team.players[0].playerId,
  nick: ['Player Blue', 'Player Red'][i], isBenched: false, team: ['blue', 'red'][i] })),
  { ...party.owner, userId: 'bench-player', nick: 'Next competitor', isBenched: true }];
let snapshot, selection = { input: 'live', partyId: party.partyId }, mutationCount = 0, failNext = false;
let fixtureSettings = structuredClone(DEFAULT_SETTINGS), fixtureRevision = 0;
const matchReps = new Map(), matchHandlers = new Map();
registerMatch({
  Replicant(name, options) {
    if (!matchReps.has(name)) {
      const rep = new EventEmitter(); let value = options?.defaultValue;
      Object.defineProperty(rep, 'value', { get: () => value, set: next => { value = next; rep.emit('change', next); } });
      matchReps.set(name, rep);
    }
    return matchReps.get(name);
  },
  listenFor: (name, handler) => matchHandlers.set(name, handler),
});
const matchState = () => matchReps.get('matchState').value;
const matchResolved = () => matchReps.get('matchResolved').value;
const sendMatch = (name, value) => new Promise((resolve, reject) => matchHandlers.get(name)(value, (error, result) => error ? reject(error) : resolve(result)));
await sendMatch('match:apply', { ...matchState(), label: 'Fixture final', left: { ...matchState().left, name: 'Player Blue' }, right: { ...matchState().right, name: 'Player Red' } });
let fixtureIntermission = structuredClone(EMPTY_INTERMISSION);
const manager = createPartyManager({ cookie: 'test-only', clientVersion: 'fixture', partyId: party.partyId }, {
  now: Date.now, selection: () => selection, publish: value => { snapshot = value; },
  presentation: { get: () => ({ settings: fixtureSettings, revision: String(fixtureRevision) }),
    save(settings, revision) { assert.equal(revision, String(fixtureRevision)); fixtureSettings = settings; fixtureRevision++; } },
  fetch: async (input, init) => {
    const url = String(input), method = init?.method ?? 'GET', body = init?.body ? JSON.parse(init.body) : {};
    if (method === 'GET') {
      if (url.endsWith('/profiles/')) return Response.json({ user: { id: party.owner.userId } });
      if (url.includes('/members?')) return Response.json({ members, totalCount: members.length });
      if (url.includes('/phonebook/')) return Response.json({ gameId: duel.gameId, gameServerNodeId: duel.gameServerNodeId, status: 'Active' });
      if (url.endsWith('/game-master')) return Response.json(duel);
      return Response.json(party);
    }
    mutationCount++;
    if (failNext) { failNext = false; throw Error('Synthetic transport loss'); }
    if (url.endsWith('/all-settings')) { party.gameSettings = body.gameSettings; party.partySettings = body.settings; party.gameType = body.gameType; }
    else if (url.endsWith('/start-game')) { party.gameState = 'Ongoing'; party.lobbyId = duel.gameId; duel.status = 'Created'; }
    else if (url.endsWith('/start-next-round')) {
      if (duel.status !== 'Created') { duel.currentRoundNumber++; duel.rounds.push({ ...duel.rounds[0], roundNumber: duel.currentRoundNumber }); }
      duel.status = 'Ongoing'; const round = duel.rounds.find(r => r.roundNumber === duel.currentRoundNumber);
      round.startTime = new Date(Date.now() - 1000).toISOString(); round.endTime = new Date(Date.now() + 59000).toISOString(); round.hasProcessedRoundTimeout = false;
    }
    else if (url.endsWith('/pause')) duel.isPaused = true;
    else if (url.endsWith('/resume-paused-round')) { duel.isPaused = false; duel.rounds.find(r => r.roundNumber === duel.currentRoundNumber).hasProcessedRoundTimeout = true; }
    else if (url.endsWith('/rollback')) { duel.isPaused = false; duel.currentRoundNumber = body.roundNumber; duel.rounds.find(r => r.roundNumber === body.roundNumber).hasProcessedRoundTimeout = false; }
    else if (url.endsWith('/abort')) { party.gameState = 'NoGame'; party.lobbyId = null; }
    else if (url.includes('/member/') && url.endsWith('/bench')) { const id = url.split('/').at(-2); members.find(m => m.userId === id).isBenched = method === 'PUT'; }
    else if (url.endsWith('/move')) { const id = url.split('/').at(-2), a = members.findIndex(m => m.userId === id), b = members.findIndex(m => m.userId === body.secondMemberId); [members[a], members[b]] = [members[b], members[a]]; }
    else throw Error('Unexpected fixture mutation: ' + url);
    duel.version++; return new Response(null, { status: 204 });
  },
});
await manager.refresh();
const preload = () => `window.fixtureValues=${JSON.stringify({ matchState: matchState(), matchResolved: matchResolved(), presenterIntermission: fixtureIntermission, partyStatus: snapshot, presenterConnection: { input: 'live', selectedPartyId: party.partyId, warnings: [] }, presenterDuel: null,
  presenterSettings: fixtureSettings, configurationStatus: { revision: String(fixtureRevision), scope: 'shared', overridden: [], error: null } })};
const handlers=new Map();window.emit=(name,value)=>{fixtureValues[name]=value;for(const cb of handlers.get(name)||[])cb(value);};
window.confirm=()=>true;window.nodecg={Replicant(name){return {get value(){return fixtureValues[name];},on(_event,cb){if(!handlers.has(name))handlers.set(name,[]);handlers.get(name).push(cb);queueMicrotask(()=>cb(fixtureValues[name]));}};},async sendMessage(name,data){const r=await fetch('/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,data})});const result=await r.json();emit('presenterSettings',result.settings);emit('configurationStatus',{...fixtureValues.configurationStatus,revision:result.revision});emit('partyStatus',result.state);emit('matchState',result.match);emit('matchResolved',result.resolvedMatch);emit('presenterIntermission',result.intermission);if(result.error)throw result.error;return result.value;}};`;
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/message') {
      let body = ''; for await (const part of req) body += part;
      const { name, data } = JSON.parse(body); let error, value;
      try {
        if (name === 'party:command') await manager.command(data);
        else if (name === 'party:refresh') await manager.refresh();
        else if (name === 'party:acknowledge') await manager.acknowledge(data);
        else if (matchHandlers.has(name)) value = await sendMatch(name, data);
        else if (name === 'presenter:control' && data.action === 'intermission') fixtureIntermission = selectIntermission(fixtureIntermission, data.body);
        else throw Error('Unexpected NodeCG message');
      } catch (cause) { error = { name: cause.name, message: cause.message }; }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ value, match: matchState(), resolvedMatch: matchResolved(), intermission: fixtureIntermission, state: snapshot, settings: fixtureSettings, revision: String(fixtureRevision), error })); return;
    }
    const name = req.url === '/' ? 'party-control.html' : req.url.slice(1);
    if (!['party-control.html', 'party-control.css', 'party-control.js', 'party-control.js.map'].includes(name)) { res.statusCode = 404; res.end(); return; }
    let content = await readFile(path.join(root, 'bundles/rashinban/dashboard', name));
    if (name.endsWith('.html')) content = content.toString().replace('<head>', '<head><script>' + preload() + '</script>');
    res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(content);
  } catch (error) { res.statusCode = 500; res.end(error.message); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const insecureHttp = process.argv.includes('--http');
const hostname = insecureHttp ? 'party-dashboard.test' : '127.0.0.1';
const origin = 'http://' + hostname + ':' + server.address().port;
const profile = await mkdtemp(path.join(os.tmpdir(), 'rb-party-browser-'));
const chromePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  ...(insecureHttp ? ['--host-resolver-rules=MAP party-dashboard.test 127.0.0.1', '--no-proxy-server'] : []),
  'about:blank'], { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket, sequence = 0; const pending = new Map(), errors = [];
async function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => { const timeout = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } }); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) { const r = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function until(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(50); } throw Error('Timed out: ' + expression); }
async function click(id) { await evaluate(`document.getElementById(${JSON.stringify(id)}).click()`); }
let lastConfirmedId = null;
async function confirmed() {
  await until(`fixtureValues.partyStatus.activity[0]?.outcome==='confirmed' && fixtureValues.partyStatus.activity[0]?.id!==${JSON.stringify(lastConfirmedId)} && !fixtureValues.partyStatus.busy`);
  lastConfirmedId = await evaluate('fixtureValues.partyStatus.activity[0].id');
}
async function screenshot(name) { const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); await writeFile(path.join(artifacts, name + '.png'), Buffer.from(shot.data, 'base64')); }
try {
  let port;
  for (let i = 0; i < 100; i++) { try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await delay(100); } }
  if (!port) throw Error('Chrome did not start');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
  socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const call = pending.get(m.id); if (call) { pending.delete(m.id); m.error ? call.reject(Error(m.error.message)) : call.resolve(m.result); } } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params); };
  await command('Runtime.enable'); await command('Page.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: origin }); await until(`document.querySelector('#connection-status')?.textContent==='Host connected'`);
  // Read-only party chat: placement, safe text, updates, scrolling, and source changes.
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.grid > .card > .section-title > h2'), el=>el.textContent)`),
    ['Live duel', 'Party chat', 'Next duel settings', 'Players & bench', 'Recent commands']);
  const chatState = { partyId: party.partyId, state: 'live', detail: 'Live messages from this connection · latest 200 retained.', messages: [
    { id: 'text', userId: 'blue', name: 'Player Blue', kind: 'Text', text: '準備できました！ <img src=x onerror=alert(1)>', sentAtMs: Date.now(), channel: null },
    { id: 'emote', userId: 'red', name: 'Player Red', kind: 'Emote', text: ':gg:', sentAtMs: Date.now() + 1, channel: null },
  ] };
  await evaluate(`emit('partyChat',${JSON.stringify(chatState)})`);
  assert.equal(await evaluate(`document.querySelectorAll('.chat-message').length`), 2);
  assert.equal(await evaluate(`document.querySelector('#chat-status').textContent`), 'Live');
  assert.equal(await evaluate(`document.querySelector('.chat-text').textContent`), chatState.messages[0].text);
  assert.equal(await evaluate(`document.querySelectorAll('#chat-messages img').length`), 0);
  assert.equal(await evaluate(`document.querySelector('.chat-emote').textContent`), ':gg:');
  assert.equal(await evaluate(`document.querySelector('.party-chat').getBoundingClientRect().top===document.querySelector('.live').getBoundingClientRect().top`), true);
  await screenshot('chat-desktop');
  const chatMutations = mutationCount;
  for (let i = 0; i < 50; i++) chatState.messages.push({ ...chatState.messages[0], id: `chat-${i}`, text: `Message ${i}`, sentAtMs: Date.now() + i + 2 });
  await evaluate(`emit('partyChat',${JSON.stringify(chatState)})`);
  assert.equal(await evaluate(`{const log=document.querySelector('#chat-messages');log.scrollHeight-log.scrollTop-log.clientHeight<2}`), true, 'new messages follow when at the bottom');
  await evaluate(`document.querySelector('#chat-messages').scrollTop=80`);
  chatState.messages.push({ ...chatState.messages[0], id: 'new-message', text: 'Latest message' });
  await evaluate(`emit('partyChat',${JSON.stringify(chatState)})`);
  assert.equal(await evaluate(`document.querySelector('#chat-messages').scrollTop`), 80, 'reading older messages preserves scroll');
  await evaluate(`emit('partyStatus',fixtureValues.partyStatus)`);
  assert.equal(await evaluate(`document.querySelector('#chat-messages').scrollTop`), 80, 'party polling preserves scroll');
  await evaluate(`emit('partyChat',{...fixtureValues.partyChat,state:'reconnecting',detail:'Chat disconnected. Reconnecting…'})`);
  assert.equal(await evaluate(`document.querySelector('#chat-status').textContent`), 'Reconnecting…');
  assert.equal(await evaluate(`document.querySelectorAll('.chat-message').length`), 53);
  chatState.messages.push({ ...chatState.messages[0], id: 'long-message', text: '長いメッセージ'.repeat(100) });
  await evaluate(`emit('partyChat',${JSON.stringify(chatState)})`);
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'), true, 'party chat fits mobile');
  await screenshot('chat-mobile');
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });
  await evaluate(`emit('presenterConnection',{...fixtureValues.presenterConnection,input:'replay'})`);
  assert.equal(await evaluate(`document.querySelectorAll('.chat-message').length`), 0, 'replay hides live chat immediately');
  await evaluate(`emit('presenterConnection',{...fixtureValues.presenterConnection,input:'live',selectedPartyId:'another-party'})`);
  assert.equal(await evaluate(`document.querySelectorAll('.chat-message').length`), 0, 'party selection hides old chat immediately');
  await evaluate(`emit('presenterConnection',{...fixtureValues.presenterConnection,selectedPartyId:${JSON.stringify(party.partyId)}});emit('partyChat',{...fixtureValues.partyChat,messages:[]})`);
  assert.equal(await evaluate(`document.querySelector('#chat-empty').hidden`), false);
  assert.equal(mutationCount, chatMutations, 'chat display never sends party commands');
  assert.equal(await evaluate('window.isSecureContext'), !insecureHttp);
  assert.equal(await evaluate('typeof crypto.randomUUID'), insecureHttp ? 'undefined' : 'function');
  assert.equal(await evaluate('typeof crypto.getRandomValues'), 'function');
  assert.equal(await evaluate(`document.querySelector('#start-game').disabled`), false);
  assert.equal(await evaluate(`document.querySelectorAll('#tournament-preset option[value]:not([value=""])').length`), 12);
  assert.equal(await evaluate(`document.querySelectorAll('#match-score-left,#match-score-right').length`), 2, 'Party exposes both shared match scores');
  assert.equal(await evaluate(`document.querySelector('#match-score-left').value`), '0');
  const mutationsBeforeScore = mutationCount;
  await click('match-score-increment-left'); await until(`fixtureValues.matchState.left.wins===1 && !document.querySelector('#match-score-increment-left').disabled`);
  assert.equal(matchState().right.wins, 0);
  assert.equal(matchReps.get('presenterSeries').value.left.wins, 1);
  await evaluate(`{const field=document.querySelector('#match-score-right');field.value='2';field.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await click('match-score-apply'); await until(`fixtureValues.matchState.right.wins===2 && !document.querySelector('#match-score-reset').disabled`);
  assert.equal(matchState().label, 'Fixture final');
  assert.equal(matchState().left.name, 'Player Blue');
  assert.equal(matchState().left.wins, 1);
  await click('match-score-reset'); await until(`fixtureValues.matchState.left.wins===0 && fixtureValues.matchState.right.wins===0 && !document.querySelector('#match-score-reset').disabled`);
  // Both dashboards subscribe to the same authoritative values.
  await sendMatch('match:apply', { ...matchState(), right: { ...matchState().right, wins: 1 } });
  await evaluate(`emit('matchState',${JSON.stringify(matchState())});emit('matchResolved',${JSON.stringify(matchResolved())})`);
  assert.equal(await evaluate(`document.querySelector('#match-score-right').value`), '1');
  // Preserve a typed draft when another operator changes the match.
  await evaluate(`{const field=document.querySelector('#match-score-left');field.value='2';field.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await sendMatch('match:apply', { ...matchState(), label: 'Changed elsewhere' });
  await evaluate(`emit('matchState',${JSON.stringify(matchState())});emit('matchResolved',${JSON.stringify(matchResolved())})`);
  assert.equal(await evaluate(`document.querySelector('#match-score-left').value`), '2');
  assert.equal(await evaluate(`document.querySelector('#match-score-apply').disabled`), true);
  await click('match-score-reload');
  assert.equal(await evaluate(`document.querySelector('#match-score-left').value`), '0');
  // Reject a server-side race even before the new Replicant snapshot arrives.
  await sendMatch('match:apply', { ...matchState(), label: 'Race from Current Match' });
  await click('match-score-increment-left');
  await until(`document.querySelector('#match-score-error').textContent.includes('changed elsewhere')`);
  assert.equal(matchState().left.wins, 0);
  await click('match-score-reload');
  for (const invalid of ['-1', '1.5', '']) {
    const revision = matchState().revision;
    await evaluate(`{const field=document.querySelector('#match-score-left');field.value=${JSON.stringify(invalid)};field.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await click('match-score-apply');
    assert.equal(await evaluate(`document.querySelector('#match-score-left').checkValidity()`), false);
    assert.equal(matchState().revision, revision);
    await click('match-score-reload');
  }
  assert.equal(mutationCount, mutationsBeforeScore, 'match scoring never mutates GeoGuessr');
  await screenshot('match-score-desktop');
  const mutationsBeforePreset = mutationCount;
  await evaluate(`document.querySelector('#tournament-preset').value='day2-moving';document.querySelector('#tournament-preset').dispatchEvent(new Event('change'))`);
  assert.equal(mutationCount, mutationsBeforePreset, 'loading a preset only fills a draft');
  assert.equal(fixtureSettings.pinpointing.enabled, false);
  assert.equal(await evaluate(`document.querySelector('[data-key="timeAfterGuess"]').value`), '90');
  assert.equal(await evaluate(`document.querySelector('[data-key="initialHealth"]').value`), '1000000');
  assert.equal(await evaluate(`document.querySelector('#start-game').disabled`), true);
  await screenshot('preset-draft-desktop');
  // NodeCG transports rejected acknowledgements as plain objects, not Error instances.
  // The browser has not yet received this concurrent configuration edit.
  fixtureRevision++;
  await click('save-settings');
  await until(`document.querySelector('#error').textContent==='Presenter settings changed. Reload the preset before saving.'`);
  assert.equal(mutationCount, mutationsBeforePreset, 'a rejected preset does not reach GeoGuessr');
  assert.equal(await evaluate(`document.querySelector('[data-key="initialHealth"]').value`), '1000000', 'rejection retains the preset draft');
  await click('reload-settings');
  await evaluate(`document.querySelector('#tournament-preset').value='day2-moving';document.querySelector('#tournament-preset').dispatchEvent(new Event('change'))`);
  await click('save-settings'); await confirmed();
  assert.equal(party.gameSettings.mapSlug, '696fe47c5b07bed052077a95');
  assert.equal(fixtureSettings.pinpointing.enabled, true);
  assert.deepEqual(fixtureSettings.tieRange, { enabled: true, mode: 'half' });
  await evaluate(`document.querySelector('#tournament-preset').value='day1-pro';document.querySelector('#tournament-preset').dispatchEvent(new Event('change'))`);
  fixtureSettings.muted = true; fixtureRevision++;
  await evaluate(`emit('presenterSettings',${JSON.stringify(fixtureSettings)});emit('configurationStatus',{...fixtureValues.configurationStatus,revision:${JSON.stringify(String(fixtureRevision))}})`);
  assert.equal(await evaluate(`document.querySelector('#save-settings').disabled`), true, 'a configuration change invalidates the preset draft');
  assert.match(await evaluate(`document.querySelector('#draft-status').textContent`), /Presenter settings changed/);
  await click('reload-settings');
  await evaluate(`document.querySelector('#tournament-preset').value='day1-pro';document.querySelector('#tournament-preset').dispatchEvent(new Event('change'))`);
  await click('save-settings'); await confirmed();
  assert.equal(party.gameSettings.mapSlug, '6620b311f64a7b842b2ca83a');
  assert.equal(party.gameSettings.initialHealth, 5000); assert.equal(party.gameSettings.maxRoundTime, 60);
  assert.equal(party.gameSettings.roundWinMultiplierIncrement, 5); assert.equal(party.gameSettings.forbidMoving, true);
  assert.equal(party.gameSettings.forbidRotating, false); assert.equal(fixtureSettings.pinpointing.enabled, false);
  assert.equal(fixtureSettings.muted, true, 'preset preserves unrelated presenter settings');
  // GeoGuessr keeps isPresent true while a player is still on the game/results screen.
  party.gameState = 'Finished'; members[1].isPlaying = true; members[1].isInCurrentGame = false;
  await manager.refresh(); await evaluate(`emit('partyStatus',${JSON.stringify(snapshot)})`);
  assert.match(await evaluate(`document.querySelectorAll('#members .member')[1].textContent`), /In game \/ results/);
  assert.equal(await evaluate(`document.querySelector('#start-game').disabled`), true, 'results-screen player is not ready for the next duel');
  assert.match(await evaluate(`document.querySelector('#start-hint').textContent`), /Player Blue.*return to the lobby/);
  await screenshot('waiting-for-lobby-desktop');
  members[1].isPlaying = false;
  await manager.refresh(); await evaluate(`emit('partyStatus',${JSON.stringify(snapshot)})`);
  assert.match(await evaluate(`document.querySelectorAll('#members .member')[1].textContent`), /In lobby/);
  assert.equal(await evaluate(`document.querySelector('#start-game').disabled`), false, 'returning to lobby enables start');
  await evaluate(`{ const hp=document.querySelector('[data-key="initialHealth"]');hp.value='9000';hp.dispatchEvent(new Event('input',{bubbles:true})); }`);
  assert.equal(await evaluate(`document.querySelector('#start-game').disabled`), true, 'unsaved draft blocks game start');
  await click('save-settings'); await confirmed();
  assert.equal(party.gameSettings.initialHealth, 9000);
  await until(`document.querySelector('#draft-status').textContent==='Matches current party'`);
  await screenshot('lobby-desktop');
  await click('start-game'); await confirmed(); await until(`document.querySelector('#phase').textContent==='Ready for round 1'`);
  await click('start-round'); await confirmed(); await until(`!document.querySelector('#pause').disabled`);
  await screenshot('live-desktop');
  const scoreSource = applySnapshot(null, { code: 'DuelStarted', duel: { state: duel } }).state;
  assert.ok(scoreSource, 'fixture decodes through the presenter protocol');
  // Forecasts consume the same presenter snapshots and pin telemetry as production.
  // Publishing them must never send a command or modify the settled scoreboard.
  {
    const beforePrediction = mutationCount;
    const source = structuredClone(scoreSource);
    source.ruleOptions = { individual: 5, mutual: 0, delay: 1, maxErrorDistance: 1_000_000 };
    source.rounds[0].panorama.lat = 0; source.rounds[0].panorama.lng = 0;
    source.players.forEach((p, i) => { p.pin = null; p.guesses = []; p.results = []; p.health = i ? 3000 : 6000; p.multiplier = i ? 1 : 2; });
    const liveConnection = { input: 'live', state: 'live', partyId: party.partyId, gameId: duel.gameId,
      controlGeneration: snapshot.sourceGeneration, lastUpdateMs: Date.now(), warnings: [] };
    const predictionStatus = structuredClone(snapshot);
    for (const team of predictionStatus.duel.teams) {
      const player = source.players.find(p => p.teamId === team.id);
      team.health = player.health; team.multiplier = player.multiplier;
    }
    const pinViews = seedViews(source);
    async function emitValue(name, value) { await evaluate(`emit(${JSON.stringify(name)},${JSON.stringify(value)})`); }
    await emitValue('partyStatus', predictionStatus);
    await emitValue('presenterConnection', liveConnection);
    await emitValue('presenterRuleContexts', { live: { source, mode: 'off', pinpointing: false }, replay: null });
    await emitValue('presenterDuel', source);
    const settledTotals = await evaluate(`Array.from(document.querySelectorAll('#teams strong'), el=>el.textContent)`);
    await until(`document.querySelector('#prediction-summary').textContent==='Waiting for both players to place a pin.'`);
    assert.equal(await evaluate(`document.querySelectorAll('.prediction-outcome').length`), 0);
    const blueView = pinViews.players[source.players[0].id], redView = pinViews.players[source.players[1].id];
    blueView.pin = { lat: 0, lng: 0 }; blueView.lastByType.PinPosition = Date.now();
    await emitValue('presenterViews', pinViews);
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.prediction-score'), el=>el.textContent)`), ['≈5,000 pts', '—']);
    assert.equal(await evaluate(`document.querySelectorAll('.prediction-outcome').length`), 0);
    redView.pin = { lat: 0, lng: (-100000 * Math.log(3000 / 5000)) / 6371000 * 180 / Math.PI };
    redView.lastByType.PinPosition = Date.now();
    await emitValue('presenterViews', pinViews);
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.prediction-outcome'), el=>el.textContent)`), ['PREDICTED WIN', 'PREDICTED LOSS']);
    assert.match(await evaluate(`document.querySelectorAll('.prediction-after')[1].textContent`), /3,000 → 0 HP/);
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#teams strong'), el=>el.textContent)`), settledTotals, 'forecast never changes settled native totals');
    await screenshot('prediction-desktop');
    await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await screenshot('prediction-mobile');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'), true, 'prediction cards fit mobile');
    await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });
    blueView.pin = { ...redView.pin }; blueView.lastByType.PinPosition = Date.now();
    await emitValue('presenterViews', pinViews);
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.prediction-outcome'), el=>el.textContent)`), ['DUEL CONTINUES', 'DUEL CONTINUES']);
    liveConnection.state = 'stale'; await emitValue('presenterConnection', liveConnection);
    assert.equal(await evaluate(`document.querySelectorAll('.prediction-outcome').length`), 0, 'disconnect clears predictions');
    liveConnection.state = 'live'; liveConnection.lastUpdateMs = Date.now() - 14900;
    await emitValue('presenterConnection', liveConnection);
    await until(`document.querySelectorAll('.prediction-outcome').length===0`);
    liveConnection.lastUpdateMs = Date.now(); await emitValue('presenterConnection', liveConnection);
    await until(`document.querySelectorAll('.prediction-outcome').length===2`);
    source.players[0].results = [{ round: 1, score: 3000, bestGuess: null, healthBefore: 6000, healthAfter: 6000, damageDealt: 0, multiplier: 2 }];
    await emitValue('presenterRuleContexts', { live: { source, mode: 'off', pinpointing: false }, replay: null });
    assert.equal(await evaluate(`document.querySelector('#prediction').hidden`), true, 'settled round hides forecast');
    source.round = 4; predictionStatus.duel.round = 4;
    source.rounds = [1, 2, 3, 4].map(number => ({ ...source.rounds[0], number }));
    source.players.forEach((p, i) => {
      p.results = [1, 2, 3].map(round => ({ round, score: i ? 4000 : 5000, bestGuess: null,
        healthBefore: 6000, healthAfter: 6000, damageDealt: 0, multiplier: 1 }));
      p.pin = i ? { ...redView.pin } : { lat: 0, lng: 0 };
    });
    await emitValue('partyStatus', predictionStatus);
    await emitValue('presenterRuleContexts', { live: { source, mode: 'half', pinpointing: true }, replay: null });
    await emitValue('presenterDuel', derivePinpointing(source, 'half'));
    assert.match(await evaluate(`document.querySelector('.prediction-after').textContent`), /6 → 8 points/);
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.prediction-outcome'), el=>el.textContent)`), ['PREDICTED WIN', 'PREDICTED LOSS']);
    await screenshot('prediction-pinpointing-desktop');
    assert.equal(mutationCount, beforePrediction, 'pin updates never send game commands');
    await emitValue('presenterViews', null);
    await emitValue('partyStatus', snapshot);
  }
  scoreSource.initialHealth = 6000;
  scoreSource.ruleOptions = { individual: 5, mutual: 0, delay: 1, maxErrorDistance: null };
  for (const [index, player] of scoreSource.players.entries()) player.results = [{ round: 1, score: index ? 3000 : 4000,
    bestGuess: null, healthBefore: 6000, healthAfter: 6000, damageDealt: 0, multiplier: 1 }];
  const scoreConnection = { input: 'live', state: 'live', partyId: party.partyId, gameId: duel.gameId,
    controlGeneration: snapshot.sourceGeneration, warnings: [] };
  const scoreSettings = structuredClone(DEFAULT_SETTINGS); scoreSettings.tieRange.enabled = true;
  const scoreContext = { live: { source: scoreSource, mode: 'full', pinpointing: false }, replay: null };
  async function publishScores(presented) {
    for (const [name, value] of Object.entries({ presenterConnection: scoreConnection, presenterSettings: scoreSettings,
      presenterRuleContexts: scoreContext, presenterDuel: presented })) await evaluate(`emit(${JSON.stringify(name)},${JSON.stringify(value)})`);
  }
  await publishScores(deriveTieRange(scoreSource, 'full'));
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#teams strong'), el=>el.textContent)`), ['6,000 HP', '5,000 HP']);
  assert.match(await evaluate(`document.querySelector('#teams').textContent`), /×1.5/);
  await screenshot('tie-range-desktop');
  scoreSettings.pinpointing.enabled = true; scoreContext.live.pinpointing = true;
  await publishScores(derivePinpointing(scoreSource, 'full'));
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#teams strong'), el=>el.textContent)`), ['0 / 7 points', '0 / 7 points']);
  assert.match(await evaluate(`document.querySelector('#score-last-round').textContent`), /TIE.*NO POINT/);
  // Saved settings are for the next duel; captured rules still govern this one.
  scoreSettings.pinpointing.enabled = false; scoreSettings.tieRange.enabled = false;
  await publishScores(derivePinpointing(scoreSource, 'full'));
  assert.match(await evaluate(`document.querySelector('#score-rules').textContent`), /Pinpointing.*Full/);
  assert.match(await evaluate(`document.querySelector('#score-next-rules').textContent`), /Next duel.*Health/);
  await screenshot('pinpointing-desktop');
  await evaluate(`emit('presenterDuel',null)`);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#teams strong'), el=>el.textContent)`), ['—', '—']);
  assert.match(await evaluate(`document.querySelector('#presenter-warning').textContent`), /unavailable/);
  await evaluate(`emit('presenterRuleContexts',null)`);
  await click('pause'); await confirmed(); assert.equal(duel.isPaused, true);
  await click('resume'); await confirmed(); await until(`!document.querySelector('#start-round').disabled`);
  await click('start-round'); await confirmed(); assert.equal(duel.currentRoundNumber, 2);
  await click('pause'); await confirmed(); await click('rollback'); await confirmed(); assert.equal(duel.currentRoundNumber, 1);
  // Finish under presenter rules while the native health duel keeps running.
  duel.currentRoundNumber = 4; duel.version++;
  duel.rounds = Array.from({ length: 4 }, (_, i) => ({ ...duel.rounds[0], roundNumber: i + 1 }));
  await manager.refresh(); await evaluate(`emit('partyStatus',${JSON.stringify(snapshot)})`);
  scoreSource.round = 4; scoreSource.version = duel.version;
  scoreSource.rounds = Array.from({ length: 4 }, (_, i) => ({ ...scoreSource.rounds[0], number: i + 1 }));
  for (const [side, player] of scoreSource.players.entries()) player.results = Array.from({ length: 4 }, (_, i) => ({
    ...player.results[0], round: i + 1, score: side ? 4000 : i < 3 ? 5000 : 4900 }));
  const terminalScore = derivePinpointing(scoreSource, 'full');
  await publishScores(terminalScore);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#teams strong'), el=>el.textContent)`), ['7 / 7 points', '0 / 7 points']);
  assert.match(await evaluate(`document.querySelector('#score-result').textContent`), /Player Blue wins/);
  assert.match(await evaluate(`document.querySelector('#presenter-warning').textContent`), /GeoGuessr is still running/);
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await screenshot('pinpointing-mobile');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'), true, 'custom scores fit mobile');
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });
  await click('abort'); await confirmed(); assert.equal(party.gameState, 'NoGame');
  scoreConnection.gameId = null; scoreConnection.state = 'disconnected'; await publishScores(terminalScore);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#teams strong'), el=>el.textContent)`), ['7 / 7 points', '0 / 7 points']);
  assert.match(await evaluate(`document.querySelector('#score-result').textContent`), /Player Blue wins/);
  await screenshot('pinpointing-finished-desktop');
  await evaluate(`document.querySelectorAll('#members .member')[1].querySelector('button').click()`); await confirmed(); assert.equal(members[1].isBenched, true);
  await evaluate(`document.querySelectorAll('#members .member')[1].querySelector('button').click()`); await confirmed();
  // Draft is not overwritten by an external settings change.
  await evaluate(`{const hp=document.querySelector('[data-key="initialHealth"]');hp.value='7500';hp.dispatchEvent(new Event('input',{bubbles:true}));}`);
  party.gameSettings.initialHealth = 8000; await manager.refresh(); await evaluate(`emit('partyStatus',${JSON.stringify(snapshot)})`);
  assert.equal(await evaluate(`document.querySelector('[data-key="initialHealth"]').value`), '7500');
  assert.equal(await evaluate(`document.querySelector('#save-settings').disabled`), true);
  await click('reload-settings');
  failNext = true; await click('start-game'); await until(`fixtureValues.partyStatus.activity[0]?.outcome==='uncertain'`);
  const before = mutationCount; await click('start-game'); assert.equal(mutationCount, before, 'uncertain command is not retried');
  await click('acknowledge'); await until(`fixtureValues.partyStatus.pending===null`);
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await screenshot('lobby-mobile');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'), true, 'mobile page has no horizontal overflow');
  await evaluate(`document.querySelector('#tournament-preset').value='day2-intersection';document.querySelector('#tournament-preset').dispatchEvent(new Event('change'))`);
  assert.equal(await evaluate(`document.querySelector('[data-key="mapSlug"]').value`), '667dab025a1e617dd25198c4');
  await screenshot('preset-draft-mobile');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'), true, 'long preset names fit mobile');
  assert.equal(mutationCount, before, 'loading the mobile preset sends no mutation');
  selection = { input: 'replay', partyId: null }; await manager.refresh(); await evaluate(`emit('partyStatus',${JSON.stringify(snapshot)})`);
  assert.equal(await evaluate(`document.querySelector('#start-game').disabled`), true);
  assert.deepEqual(errors, []);
  console.log('Party browser flow passed: read-only chat layout, safe text, emotes, scrolling, source changes, shared Match Score increments, typed edits, reset, synchronization, stale edits, invalid input, live pin predictions, knockout/continue, stale/settled suppression, tournament preset drafts, Half tie range, Pinpointing switching, config conflicts, lobby readiness, presenter scores, next-duel rules, unavailable scores, retained winner, settings, starts, pause/resume, rollback, abort, bench, unknown outcomes, replay, mobile. Mutations stayed inside fixture API.');
  console.log('Screenshots: ' + artifacts);
} catch (error) {
  if (socket?.readyState === WebSocket.OPEN) {
    console.error(await evaluate(`JSON.stringify({phase:document.querySelector('#phase')?.textContent,error:document.querySelector('#error')?.textContent,state:fixtureValues.partyStatus})`));
    await screenshot('failure').catch(() => {});
  }
  console.error('Browser exceptions:', JSON.stringify(errors));
  throw error;
} finally {
  if (socket?.readyState === WebSocket.OPEN) { await command('Browser.close').catch(() => {}); socket.close(); }
  chrome.kill(); server.close();
}
