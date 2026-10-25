// Exercises the built graphics and switcher against isolated NodeCG fixtures.
// No live NodeCG process, credentials, spreadsheet, or persisted replicants are used.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, access, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInitialState, setPreview, take, swap, clearPreview, revertPreview } from '../bundles/rashinban/src/broadcast/state.ts';
import { emptyMatch, resolveMatch } from '../bundles/rashinban/src/match/state.ts';
import { rowToProfile } from '../bundles/rashinban/src/sheet/players.ts';
import { normalizeEvent } from '../bundles/rashinban/src/startgg/normalize.ts';
import { playerCardResults } from '../bundles/rashinban/src/broadcast/player-card-results.ts';
import { fromPhaseGroupSample } from '../bundles/rashinban/src/bracket/finals.ts';
import { createInitialState as initialBanpick, applyAction, nextGame, undo, reset } from '../bundles/rashinban/src/banpick/rules.ts';
import { REPLICANTS, BROADCAST_MESSAGES, BANPICK_MESSAGES } from '../bundles/rashinban/src/types/replicants.ts';
import { verifyBanpick } from './banpick-browser-checks.mjs';
import { verifyCasters } from './casters-browser-checks.mjs';
import { verifyLedPages } from './led-browser-checks.mjs';
import { verifyPlayerCardsDesign } from './player-cards-browser-checks.mjs';
import { verifyLowerThirds } from './lower-thirds-browser-checks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ledOnly = process.argv.includes('--led-only');
const lowerThirdsOnly = process.argv.includes('--lower-thirds-only');
const castersOnly = process.argv.includes('--casters-only');
const cardsOnly = process.argv.includes('--cards-only');
const banpickOnly = process.argv.includes('--banpick-only');
const artifacts = path.join(root, banpickOnly ? 'artifacts/banpick' : lowerThirdsOnly ? 'artifacts/lower-thirds' : castersOnly ? 'artifacts/casters' : 'artifacts/player-cards');
const adobeFonts = process.argv.includes('--adobe-fonts');
const screenshotDirectory = (cardsOnly || banpickOnly) && !adobeFonts ? path.join(artifacts, 'fallback-fonts') : artifacts;
await mkdir(artifacts, { recursive: true });
await mkdir(screenshotDirectory, { recursive: true });
const now = Date.parse('2026-10-12T05:00:00Z');
const profiles = [
  rowToProfile({ startgg_entrant_id: '10', startgg_tag: 'Stephen', name: 'Stephen', twitter: 'StephGeoGuessr', age: '29', rating: '1493', favorite_mode: '全モード', strengths: 'Movingの知識、カーメタ', favorite_food: '寿司(イワシ・サンマ)、超濃厚煮干しラーメン、マトンビリヤニ、ぼたん鍋', message: '前年度は解説として参加させていただきましたが、今年度は選手としていいプレーを少しでも見せれるように頑張ります！' }),
  rowToProfile({ startgg_entrant_id: '20', startgg_tag: 'eeeeeeeeeeee', name: 'eeeeeeeeeeee', twitter: 'eeeeeeeeee_geo', age: '16', rating: '1452', favorite_mode: 'NM', strengths: '広く浅い知識', favorite_food: '唐揚げ', message: '自分を信じる' }),
];
const match = emptyMatch();
match.left.entrantId = 10; match.right.entrantId = 20;
match.source = 'startgg'; match.setId = 50; match.label = 'Top 8';
let state = createInitialState();
// Reference crops and Preview/TAKE comparisons need a fixed starting position.
for (const output of ['stream', 'led']) {
  state = take(setPreview(state, output, { playerCards: { visible: true, position: 'left' } }), output);
}
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
const values = { [REPLICANTS.banPick]: initialBanpick(), [REPLICANTS.broadcast]: state, [REPLICANTS.matchResolved]: resolveMatch(match, profiles),
  [REPLICANTS.players]: profiles, [REPLICANTS.startggBracket]: bracket, [REPLICANTS.bracketFinals]: finals };
const preload = () => `
Date.now=()=>${now};
const values=${JSON.stringify(values).replaceAll('<', '\\u003c')};
const handlers=new Map();
window.fixtureValues=values;
window.emit=(name,value)=>{values[name]=value;for(const cb of handlers.get(name)||[])cb(value);};
window.nodecg={Replicant(name){return{get value(){return values[name];},on(event,callback){if(!handlers.has(name))handlers.set(name,[]);handlers.get(name).push(callback);if(Object.hasOwn(values,name))queueMicrotask(()=>callback(values[name]));}};},
async sendMessage(name,data){if(name==='presenter:clock')return Date.now();if(name.startsWith('presenter:'))return true;const response=await fetch('/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,data})});const next=await response.json();if(!response.ok)throw Error(next.error);emit(next.replicant,next.value);for(const frame of document.querySelectorAll('iframe'))frame.contentWindow.emit?.(next.replicant,next.value);return next.value;}};
`;
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/message') {
      let body = ''; for await (const chunk of req) body += chunk;
      const { name, data } = JSON.parse(body);
      if (Object.values(BANPICK_MESSAGES).includes(name)) {
        const previous = values[REPLICANTS.banPick];
        values[REPLICANTS.banPick] = name === BANPICK_MESSAGES.act ? applyAction(previous, data.optionId, data.player)
          : name === BANPICK_MESSAGES.nextGame ? nextGame(previous)
          : name === BANPICK_MESSAGES.undo ? undo(previous) : reset(previous);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ replicant: REPLICANTS.banPick, value: values[REPLICANTS.banPick] })); return;
      }
      if (name === BROADCAST_MESSAGES.setPreview) state = setPreview(state, data.output, data.patch);
      else if (name === BROADCAST_MESSAGES.take) state = take(state, data.output);
      else if (name === BROADCAST_MESSAGES.revertPreview) state = revertPreview(state, data.output);
      else if (name === BROADCAST_MESSAGES.swap) state = swap(state, data.output);
      else if (name === BROADCAST_MESSAGES.clearPreview) state = clearPreview(state, data.output);
      else throw Error('Unexpected message ' + name);
      values[REPLICANTS.broadcast] = state;
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ replicant: REPLICANTS.broadcast, value: state })); return;
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
    res.setHeader('Content-Type', { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream');
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
async function screenshot(name, clip) {
  const shot = await command('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  await writeFile(path.join(screenshotDirectory, name + '.png'), Buffer.from(shot.data, 'base64'));
}
async function fits() {
  return evaluate(`[...document.querySelectorAll('.pcard:not([hidden])')].every(card=>{const r=card.getBoundingClientRect();const led=document.body.dataset.output==='led';return r.top>=0&&r.bottom<=(led?576:1080)&&(!led||(r.top===24&&r.height<=529&&r.width===480&&r.left===(card.id==='card-1'?36:1404)))&&card.scrollWidth<=card.clientWidth&&[...card.querySelectorAll('.name,.twitter,.value,.result-row,.result-round,.result-opponent,.result-score,.results-empty,.day1-empty,.record-value,.highlights-text')].filter(e=>e.getBoundingClientRect().height).every(e=>{const a=e.getBoundingClientRect();return a.left>=r.left&&a.right<=r.right&&a.top>=r.top&&a.bottom<=r.bottom;});})`);
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
  if (banpickOnly) {
    for (const output of ['stream', 'led']) state = take(setPreview(state, output, {
      banpick: { visible: true }, playerCards: { visible: output === 'led' },
    }), output);
    values[REPLICANTS.broadcast] = state;
    await verifyBanpick({ navigate, evaluate, until, screenshot, delay, command, adobeFonts });
    assert.deepEqual(errors, [], 'no browser exceptions');
    console.log('Ban/pick browser checks passed. Screenshots: ' + screenshotDirectory);
  } else if (lowerThirdsOnly) {
    await verifyLowerThirds({ navigate, evaluate, until, screenshot, delay, command });
    assert.deepEqual(errors, [], 'no browser exceptions');
    console.log('Lower-third browser checks passed. Screenshots: ' + artifacts);
  } else if (ledOnly) {
    await verifyLedPages({ navigate, evaluate, until, screenshot, delay, command });
    assert.deepEqual(errors, [], 'no browser exceptions');
    console.log('LED page checks passed. Screenshots: ' + artifacts);
  } else if (castersOnly) {
    await verifyCasters({ navigate, evaluate, until, screenshot, delay, command });
    assert.deepEqual(errors, [], 'no browser exceptions');
    console.log('Caster browser checks passed. Screenshots: ' + artifacts);
  } else {
  if (!cardsOnly) await verifyLedPages({ navigate, evaluate, until, screenshot, delay, command });
  await verifyPlayerCardsDesign({ navigate, evaluate, card, screenshot, command, fits, adobeFonts, values, bracket, makeSet });

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
  assert.equal(await evaluate(`document.querySelectorAll('#card-1 .result-row').length`), 0, 'compact shows Day 1 totals rather than recent matches');
  assert.ok(await fits(), 'real start.gg compact results fit'); await screenshot('10-startgg-compact');
  await card({ page: 'stats' });
  await evaluate(`{const m=structuredClone(fixtureValues.${REPLICANTS.matchResolved});m.setId=102466047;emit('${REPLICANTS.matchResolved}',m);}`);
  assert.equal(await evaluate(`document.querySelector('#card-1 .result-opponent').textContent`), 'vs. Hope');
  assert.equal(await evaluate(`document.querySelectorAll('#card-1 .result-row').length`), 5);
  assert.ok(await fits()); await screenshot('11-startgg-earlier-match');

  // Both independent bracket graphics consume the same recorded data.
  const bracketRows = () => evaluate(`[...document.querySelectorAll('#bracket-matches > .match')].map(el=>({
    match:Number(el.id.slice(5)),top:el.querySelector('.match--player-name').textContent,
    bottom:el.querySelectorAll('.match--player-name')[1].textContent,
    topScore:el.querySelector('.match--seed').textContent,bottomScore:el.querySelectorAll('.match--seed')[1].textContent,
    winner:el.querySelector('.winner')===el.querySelector('.match--player')?'top':el.querySelector('.winner')?'bottom':null,
    active:el.querySelector('.match-border').classList.contains('active')
  }))`);
  for (const [page, height] of cardsOnly ? [] : [['bracket-led', 576], ['brackets-finals', 1080]]) {
    await navigate(`/bundles/rashinban/graphics/${page}.html`, 'document.querySelector("#match1-top")?.textContent');
    assert.deepEqual(await bracketRows(), finals.rows, `${page}: names, scores, winners, and active matches`);
    assert.equal(await evaluate(`document.querySelector('#bracket').getBoundingClientRect().height`), height);
    assert.ok(await evaluate(`[...document.querySelectorAll('#bracket-matches > .match')].filter(el=>getComputedStyle(el).display!=='none').every(el=>{const r=el.getBoundingClientRect();return r.x>=0&&r.right<=1920&&r.y>=0&&r.bottom<=${height};})`), `${page}: match boxes fit the output`);
    await screenshot(page === 'bracket-led' ? '16-led-bracket' : '17-dedicated-bracket');
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

  state = createInitialState();
  for (const output of ['stream', 'led']) state = take(setPreview(state, output, {
    banpick: { visible: true }, playerCards: { visible: output === 'led' },
  }), output);
  values[REPLICANTS.broadcast] = state;
  if (!cardsOnly) {
    await verifyBanpick({ navigate, evaluate, until, screenshot, delay, command });
    await verifyCasters({ navigate, evaluate, until, screenshot, delay, command });
  }
  await writeFile(path.join(artifacts, 'startgg-check.json'), JSON.stringify({
    source: liveStartgg ? 'fresh API responses' : 'saved API responses', sourceFiles,
    fetchedAt: sources.map(source => source.fetchedAt), loadedSets: Object.keys(realBracket.sets).length,
    currentSetId: realMatch.setId, player: 'Punk', recentResults: recentResults.rows, previousGames: priorGames.rows,
  }, null, 2) + '\n');
  assert.deepEqual(errors, [], 'no browser exceptions');
  console.log('Player cards verified: independent player/position in every mode, position Preview/TAKE, content-sized Profile/Results/Compact cards, career highlights, Day 1 totals, single stream player, two LED cards, latest five matches, obsolete date/page ignored, missing data, dashboard selection and TAKE.');
  console.log(`start.gg replay verified from ${liveStartgg ? 'fresh' : 'saved'} API responses: 30 sets, latest five/three games across dates, current/later matches excluded.`);
  if (!cardsOnly) console.log('Bracket verified: 1920x576 LED layout, independent 1080p dedicated graphic, shared data updates, reset visibility, stale-data clearing, always-on LED sources, Stream Program page sync, background-only tint transparency.');
  console.log('Screenshots: ' + screenshotDirectory);
  }
} finally {
  socket?.close(); chrome.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await delay(300);
  const target = path.resolve(profile);
  if (path.dirname(target) !== path.resolve(artifacts) || !path.basename(target).startsWith('chrome-')) throw Error('Unsafe temporary profile path');
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
