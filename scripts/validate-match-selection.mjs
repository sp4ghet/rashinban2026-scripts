// Real match extension behind a fixture NodeCG transport; no credentials or live account.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { registerMatch } from '../bundles/rashinban/src/extension/match.ts';
import { createInitialState } from '../bundles/rashinban/src/banpick/rules.ts';
import { rowToProfile } from '../bundles/rashinban/src/sheet/players.ts';
import { normalizeEvent } from '../bundles/rashinban/src/startgg/normalize.ts';
const root = process.cwd(), artifacts = path.join(root, 'artifacts/match-selection');
await mkdir(artifacts, { recursive: true });
const reps = new Map(), listeners = new Map();
function Replicant(name, options) {
  if (!reps.has(name)) {
    const rep = new EventEmitter(); let value = options?.defaultValue;
    Object.defineProperty(rep, 'value', { get: () => value, set: next => { value = next; rep.emit('change', next); } });
    reps.set(name, rep);
  }
  return reps.get(name);
}
Replicant('banPick').value = createInitialState();
Replicant('players').value = ['Alpha', 'Beta', 'Gamma', 'Delta'].map((name, i) => rowToProfile({
  name, startgg_tag: name, startgg_entrant_id: String(i + 1), geoguessr_player_uid: `65fc3453702bba73b4c0a39${i}`,
}));
Replicant('presenterDuel').value = { players: [{ id: 'venue-blue', teamColor: 'blue' }, { id: 'venue-red', teamColor: 'red' }] };
const bracket = normalizeEvent(null, [], null, 0);
for (const [i, name] of ['Alpha', 'Beta', 'Gamma', 'Delta'].entries()) bracket.entrants[i + 1] = { id: i + 1, name, tag: name, prefix: null, initialSeedNum: null };
for (const [i, ids] of [[1, 2], [3, 4], [1, null]].entries()) bracket.sets[7 + i] = {
  id: 7 + i, groupId: 1, phaseId: null, round: i + 1, roundText: `Match ${i + 1}`, state: 'ready',
  slots: ids.map((entrantId, slot) => ({ entrantId, score: i === 0 && slot === 0 ? 1 : 0 })),
};
Replicant('startggBracket').value = bracket;
registerMatch({ Replicant, listenFor: (name, handler) => listeners.set(name, handler) });
const state = name => reps.get(name).value;
const values = () => Object.fromEntries([...reps].map(([name, rep]) => [name, rep.value]));
const send = (name, data) => new Promise((resolve, reject) => listeners.get(name)(data, (error, value) => error ? reject(error) : resolve(value)));
const preload = () => `window.fixtureValues=${JSON.stringify(values())};
const handlers=new Map();window.emit=(name,value)=>{fixtureValues[name]=value;for(const cb of handlers.get(name)||[])cb(value);};
window.publish=async()=>{const values=await fetch('/snapshot').then(r=>r.json());for(const [name,value] of Object.entries(values))emit(name,value);};
window.nodecg={Replicant(name){return {get value(){return fixtureValues[name];},on(_event,cb){if(!handlers.has(name))handlers.set(name,[]);handlers.get(name).push(cb);queueMicrotask(()=>cb(fixtureValues[name]));}};},async sendMessage(name,data){const result=await fetch('/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,data})}).then(r=>r.json());for(const [key,value] of Object.entries(result.values))emit(key,value);if(result.error)throw result.error;return result.value;}};`;
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/snapshot') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(values())); return; }
    if (req.url === '/message') {
      let body=''; for await (const part of req) body+=part;
      const { name, data }=JSON.parse(body); let value,error;
      try { if (name === 'startgg:refresh') value = {}; else value=await send(name,data); }
      catch (cause) { error={message:cause.message}; }
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({value,error,values:values()})); return;
    }
    const name = req.url === '/' ? 'current-match.html' : req.url.slice(1);
    if (!['current-match.html','current-match.js','current-match.js.map'].includes(name)) { res.statusCode=404;res.end();return; }
    let content=await readFile(path.join(root,'bundles/rashinban/dashboard',name));
    if (name.endsWith('.html')) content=content.toString().replace('<head>','<head><script>'+preload()+'</script>');
    res.setHeader('Content-Type',name.endsWith('.html')?'text/html':'text/javascript');res.end(content);
  } catch(error) { res.statusCode=500;res.end(error.message); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const profile = await mkdtemp(path.join(os.tmpdir(), 'rb-party-browser-'));
const chromePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
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
async function screenshot(name) { const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); await writeFile(path.join(artifacts, name + '.png'), Buffer.from(shot.data, 'base64')); }

const choose = (id, value) => evaluate(`{const field=document.getElementById(${JSON.stringify(id)});field.value=${JSON.stringify(value)};field.dispatchEvent(new Event('change',{bubbles:true}));}`);
const label = (slot, value) => evaluate(`{const field=document.getElementById(${JSON.stringify(slot+'-label')});field.value=${JSON.stringify(value)};field.dispatchEvent(new Event('input',{bubbles:true}));}`);
const ready = () => until(`!document.querySelector('#refresh-startgg').disabled`);
const load = async (slot, id) => { await evaluate(`document.querySelector('button[data-load-slot="${slot}"][data-set-id="${id}"]').click()`); await until(`fixtureValues.${slot==='current'?'matchState':'nextMatchState'}.setId===${id}`); await ready(); };
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
  await command('Page.navigate', { url: origin }); await until(`fixtureValues.nextMatchState && !document.querySelector('#current-left').disabled`);

  assert.equal(await evaluate(`document.querySelectorAll('input:not([id$="-label"])').length`), 0, 'only match labels remain as text inputs');
  assert.equal(await evaluate(`document.querySelectorAll('select').length`), 4, 'both slots have two player selectors');
  assert.equal(await evaluate(`document.querySelector('#promote-next').disabled`), true);
  await choose('current-left','profile:0'); await choose('current-right','profile:1'); await label('current','Manual final');
  await click('current-apply'); await until(`fixtureValues.matchState.label==='Manual final'`); await ready();
  assert.equal(state('matchState').left.name,'Alpha');
  assert.equal(state('presenterSeries').left.playerId,'venue-red');
  assert.equal(state('presenterSeries').right.playerId,'venue-blue');
  const currentBefore=JSON.stringify(state('matchState'));
  await choose('next-left','profile:2'); await choose('next-right','profile:3'); await click('next-apply');
  await until(`fixtureValues.nextMatchState.left.name==='Gamma'`); await ready();
  assert.equal(JSON.stringify(state('matchState')),currentBefore);
  await load('next',8);
  assert.deepEqual(state('nextMatchState').gameMapping,{left:'red',right:'blue'});
  assert.equal(JSON.stringify(state('matchState')),currentBefore);
  await command('Page.reload'); await until(`document.querySelector('#next-left')?.value==='profile:2'`); await ready();
  assert.equal(await evaluate(`document.querySelector('#next-label').value`),'Match 2','next slot survives reload');
  await load('current',7);
  assert.equal(state('matchState').left.wins,1);
  assert.equal(state('nextMatchState').setId,8);
  await screenshot('current-and-next-desktop');
  assert.deepEqual(state('matchState').gameMapping,{left:'red',right:'blue'});
  await click('current-swap'); await until(`fixtureValues.matchState.left.name==='Beta'`); await ready();
  assert.equal(state('presenterSeries').left.playerId,'venue-red');
  assert.equal(state('presenterSeries').right.playerId,'venue-blue');
  await load('current',7);
  await click('next-swap'); await until(`fixtureValues.nextMatchState.left.name==='Delta'`); await ready();
  assert.deepEqual(state('nextMatchState').gameMapping,{left:'red',right:'blue'});
  await click('promote-next'); await until(`fixtureValues.matchState.setId===8 && fixtureValues.nextMatchState.left.name===''`); await ready();
  assert.equal(state('presenterSeries').left.name,'Delta');
  assert.equal(state('presenterSeries').left.playerId,'venue-red','team binding stays fixed through next swap and promotion');
  assert.equal(state('presenterSeries').right.playerId,'venue-blue');
  assert.equal(await evaluate(`document.querySelector('#promote-next').disabled`),true);
  await choose('next-left','profile:0'); await choose('next-right','profile:1'); await label('next','Prepared draft');
  await load('current',7);
  assert.equal(await evaluate(`document.querySelector('#next-label').value`),'Prepared draft','loading current preserves next draft');
  assert.equal(state('nextMatchState').left.name,'','unsaved next edits stay local');
  await click('next-reload');
  await label('current','Unsaved label');
  await send('match:apply',{...state('matchState'),left:{...state('matchState').left,wins:2}});
  await evaluate('publish()');
  await click('current-apply'); await until(`document.querySelector('#current-error').textContent.includes('changed elsewhere')`); await ready();
  assert.equal(state('matchState').left.wins,2,'a stale form never overwrites Party scores');
  assert.equal(await evaluate(`document.querySelector('#current-label').value`),'Unsaved label');
  await click('current-reload');
  await choose('current-right','profile:0'); await click('current-apply');
  await until(`document.querySelector('#current-error').textContent.includes('different players')`); await ready();
  assert.equal(state('matchState').right.name,'Beta');
  await click('current-reload');
  assert.equal(await evaluate(`document.querySelectorAll('button[data-set-id="9"]:disabled').length`),2,'unknown entrants cannot be loaded');
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await screenshot('current-and-next-mobile');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true,'mobile page fits');
  assert.deepEqual(errors,[]);
  console.log('Match selection browser flow passed: removed fields, both player selectors, independent start.gg targets, persisted staging, promotion, fixed team bindings through both swaps, preserved drafts, stale score protection, duplicate rejection, mobile.');
  console.log('Screenshots: '+artifacts);
} catch(error) {
  if(socket?.readyState===WebSocket.OPEN) {
    console.error(await evaluate(`JSON.stringify({currentError:document.querySelector('#current-error')?.textContent,nextError:document.querySelector('#next-error')?.textContent,current:fixtureValues.matchState,next:fixtureValues.nextMatchState})`));
    await screenshot('failure').catch(()=>{});
  }
  throw error;
} finally {
  if(socket?.readyState===WebSocket.OPEN){await command('Browser.close').catch(()=>{});socket.close();}
  chrome.kill();server.close();
}
