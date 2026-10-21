// Built dashboard -> real extension handlers -> replicated state -> built graphics.
// Uses isolated NodeCG transport fixtures and a disposable headless browser.
import assert from 'node:assert/strict';
import { validateSponsorRotation } from './lib/validate-sponsor-rotation.mjs';
import { EventEmitter } from 'node:events';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { createMediaRouter } from '../bundles/rashinban/src/extension/config/assets.ts';
import { registerMatch } from '../bundles/rashinban/src/extension/match.ts';
import { emptyMatch } from '../bundles/rashinban/src/match/state.ts';
import { rowToProfile } from '../bundles/rashinban/src/sheet/players.ts';
import { registerInterval } from '../bundles/rashinban/src/extension/interval.ts';
import { registerBroadcast } from '../bundles/rashinban/src/extension/broadcast.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adobeFonts = process.argv.includes('--adobe-fonts');
const artifacts = path.join(root, 'artifacts/interval', adobeFonts ? '' : 'offline');
await mkdir(artifacts, { recursive: true });
const values = {}, handlers = new Map(), reps = new Map();
const nodecg = {
  Replicant(name, options) {
    if (!reps.has(name)) {
      if (options?.defaultValue !== undefined) values[name] = structuredClone(options.defaultValue);
      const rep = new EventEmitter();
      Object.defineProperty(rep, 'value', { get: () => values[name], set: value => { values[name] = value; rep.emit('change', value); } });
      reps.set(name, rep);
    }
    return reps.get(name);
  },
  listenFor(name, callback) { handlers.set(name, callback); },
  log: { warn() {}, error: console.error },
};
registerMatch(nodecg);
registerInterval(nodecg);
registerBroadcast(nodecg, express.Router());
// Bundle the legacy extension's extensionless imports for Node's TS fixture runner.
const bracketModule = path.join(artifacts, 'bracket-extension.mjs');
await build({entryPoints: [path.join(root, 'bundles/rashinban/src/extension/bracket.ts')], outfile: bracketModule,
  bundle: true, platform: 'node', format: 'esm', packages: 'external'});
const { registerBracket } = await import(pathToFileURL(bracketModule).href);
const nativeInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => nativeInterval(...args).unref();
try { registerBracket(nodecg, express.Router()); } finally { globalThis.setInterval = nativeInterval; }
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
const media = express();
media.use('/rashinban/media', createMediaRouter({appRoot: root, sharedRoot: root, isWorktree: false}));
const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/rashinban/media/')) { media(req, res); return; }
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
async function chooseSource(value) {
  await fill('#match-source', value);
  await evaluate('document.querySelector("#match-source").dispatchEvent(new Event("change", { bubbles: true }))');
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
  const range = await fetch(origin + '/rashinban/media/background/kv.mp4', {headers: {range: 'bytes=0-31'}});
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 32);
  // Operate both scenes and their real controls without leaving the switcher.
  await navigate('dashboard/switcher-stream.html', 1440, 1100);
  await until('document.querySelector("[data-row=bracket] button") !== null');
  const monitor = channel => `document.querySelector('.monitor[data-channel=${channel}] iframe.info').contentDocument`;
  const sceneVideo = (channel, scene) => `${monitor(channel)}?.querySelector('#layer-${scene} video')`;
  assert.equal(await evaluate('document.querySelector("#strip details, #strip iframe")'), null, 'scene dropdown panels are removed');
  await until('document.querySelector("#interval-timer-controls")?.disabled === false');
  const initialBus = structuredClone(values.broadcast);
  await fill('#interval-minutes', '12.5');
  await click('#interval-start');
  await until('document.querySelector("#interval-timer-status").textContent === "Running"');
  assert.equal(await evaluate('document.querySelector("#interval-countdown").textContent'), '12:30', 'server clock corrects the fixture client clock skew');
  await click('#interval-pause');
  await until('document.querySelector("#interval-pause").textContent === "Resume"');
  const inlinePaused = values.interval.timer.remainingMs;
  assert.ok(inlinePaused > 740000 && inlinePaused <= 750000);
  await fill('#interval-minutes', '9');
  await click('#interval-pause');
  await until('document.querySelector("#interval-timer-status").textContent === "Running"');
  assert.ok(values.interval.timer.endsAtMs - Date.now() > 740000, 'Resume keeps the original remaining time');
  assert.equal(await evaluate('document.querySelector("#interval-minutes").value'), '9', 'timer updates preserve the next duration draft');
  await click('#interval-clear');
  await until('document.querySelector("#interval-timer-status").textContent === "Hidden"');
  assert.equal(await evaluate('document.querySelector("#interval-pause").disabled && document.querySelector("#interval-clear").disabled'), true);
  assert.deepEqual(values.broadcast, initialBus, 'live timer controls do not alter Preview or Program visibility');
  await fill('#interval-minutes', '0');
  await click('#interval-start');
  await until('document.querySelector("#error").textContent.length > 0');
  assert.equal(values.interval.timer.endsAtMs, null, 'invalid durations cannot start the timer');
  await fill('#interval-minutes', '10');
  await click('#interval-start');
  await until('document.querySelector("#interval-timer-status").textContent === "Running"');
  assert.equal(await evaluate('document.querySelector("#error").textContent'), '');
  await message('bracket:setConfig', {source: 'sample'});
  await until('fixtureValues.bracketFinals?.rows.length > 0 && !fixtureValues.bracketFinals.error');
  await click('[data-row=interval] button');
  await until(`${sceneVideo('preview', 'interval')}?.currentTime > .1`);
  assert.equal(await evaluate(`${sceneVideo('program', 'interval')}.paused`), true);
  await click('#take');
  await until(`${sceneVideo('program', 'interval')}?.currentTime > .1`);
  await click('[data-row=bracket] button');
  await until(`${sceneVideo('preview', 'bracket')}?.currentTime > .1 && ${sceneVideo('preview', 'interval')}.paused`);
  assert.equal(values.broadcast.stream.preview.interval.visible, false);
  assert.equal(values.broadcast.stream.program.interval.visible, true);
  assert.equal(await evaluate(`${sceneVideo('program', 'bracket')}.paused`), true);
  await screenshot('switcher-bracket-preview');
  await click('#revert');
  await until(`${sceneVideo('preview', 'bracket')}.paused && !${sceneVideo('preview', 'interval')}.paused`);
  await click('[data-row=bracket] button');
  await until('fixtureValues.broadcast.stream.preview.bracket.visible && !document.querySelector("#take").disabled');
  await click('#take');
  await until(`${sceneVideo('program', 'bracket')}?.currentTime > .1 && ${sceneVideo('program', 'interval')}.paused`);
  const playback = await evaluate(`{const v=${sceneVideo('program', 'bracket')}; ({muted:v.muted,loop:v.loop,inline:v.playsInline,width:v.videoWidth,height:v.videoHeight})}`);
  assert.deepEqual(playback, {muted: true, loop: true, inline: true, width: 1920, height: 1080});
  await evaluate(`{const v=${sceneVideo('program', 'bracket')}; v.currentTime = 19.8;}`);
  await delay(800);
  await until(`${sceneVideo('program', 'bracket')}.currentTime < 2 && !${sceneVideo('program', 'bracket')}.paused`);
  for (const [file, height] of [['brackets-finals.html', 1080], ['bracket-led.html', 576]]) {
    await navigate('graphics/' + file);
    await until('document.querySelector("video")?.currentTime > .1');
    assert.equal(await evaluate('document.querySelector("video").getBoundingClientRect().height'), height);
    await screenshot(file.replace('.html', '-video'));
  }
  await message('broadcast:setPreview', {output: 'stream', patch: {interval: {visible: false}, bracket: {visible: false}}});
  await message('broadcast:take', {output: 'stream'});
  await message('interval:timer', {action: 'clear'});
  for (const query of ['', '?channel=preview']) {
    await navigate('graphics/interval-stream.html' + query);
    assert.equal(await evaluate('document.querySelector("#layer-interval").hidden'), false, 'standalone Stream is visible with the switcher off, including preview URLs');
    await until('document.querySelector("video")?.currentTime > .1');
  }
  await navigate('graphics/info-stream.html');
  assert.equal(await evaluate('document.querySelector("#layer-interval").hidden'), true, 'info-stream still follows the Stream switcher');
  await navigate('dashboard/interval-control.html', 650, 650);
  await until('!document.querySelector("#content-controls").disabled');
  assert.equal(await evaluate('document.querySelector("#countdown-label, [aria-label*=Round]")'), null, 'removed labels have no dashboard controls');
  await chooseSource('manual');
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
  assert.equal(await evaluate('document.querySelector("#restart-at").type'), 'time');
  assert.match(await evaluate('document.querySelector("#restart-at").value'), /^\d{2}:\d{2}$/);
  await fill('#restart-at', ''); await click('#schedule');
  await until('document.querySelector("#error").textContent.includes("Choose a restart time")');
  const jst = new Date(Date.now() + 9 * 3600000 + 3600000).toISOString().slice(0, 16);
  await fill('#restart-at', jst.slice(11)); await click('#schedule');
  await until('document.querySelector("#timer-status").textContent === "Running"');
  assert.equal(values.interval.timer.endsAtMs, Date.parse(jst + ':00+09:00'));
  assert.equal(await evaluate('document.querySelector("#error").textContent'), '');
  const tomorrowJst = new Date(Date.now() + 9 * 3600000 + 23 * 3600000).toISOString().slice(0, 16);
  await fill('#restart-at', tomorrowJst.slice(11)); await click('#schedule');
  await until(`fixtureValues.interval.timer.endsAtMs === ${Date.parse(tomorrowJst + ':00+09:00')}`);
  assert.equal(values.interval.timer.endsAtMs, Date.parse(tomorrowJst + ':00+09:00'), 'a past time schedules its next JST occurrence');
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
    await until('document.querySelector("video")?.currentTime > .1');
    assert.equal(await evaluate('document.querySelector("video").getBoundingClientRect().height'), output === 'led' ? 576 : 1080);
    await message('broadcast:setPreview', { output: 'stream', patch: { interval: { visible: false } } });
    await message('broadcast:take', { output: 'stream' });
    await until('fixtureValues.broadcast.stream.program.interval.visible === false');
    assert.equal(await evaluate('document.querySelector("#layer-interval").hidden'), false, `${output} standalone stays visible when the Stream switcher is turned off`);
    assert.equal(await evaluate('document.querySelector("video").paused'), false, `${output} standalone video keeps playing with the switcher off`);
    await message('broadcast:setPreview', { output: 'stream', patch: { interval: { visible: true } } });
    await message('broadcast:take', { output: 'stream' });
    if (adobeFonts) console.log(`${output}: Adobe heading font loaded: ${await evaluate('document.fonts.check(\'700 112px "kaneda-gothic"\')')}`);
    assert.equal(await evaluate('document.querySelector(".interval-match-players").textContent'), 'SHIINA VS EURYA');
    assert.equal(await evaluate('[...document.querySelectorAll("#layer-interval img")].every(img => img.complete && img.naturalWidth > 0)'), true);
    await screenshot(output);
    if (output === 'led') {
      await screenshot('led-band', { x: 0, y: 0, width: 1920, height: 576, scale: 1 });
      assert.equal(await evaluate(`['.interval-topbar', '.interval-bottombar', '.interval-icon', '.interval-title'].every(selector => !document.querySelector(selector).checkVisibility())`), true, 'LED uses the unframed reference layout');
    }
    const rotation = await validateSponsorRotation(evaluate, screenshot, output);
    await writeFile(path.join(artifacts, output + '-sponsor-fade.json'), JSON.stringify(rotation, null, 2));
  }

  // Link Interval to the real saved Next Match and keep the manual list for later.
  nodecg.Replicant('players').value = ['Alpha', 'Beta'].map((name, i) => rowToProfile({
    name: name + ' Display', startgg_tag: name, geoguessr_player_uid: `65fc3453702bba73b4c0a39${i}`,
  }));
  const staged = emptyMatch();
  staged.left.tag = 'Alpha'; staged.right.tag = 'Beta';
  await message('match:next:apply', staged);
  const savedTimer = structuredClone(values.interval.timer);
  await navigate('dashboard/interval-control.html', 650, 700);
  await until('!document.querySelector("#content-controls").disabled');
  await chooseSource('next');
  assert.equal(await evaluate('document.querySelector("#next-match-preview").textContent'), 'Alpha Display vs Beta Display');
  assert.equal(values.interval.content.matchSource, 'manual', 'source changes are drafts until applied');
  await click('#apply');
  await until('document.querySelector("#draft-status").textContent === "Saved content"');
  assert.equal(values.interval.content.matchSource, 'next');
  assert.deepEqual(values.interval.content.matches, [{ playerOne: 'SHIINA', playerTwo: 'EURYA' }]);
  assert.deepEqual(values.interval.timer, savedTimer);
  await fill('#title', 'KEEP THIS DRAFT');
  await message('match:next:swap', { revision: values.nextMatchState.revision });
  await until('document.querySelector("#next-match-preview").textContent === "Beta Display vs Alpha Display"');
  assert.equal(await evaluate('document.querySelector("#title").value'), 'KEEP THIS DRAFT');
  await click('#reload');
  await screenshot('dashboard-next-match');
  await navigate('dashboard/interval-control.html', 350, 750);
  await until('document.querySelector("#match-source").value === "next" && !document.querySelector("#content-controls").disabled');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'narrow panel must fit');
  await screenshot('dashboard-next-match-narrow');
  for (const output of ['stream', 'led']) {
    await navigate(`graphics/interval-${output}.html`);
    await until('document.querySelector(".interval-match-players")?.textContent === "Beta Display VS Alpha Display"');
    const current = emptyMatch(); current.revision = values.matchState.revision;
    current.left.name = 'Current A'; current.right.name = 'Current B';
    await message('match:apply', current);
    await until('fixtureValues.matchState.left.name === "Current A"');
    assert.equal(await evaluate('document.querySelector(".interval-match-players").textContent'), 'Beta Display VS Alpha Display', 'current match edits must not affect Interval');
    nodecg.Replicant('players').value = values.players.map(profile => ({ ...profile, name: profile.name.replace('Alpha Display', 'Alpha Updated') }));
    await until('document.querySelector(".interval-match-players")?.textContent === "Beta Display VS Alpha Updated"');
    await screenshot(output + '-next-match');
    const next = structuredClone(values.nextMatchState);
    await message('match:next:promote', { revision: values.matchState.revision, nextRevision: next.revision });
    await until('document.querySelector(".interval-upcoming").hidden');
    assert.deepEqual(values.interval.timer, savedTimer, 'promotion must not change countdown');
    await message('match:next:apply', { ...next, revision: values.nextMatchState.revision });
    await until('document.querySelector(".interval-match-players")?.textContent === "Beta Display VS Alpha Updated"');
    nodecg.Replicant('players').value = values.players.map(profile => ({ ...profile, name: profile.name.replace('Alpha Updated', 'Alpha Display') }));
    await until('document.querySelector(".interval-match-players")?.textContent === "Beta Display VS Alpha Display"');
  }
  await navigate('dashboard/interval-control.html', 650, 650);
  await until('!document.querySelector("#content-controls").disabled');
  await chooseSource('manual');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Match 1 Player 1"]').value`), 'SHIINA');
  await click('#apply');
  await until('document.querySelector("#draft-status").textContent === "Saved content"');
  assert.equal(values.interval.content.matchSource, 'manual');

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
      if (!span.checkVisibility()) return true;
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
  // Recreate the designer's reference with fixture state only; production retains
  // its live match/timer and transparent background over the venue KV video.
  await message('interval:content', { ...values.interval.content, title: 'INTERVAL', upcomingLabel: 'COMING UP', matchSource: 'manual', matches: [{ playerOne: 'SP4GHET', playerTwo: 'SP4GHET' }] });
  await message('interval:timer', { action: 'start', durationSeconds: 1800 });
  await message('interval:timer', { action: 'pause' });
  await navigate('graphics/interval-led.html');
  await until('document.querySelector(".interval-countdown span").textContent === "30:00"');
  const ledBounds = await evaluate(`Object.fromEntries(['upcoming', 'timer', 'slides'].map(name => {
    const { x, y, width, height } = document.querySelector('.interval-' + name).getBoundingClientRect();
    return [name, { x, y, width, height }];
  }))`);
  assert.ok(ledBounds.upcoming.x + ledBounds.upcoming.width < ledBounds.timer.x, 'LED match column must clear the countdown');
  assert.ok(ledBounds.timer.x + ledBounds.timer.width < ledBounds.slides.x, 'LED countdown must clear the slide');
  assert.equal(ledBounds.timer.x + ledBounds.timer.width / 2, 960, 'LED countdown is centered on the wall');
  assert.ok(ledBounds.timer.y + ledBounds.timer.height < 475.5, 'LED countdown must clear every sponsor slide');
  assert.ok(Object.values(ledBounds).every(box => box.y >= 0 && box.y + box.height <= 576), 'LED content must fit the visible band');
  await evaluate(`document.body.style.background = 'url("assets/presenter-kv-led.png") 0 0 / 1920px 576px no-repeat'; new Promise((resolve, reject) => { const image = new Image(); image.onload = resolve; image.onerror = reject; image.src = 'assets/presenter-kv-led.png'; })`);
  await screenshot('led-reference', { x: 0, y: 0, width: 1920, height: 576, scale: 1 });
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log('Interval/bracket browser validation passed: inline switcher timer start/pause/resume/clear and validation, preview/revert/TAKE, KV playback/loop/mute/hidden pause/range delivery, standalone Stream and LED, dashboard saves, Next Match/profile updates, timer controls/JST, sponsor fades, layout bounds and text safety.');
  console.log('Screenshots: ' + artifacts);
} finally {
  socket?.close(); chrome.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
