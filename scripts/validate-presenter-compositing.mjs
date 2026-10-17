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
const artifacts = path.join(root, 'artifacts/presenter-validation/compositing');
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
  await command('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  async function pixels(points) {
    const shot = await command('Page.captureScreenshot', { format: 'png' });
    return evaluate(`(async()=>{const image=new Image();image.src='data:image/png;base64,${shot.data}';await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return ${JSON.stringify(points)}.map(([x,y])=>[...ctx.getImageData(x,y,1,1).data]);})()`);
  }
  const transparent = rgba => assert.equal(rgba[3], 0, `Expected an alpha hole, got ${rgba}`);
  const opaque = rgba => assert.equal(rgba[3], 255, `Expected opaque artwork, got ${rgba}`);
  for (const output of ['stream', 'led']) {
    const led = output === 'led';
    await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/presenter${led ? '-led' : ''}.html?role=preview` });
    for (let i=0;i<100;i++) { if(await evaluate(`document.getElementById('timer-value')?.textContent==='39'`))break;await delay(100); }
    await evaluate(`qa.live('NM','chroma','none');qa.set('presenterSettings',{...qa.initial.presenterSettings,viewSource:'chroma',keyColor:'transparent'})`);
    await settle();
    const livePixels = await pixels([[100,300],[1800,300],[960,180],[300,800],[1600,800]]);
    transparent(livePixels[0]); transparent(livePixels[1]); opaque(livePixels[2]);
    if(!led){transparent(livePixels[3]);transparent(livePixels[4]);}
    await screenshot(output+'-transparent-live',led);
    checks.push(output+': gameplay holes have zero alpha while the backdrop stays opaque');

    await evaluate(`qa.live('NM','chroma','left');qa.set('presenterSettings',{...qa.initial.presenterSettings,viewSource:'chroma',keyColor:'transparent'})`);
    await settle();
    const label=await evaluate(`qa.rect('left-lock')`);
    const labelPoints=[];
    for(let y=Math.ceil(label.y);y<label.y+label.height;y+=2)
      for(let x=Math.ceil(label.x);x<label.x+label.width;x+=2) labelPoints.push([x,y]);
    const labelAlpha=(await pixels(labelPoints)).map(rgba=>rgba[3]);
    assert.equal(Math.max(...labelAlpha),255,'Lock text should render at full opacity');
    assert.equal(Math.min(...labelAlpha),102,'Lock text should have only the full-window overlay behind it');
    const lockedPixels=await pixels([[100,300],[1800,300]]);
    assert.deepEqual(lockedPixels[0],[0,0,0,102],'Locked window should have a 40% black overlay');
    transparent(lockedPixels[1]);
    await screenshot(output+'-transparent-lock',led);
    checks.push(output+': full-opacity lock text over a 40% window overlay; unlocked feed stays transparent');

    await evaluate(`qa.live('NM','chroma','none');qa.set('presenterSettings',{...qa.initial.presenterSettings,viewSource:'chroma',keyColor:'transparent'});const next=structuredClone(qa.initial.presenterDuel);next.rounds[0].startAtMs=qa.now+60000;qa.set('presenterDuel',next);qa.set('presenterTimeline',{...qa.initial.presenterTimeline,phase:'pre-round'});`);
    await settle();
    assert.equal(await evaluate(`document.getElementById('preview-area').hidden`),false);
    const preview=await pixels([[960,300],[100,300],[300,800],[1600,800]]);
    opaque(preview[0]);opaque(preview[1]);
    if(!led){transparent(preview[2]);transparent(preview[3]);}
    assert.notDeepEqual(preview[0].slice(0,3),[255,0,255]);
    if(led) assert.equal(await evaluate(`getComputedStyle(document.getElementById('preview-map')).display`),'none');
    await screenshot(output+'-transparent-preview',led);
    checks.push(output+': preview is opaque and camera holes cut through overlapping preview artwork');

    const result=structuredClone(state);
    result.players.forEach((p,i)=>{p.results=[{round:result.round,score:i?3200:4500,bestGuess:null,healthBefore:6000,healthAfter:i?4700:6000,damageDealt:i?0:1300,multiplier:1}];});
    const timing=advanceTimeline(null,result,epoch,false,DEFAULT_TIMING);
    await evaluate(`qa.set('presenterDuel',${JSON.stringify(result)});qa.set('presenterTimeline',${JSON.stringify(timing)});qa.now=${timing.revealAtMs+8000};`);
    await settle();
    assert.equal(await evaluate(`document.getElementById('results-area').hidden`),false);
    const results=await pixels([[960,500],[300,800],[1600,800],[100,300]]);
    opaque(results[0]);opaque(results[3]);
    if(!led){transparent(results[1]);transparent(results[2]);}
    checks.push(output+': results close gameplay holes and preserve camera alpha over the map');

    if(!led){
      await evaluate(`document.querySelectorAll('.camera').forEach(el=>{el.classList.remove('key-slot');el.classList.add('relay-camera')});`);
      await settle();
      const cameras=await pixels([[300,800],[1600,800]]);cameras.forEach(opaque);
      checks.push('stream: relayed camera regions remain opaque');
    }
    await evaluate(`qa.live('NM','chroma','none');qa.set('presenterSettings',{...qa.initial.presenterSettings,viewSource:'chroma',keyColor:'#00ff00'})`);
    await settle();
    const keyed=await pixels([[100,300],[1800,300]]);
    keyed.forEach(rgba=>assert.deepEqual(rgba,[0,255,0,255]));
    checks.push(output+': switching back to green restores opaque key windows');
  }
  assert.deepEqual(errors, [], 'uncaught browser errors');
  await writeFile(path.join(artifacts,'report.json'),JSON.stringify({checks,errors},null,2));
  console.log(JSON.stringify({checks:checks.length,errors:errors.length,artifacts},null,2));
} finally {
  socket?.close(); chrome.kill(); await new Promise(resolve=>server.close(resolve));
}
