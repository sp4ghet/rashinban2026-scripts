// Exercises the built graphics and switcher against isolated NodeCG fixtures.
// No live NodeCG process, credentials, spreadsheet, or persisted replicants are used.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, access, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInitialState, setPreview, take, revertPreview } from '../bundles/rashinban/src/broadcast/state.ts';
import { emptyMatch, resolveMatch } from '../bundles/rashinban/src/match/state.ts';
import { rowToProfile } from '../bundles/rashinban/src/sheet/players.ts';
import { normalizeEvent } from '../bundles/rashinban/src/startgg/normalize.ts';
import { playerCardResults } from '../bundles/rashinban/src/broadcast/player-card-results.ts';
import { fromPhaseGroupSample } from '../bundles/rashinban/src/bracket/finals.ts';
import { REPLICANTS, BROADCAST_MESSAGES } from '../bundles/rashinban/src/types/replicants.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts/player-cards');
const adobeFonts = process.argv.includes('--adobe-fonts');
await mkdir(artifacts, { recursive: true });
const now = Date.parse('2026-10-12T05:00:00Z');
const profiles = [
  rowToProfile({ startgg_entrant_id: '10', startgg_tag: 'Stephen', name: 'Stephen', twitter: 'StephGeoGuessr', age: '29', rating: '1493', favorite_mode: '全モード', strengths: 'Movingの知識、カーメタ', favorite_food: '寿司(イワシ・サンマ)、超濃厚煮干しラーメン、マトンビリヤニ、ぼたん鍋', message: '前年度は解説として参加させていただきましたが、今年度は選手としていいプレーを少しでも見せれるように頑張ります！' }),
  rowToProfile({ startgg_entrant_id: '20', startgg_tag: 'eeeeeeeeeeee', name: 'eeeeeeeeeeee', twitter: 'eeeeeeeeee_geo', age: '16', rating: '1452', favorite_mode: 'NM', strengths: '広く浅い知識', favorite_food: '唐揚げ', message: '自分を信じる' }),
];
const match = emptyMatch();
match.left.entrantId = 10; match.right.entrantId = 20;
match.source = 'startgg'; match.setId = 50; match.label = 'Top 8';
let state = createInitialState();
for (const output of ['stream', 'led']) {
  state = take(setPreview(state, output, { playerCards: { visible: true } }), output);
}
state = take(setPreview(state, 'stream', { casters: { titleBar: false } }), 'stream');
const makeSet = (id, when, round, ownScore = 2, opponentScore = 0) => ({
  id, groupId: 1, phaseId: 1, identifier: String(id), round: id, side: 'winners', roundText: round,
  state: 'completed', stateCode: 3, winnerEntrantId: ownScore > opponentScore ? 10 : 20, loserEntrantId: ownScore > opponentScore ? 20 : 10,
  displayScore: null, totalGames: ownScore + opponentScore, wPlacement: null, lPlacement: null, startedAt: null,
  completedAt: Date.parse(when) / 1000, streamName: null,
  slots: [{ index: 0, entrantId: 10, score: ownScore }, { index: 1, entrantId: 20, score: opponentScore }],
});
const sets = [makeSet(1, '2026-10-10T02:00:00Z', 'Qualifier'), makeSet(2, '2026-10-11T02:00:00Z', 'Top 64'), makeSet(3, '2026-10-11T04:00:00Z', 'Top 32', 2, 1)];
const bracket = { fetchedAt: now, event: null, phases: [], groups: {}, streamQueue: [],
  entrants: { 10: { id: 10, tag: 'Stephen', name: 'Stephen' }, 20: { id: 20, tag: 'eeeeeeeeeeee', name: 'eeeeeeeeeeee' } },
  sets: Object.fromEntries(sets.map(set => [set.id, set])) };
const finals = { source: 'sample', updatedAt: now, error: null,
  ...fromPhaseGroupSample(JSON.parse(await readFile(path.join(root, 'docs/startgg/samples/evo-japan-2026-sf6-finals-top8.json'), 'utf8'))) };
const values = { [REPLICANTS.broadcast]: state, [REPLICANTS.matchResolved]: resolveMatch(match, profiles),
  [REPLICANTS.players]: profiles, [REPLICANTS.startggBracket]: bracket, [REPLICANTS.bracketFinals]: finals };
const preload = () => `
Date.now=()=>${now};
const values=${JSON.stringify(values).replaceAll('<', '\\u003c')};
const handlers=new Map();
window.fixtureValues=values;
window.emit=(name,value)=>{values[name]=value;for(const cb of handlers.get(name)||[])cb(value);};
window.nodecg={Replicant(name){return{on(event,callback){if(!handlers.has(name))handlers.set(name,[]);handlers.get(name).push(callback);if(Object.hasOwn(values,name))queueMicrotask(()=>callback(values[name]));}};},
async sendMessage(name,data){const response=await fetch('/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,data})});const next=await response.json();if(!response.ok)throw Error(next.error);emit('${REPLICANTS.broadcast}',next);for(const frame of document.querySelectorAll('iframe'))frame.contentWindow.emit?.('${REPLICANTS.broadcast}',next);return next;}};
`;
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/message') {
      let body = ''; for await (const chunk of req) body += chunk;
      const { name, data } = JSON.parse(body);
      if (name === BROADCAST_MESSAGES.setPreview) state = setPreview(state, data.output, data.patch);
      else if (name === BROADCAST_MESSAGES.take) state = take(state, data.output);
      else if (name === BROADCAST_MESSAGES.revertPreview) state = revertPreview(state, data.output);
      else throw Error('Unexpected message ' + name);
      values[REPLICANTS.broadcast] = state;
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(state)); return;
    }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) throw Error('Invalid path');
    const ext = path.extname(file);
    let content = await readFile(file);
    if (ext === '.html') {
      content = content.toString();
      if (!adobeFonts) content = content.replace(/<link[^>]+https:\/\/use\.typekit\.net[^>]+>/g, '');
      content = content.replace('<head>', '<head><style>body { background: #111827 !important; }</style><script>' + preload() + '</script>');
    }
    res.setHeader('Content-Type', { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png' }[ext] || 'application/octet-stream');
    res.end(content);
  } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: error.message })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
let chromePath;
for (const candidate of [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)) {
  try { await access(candidate); chromePath = candidate; break; } catch {}
}
if (!chromePath) { server.close(); throw Error('Chrome not found. Set CHROME_PATH.'); }
const profile = path.join(artifacts, 'chrome-' + Date.now());
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const pending = new Map(), errors = [];
let socket, sequence = 0;
async function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 15000);
    pending.set(id, { resolve: result => { clearTimeout(timeout); resolve(result); }, reject: error => { clearTimeout(timeout); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function until(expression) {
  for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await delay(100); }
  throw Error('Timed out: ' + expression);
}
async function navigate(url, ready = 'document.querySelector("#cards.visible")') {
  await command('Page.navigate', { url: origin + url }); await until(ready);
  await evaluate('document.fonts.ready'); await delay(550);
}
async function card(patch, output = 'stream') {
  await evaluate(`{const s=structuredClone(fixtureValues.${REPLICANTS.broadcast});Object.assign(s.${output}.program.playerCards,${JSON.stringify(patch)});emit('${REPLICANTS.broadcast}',s);}`);
  await delay(50);
}
async function screenshot(name) {
  const shot = await command('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(artifacts, name + '.png'), Buffer.from(shot.data, 'base64'));
}
async function fits() {
  return evaluate(`[...document.querySelectorAll('.pcard:not([hidden])')].every(card=>{const r=card.getBoundingClientRect();const led=document.body.dataset.output==='led';return r.top>=0&&r.bottom<=(led?576:1080)&&(!led||(r.top===24&&r.height===528&&r.width===480&&r.left===(card.id==='card-1'?24:1416)))&&card.scrollWidth<=card.clientWidth&&[...card.querySelectorAll('.name,.twitter,.value,.result-row,.result-round,.result-opponent,.result-score,.results-empty')].filter(e=>e.getBoundingClientRect().height).every(e=>{const a=e.getBoundingClientRect();return a.left>=r.left&&a.right<=r.right&&a.top>=r.top&&a.bottom<=r.bottom;});})`);
}
async function sharedLayout() {
  return evaluate(`[...document.querySelectorAll('.pcard:not([hidden])')].map(card=>[card,...card.querySelectorAll('.head,.name,.twitter,.page-profile,.page-profile .pair,.page-profile .field,.page-profile .label,.page-profile .value')].map(el=>({rect:el.getBoundingClientRect().toJSON(),font:getComputedStyle(el).font})))`);
}
try {
  let port;
  for (let i = 0; i < 100; i++) { try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await delay(100); } }
  if (!port) throw Error('Chrome did not start');
  const pages = await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json());
  socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => { const message = JSON.parse(event.data); if (message.id) { const call = pending.get(message.id); if (call) { pending.delete(message.id); message.error ? call.reject(Error(message.error.message)) : call.resolve(message.result); } } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params); };
  await command('Runtime.enable'); await command('Page.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await navigate('/bundles/rashinban/graphics/info-stream.html');
  if (adobeFonts) assert.ok(await evaluate(`[...document.fonts].some(font=>font.family.includes('kaneda-gothic')&&font.weight==='700'&&font.status==='loaded')`), 'Adobe Kaneda Gothic must be loaded for the online typography check');
  assert.equal(await evaluate(`document.querySelectorAll('.pcard:not([hidden])').length`), 1);
  assert.equal(await evaluate(`document.querySelector('#card-1 .rating').textContent`), '1493');
  assert.ok(await fits(), 'long Japanese profile fits'); await screenshot('01-profile');
  const streamProfileLayout = await sharedLayout();
  await card({ page: 'stats' });
  assert.equal(await evaluate(`document.querySelectorAll('#card-1 .result-row').length`), 3);
  assert.equal(await evaluate(`document.querySelector('#card-1 .result-round').textContent`), 'Top 32');
  assert.ok(await fits()); await screenshot('02-results');
  await card({ page: 'compact' });
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#card-1 .profile-only')).display`), 'none');
  assert.equal(await evaluate(`document.querySelectorAll('#card-1 .result-row').length`), 3);
  assert.deepEqual(await sharedLayout(), streamProfileLayout, 'stream Profile and Compact keep the frame and shared fields identical');
  assert.ok(await fits()); await screenshot('03-compact');
  await card({ player: 'right' });
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#card-1')).display`), 'none');
  assert.equal(await evaluate(`document.querySelector('#card-2 .result-score').textContent`), '1–2');
  assert.ok(await fits()); await screenshot('04-right');
  const rightCompactLayout = await sharedLayout();
  await card({ page: 'profile' });
  assert.deepEqual(await sharedLayout(), rightCompactLayout, 'wrapped player header stays fixed between Profile and Compact');
  await card({ page: 'compact' });

  for (const page of ['profile', 'stats', 'compact']) {
    for (const player of ['left', 'right']) {
      for (const position of ['left', 'right']) {
        await card({ page, player, position });
        const shown = await evaluate(`[...document.querySelectorAll('.pcard:not([hidden])')].map(el=>({name:el.querySelector('.name').textContent,x:el.getBoundingClientRect().x,color:getComputedStyle(el).backgroundColor}))`);
        assert.deepEqual(shown, [{ name: player === 'left' ? 'Stephen' : 'eeeeeeeeeeee', x: position === 'left' ? 110 : 1010, color: player === 'left' ? 'rgb(204, 38, 38)' : 'rgb(38, 105, 204)' }], `${page}: ${player} player at ${position} position preserves identity and color`);
        assert.ok(await fits());
        if (page === 'profile' && player === 'left' && position === 'right') await screenshot('14-p1-right');
        if (page === 'profile' && player === 'right' && position === 'left') await screenshot('15-p2-left');
      }
    }
  }
  await card({ page: 'compact', player: 'left', position: 'left' });

  const longBracket = structuredClone(bracket);
  for (let id = 4; id <= 14; id++) longBracket.sets[id] = makeSet(id, `2026-10-11T${String(id).padStart(2, '0')}:00:00Z`, `Round ${id}`);
  await evaluate(`emit('${REPLICANTS.startggBracket}',${JSON.stringify(longBracket)})`);
  await card({ page: 'stats', player: 'left', resultsDate: '1900-01-01', resultsPage: 99 });
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#card-1 .result-round')].map(el=>el.textContent)`), ['Round 14', 'Round 13', 'Round 12', 'Round 11', 'Round 10']);
  assert.equal(await evaluate(`document.querySelectorAll('.results-date,.results-pagination').length`), 0);
  assert.ok(await fits(), 'five recent results fit'); await screenshot('05-latest-five');
  await card({ page: 'compact' });
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#card-1 .result-round')].map(el=>el.textContent)`), ['Round 14', 'Round 13', 'Round 12']);
  assert.ok(await fits());
  await evaluate(`{const p=structuredClone(fixtureValues.${REPLICANTS.players});p[1].name='とても長い日本語のプレイヤーネームを持つ対戦相手';emit('${REPLICANTS.players}',p);}`);
  await card({ page: 'stats' });
  await screenshot('08-long-opponents');
  assert.ok(await fits(), 'long opponent names fit on a five-result page');
  await card({ page: 'compact' });
  assert.ok(await fits(), 'three long opponent names fit below the fixed shared stream fields');
  assert.deepEqual(await sharedLayout(), streamProfileLayout, 'long results do not move the shared stream fields');
  await evaluate(`{const m=structuredClone(fixtureValues.${REPLICANTS.matchResolved});m.left.profile=null;m.left.name='<img src=x onerror=alert(1)>';emit('${REPLICANTS.matchResolved}',m);}`);
  await card({ page: 'profile' });
  assert.equal(await evaluate(`document.querySelector('#card-1 .name').textContent`), '<img src=x onerror=alert(1)>');
  assert.equal(await evaluate(`document.querySelectorAll('#card-1 img').length`), 0);
  assert.equal(await evaluate(`document.querySelector('#card-1 .rating').textContent`), '');
  assert.ok(await fits(), 'missing profile is cleared safely');
  await card({ page: 'compact' });
  await evaluate(`emit('${REPLICANTS.startggBracket}',null)`);
  assert.equal(await evaluate(`document.querySelector('#card-1 .results-empty').textContent`), 'Results unavailable');
  await evaluate(`emit('${REPLICANTS.matchResolved}',null)`);
  assert.equal(await evaluate(`document.querySelector('#cards').classList.contains('visible')`), false);
  assert.equal(await evaluate(`document.querySelector('#card-1 .rating').textContent`), '');

  await navigate('/bundles/rashinban/graphics/info-led.html');
  assert.equal(await evaluate(`document.querySelectorAll('.pcard:not([hidden])').length`), 2);
  await screenshot('12-led-profile');
  assert.ok(await fits(), 'LED profiles fit the physical 576px band with 24px margins');
  const ledProfileLayout = await sharedLayout();
  const ledBracket = structuredClone(longBracket);
  for (const [index, round] of ['Losers Quarter-Final', 'Losers Round 1', 'Losers Round 6', 'Losers Round 5', 'Losers Round 4'].entries()) ledBracket.sets[14 - index].roundText = round;
  await evaluate(`emit('${REPLICANTS.startggBracket}',${JSON.stringify(ledBracket)});{const p=structuredClone(fixtureValues.${REPLICANTS.players});p[1].name='とても長い日本語のプレイヤーネームを持つ対戦相手';emit('${REPLICANTS.players}',p);}`);
  await card({ page: 'stats' }, 'led');
  assert.equal(await evaluate(`document.querySelectorAll('#card-1 .result-row').length`), 5);
  await screenshot('13-led-results');
  assert.ok(await fits(), 'five LED results with long opponents fit the physical 576px band');
  await card({ page: 'compact' }, 'led');
  assert.equal(await evaluate(`document.querySelectorAll('#card-1 .result-row').length`), 3);
  await screenshot('06-led');
  assert.ok(await fits(), 'compact LED cards fit the physical 576px band');
  assert.deepEqual(await sharedLayout(), ledProfileLayout, 'both LED cards keep their frame and shared fields identical between Profile and Compact');
  await evaluate(`emit('${REPLICANTS.startggBracket}',null)`);
  assert.deepEqual(await sharedLayout(), ledProfileLayout, 'missing results do not move the shared LED fields');

  await command('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate('/bundles/rashinban/dashboard/switcher-stream.html', 'document.querySelector("#strip select")');
  const playerSelect = `[...document.querySelectorAll('[data-row="playerCards"] label')].find(el=>el.firstChild.textContent==='Player').querySelector('select')`;
  assert.deepEqual(await evaluate(`[...(${playerSelect}).options].map(option=>option.textContent)`), ['P1 Stephen', 'P2 eeeeeeeeeeee']);
  assert.equal(await evaluate(`document.querySelectorAll('[data-row="playerCards"] input[type="date"],[data-row="playerCards"] input[type="number"]').length`), 0);
  const programDocument = `document.querySelector('.monitor[data-channel="program"] iframe.info').contentDocument`;
  const previewDocument = `document.querySelector('.monitor[data-channel="preview"] iframe.info').contentDocument`;
  await until(`${programDocument}.querySelector('#cards')?.dataset.page==='profile'`);
  await evaluate(`{const selects=document.querySelectorAll('[data-row="playerCards"] select');const mode=[...selects].find(s=>[...s.options].some(o=>o.value==='compact'));mode.value='compact';mode.dispatchEvent(new Event('change'));}`);
  await until(`fixtureValues.${REPLICANTS.broadcast}.stream.preview.playerCards.page==='compact'`);
  assert.equal(await evaluate(`fixtureValues.${REPLICANTS.broadcast}.stream.program.playerCards.page`), 'profile');
  await evaluate(`{const s=[...document.querySelectorAll('[data-row="playerCards"] select')].find(s=>[...s.options].some(o=>o.value==='right'));s.value='right';s.dispatchEvent(new Event('change'));}`);
  await until(`fixtureValues.${REPLICANTS.broadcast}.stream.preview.playerCards.player==='right'`);
  await evaluate(`{const m=structuredClone(fixtureValues.${REPLICANTS.matchResolved});m.left.name='めうめう';m.right.name='たいけい/Taikei';emit('${REPLICANTS.matchResolved}',m);}`);
  assert.deepEqual(await evaluate(`[...(${playerSelect}).options].map(option=>option.textContent)`), ['P1 めうめう', 'P2 たいけい/Taikei']);
  assert.equal(await evaluate(`(${playerSelect}).value`), 'right', 'renaming options preserves the selected player');
  await evaluate(`emit('${REPLICANTS.matchResolved}',null)`);
  assert.deepEqual(await evaluate(`[...(${playerSelect}).options].map(option=>option.textContent)`), ['P1 TBD', 'P2 TBD']);
  assert.equal(await evaluate(`(${playerSelect}).value`), 'right');
  await evaluate(`emit('${REPLICANTS.matchResolved}',${JSON.stringify(values[REPLICANTS.matchResolved])})`);
  assert.equal(await evaluate(`${programDocument}.querySelector('#cards').dataset.page`), 'profile');
  assert.equal(await evaluate(`${previewDocument}.querySelector('#cards').dataset.page`), 'compact');
  assert.equal(await evaluate(`${previewDocument}.querySelector('#card-1').hidden`), true);
  assert.equal(await evaluate(`${previewDocument}.querySelector('#card-2').getBoundingClientRect().x`), 110, 'changing player keeps the chosen left position');
  await evaluate(`{const label=[...document.querySelectorAll('[data-row="playerCards"] label')].find(el=>el.firstChild.textContent==='Position');const select=label.querySelector('select');select.value='right';select.dispatchEvent(new Event('change'));}`);
  await until(`fixtureValues.${REPLICANTS.broadcast}.stream.preview.playerCards.position==='right'`);
  assert.equal(await evaluate(`fixtureValues.${REPLICANTS.broadcast}.stream.program.playerCards.position`), 'left');
  assert.equal(await evaluate(`${previewDocument}.querySelector('#card-2').getBoundingClientRect().x`), 1010);
  assert.equal(await evaluate(`${programDocument}.querySelector('#card-1').getBoundingClientRect().x`), 110);
  await evaluate(`document.querySelector('#take').click()`);
  await until(`fixtureValues.${REPLICANTS.broadcast}.stream.program.playerCards.page==='compact'&&fixtureValues.${REPLICANTS.broadcast}.stream.program.playerCards.player==='right'`);
  assert.equal(await evaluate(`${programDocument}.querySelector('#cards').dataset.page`), 'compact');
  assert.equal(await evaluate(`${programDocument}.querySelector('#card-1').hidden`), true);
  assert.equal(await evaluate(`fixtureValues.${REPLICANTS.broadcast}.stream.program.playerCards.position`), 'right');
  assert.equal(await evaluate(`${programDocument}.querySelector('#card-2').getBoundingClientRect().x`), 1010);
  await screenshot('07-switcher');

  // Replay actual completed start.gg sets without changing any tournament or
  // live replicants. --startgg-live uses fresh responses from startgg-fetch.mjs.
  const liveStartgg = process.argv.includes('--startgg-live');
  const sourceFiles = liveStartgg
    ? ['artifacts/player-cards/startgg-live-semifinals.json', 'artifacts/player-cards/startgg-live-finals.json']
    : ['docs/startgg/samples/evo-japan-2026-sf6-semifinals-top24.json', 'docs/startgg/samples/evo-japan-2026-sf6-finals-top8.json'];
  const sources = await Promise.all(sourceFiles.map(async file => JSON.parse(await readFile(path.join(root, file), 'utf8'))));
  const realBracket = normalizeEvent(null, sources.map(source => source.data.phaseGroup), null, now);
  const realMatch = emptyMatch();
  realMatch.source = 'startgg'; realMatch.setId = 102466032;
  realMatch.left.entrantId = 22463723; realMatch.left.name = 'Punk';
  realMatch.right.entrantId = 22137613; realMatch.right.name = 'Yamaguchi';
  const realResolved = resolveMatch(realMatch, []);
  const recentResults = playerCardResults(realBracket, realResolved.left, [], realMatch.setId, 5, now);
  assert.deepEqual(recentResults.rows.map(row => row.id), [102466047, 102466046, 102466044, 102466042, 102398940]);
  const priorGames = playerCardResults(realBracket, realResolved.left, [], realMatch.setId, 3, now);
  assert.deepEqual(priorGames.rows.map(row => [row.opponent, row.score]), [['Higuchi', '3–0'], ['Hope', '3–1'], ['naooonn', '3–2']]);
  // Selecting the preceding match also excludes the later Grand Final.
  assert.deepEqual(playerCardResults(realBracket, realResolved.left, [], 102466047, 3, now).rows.map(row => row.id), [102466046, 102466044, 102466042]);
  await command('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await navigate('/bundles/rashinban/graphics/info-stream.html');
  await evaluate(`emit('${REPLICANTS.players}',[]);emit('${REPLICANTS.startggBracket}',${JSON.stringify(realBracket)});emit('${REPLICANTS.matchResolved}',${JSON.stringify(realResolved)});`);
  await card({ page: 'stats', player: 'left' });
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#card-1 .result-opponent')].map(el=>el.textContent)`), ['vs. Higuchi', 'vs. Hope', 'vs. naooonn', 'vs. SR NuckleDu', 'vs. cosa']);
  assert.ok(await fits(), 'real start.gg recent results fit'); await screenshot('09-startgg-results');
  await card({ page: 'compact' });
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#card-1 .result-score')].map(el=>el.textContent)`), ['3–0', '3–1', '3–2']);
  assert.ok(await fits(), 'real start.gg compact results fit'); await screenshot('10-startgg-compact');
  await evaluate(`{const m=structuredClone(fixtureValues.${REPLICANTS.matchResolved});m.setId=102466047;emit('${REPLICANTS.matchResolved}',m);}`);
  assert.equal(await evaluate(`document.querySelector('#card-1 .result-opponent').textContent`), 'vs. Hope');
  assert.equal(await evaluate(`document.querySelectorAll('#card-1 .result-row').length`), 3);
  assert.ok(await fits()); await screenshot('11-startgg-earlier-match');

  // Both bracket graphics consume the same recorded data. LED visibility is
  // independent; the dedicated graphic still fills its original 1080p canvas.
  const bracketRows = () => evaluate(`[...document.querySelectorAll('#bracket-matches > .match')].map(el=>({
    match:Number(el.id.slice(5)),top:el.querySelector('.match--player-name').textContent,
    bottom:el.querySelectorAll('.match--player-name')[1].textContent,
    topScore:el.querySelector('.match--seed').textContent,bottomScore:el.querySelectorAll('.match--seed')[1].textContent,
    winner:el.querySelector('.winner')===el.querySelector('.match--player')?'top':el.querySelector('.winner')?'bottom':null,
    active:el.querySelector('.match-border').classList.contains('active')
  }))`);
  for (const [page, height] of [['info-led', 576], ['brackets-finals', 1080]]) {
    await navigate(`/bundles/rashinban/graphics/${page}.html`, 'document.querySelector("#match1-top")?.textContent');
    if (page === 'info-led') {
      assert.equal(await evaluate(`document.querySelector('#layer-bracket').hidden`), true);
      await evaluate(`{const s=structuredClone(fixtureValues.${REPLICANTS.broadcast});s.led.program.bracket.visible=true;s.led.program.playerCards.visible=false;emit('${REPLICANTS.broadcast}',s);}`);
      await delay(550);
    } else {
      assert.equal(state.led.program.bracket.visible, false, 'standalone works with the LED bracket hidden');
    }
    assert.deepEqual(await bracketRows(), finals.rows, `${page}: names, scores, winners, and active matches`);
    assert.equal(await evaluate(`document.querySelector('#bracket').getBoundingClientRect().height`), height);
    assert.ok(await evaluate(`[...document.querySelectorAll('#bracket-matches > .match')].filter(el=>getComputedStyle(el).display!=='none').every(el=>{const r=el.getBoundingClientRect();return r.x>=0&&r.right<=1920&&r.y>=0&&r.bottom<=${height};})`), `${page}: match boxes fit the output`);
    await screenshot(page === 'info-led' ? '16-led-bracket' : '17-dedicated-bracket');
    const reset = { ...finals.rows[0], match: 11, top: 'めうめう', bottom: 'たいけい/Taikei', active: true, winner: 'bottom' };
    await evaluate(`emit('${REPLICANTS.bracketFinals}',${JSON.stringify({ ...finals, rows: [reset] })})`);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('#match11')).display`), 'inline');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('#match11-bracket-line')).display`), 'inline');
    assert.deepEqual((await bracketRows()).find(row=>row.match===11), reset);
    assert.equal(await evaluate(`document.querySelector('#match1-top').textContent`), '', 'partial data clears stale matches');
    await evaluate(`emit('${REPLICANTS.bracketFinals}',null)`);
    assert.equal(await evaluate(`document.querySelector('#match11-top').textContent`), '');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('#match11')).display`), 'none');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('#match11-bracket-line')).display`), 'none');
    assert.equal(await evaluate(`document.querySelectorAll('#bracket .active,#bracket .winner').length`), 0);
  }

  await command('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate('/bundles/rashinban/dashboard/switcher-led.html', 'document.querySelector("[data-row=bracket] button.toggle")');
  await until(`${programDocument}.querySelector('#match1-top')?.textContent&&${previewDocument}.querySelector('#match1-top')?.textContent`);
  const bracketHidden = document => `${document}.querySelector('#layer-bracket').hidden`;
  assert.equal(await evaluate(bracketHidden(programDocument)), true);
  assert.equal(await evaluate(bracketHidden(previewDocument)), true);
  await evaluate(`document.querySelector('[data-row=bracket] button.toggle').click()`);
  await until(`fixtureValues.${REPLICANTS.broadcast}.led.preview.bracket.visible`);
  assert.equal(await evaluate(bracketHidden(previewDocument)), false);
  assert.equal(await evaluate(bracketHidden(programDocument)), true);
  await evaluate(`document.querySelector('[data-row=playerCards] button.toggle').click()`);
  await until(`!fixtureValues.${REPLICANTS.broadcast}.led.preview.playerCards.visible`);
  await evaluate(`document.querySelector('#take').click()`);
  await until(`fixtureValues.${REPLICANTS.broadcast}.led.program.bracket.visible`);
  assert.equal(await evaluate(bracketHidden(programDocument)), false);
  await delay(550);
  await screenshot('18-led-switcher-bracket');
  await evaluate(`document.querySelector('[data-row=bracket] button.toggle').click()`);
  await until(`!fixtureValues.${REPLICANTS.broadcast}.led.preview.bracket.visible`);
  assert.equal(await evaluate(bracketHidden(programDocument)), false, 'hiding is also staged until TAKE');
  await evaluate(`document.querySelector('#take').click()`);
  await until(`!fixtureValues.${REPLICANTS.broadcast}.led.program.bracket.visible`);
  assert.equal(await evaluate(bracketHidden(programDocument)), true);
  await writeFile(path.join(artifacts, 'startgg-check.json'), JSON.stringify({
    source: liveStartgg ? 'fresh API responses' : 'saved API responses', sourceFiles,
    fetchedAt: sources.map(source => source.fetchedAt), loadedSets: Object.keys(realBracket.sets).length,
    currentSetId: realMatch.setId, player: 'Punk', recentResults: recentResults.rows, previousGames: priorGames.rows,
  }, null, 2) + '\n');
  assert.deepEqual(errors, [], 'no browser exceptions');
  console.log('Player cards verified: independent player/position in every mode, position Preview/TAKE, identical Profile/Compact frame and shared-field positions, single stream player, two LED cards, latest five/three games, obsolete date/page ignored, missing data, dashboard selection and TAKE.');
  console.log(`start.gg replay verified from ${liveStartgg ? 'fresh' : 'saved'} API responses: 30 sets, latest five/three games across dates, current/later matches excluded.`);
  console.log('Bracket verified: 1920x576 LED layout, independent 1080p dedicated graphic, shared data updates, reset visibility, stale-data clearing, LED Preview/TAKE show and hide.');
  console.log('Screenshots: ' + artifacts);
} finally {
  socket?.close(); chrome.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await delay(300);
  const target = path.resolve(profile);
  if (path.dirname(target) !== path.resolve(artifacts) || !path.basename(target).startsWith('chrome-')) throw Error('Unsafe temporary profile path');
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
