// Isolated built-page checks with a controlled presenter clock. No live game,
// camera, Google API or NodeCG runtime is changed by this script.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySnapshot } from '../bundles/rashinban/src/presenter/normalize.ts';
import { seedViews } from '../bundles/rashinban/src/presenter/telemetry.ts';
import { advanceTimeline, DEFAULT_TIMING } from '../bundles/rashinban/src/presenter/timeline.ts';
import { DEFAULT_SETTINGS } from '../bundles/rashinban/src/presenter/settings.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts/presenter-validation/motion');
await mkdir(artifacts, { recursive: true });
const epoch = Date.now();
const state = applySnapshot(null, JSON.parse(await readFile(path.join(root, 'docs/geoguessr/samples/gs2-ws-DuelStarted.json'), 'utf8'))).state;
state.mode = 'NM'; state.status = 'Ongoing';
Object.assign(state.rounds[0], { startAtMs: epoch - 21000, timerStartAtMs: epoch - 21000, endAtMs: epoch + 39000 });
const timeline = advanceTimeline(null, state, epoch, false, DEFAULT_TIMING);
const initial = { presenterDuel: state, presenterViews: seedViews(state), presenterTimeline: timeline,
  presenterSettings: { ...DEFAULT_SETTINGS, viewSource: 'rendered', muted: true },
  presenterSeries: { id: 'motion-qa', source: 'manual', left: { id: 'a', name: 'PLAYER LEFT', handle: '', wins: 1, playerId: state.players[0].id },
    right: { id: 'b', name: 'PLAYER RIGHT', handle: '', wins: 2, playerId: state.players[1].id } },
  presenterClients: { clients: [], program: null }, presenterPublicConfig: { googleMapsApiKey: '' } };
const bootstrap = `
window.qa={now:${epoch},initial:${JSON.stringify(initial)}};
Date.now=()=>qa.now;performance.now=()=>qa.now-${epoch};
const reps=new Map();
qa.set=(name,value)=>{const rep=nodecg.Replicant(name);rep.value=value;rep.listeners.forEach(fn=>fn(value));};
window.nodecg={Replicant(name){if(!reps.has(name))reps.set(name,{value:qa.initial[name],listeners:[],on(event,fn){this.listeners.push(fn);queueMicrotask(()=>fn(this.value));}});return reps.get(name);},async sendMessage(name){return name==='presenter:clock'?qa.now:true;}};
qa.rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
qa.live=(mode,source,lock)=>{qa.now=${epoch};const s=structuredClone(qa.initial.presenterDuel);s.mode=mode;for(const [i,side] of ['left','right'].entries())if(lock===side||lock==='both')s.players[i].guesses=[{round:s.round,lat:1,lng:2,score:4000,distanceM:10,createdAtMs:qa.now}];qa.set('presenterSettings',{...qa.initial.presenterSettings,viewSource:source});qa.set('presenterDuel',s);qa.set('presenterTimeline',structuredClone(qa.initial.presenterTimeline));};
`;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const file = path.resolve(root, 'bundles/rashinban/graphics', '.' + url.pathname);
    if (!file.startsWith(path.join(root, 'bundles/rashinban/graphics') + path.sep)) throw Error('Invalid path');
    let data = await readFile(file);
    if (file.endsWith('.html')) data = data.toString().replace('<script src="presenter.js">', `<script>${bootstrap}</script><script src="presenter.js">`);
    res.setHeader('Content-Type', { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg' }[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch (error) { res.writeHead(404); res.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = path.join(artifacts, `chrome-${Date.now()}`);
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket; let counter = 0;
const pending = new Map(), errors = [], checks = [], layouts = [];
async function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++counter;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function settle() { await delay(450); }
async function screenshot(name, led = false) {
  const r = await command('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1920, height: led ? 576 : 1080, scale: 1 } });
  await writeFile(path.join(artifacts, `${name}.png`), Buffer.from(r.data, 'base64'));
}
const ratio = r => assert.ok(Math.abs(r.width / r.height - 16 / 9) < 0.001, `Expected 16:9: ${JSON.stringify(r)}`);
try {
  let target;
  for (let i = 0; i < 100; i++) {
    try {
      const port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
      target = (await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())).find(p => p.type === 'page');
      if (target) break;
    } catch { /* Chrome is starting. */ }
    await delay(100);
  }
  if (!target) throw Error('Browser did not start');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const m = JSON.parse(event.data);
    if (m.id) { const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); } }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params);
  };
  await command('Runtime.enable'); await command('Page.enable');
  await command('DOM.enable'); await command('CSS.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  for (const output of ['stream', 'led']) {
    const led = output === 'led';
    await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/presenter${led ? '-led' : ''}.html?role=preview` });
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`document.getElementById('timer-value')?.textContent==='39'`)) break;
      await delay(100);
    }
    assert.equal(await evaluate(`document.getElementById('timer-value').textContent`), '39');
    await evaluate(`document.fonts.ready`);
    const fontDocument = await command('DOM.getDocument');
    const fontNode = await command('DOM.querySelector', { nodeId: fontDocument.root.nodeId, selector: '#timer-value' });
    const fontUsage = await command('CSS.getPlatformFontsForNode', { nodeId: fontNode.nodeId });
    assert.ok(fontUsage.fonts.some(font => font.familyName.toLowerCase().includes('kaneda') && font.glyphCount > 0), 'timer numerals must render in Kaneda Gothic');
    const alignment = await evaluate(`({timer:qa.rect('timer'),value:qa.rect('timer-value')})`);
    assert.ok(Math.abs(alignment.timer.x + alignment.timer.width / 2 - alignment.value.x - alignment.value.width / 2) < 1, 'timer numeral centered horizontally');
    assert.ok(Math.abs(alignment.timer.y + alignment.timer.height / 2 - alignment.value.y - alignment.value.height / 2) < 1, 'timer numeral centered vertically');
    await evaluate(`const initial56=structuredClone(qa.initial.presenterDuel);Object.assign(initial56.rounds[0],{startAtMs:qa.now-4000,timerStartAtMs:qa.now-4000,endAtMs:qa.now+56000});qa.set('presenterDuel',initial56);`);
    await settle(); await screenshot(`${output}-56`, led);
    const timer = await evaluate(`qa.rect('timer')`);
    for (const mode of ['NM', 'NMPZ']) for (const source of ['rendered', 'video', 'chroma']) for (const lock of ['none', 'left', 'right', 'both']) {
      await evaluate(`qa.live('${mode}','${source}','${lock}')`); await settle();
      const current = await evaluate(`({timer:qa.rect('timer'),left:qa.rect('left-window'),right:qa.rect('right-window'),leftMap:qa.rect('left-map'),rightMap:qa.rect('right-map'),layout:document.body.dataset.layout,lock:document.body.dataset.lock})`);
      assert.deepEqual(current.timer, timer, `${output} timer moved on ${mode}/${source}/${lock}`);
      if (current.layout === 'dual' || current.lock !== 'none') { ratio(current.left); ratio(current.right); }
      if (current.lock === 'left' || current.lock === 'both') ratio(current.leftMap);
      if (current.lock === 'right' || current.lock === 'both') ratio(current.rightMap);
      if (current.layout === 'shared' && ['left', 'right'].includes(current.lock)) {
        const shared = await evaluate(`(()=>{const el=document.getElementById('shared-panorama');const style=getComputedStyle(el);return{width:parseFloat(style.width)-parseFloat(style.borderLeftWidth)-parseFloat(style.borderRightWidth),height:parseFloat(style.height)-parseFloat(style.borderTopWidth)-parseFloat(style.borderBottomWidth)};})()`);
        ratio(shared);
      }
      if (led) {
        assert.equal(current.layout, 'dual');
        assert.ok(current.left.x + current.left.width < timer.x && timer.x + timer.width < current.right.x);
        assert.ok(current.left.y + current.left.height <= 576 && current.right.y + current.right.height <= 576);
      }
      layouts.push({ output, mode, source, lock, ...current });
    }
    checks.push(`${output}: fixed timer and 16:9 lock frames across modes, sources and both sides`);
    await evaluate(`qa.live('NM','rendered','none')`); await settle(); await screenshot(`${output}-39`, led);
    await evaluate(`qa.live('NM','rendered','left')`); await settle(); await screenshot(`${output}-locked`, led);
    await evaluate(`qa.live('NM','rendered','none');const s=structuredClone(qa.initial.presenterDuel);s.rounds[0].startAtMs=qa.now+60000;qa.set('presenterDuel',s);qa.set('presenterTimeline',{...qa.initial.presenterTimeline,phase:'pre-round'});`);
    await settle();
    const preview = await evaluate(`({rect:qa.rect('preview-area'),panorama:qa.rect('preview-panorama'),hidden:document.getElementById('preview-area').hidden,timerHidden:document.getElementById('timer').hidden})`);
    ratio(preview.rect); ratio(preview.panorama); assert.equal(preview.rect.x + preview.rect.width / 2, 960); assert.equal(preview.hidden, false); assert.equal(preview.timerHidden, true);
    await screenshot(`${output}-preview`, led);
    checks.push(`${output}: centered 16:9 preview and gold final countdown`);

    const result = structuredClone(state); result.manualRoundStart = false;
    result.players.forEach((player, i) => { player.results = [{ round: result.round, score: i ? 3200 : 4500, bestGuess: null,
      healthBefore: 6000, healthAfter: i ? 4050 : 6000, damageDealt: i ? 0 : 1950, multiplier: 1.5 }]; });
    const scoring = advanceTimeline(null, result, epoch, false, DEFAULT_TIMING);
    await evaluate(`qa.live('NM','chroma','left')`); await settle();
    const liveWindows = await evaluate(`({left:qa.rect('left-window'),right:qa.rect('right-window')})`);
    for (const now of [epoch, scoring.revealAtMs - 1]) {
      await evaluate(`qa.now=${now};qa.set('presenterDuel',${JSON.stringify(result)});qa.set('presenterTimeline',${JSON.stringify(scoring)});`); await settle();
      const lead = await evaluate(`({transitionHidden:document.getElementById('transition').hidden,liveHidden:document.getElementById('live-area').hidden,resultsVisibility:document.getElementById('results-area').style.visibility,left:qa.rect('left-window'),right:qa.rect('right-window'),phaseLabel:document.getElementById('phase-label').textContent,scoringHidden:document.getElementById('scoring-layer').hidden})`);
      assert.equal(lead.transitionHidden,true,'No Round Complete interstitial before scoring');
      assert.equal(lead.liveHidden,false,'Keep the last live view until results are ready');
      assert.equal(lead.resultsVisibility,'hidden'); assert.equal(lead.scoringHidden,true);
      assert.deepEqual({left:lead.left,right:lead.right},liveWindows,'Retain the final player window layout');
      assert.notEqual(lead.phaseLabel,'ROUND COMPLETE');
    }
    const reveal = advanceTimeline(scoring, result, scoring.revealAtMs, false, DEFAULT_TIMING);
    await evaluate(`qa.now=${scoring.revealAtMs};qa.set('presenterTimeline',${JSON.stringify(reveal)});`); await settle();
    assert.deepEqual(await evaluate(`({liveHidden:document.getElementById('live-area').hidden,resultsVisibility:document.getElementById('results-area').style.visibility,transitionHidden:document.getElementById('transition').hidden,stage:document.body.dataset.scoring})`),
      {liveHidden:true,resultsVisibility:'visible',transitionHidden:true,stage:'entry'});
    checks.push(`${output}: final gameplay cuts directly to results and scoring without an interstitial`);
    const tokens = [];
    for (const [name, offset] of [['count', 1585], ['anticipate', 3160], ['collision', 3360], ['multiplier', 4260], ['flight', 4960], ['multiplier-faded', 5160], ['impact-before', 5309], ['impact', 5310], ['impact-after', 5410], ['settled', 7310]]) {
      const now = scoring.revealAtMs + offset;
      const t = advanceTimeline(scoring, result, now, false, DEFAULT_TIMING);
      await evaluate(`qa.now=${now};qa.set('presenterDuel',${JSON.stringify(result)});qa.set('presenterTimeline',${JSON.stringify(t)});`); await settle();
      tokens.push({ name, ...await evaluate(`({stage:document.body.dataset.scoring,rect:qa.rect('score-token-right'),transform:document.getElementById('score-token-right').style.transform,opacity:document.getElementById('score-token-right').style.opacity,health:document.getElementById('right-health').textContent,multiplierHidden:document.getElementById('score-calculation').hidden})`) });
      if (!name.startsWith('impact-')) await screenshot(`${output}-score-${name}`, led);
    }
    const before = tokens.find(t => t.name === 'impact-before'), impact = tokens.find(t => t.name === 'impact');
    assert.equal(impact.stage, 'impact');
    assert.ok(Math.abs(before.rect.y - impact.rect.y) < 15, 'damage must not teleport at impact');
    assert.equal(impact.opacity, '1');
    assert.equal(tokens.find(t => t.name === 'flight').multiplierHidden, false);
    assert.equal(tokens.find(t => t.name === 'multiplier-faded').multiplierHidden, true);
    assert.equal(tokens.at(-1).health, '4050');
    await writeFile(path.join(artifacts, `${output}-motion.json`), JSON.stringify(tokens, null, 2));
    checks.push(`${output}: built scoring animation crosses impact continuously and settles authoritative HP`);
    // The production client deliberately never rewinds its synchronized clock.
    // Sample the last ten seconds after scoring, without rewinding time.
    await evaluate(`qa.live('NM','rendered','none');qa.now=${epoch + 29000}`); await settle();
    assert.equal(await evaluate(`document.getElementById('timer-value').textContent`), '10');
    assert.equal(await evaluate(`document.getElementById('timer').classList.contains('critical')`), true);
    if (led) {
      const numeral = await evaluate(`qa.rect('timer-value')`);
      assert.ok(numeral.x >= 816 && numeral.x + numeral.width <= 1104, 'final countdown stays between LED views');
    }
    await screenshot(`${output}-10`, led);
  }
  assert.deepEqual(errors, [], 'uncaught browser errors');
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify({ checks, errors, layouts }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, layoutCases: layouts.length, errors: errors.length, artifacts }, null, 2));
} finally {
  socket?.close(); chrome.kill(); await new Promise(resolve => server.close(resolve));
}
