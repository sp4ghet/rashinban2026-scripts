// Built dashboard -> real extension handlers -> replicated state -> built graphics.
// Uses isolated NodeCG transport fixtures and a disposable headless browser.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { registerInterval } from '../bundles/rashinban/src/extension/interval.ts';
import { registerBroadcast } from '../bundles/rashinban/src/extension/broadcast.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adobeFonts = process.argv.includes('--adobe-fonts');
const artifacts = path.join(root, 'artifacts/interval', adobeFonts ? '' : 'offline');
await mkdir(artifacts, { recursive: true });
const values = {}, handlers = new Map();
const nodecg = {
  Replicant(name, options) {
    if (!(name in values) && options?.defaultValue !== undefined) values[name] = structuredClone(options.defaultValue);
    return { get value() { return values[name]; }, set value(value) { values[name] = value; } };
  },
  listenFor(name, callback) { handlers.set(name, callback); },
  log: { warn() {}, error: console.error },
};
registerInterval(nodecg);
registerBroadcast(nodecg, express.Router());
const message = (name, data) => new Promise((resolve, reject) => {
  const handler = handlers.get(name);
  if (!handler) throw Error('Unregistered message: ' + name);
  handler(data, (error, value) => error ? reject(error) : resolve(value));
});
const preload = () => `
const nativeNow=Date.now; Date.now=()=>nativeNow()+60000;
const nativeSetInterval=window.setInterval;
window.fixtureIntervals=[];
window.setInterval=(callback,ms,...args)=>{const id=nativeSetInterval(callback,ms,...args);window.fixtureIntervals.push({id,callback,ms});return id;};
const values=${JSON.stringify(values).replaceAll('<', '\\u003c')}, listeners=new Map();
window.fixtureValues=values;
function emit(name,value){values[name]=value;for(const cb of listeners.get(name)||[])cb(value);}
function sync(next){for(const [name,value] of Object.entries(next))if(JSON.stringify(value)!==JSON.stringify(values[name]))emit(name,value);}
window.nodecg={bundleConfig:{},Replicant(name){return{get value(){return values[name];},on(event,cb){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(cb);if(name in values)queueMicrotask(()=>cb(values[name]));}};},
async sendMessage(name,data){const response=await fetch('/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,data})});const result=await response.json();if(!response.ok)throw result;sync(await fetch('/state').then(r=>r.json()));return result;}};
setInterval(()=>fetch('/state').then(r=>r.json()).then(sync),100);
`;
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/state') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(values)); return; }
    if (req.url === '/message') {
      let body = ''; for await (const chunk of req) body += chunk;
      const { name, data } = JSON.parse(body);
      const value = await message(name, data);
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); return;
    }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/favicon.ico') { res.statusCode = 204; res.end(); return; }
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(path.join(root, 'bundles', 'rashinban') + path.sep)) throw Error('Invalid fixture path');
    let data = await readFile(file);
    const ext = path.extname(file);
    if (ext === '.html') {
      data = data.toString();
      if (!adobeFonts) data = data.replace(/<link[^>]+https:\/\/(?:use\.typekit\.net|fonts\.googleapis\.com)[^>]+>/g, '');
      data = data.replace('<head>', '<head><script>' + preload() + '</script>');
    }
    res.setHeader('Content-Type', { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
      '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.woff2': 'font/woff2' }[ext] || 'application/octet-stream');
    res.end(data);
  } catch (error) { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ message: error.message })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const profile = await mkdtemp(path.join(os.tmpdir(), 'rb-interval-browser-'));
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket, sequence = 0;
const pending = new Map(), errors = [];
async function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
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
  for (let attempt = 0; attempt < 120; attempt++) { if (await evaluate(expression)) return; await delay(50); }
  throw Error('Timed out: ' + expression);
}
async function navigate(file, width = 1920, height = 1080) {
  await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: origin + '/bundles/rashinban/' + file });
  await until('document.readyState === "complete"');
  await evaluate('document.fonts.ready');
}
async function click(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); }
async function fill(selector, value) {
  await evaluate(`{const input=document.querySelector(${JSON.stringify(selector)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));}`);
}
async function screenshot(name, clip) {
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  // Let Chrome finish rasterizing loaded fonts/SVGs after revealing the layer.
  await delay(300);
  const shot = await command('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  await writeFile(path.join(artifacts, name + '.png'), Buffer.from(shot.data, 'base64'));
}
try {
  let port;
  for (let i = 0; i < 100; i++) { try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await delay(100); } }
  if (!port) throw Error('Headless Chrome did not start');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const result = JSON.parse(event.data);
    if (result.id) {
      const call = pending.get(result.id); if (!call) return;
      pending.delete(result.id); result.error ? call.reject(Error(result.error.message)) : call.resolve(result.result);
    } else if (result.method === 'Runtime.exceptionThrown') errors.push(result.params.exceptionDetails);
  };
  await command('Runtime.enable'); await command('Page.enable');
  await navigate('graphics/interval-stream.html');
  assert.equal(await evaluate('document.querySelector("#layer-interval").hidden'), true);
  await navigate('dashboard/interval-control.html', 650, 650);
  await until('!document.querySelector("#content-controls").disabled');
  assert.equal(await evaluate('document.querySelector("#countdown-label, [aria-label*=Round]")'), null, 'removed labels have no dashboard controls');
  await fill('[aria-label="Match 1 Player 1"]', 'SHIINA');
  await fill('[aria-label="Match 1 Player 2"]', 'EURYA');
  await click('#apply');
  await until('document.querySelector("#draft-status").textContent === "Saved content"');
  assert.equal(values.interval.content.matches[0].playerOne, 'SHIINA');
  await fill('#duration', '46.1'); await click('#start');
  await until('document.querySelector("#timer-status").textContent === "Running"');
  assert.equal(await evaluate('document.querySelector("#countdown").textContent.startsWith("46:")'), true, 'client clock skew must not shorten countdown');
  await click('#pause'); await until('document.querySelector("#timer-status").textContent === "Paused"');
  const paused = values.interval.timer.remainingMs;
  assert.ok(paused > 2760000 && paused <= 2766000);
  await fill('#title', 'UNSAVED DRAFT');
  await click('#pause'); await until('document.querySelector("#timer-status").textContent === "Running"');
  assert.equal(await evaluate('document.querySelector("#title").value'), 'UNSAVED DRAFT', 'timer updates retain content draft');
  await click('#reload');
  assert.equal(await evaluate('document.querySelector("#title").value'), 'INTERVAL');
  await click('#pause'); await until('document.querySelector("#timer-status").textContent === "Paused"');
  await screenshot('dashboard');
  await navigate('dashboard/interval-control.html', 650, 650);
  await until('document.querySelector("#timer-status").textContent === "Paused"');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Match 1 Player 1"]').value`), 'SHIINA');
  await click('#clear'); await until('document.querySelector("#timer-status").textContent === "Hidden"');
  await fill('#restart-at', '2020-01-01T12:00'); await click('#schedule');
  await until('document.querySelector("#error").textContent.includes("future")');
  const jst = new Date(Date.now() + 9 * 3600000 + 3600000).toISOString().slice(0, 16);
  await fill('#restart-at', jst); await click('#schedule');
  await until('document.querySelector("#timer-status").textContent === "Running"');
  assert.equal(values.interval.timer.endsAtMs, Date.parse(jst + ':00+09:00'));
  await fill('#duration', '46.1'); await click('#start'); await until('document.querySelector("#countdown").textContent.startsWith("46:")');
  await click('#pause'); await until('document.querySelector("#timer-status").textContent === "Paused"');

  for (const output of ['stream', 'led']) {
    if (output === 'stream') {
      await navigate('dashboard/switcher-stream.html', 1440, 1000);
      await until('document.querySelector("[data-row=interval] button") !== null');
      await click('[data-row="interval"] button');
      await until('document.querySelector(".monitor[data-channel=preview] iframe.info").contentDocument?.querySelector("#layer-interval")?.hidden === false');
      assert.equal(values.broadcast[output].program.interval.visible, false);
      await click('#revert');
      await until('document.querySelector(".monitor[data-channel=preview] iframe.info").contentDocument?.querySelector("#layer-interval")?.hidden === true');
      await click('[data-row="interval"] button');
      await until('!document.querySelector("#take").disabled');
      await click('#take');
      await until('document.querySelector(".monitor[data-channel=program] iframe.info").contentDocument?.querySelector("#layer-interval")?.hidden === false');
      assert.equal(values.broadcast[output].program.interval.visible, true);
    }
    await navigate(`graphics/interval-${output}.html${output === 'led' ? '?channel=preview' : ''}`);
    await until('document.querySelector("#layer-interval")?.hidden === false');
    if (output === 'led') {
      await message('broadcast:setPreview', { output: 'stream', patch: { interval: { visible: false } } });
      await message('broadcast:take', { output: 'stream' });
      await until('fixtureValues.broadcast.stream.program.interval.visible === false');
      assert.equal(await evaluate('document.querySelector("#layer-interval").hidden'), false, 'LED is always on regardless of Stream visibility or a legacy preview URL');
      await message('broadcast:setPreview', { output: 'stream', patch: { interval: { visible: true } } });
      await message('broadcast:take', { output: 'stream' });
    }
    if (adobeFonts) console.log(`${output}: Adobe heading font loaded: ${await evaluate('document.fonts.check(\'700 112px "kaneda-gothic"\')')}`);
    assert.equal(await evaluate('document.querySelector(".interval-match-players").textContent'), 'SHIINA VS EURYA');
    assert.equal(await evaluate('[...document.querySelectorAll("#layer-interval img")].every(img => img.complete && img.naturalWidth > 0)'), true);
    await screenshot(output);
    if (output === 'led') await screenshot('led-band', { x: 0, y: 0, width: 1920, height: 576, scale: 1 });
    // Sample actual painted opacity through a complete 12-second sponsor cycle.
    // This catches the old abrupt hidden/display swap even when all logos load.
    const fade = await evaluate(`new Promise(resolve => {
      const started = performance.now(), samples = [];
      function sample() {
        samples.push({ time: performance.now() - started, logos: [...document.querySelectorAll('.interval-sponsors img')].map(img => ({
          name: img.alt, opacity: img.checkVisibility() ? Number(getComputedStyle(img).opacity) : 0,
        })) });
        if (performance.now() - started < 13000) requestAnimationFrame(sample); else resolve(samples);
      }
      sample();
    })`);
    assert.ok(fade.some(sample => sample.logos.some(logo => logo.opacity > .05 && logo.opacity < .95)), `${output}: sponsors must visibly fade, not cut`);
    const outgoing = fade.map(sample => sample.logos.find(logo => logo.name === 'GeoGuessr')?.opacity);
    const incoming = fade.map(sample => sample.logos.find(logo => logo.name === '味の素株式会社')?.opacity);
    assert.ok(outgoing.some(opacity => opacity > .05 && opacity < .95), `${output}: outgoing logo must fade out`);
    assert.ok(incoming.some(opacity => opacity > .05 && opacity < .95), `${output}: incoming logo must fade in`);
    assert.ok(fade.every(sample => sample.logos.find(logo => logo.name === 'TAMURA BUILDS')?.opacity === 1), 'fixed sponsor stays visible');
    const rotation = await evaluate(`new Promise(async resolve => {
      const timer = fixtureIntervals.find(timer => timer.ms === 12000);
      clearInterval(timer.id);
      const img = document.querySelector('.interval-sponsor-rotating img');
      const changes = [], visible = [];
      const observer = new MutationObserver(() => changes.push({name: img.alt, opacity: Number(getComputedStyle(img).opacity)}));
      observer.observe(img, {attributes: true, attributeFilter: ['src']});
      for (let i = 0; i < 6; i++) {
        timer.callback();
        await new Promise(done => setTimeout(done, 1000));
        const box = img.getBoundingClientRect(), parent = img.parentElement.getBoundingClientRect();
        visible.push({name: img.alt, loaded: img.complete && img.naturalWidth > 0, opacity: Number(getComputedStyle(img).opacity), fits: box.left >= parent.left - 1 && box.right <= parent.right + 1});
      }
      observer.disconnect(); resolve({changes, visible});
    })`);
    assert.deepEqual(rotation.visible.map(logo => logo.name), ['GeoGuessr Record', '調布駅前そけいヘルニアクリニック', 'BFCC — Powered by バラジオ放送局', 'かわいいしっしー', 'GeoGuessr', '味の素株式会社']);
    assert.ok(rotation.changes.every(logo => logo.opacity < .01), `${output}: swap logo only while invisible`);
    assert.ok(rotation.visible.every(logo => logo.loaded && logo.fits && logo.opacity === 1), `${output}: each sponsor loads, fits and fades fully in`);
    await writeFile(path.join(artifacts, output + '-sponsor-fade.json'), JSON.stringify({samples: fade, rotation}, null, 2));
  }

  // Simulate an older dashboard sending removed fields; neither may reappear.
  const longMatches = Array.from({ length: 4 }, (_, index) => ({ label: '準決勝', playerOne: index ? '長いプレイヤー名テスト' : '<img src=x onerror=alert(1)>', playerTwo: 'VeryLongCompetitorName' }));
  await message('interval:content', { ...values.interval.content, title: 'RASHINBAN 2026 GRAND FINALS INTERVAL', countdownLabel: '再開まで', matches: longMatches });
  await message('interval:timer', { action: 'start', durationSeconds: 86399 });
  for (const output of ['stream', 'led']) {
    await navigate(`graphics/interval-${output}.html`);
    await until('document.querySelectorAll(".interval-match").length === 4');
    await until('document.querySelector(".interval-timer").hidden === false');
    assert.equal(await evaluate('document.querySelector(".interval-countdown-label, .interval-match-label")'), null, 'removed labels have no graphic elements');
    assert.equal(await evaluate('/再開まで|準決勝/.test(document.querySelector("#layer-interval").textContent)'), false, 'legacy label text must not appear');
    assert.equal(await evaluate('document.querySelector(".interval-countdown span").textContent.startsWith("23:59:")'), true, 'graphics must ignore the one-minute client clock skew');
    assert.equal(await evaluate('document.querySelectorAll(".interval-match img").length'), 0, 'names render as text');
    for (const count of [3, 4]) {
      await message('interval:content', { ...values.interval.content, matches: longMatches.slice(0, count) });
      await until(`document.querySelectorAll('.interval-match').length === ${count}`);
      const height = output === 'led' ? 560 : 1035;
      const bottom = await evaluate('document.querySelector(".interval-matches").getBoundingClientRect().bottom');
      assert.ok(bottom <= height, `${output} match list bottom ${bottom} exceeds ${height}`);
      if (output === 'stream') {
        const timerTop = await evaluate('document.querySelector(".interval-timer").getBoundingClientRect().top');
        assert.ok(bottom + 12 <= timerTop + .01, `Stream matches end at ${bottom}, overlapping countdown at ${timerTop}`);
      }
    }
    const fits = await evaluate(`[...document.querySelectorAll('#layer-interval [data-fit]')].every(span => {
      const box=span.getBoundingClientRect(), parent=span.parentElement.getBoundingClientRect();
      return box.left >= parent.left - 1 && box.right <= parent.right + 1;
    })`);
    assert.equal(fits, true, `${output} long text must fit its column`);
    await screenshot(output + '-four-matches');
    await message('interval:content', { ...values.interval.content, matches: [] });
    await until('document.querySelector(".interval-upcoming").hidden');
    await message('interval:content', { ...values.interval.content, matches: longMatches });
  }
  await message('interval:timer', { action: 'clear' });
  await until('document.querySelector(".interval-timer").hidden');
  await message('interval:timer', { action: 'start', durationSeconds: .1 });
  await until('document.querySelector(".interval-countdown span").textContent === "00:00"');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log('Interval browser validation passed: dashboard saves, timer controls/JST, persistence, preview/revert/TAKE, both layouts, all logos, four matches, empty states, expiry, text safety.');
  console.log('Screenshots: ' + artifacts);
} finally {
  socket?.close(); chrome.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
