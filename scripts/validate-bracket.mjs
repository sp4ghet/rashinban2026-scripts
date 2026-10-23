// Real built bracket pages with disposable NodeCG fixtures and headless Chrome.
// No running NodeCG instance or tournament data is changed.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { build } from 'esbuild';
import { createMediaRouter } from '../bundles/rashinban/src/extension/config/assets.ts';
import { resolveInstallationRoots } from '../bundles/rashinban/src/extension/config/roots.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts/bracket-validation');
await mkdir(artifacts, { recursive: true });
await build({ entryPoints: [path.join(root, 'bundles/rashinban/src/graphics/layers/bracket.ts')],
  outfile: path.join(artifacts, 'layer.js'), bundle: true, format: 'iife', globalName: 'bracketFixture', platform: 'browser' });
const rows = Array.from({ length: 11 }, (_, i) => ({ match: i + 1, top: i < 10 ? 'TOZANGEZAN' : '', bottom: i < 10 ? 'TOZANGEZAN' : '', topScore: '0', bottomScore: '0', winner: 'top', active: false }));
const preload = `<script>
const callbacks=new Map();
window.emit=(name,value)=>{for(const callback of callbacks.get(name)||[])callback(value);};
window.nodecg={Replicant(name){return{on(event,callback){if(!callbacks.has(name))callbacks.set(name,[]);callbacks.get(name).push(callback);if(name==='bracketFinals')queueMicrotask(()=>callback({rows:${JSON.stringify(rows)}}));}};}};
</script>`;
const app = express();
app.use('/rashinban/media', createMediaRouter(resolveInstallationRoots(root)));
app.get('/bundles/rashinban/graphics/:page.html', async (req, res) => {
  const html = await readFile(path.join(root, 'bundles/rashinban/graphics', req.params.page + '.html'), 'utf8');
  res.type('html').send(html.replace('<head>', '<head>' + preload));
});
app.use(express.static(root));
const server = createServer(app);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const profile = await mkdtemp(path.join(os.tmpdir(), 'rb-bracket-browser-'));
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket, sequence = 0;
const pending = new Map(), errors = [], checks = [];
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 20000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function until(expression) {
  for (let i = 0; i < 200; i++) { if (await evaluate(expression)) return; await delay(50); }
  throw Error('Timed out: ' + expression);
}
async function screenshot(name) {
  await delay(200);
  const shot = await command('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(artifacts, name + '.png'), Buffer.from(shot.data, 'base64'));
}
const check = (label, value, expected = true) => { assert.deepEqual(value, expected, label); checks.push(label); };
try {
  let port;
  for (let i = 0; i < 100; i++) { try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await delay(100); } }
  if (!port) throw Error('Chrome did not start');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) { const call = pending.get(message.id); if (!call) return; pending.delete(message.id); message.error ? call.reject(Error(message.error.message)) : call.resolve(message.result); }
    else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  };
  await command('Runtime.enable'); await command('Page.enable'); await command('DOM.enable'); await command('CSS.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  for (const page of ['brackets-finals', 'bracket-en', 'bracket-led']) {
    await command('Page.navigate', { url: `${origin}/bundles/rashinban/graphics/${page}.html` });
    await until(`document.querySelector('#match1-top')?.textContent === 'TOZANGEZAN' && document.readyState === 'complete'`);
    await evaluate(`document.fonts.ready`);
    await evaluate(`document.fonts.load('700 24px "kaneda-gothic"', 'TOZANGEZAN')`);
    await until(`Array.from(document.fonts).some(f=>f.family.includes('kaneda-gothic') && f.weight==='700' && f.status==='loaded')`);
    // Freeze the real background at a repeatable frame. EN retains its alpha channel.
    if (page !== 'bracket-en') {
      await until(`document.querySelector('video')?.readyState >= 2`);
      await evaluate(`(()=>{const video=document.querySelector('video');video.pause();video.currentTime=0;})()`);
      await until(`!document.querySelector('video').seeking`);
    }
    await screenshot(page + '-before-reset');
    const doc = await command('DOM.getDocument');
    const node = await command('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#match1-top' });
    const fonts = await command('CSS.getPlatformFontsForNode', { nodeId: node.nodeId });
    console.log(page, JSON.stringify(fonts));
    check(page + ' uses actual Kaneda font', fonts.fonts.some(font => font.familyName.includes('Kaneda') && font.isCustomFont));
    const headingCenter = () => evaluate(`Number(document.querySelector('.bracket-champion').getAttribute('x'))`);
    const matchCenter = id => evaluate(`(()=>{const m=document.querySelector('#match${id}');const r=m.querySelector('.match--player-background').getBoundingClientRect();return r.x+r.width/2;})()`);
    check(page + ' champion starts above first Grand Final', await headingCenter(), await matchCenter(10));
    check(page + ' reset initially hidden', await evaluate(`getComputedStyle(document.querySelector('#match11')).display`), 'none');
    if (page !== 'bracket-led') {
      check(page + ' compact match geometry', await evaluate(`(()=>{const r=document.querySelector('#match1 .match--player-background').getBoundingClientRect();return [r.x,r.y,r.width,r.height];})()`), [640,182,199,31]);
      check(page + ' reference score size', await evaluate(`getComputedStyle(document.querySelector('.match--seed')).fontSize`), '28px');
    }
    const resetRows = structuredClone(rows);
    Object.assign(resetRows[10], { top: 'TOZANGEZAN', bottom: 'STEPHEN', active: true, winner: null });
    await evaluate(`emit('bracketFinals',{rows:${JSON.stringify(resetRows)}})`);
    check(page + ' reset becomes visible', await evaluate(`getComputedStyle(document.querySelector('#match11')).display !== 'none'`));
    check(page + ' champion moves to reset', await headingCenter(), await matchCenter(11));
    check(page + ' active match highlighted', await evaluate(`document.querySelector('#match11-border').classList.contains('active')`));
    await screenshot(page + '-reset');
    await evaluate(`emit('bracketFinals',{rows:${JSON.stringify(rows)}})`);
    check(page + ' champion returns when reset is cleared', await headingCenter(), await matchCenter(10));
    check(page + ' reset connector hidden again', await evaluate(`getComputedStyle(document.querySelector('#match11-bracket-line')).display`), 'none');
    const longRows = structuredClone(rows);
    longRows[0].top = 'A VERY LONG TOURNAMENT PLAYER NAME';
    longRows[0].bottom = 'とざんげざん';
    await evaluate(`emit('bracketFinals',{rows:${JSON.stringify(longRows)}}); document.fonts.ready`);
    await screenshot(page + '-long-names');
    check(page + ' names stay inside name plates', await evaluate(`Array.from(document.querySelectorAll('.match--player-name')).every(name=>{const bounds=name.getBoundingClientRect();const score=name.parentElement.querySelector('.match--seed-background').getBoundingClientRect();return bounds.width===0 || bounds.right<=score.left-3;})`));
    await evaluate(`new Promise(resolve=>{const script=document.createElement('script');script.src='/artifacts/bracket-validation/layer.js';script.onload=resolve;document.head.append(script);})`);
    await evaluate(`window.fixtureLayer=bracketFixture.mountBracket(document.querySelector('#layer-bracket'),${JSON.stringify(page === 'bracket-led' ? 'led' : 'stream')},false,{background:false})`);
    // Let the initial replicant callback run before updating the hidden view.
    await evaluate(`fixtureLayer.apply({visible:false});emit('bracketFinals',{rows:${JSON.stringify(longRows)}});fixtureLayer.apply({visible:true})`);
    check(page + ' hidden updates fit when revealed', await evaluate(`(()=>{const name=document.querySelector('#match1-top');const score=name.parentElement.querySelector('.match--seed-background');return name.getBoundingClientRect().right <= score.getBoundingClientRect().left-3;})()`));
  }
  check('No browser runtime errors', errors, []);
  await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify(checks, null, 2));
  console.log(`${checks.length} browser checks passed. Screenshots: ${artifacts}`);
} finally {
  socket?.close(); chrome.kill(); server.close();
}
