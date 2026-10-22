// Built dashboard -> real extension handlers -> replicated state -> built graphics.
// Uses isolated NodeCG transport fixtures and a disposable headless browser.
import assert from 'node:assert/strict';
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
import { createInitialState, applyAction } from '../bundles/rashinban/src/banpick/rules.ts';
import { registerBroadcast } from '../bundles/rashinban/src/extension/broadcast.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adobeFonts = process.argv.includes('--adobe-fonts');
const artifacts = path.join(root, 'artifacts/en-validation', adobeFonts ? 'adobe' : 'offline');
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

let sheetRows;
try { sheetRows = JSON.parse(await readFile(path.join(root, 'artifacts/en-validation/players-en.json'), 'utf8')); }
catch { sheetRows = [['geoguessr_player_uid','name','startgg_tag','startgg_entrant_id','age','rating','favorite_mode','strengths','favorite_food','message'],
  ['5e6434058fd6cf50f886fb99','Stephen','Stephen','42','29','1493','All modes','Moving knowledge, car meta','Sushi, ultra-rich dried-sardine-based ramen, mutton biryani, and wild boar hot pot.','Last year I participated as a commentator, but this year I will do my best to put on a good performance as a competitor!'],
  ['6375a42d001fcb9df8d226d9','shiyoe','original-tag','43','20','1747','NMPZ','NMPZ','GeoGuessr Parfait','I will do my best']]; }
const profiles = sheetRows.slice(1).filter(row => row[0]).map(row => rowToProfile(Object.fromEntries(sheetRows[0].map((key, index) => [key, row[index] || '']))));
const originalProfiles = profiles.map(profile => ({...profile, name: 'JP ' + profile.name}));
nodecg.Replicant('banPick').value = [4,7,1].reduce((state,id)=>applyAction(state,id),createInitialState());
nodecg.Replicant('players').value = originalProfiles;
nodecg.Replicant('playersEn').value = profiles;
nodecg.Replicant('castersEn').value = [{role:'CASTER', name:'trulybuzzy', twitter:'trulybuzzy'}, {role:'CASTER', name:'kioni_the_mage', twitter:'kioni_the_mage'}];
const current = emptyMatch();
current.left.uid = profiles[4]?.geoguessrPlayerUid || profiles[0].geoguessrPlayerUid;
current.right.uid = profiles[2]?.geoguessrPlayerUid || profiles[1].geoguessrPlayerUid;
current.left.wins=1; current.label='Winners Final';
nodecg.Replicant('matchState').value = current;
nodecg.Replicant('nextMatchState').value = current;
const checks=[];
function check(label, value, expected=true) { assert.deepEqual(value,expected,label); checks.push(label); }

const preload = () => `
const nativeNow=Date.now; Date.now=()=>nativeNow()+60000;
const nativeSetInterval=window.setInterval;
window.fixtureIntervals=[];
window.setInterval=(callback,ms,...args)=>{const id=nativeSetInterval(callback,ms,...args);window.fixtureIntervals.push({id,callback,ms});return id;};
const values=${JSON.stringify(values).replaceAll('<', '\\u003c')}, listeners=new Map();
window.fixtureValues=values;window.fixturePending=0;
function emit(name,value){values[name]=value;for(const cb of listeners.get(name)||[])cb(value);}
function sync(next){for(const [name,value] of Object.entries(next))if(JSON.stringify(value)!==JSON.stringify(values[name]))emit(name,value);}
window.nodecg={bundleConfig:{},Replicant(name){return{get value(){return values[name];},on(event,cb){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(cb);if(name in values)queueMicrotask(()=>cb(values[name]));}};},
async sendMessage(name,data){window.fixturePending++;try{const response=await fetch('/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,data})});const result=await response.json();if(!response.ok)throw result;sync(await fetch('/state').then(r=>r.json()));return result;}finally{window.fixturePending--;}}};
setInterval(()=>fetch('/state').then(r=>r.json()).then(sync),100);
`;
const media = express();
media.use('/rashinban/media', createMediaRouter({appRoot: root, sharedRoot: process.env.RASHINBAN_SHARED_ROOT || root, isWorktree: Boolean(process.env.RASHINBAN_SHARED_ROOT)}));
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
const profile = await mkdtemp(path.join(os.tmpdir(), 'rb-english-browser-'));
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
  if (adobeFonts && file.startsWith('graphics/')) await until("Array.from(document.fonts).some(f => f.family.includes('kaneda-gothic') && f.weight === '700' && f.status === 'loaded')");
}
async function click(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await until("window.fixturePending === 0"); }
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
  for (let i=0;i<100;i++) { try { port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break; } catch {await delay(100);} }
  if (!port) throw Error('Headless Chrome did not start');
  const pages=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
  socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=event=>{const result=JSON.parse(event.data);if(result.id){const call=pending.get(result.id);if(!call)return;pending.delete(result.id);result.error?call.reject(Error(result.error.message)):call.resolve(result.result);}else if(result.method==='Runtime.exceptionThrown')errors.push(result.params.exceptionDetails);};
  await command('Runtime.enable');await command('Page.enable');
  await command('Emulation.setDefaultBackgroundColorOverride',{color:{r:16,g:20,b:28,a:1}});
  await navigate('dashboard/switcher-en.html',1440,1100);
  const doc=channel=>`document.querySelector('.monitor[data-channel=${channel}] iframe.info').contentDocument`;
  const card=channel=>`${doc(channel)}?.querySelector('#cards')`;
  await until(`${doc('preview')}?.querySelector('#cards') && ${doc('program')}?.querySelector('#cards')`);
  await until('document.querySelector("#interval-timer-controls")?.disabled === false');
  check('English player menu uses English names', await evaluate(`document.querySelector('[data-row=playerCards] select').textContent.includes('JP ')`),false);
  await message('broadcast:setPreview',{output:'stream',patch:{playerCards:{player:'right',visible:true},playerCameras:{right:true}}});
  await message('broadcast:take',{output:'stream'});
  const stream=structuredClone(values.broadcast.stream);
  await click('[data-row=playerCameras] button');
  await until(`${card('preview')}.classList.contains('visible')`);
  check('Preview has English profile',await evaluate(`${doc('preview')}.querySelector('#card-1 .name').textContent`),profiles.find(p=>p.geoguessrPlayerUid===current.left.uid).name);
  check('English stages P1 while Stream remains P2',values.broadcast.en.preview.playerCards.player,'left');
  check('Program stays hidden before TAKE',await evaluate(`${card('program')}.classList.contains('visible')`),false);
  await click('#take');await until(`${card('program')}.classList.contains('visible')`);
  await screenshot('switcher-player');
  await evaluate(`{const select=document.querySelector('[data-row=playerCards] select');select.value='right';select.dispatchEvent(new Event('change'));}`);
  await until("window.fixtureValues.broadcast.en.preview.playerCameras.right === true");
  check('Card player selector links camera',values.broadcast.en.preview.playerCameras.left,false);
  check('Card swap restores matching position',values.broadcast.en.preview.playerCards.position,'right');
  await click('#revert');await until("window.fixtureValues.broadcast.en.preview.playerCards.player === 'left'");
  check('Revert keeps EN Program',values.broadcast.en.program.playerCards.player,'left');
  await message('interval:timer',{action:'start',durationSeconds:900});
  const mainTimer=structuredClone(values.interval.timer);
  await fill('#interval-minutes','2');await click('#interval-start');
  await until("document.querySelector('#interval-countdown').textContent === '02:00'");
  check('EN start leaves main timer unchanged',values.interval.timer,mainTimer);
  await click('#interval-pause');await until("document.querySelector('#interval-pause').textContent === 'Resume'");
  const enPaused=values.intervalEn.timer.remainingMs;
  check('EN pauses its own remaining time',enPaused>115000&&enPaused<=120000);
  await message('interval:timer',{action:'clear'});
  check('Main clear leaves EN paused',values.intervalEn.timer.remainingMs,enPaused);
  await click('#interval-pause');await until("document.querySelector('#interval-pause').textContent === 'Pause'");
  await click('#interval-clear');await until("document.querySelector('#interval-timer-status').textContent === 'Hidden'");
  await click('[data-row=lowerThird] button');await click('[data-row=banpick] button');await click('#take');
  await until(`${doc('program')}.querySelector('#lower-third').classList.contains('visible')`);
  check('Ban/pick on English Program',await evaluate(`${doc('program')}.querySelector('#banpick').classList.contains('visible')`));
  await evaluate(`{const select=document.querySelector('[data-row=casters] select');select.value='trulybuzzy';select.dispatchEvent(new Event('change'));}`);
  await until("window.fixtureValues.broadcast.en.preview.casters.names.left === 'trulybuzzy'");
  await click('[data-row=casters] button');await click('#take');
  await until(`${doc('program')}.querySelector('#caster-1 .name').textContent === 'trulybuzzy'`);
  check('English casters populated',await evaluate(`${doc('program')}.querySelector('#caster-1').dataset.visible`),'true');
  await click('[data-row=interval] button');await click('#take');
  await until(`${doc('program')}.querySelector('#layer-interval').hidden === false`);
  check('EN upcoming names localized',await evaluate(`${doc('program')}.querySelector('.interval-matches').textContent.includes('JP ')`),false);
  await screenshot('switcher-interval');
  await click('[data-row=bracket] button');await click('#take');
  await until(`${doc('program')}.querySelector('#layer-bracket').hidden === false`);
  check('Bracket replaces interval',values.broadcast.en.program.interval.visible,false);
  check('All EN actions leave Stream untouched',values.broadcast.stream,stream);
  // Render every requested layer directly at production size.
  await message('broadcast:clearPreview',{output:'en'});
  await message('broadcast:setPreview',{output:'en',patch:{playerCards:{visible:true,page:'profile',player:'left',position:'left'},playerCameras:{left:true,right:false}}});
  await message('broadcast:take',{output:'en'});
  await navigate('graphics/info-en.html?cameraMode=placeholder');
  await until("document.querySelector('#cards').classList.contains('visible')");
  await screenshot('player-card');
  const overflows=[];
  for (const profile of profiles) {
    current.left.uid=profile.geoguessrPlayerUid;
    nodecg.Replicant('matchState').value=structuredClone(current);
    await until(`document.querySelector('#card-1 .name').textContent === ${JSON.stringify(profile.name)}`);
    const measure=await evaluate(`(()=>{const c=document.querySelector('#card-1'),d=c.querySelector('.page-details');return {name:c.querySelector('.name').textContent,overflow:d.getBoundingClientRect().bottom-(c.getBoundingClientRect().bottom-parseFloat(getComputedStyle(c).paddingBottom)),font:document.querySelector('#cards').dataset.headingFont};})()`);
    if(measure.overflow>2)overflows.push(measure);
  }
  await writeFile(path.join(artifacts,'profile-overflow.json'),JSON.stringify(overflows,null,2));
  check('All '+profiles.length+' English profiles fit within cards',overflows,[]);
  await message('broadcast:setPreview',{output:'en',patch:{playerCards:{visible:false},playerCameras:{left:false,right:false},lowerThird:{visible:true,mode:'scores'},banpick:{visible:true}}});
  await message('broadcast:take',{output:'en'});await until("document.querySelector('#lower-third').dataset.mode === 'scores'");await screenshot('lower-thirds-banpick');
  const first=profiles[0];
  nodecg.Replicant('bracketFinals').value={source:'startgg',groupId:1,error:null,updatedAt:Date.now(),rows:[{match:1,top:'renamed-tag',bottom:'Unknown',topEntrantId:first.startggEntrantId,topScore:'2',bottomScore:'1',winner:'top',active:true}]};
  await message('broadcast:setPreview',{output:'en',patch:{bracket:{visible:true},interval:{visible:false}}});await message('broadcast:take',{output:'en'});
  await until("document.querySelector('#layer-bracket').hidden === false");
  await until(`document.querySelector('#match1-top').textContent === ${JSON.stringify(first.name)}`);
  check('Bracket matches English name by entrant ID',await evaluate('document.querySelector("#match1-top").textContent'),first.name);
  nodecg.Replicant('playersEn').value = profiles.map(p => p === first ? {...p,startggTag:'',startggEntrantId:null} : p);
  await until(`window.fixtureValues.playersEn[0].startggEntrantId === null`);
  check('Bracket resolves UID-only translations through shared identity',await evaluate('document.querySelector("#match1-top").textContent'),first.name);
  await screenshot('bracket');
  await message('interval:timer:en',{action:'start',durationSeconds:300});
  await message('broadcast:setPreview',{output:'en',patch:{bracket:{visible:false},interval:{visible:true}}});await message('broadcast:take',{output:'en'});
  await until("document.querySelector('#layer-interval').hidden === false");await screenshot('interval');
  check('No browser exceptions',errors,[]);
  await writeFile(path.join(artifacts,'report.json'),JSON.stringify({checks,profileCount:profiles.length,adobeFonts,errors},null,2));
  console.log(JSON.stringify({passed:checks.length,profileCount:profiles.length,artifacts}));
} catch(error) {
  await writeFile(path.join(artifacts,'failure.json'),JSON.stringify({message:error.message,stack:error.stack,checks,errors},null,2));throw error;
} finally {
  try{await command('Browser.close');}catch{}socket?.close();chrome.kill();
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
