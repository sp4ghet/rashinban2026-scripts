// Isolated end-to-end check: actual built presenter, fake NodeCG state and two
// Chromium test cameras. Never connects to the running NodeCG or physical inputs.
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
const artifacts = path.join(root, 'artifacts/presenter-validation/video-inputs');
await mkdir(artifacts, { recursive: true });
const state = applySnapshot(null, JSON.parse(await readFile(path.join(root, 'docs/geoguessr/samples/gs2-ws-DuelStarted.json'), 'utf8'))).state;
state.rounds[0].startAtMs = Date.now() - 1000; state.rounds[0].endAtMs = Date.now() + 600000;
const timeline = advanceTimeline(null, state, Date.now(), false, DEFAULT_TIMING);
const initial = { presenterDuel: state, presenterViews: seedViews(state), presenterTimeline: timeline,
  presenterSettings: { ...DEFAULT_SETTINGS, viewSource: 'video' },
  presenterSeries: { id: 'capture-qa', source: 'manual', left: { id: 'a', name: 'PLAYER LEFT', handle: '', wins: 0, playerId: state.players[0].id },
    right: { id: 'b', name: 'PLAYER RIGHT', handle: '', wins: 0, playerId: state.players[1].id } },
  presenterClients: { clients: [], program: null }, presenterPublicConfig: { googleMapsApiKey: process.env.PRESENTER_VIDEO_TEST_MAPS_KEY ?? '' } };
const bootstrap = `
window.qa={initial:${JSON.stringify(initial)},streams:[],requests:[],failName:null,standby:false};
qa.draws={left:0,right:0};qa.clears={left:0,right:0};
for(const method of ['drawImage','clearRect']){const original=CanvasRenderingContext2D.prototype[method];CanvasRenderingContext2D.prototype[method]=function(...args){const side=/^capture-(left|right)-canvas$/.exec(this.canvas.id)?.[1];if(side)qa[method==='drawImage'?'draws':'clears'][side]++;return original.apply(this,args);};}
const reps=new Map();
qa.set=(name,value)=>{const rep=nodecg.Replicant(name);rep.value=value;rep.listeners.forEach(fn=>fn(value));};
window.nodecg={Replicant(name){if(!reps.has(name))reps.set(name,{value:qa.initial[name],listeners:[],on(event,fn){this.listeners.push(fn);queueMicrotask(()=>fn(this.value));}});return reps.get(name);},
  async sendMessage(name,body){if(name==='presenter:clock')return Date.now();if(name==='presenter:client'&&body.role==='program')qa.set('presenterClients',{clients:[],program:qa.standby?null:{clientId:body.clientId,expiresAtMs:Date.now()+60000}});return true;}};
const realCapture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
const realDevices=navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
navigator.mediaDevices.enumerateDevices=async()=>{if(qa.deferDevices)await new Promise(resolve=>qa.finishScan=resolve);return qa.hideDevices?[{kind:'videoinput',deviceId:'',label:''}]:realDevices();};
navigator.mediaDevices.getUserMedia=async options=>{qa.requests.push(options);if(options.video===true&&qa.failDefault){if(qa.revealAfterProbe)qa.hideDevices=false;throw new DOMException('test default input failure',qa.failDefault);}if(qa.failName)throw new DOMException('test failure',qa.failName);const stream=await realCapture(options);qa.streams.push(stream);return stream;};
qa.mode=mode=>qa.set('presenterSettings',{...nodecg.Replicant('presenterSettings').value,viewSource:mode});
qa.lock=side=>{const s=structuredClone(nodecg.Replicant('presenterDuel').value);const id=nodecg.Replicant('presenterSeries').value[side].playerId;s.players.find(p=>p.id===id).guesses.push({round:s.round,lat:35.69,lng:side==='left'?139.69:139.70,score:4000,distanceM:10,createdAtMs:Date.now()});qa.set('presenterDuel',s);};
qa.reset=()=>{qa.set('presenterDuel',structuredClone(qa.initial.presenterDuel));qa.set('presenterTimeline',structuredClone(qa.initial.presenterTimeline));};
qa.preview=next=>{const s=structuredClone(qa.initial.presenterDuel);const t={...qa.initial.presenterTimeline,phase:'pre-round'};
  if(next){const round=structuredClone(s.rounds[0]);round.number=s.round+1;round.startAtMs=null;s.rounds.push(round);
    s.players.forEach(p=>p.results=[{round:s.round,score:4000,bestGuess:null,healthBefore:6000,healthAfter:6000,damageDealt:0,multiplier:1}]);
    Object.assign(t,{phase:'between-rounds',holdAtMs:Date.now()-1000,revealAtMs:Date.now()-2000});
  }else s.rounds[0].startAtMs=Date.now()+60000;
  qa.set('presenterDuel',s);qa.set('presenterTimeline',t);};
qa.hold=()=>qa.set('presenterTimeline',{...nodecg.Replicant('presenterTimeline').value,phase:'results-transition',effect:'single-5k'});
qa.hash=side=>document.getElementById('capture-'+side+'-canvas').toDataURL();
qa.bounds=()=>['left','right'].map(s=>{const r=document.getElementById(s+'-window').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
qa.active=()=>qa.streams.flatMap(s=>s.getTracks()).filter(t=>t.readyState==='live').length;
`;
const html = (await readFile(path.join(root, 'bundles/rashinban/graphics/presenter.html'), 'utf8'))
  .replace('<script src="presenter.js">', `<script>${bootstrap}</script><script src="presenter.js">`);
const ledHtml = (await readFile(path.join(root, 'bundles/rashinban/graphics/presenter-led.html'), 'utf8'))
  .replace('<script src="presenter.js">', `<script>${bootstrap}</script><script src="presenter.js">`);
const routes = { '/presenter.js': ['bundles/rashinban/graphics/presenter.js', 'text/javascript'],
  '/presenter.css': ['bundles/rashinban/graphics/presenter.css', 'text/css'],
  '/presenter-led.css': ['bundles/rashinban/graphics/presenter-led.css', 'text/css'],
  '/assets/presenter-kv.jpg': ['bundles/rashinban/graphics/assets/presenter-kv.jpg', 'image/jpeg'] };
const server = createServer(async (req, res) => {
  const route = routes[new URL(req.url, 'http://localhost').pathname];
  if (route) { res.writeHead(200, { 'Content-Type': route[1] }); res.end(await readFile(path.join(root, route[0]))); }
  else { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(req.url.startsWith('/presenter-led.html') ? ledHtml : html); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/presenter.html?role=program&videoSetup=1`;
const profile = path.join(artifacts, `chrome-${Date.now()}`);
const isOBS = !!process.env.OBS_VIDEO_TEST_PATH;
const flags = ['--enable-media-stream', ...isOBS ? [] : ['--use-fake-ui-for-media-stream'], '--use-fake-device-for-media-stream=device-count=2,fps=30'];
let processHandle; let socket; let debugPort; let counter = 0;
const pending = new Map(); const errors = []; const checks = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function command(method, params = {}) {
  const id = ++counter;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function until(expression, label, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await evaluate(expression)) { checks.push(label); return; } await delay(100); }
  const diagnostic = await evaluate(`JSON.stringify({page:document.body?.dataset,surfaces:Array.from(document.querySelectorAll('.google-surface')).map(surface=>({slot:surface.parentElement.id,visibility:surface.style.visibility})),setup:document.getElementById('video-setup')?.textContent})`);
  throw Error('Timed out: ' + label + '\n' + diagnostic + '\n' + errors.map(error => error.exceptionDetails?.exception?.description ?? error.exceptionDetails?.text).join('\n'));
}
async function screenshot(name) {
  // SDK surface visibility precedes tile painting; allow imagery to settle for visual review.
  if (initial.presenterPublicConfig.googleMapsApiKey) await delay(1000);
  const result = await command('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(artifacts, `${isOBS ? 'obs' : 'chrome'}-${name}.png`), Buffer.from(result.data, 'base64'));
}
try {
  if (isOBS) {
    const executable = path.resolve(process.env.OBS_VIDEO_TEST_PATH);
    const portable = path.resolve(path.dirname(executable), '../..');
    if (!portable.startsWith(artifacts + path.sep)) throw Error('OBS test must use a portable copy inside ' + artifacts);
    const basic = path.join(portable, 'config/obs-studio/basic');
    await mkdir(path.join(basic, 'scenes'), { recursive: true }); await mkdir(path.join(basic, 'profiles/VideoInputValidation'), { recursive: true });
    await writeFile(path.join(portable, 'portable_mode.txt'), '');
    await writeFile(path.join(portable, 'config/obs-studio/global.ini'), '[General]\nFirstRun=false\n[Basic]\nProfile=VideoInputValidation\nProfileDir=VideoInputValidation\nSceneCollection=VideoInputValidation\nSceneCollectionFile=VideoInputValidation\n');
    await writeFile(path.join(basic, 'profiles/VideoInputValidation/basic.ini'), '[General]\nName=VideoInputValidation\n[Video]\nBaseCX=1920\nBaseCY=1080\nOutputCX=1920\nOutputCY=1080\nFPSType=0\nFPSCommon=60\n[Audio]\nSampleRate=48000\nChannelSetup=Stereo\n');
    await writeFile(path.join(basic, 'scenes/VideoInputValidation.json'), JSON.stringify({ name: 'VideoInputValidation',
      current_scene: 'Validation', current_program_scene: 'Validation', scene_order: [{ name: 'Validation' }], groups: [],
      sources: [{ name: 'PresenterVideoValidation', id: 'browser_source', versioned_id: 'browser_source',
        settings: { url, width: 1920, height: 1080, fps: 60, shutdown: false, restart_when_active: false }, mixers: 0 },
      { name: 'Validation', id: 'scene', versioned_id: 'scene', settings: { items: [{ name: 'PresenterVideoValidation', visible: true,
        pos: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rot: 0, align: 5, id: 1, bounds_type: 0 }] } }] }));
    // Reserve an available localhost debug port before launching this isolated OBS.
    const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    debugPort = probe.address().port; await new Promise(resolve => probe.close(resolve));
    processHandle = spawn(executable, ['--portable', '--multi', '--minimize-to-tray', '--disable-updater',
      '--disable-missing-files-check', '--collection', 'VideoInputValidation', '--profile', 'VideoInputValidation',
      `--remote-debugging-port=${debugPort}`, ...flags], { cwd: path.dirname(executable), windowsHide: true, stdio: 'ignore' });
  } else {
    processHandle = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
        '--disable-background-networking', '--autoplay-policy=no-user-gesture-required', ...flags, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  }
  let target;
  for (let i = 0; i < 150; i++) {
    try {
      if (!debugPort) debugPort = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
      const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(res => res.json());
      target = pages.find(page => isOBS ? page.url === url : page.type === 'page'); if (target) break;
    } catch { /* Process is still starting. */ }
    await delay(200);
  }
  if (!target) throw Error('Test browser did not start');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) { const call = pending.get(message.id); if (call) { pending.delete(message.id); message.error ? call.reject(Error(message.error.message)) : call.resolve(message.result); } }
    else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params);
  };
  await command('Runtime.enable'); await command('Page.enable');
  if (!isOBS) await command('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  // OBS already loaded this URL from its scene collection. Navigating again
  // while CEF is injecting the source CSS races its first OnLoadEnd callback.
  if (!isOBS) await command('Page.navigate', { url });
  await until(`document.readyState==='complete'`, 'initial page loaded');
  await until(`document.body?.dataset.program==='true'`, 'program lease acquired');
  if (initial.presenterPublicConfig.googleMapsApiKey) await until(`document.body.dataset.renderer==='api-ready'`, 'Google renderer ready', 30000);
  await until(`!document.getElementById('video-find').disabled`, 'initial enumeration settled');
  await evaluate(`qa.hideDevices=true;qa.deferDevices=true;qa.beforeGuard=qa.requests.length;document.getElementById('video-find').click()`);
  await until(`typeof qa.finishScan==='function'`, 'permission scan waits for enumeration');
  await evaluate(`qa.standby=true;qa.set('presenterClients',{clients:[],program:null});qa.deferDevices=false;qa.finishScan()`);
  await until(`!document.getElementById('video-find').disabled`, 'ownership loss cancels permission probe after enumeration');
  assert.equal(await evaluate(`qa.requests.length===qa.beforeGuard`), true);
  await evaluate(`qa.hideDevices=false;qa.standby=false;nodecg.sendMessage('presenter:client',{role:'program',clientId:document.body.dataset.clientId})`);
  // Grant access using a simulated camera, then reproduce a default input that
  // fails to start even though permission allows the other inputs to be listed.
  await evaluate(`(async()=>{const grant=await realCapture({audio:false,video:true});grant.getTracks().forEach(t=>t.stop());})()`);
  await until(`!document.getElementById('video-find').disabled`, 'initial device scan finished');
  await evaluate(`qa.hideDevices=true;qa.failDefault='NotReadableError';qa.revealAfterProbe=true;for(const s of ['left','right'])document.getElementById('video-'+s+'-device').replaceChildren(new Option('No input',''));document.getElementById('video-find').click()`);
  await until(`!document.getElementById('video-find').disabled`, 'failed default permission probe settled');
  assert.equal(await evaluate(`document.querySelectorAll('#video-left-device option').length`), 3, 'failed default input must not prevent listing the other cameras');
  checks.push('device list recovers after default input cannot start');
  await evaluate(`qa.beforeFind=qa.requests.length;document.getElementById('video-find').click()`);
  await until(`!document.getElementById('video-find').disabled`, 'available devices scanned');
  assert.equal(await evaluate(`qa.requests.length===qa.beforeFind`), true, 'finding already exposed inputs must not open the default camera');
  checks.push('device discovery avoids opening an unrelated default camera');
  await evaluate(`qa.hideDevices=true;qa.revealAfterProbe=false;document.getElementById('video-find').click()`);
  await until(`!document.getElementById('video-find').disabled`, 'unexposed devices reported');
  assert.match(await evaluate(`document.getElementById('video-setup-message').textContent`), /device discovery.*NotReadableError/i);
  checks.push('discovery error identifies its stage and browser error name');
  await evaluate(`qa.hideDevices=false;qa.failDefault=null;document.getElementById('video-find').click()`);
  await until(`document.querySelectorAll('#video-left-device option').length===3`, 'two browser camera devices enumerated');
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('#video-left-device option')).slice(1).every(o=>o.textContent.startsWith('fake_device_'))`), true, 'only simulated devices');
  await evaluate(`qa.ids=Array.from(document.querySelectorAll('#video-left-device option')).slice(1).map(o=>o.value)`);
  for (const [side, index] of [['left', 1], ['right', 2]]) {
    const bounds = await evaluate(`(()=>{const option=document.getElementById('video-${side}-device').options[${index}];const r=option.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`);
    assert.ok(bounds.width > 0 && bounds.height > 0, 'device choices must be rendered inside the OBS page, without a native popup');
    const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, button: 'left', clickCount: 1 };
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point });
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point });
    assert.equal(await evaluate(`document.getElementById('video-${side}-device').value===qa.ids[${index - 1}]`), true, side + ' device can be selected by clicking its visible row');
  }
  assert.equal(await evaluate(`document.getElementById('video-setup').getBoundingClientRect().bottom<=1080`), true, 'setup and apply controls fit within the OBS output');
  checks.push('device list rows select by pointer without native popups');
  await evaluate(`document.getElementById('video-apply').click()`);
  const ready = `['left','right'].every(s=>document.getElementById('capture-'+s)?.dataset.hasFrame==='true')`;
  await until(ready, 'two live feeds painted');
  assert.equal(await evaluate(`qa.streams.every(s=>s.getAudioTracks().length===0)`), true);
  await evaluate(`qa.live=qa.hash('left')`); await delay(150);
  assert.equal(await evaluate(`qa.live!==qa.hash('left')`), true, 'live pixels keep advancing');
  await screenshot('setup');
  await evaluate(`document.getElementById('video-close').click()`); await screenshot('equal');
  for (let sample = 0; sample < 3; sample++) {
    await evaluate(`qa.hiddenHashes=['left','right'].map(qa.hash)`); await delay(1000);
    assert.equal(await evaluate(`['left','right'].every((side,i)=>qa.hash(side)!==qa.hiddenHashes[i])`), true, 'both feeds advance with setup display:none');
  }
  checks.push('hidden setup does not stall either video feed');
  await evaluate(`qa.beforeCopies={draws:{...qa.draws},frames:['left','right'].map(s=>document.getElementById('video-'+s+'-preview').getVideoPlaybackQuality().totalVideoFrames)}`);
  await delay(500);
  assert.equal(await evaluate(`['left','right'].every((s,i)=>qa.draws[s]-qa.beforeCopies.draws[s]<=document.getElementById('video-'+s+'-preview').getVideoPlaybackQuality().totalVideoFrames-qa.beforeCopies.frames[i]+2)`), true, 'canvas copies only new source frames');
  checks.push('30 fps inputs avoid duplicate canvas copies at 60 Hz');
  for (const code of ['', 'F8']) {
    const label = code ? 'F8 with physical key code' : 'OBS F8 without physical key code';
    for (const hidden of [false, true]) {
      await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F8', code, windowsVirtualKeyCode: 119 });
      assert.equal(await evaluate(`document.getElementById('video-setup').hidden`), hidden, label + ' toggles local setup');
      await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F8', code, windowsVirtualKeyCode: 119, autoRepeat: true });
      assert.equal(await evaluate(`document.getElementById('video-setup').hidden`), hidden, label + ' ignores key repeat');
      await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F8', code, windowsVirtualKeyCode: 119 });
    }
    checks.push(label);
  }
  for (const mode of ['MOVE', 'NM', 'NMPZ']) {
    await evaluate(`qa.set('presenterDuel',{...nodecg.Replicant('presenterDuel').value,mode:'${mode}'})`);
    await until(`document.body.dataset.layout==='dual'&&${ready}`, mode + ' retains two feeds');
  }
  assert.deepEqual(await evaluate(`qa.bounds().map(r=>[r.width,r.height])`), [[922, 519], [922, 519]]);
  await evaluate(`qa.lock('left')`); await delay(450);
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('left-map')).display`), 'block', 'locked video side shows the comparison map');
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('capture-left')).display`), 'none');
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('right-map')).display`), 'none');
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('capture-right')).display`), 'grid');
  if (initial.presenterPublicConfig.googleMapsApiKey) assert.equal(await evaluate(`document.getElementById('left-map').style.visibility`), 'visible');
  assert.deepEqual(await evaluate(`qa.bounds().map(r=>[r.x,r.y,r.width,r.height])`), [[28, 218, 574, 574], [622, 144, 1270, 714]], 'left lock uses the rendered layout');
  await screenshot('left-locked'); checks.push('left lock replaces feed with a comparison map and scales the active feed');
  await evaluate(`qa.lock('right')`); await delay(450);
  assert.deepEqual(await evaluate(`qa.bounds().map(r=>[r.width,r.height])`), [[922, 519], [922, 519]]);
  assert.deepEqual(await evaluate(`['left','right'].map(s=>getComputedStyle(document.getElementById(s+'-map')).display)`), ['block','block']);
  await evaluate(`qa.frozen=qa.hash('left')`); await delay(250);
  assert.equal(await evaluate(`qa.frozen===qa.hash('left')`), true, 'both locks freeze pixels');
  await evaluate(`qa.reset();qa.lock('right')`); await delay(450);
  assert.deepEqual(await evaluate(`qa.bounds().map(r=>[r.x,r.y,r.width,r.height])`), [[28, 144, 1270, 714], [1318, 218, 574, 574]], 'right lock uses the rendered layout');
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('right-map')).display`), 'block');
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('capture-right')).display`), 'none');
  await evaluate(`qa.reset()`); await until(`document.body.dataset.lock==='none'&&${ready}`, 'feeds resume on live reset');
  assert.deepEqual(await evaluate(`['left','right'].map(s=>getComputedStyle(document.getElementById(s+'-map')).display)`), ['none','none']);
  assert.deepEqual(await evaluate(`['left','right'].map(s=>getComputedStyle(document.getElementById('capture-'+s)).display)`), ['grid','grid']);
  await evaluate(`qa.hold()`); await until(`document.body.dataset.celebrationUnderlay==='true'`, 'celebration retains outgoing view');
  await evaluate(`qa.frozen=qa.hash('left')`); await delay(250);
  assert.equal(await evaluate(`qa.frozen===qa.hash('left')`), true, 'celebration does not sample later camera frames');
  await evaluate(`qa.mutedTrack=document.getElementById('video-left-preview').srcObject.getVideoTracks()[0];Object.defineProperty(qa.mutedTrack,'muted',{configurable:true,value:true});qa.mutedTrack.dispatchEvent(new Event('mute'))`);
  assert.equal(await evaluate(`qa.frozen===qa.hash('left')&&document.getElementById('capture-left').dataset.hasFrame==='true'`), true, 'signal mute preserves the held celebration frame');
  await evaluate(`delete qa.mutedTrack.muted;qa.mutedTrack.dispatchEvent(new Event('unmute'));qa.reset()`);
  await until(ready, 'feeds resume after signal recovery');
  await evaluate(`const s=structuredClone(nodecg.Replicant('presenterDuel').value);s.rounds[0].endAtMs=Date.now()-1;qa.set('presenterDuel',s)`);
  await delay(100); await evaluate(`qa.deadlineHashes=['left','right'].map(qa.hash)`); await delay(300);
  assert.equal(await evaluate(`['left','right'].every((s,i)=>qa.hash(s)===qa.deadlineHashes[i])`), true, 'deadline freezes both feeds before results arrive');
  checks.push('mute and timeout preserve safe held pixels');
  for (const next of [false, true]) {
    await evaluate(`qa.preview(${next})`);
    await until(`document.body.dataset.scene==='preview'&&document.getElementById('round-number').textContent==='${next ? 2 : 1}'`, next ? 'next round preview shown after results' : 'first round preview shown');
    assert.equal(await evaluate(`getComputedStyle(document.getElementById('preview-map')).display`), 'block');
    assert.equal(await evaluate(`document.getElementById('live-area').hidden`), true);
    assert.equal(await evaluate(`document.getElementById('round-number').textContent`), next ? '2' : '1');
    if (initial.presenterPublicConfig.googleMapsApiKey) {
      await until(`document.querySelector('#preview-panorama .google-surface')?.style.visibility==='visible'`, 'preview panorama resolved');
      assert.equal(await evaluate(`document.getElementById('preview-map').style.visibility`), 'visible');
    }
    await screenshot(next ? 'next-round-preview' : 'first-round-preview');
  }
  await evaluate(`qa.reset()`); await until(ready, 'live feeds return after round preview');
  assert.equal(await evaluate(`document.getElementById('preview-area').hidden`), true);
  await evaluate(`qa.reset();qa.mode('chroma')`); await until(`qa.active()===0&&document.body.dataset.source==='chroma'`, 'chroma releases both devices');
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('capture-left')).display`), 'none');
  await delay(100); await evaluate(`qa.clearedCounts={...qa.clears}`); await delay(250);
  assert.equal(await evaluate(`['left','right'].every(s=>qa.clears[s]===qa.clearedCounts[s])`), true, 'inactive video canvases are not repeatedly cleared');
  checks.push('inactive capture does no canvas work');
  await evaluate(`qa.mode('rendered')`); await delay(100); assert.equal(await evaluate(`qa.active()`), 0);
  await evaluate(`qa.mode('video')`); await until(ready, 'video mode reacquires selected devices');
  await evaluate(`document.getElementById('video-swap').click()`); await until(ready, 'swapped feeds reconnect');
  assert.equal(await evaluate(`document.getElementById('video-left-preview').srcObject.getVideoTracks()[0].getSettings().deviceId===qa.ids[1]`), true);
  const beforeReload = await evaluate('performance.timeOrigin');
  await command('Page.reload'); await until(`performance.timeOrigin!==${beforeReload}&&${ready}`, 'saved assignments restore after reload');
  await evaluate(`qa.ids=Array.from(document.querySelectorAll('#video-left-device option')).filter(o=>o.value).map(o=>o.value)`);
  await evaluate(`qa.standby=true;qa.set('presenterClients',{clients:[],program:null})`);
  await until(`qa.active()===0`, 'standby releases capture');
  await evaluate(`qa.standby=false;nodecg.sendMessage('presenter:client',{role:'program',clientId:document.body.dataset.clientId})`);
  await until(ready, 'program transfer resumes capture');
  await evaluate(`const track=document.getElementById('video-left-preview').srcObject.getVideoTracks()[0];track.stop();track.dispatchEvent(new Event('ended'))`);
  await until(`document.getElementById('capture-left').dataset.state==='error'&&document.getElementById('capture-right').dataset.state==='ready'`, 'disconnect isolates affected feed');
  await until(ready, 'disconnect recovers without opening setup');
  await evaluate(`qa.beforeDeviceChange=qa.requests.length;const disconnected=document.getElementById('video-left-preview').srcObject.getVideoTracks()[0];disconnected.stop();disconnected.dispatchEvent(new Event('ended'));navigator.mediaDevices.dispatchEvent(new Event('devicechange'))`);
  await delay(150);
  assert.equal(await evaluate(`qa.requests.length-qa.beforeDeviceChange`), 1, 'devicechange immediately retries only the disconnected input');
  await until(ready, 'device discovery restores the affected feed');
  await evaluate(`qa.failName='NotAllowedError';document.getElementById('video-reconnect').click()`);
  await until(`document.getElementById('capture-left').dataset.state==='error'`, 'permission denial reported');
  const count = await evaluate(`qa.requests.length`);
  await evaluate(`navigator.mediaDevices.dispatchEvent(new Event('devicechange'))`);
  await delay(600); assert.equal(await evaluate(`qa.requests.length`), count, 'permission denial is not retried by timers or devicechange');
  await evaluate(`qa.failName=null;document.getElementById('video-reconnect').click()`); await until(ready, 'permission retry restores feeds');
  await evaluate(`const select=document.getElementById('video-left-device');select.add(new Option('Missing input','missing-device'));select.value='missing-device';document.getElementById('video-apply').click()`);
  await until(`document.getElementById('capture-left').dataset.state==='error'&&document.getElementById('capture-right').dataset.state==='ready'`, 'missing device does not substitute a default camera');
  await evaluate(`document.getElementById('video-left-device').value=qa.ids[1];document.getElementById('video-find').click()`);
  await until(`!document.getElementById('video-find').disabled`, 'rescan retains unapplied device selection');
  await evaluate(`document.getElementById('video-swap').click()`);
  assert.equal(await evaluate(`document.getElementById('video-right-device').value`), 'missing-device', 'swap keeps the unavailable saved assignment');
  await evaluate(`document.getElementById('video-apply').click()`);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('rashinban:presenter-video-inputs:v1')).right`), 'missing-device');
  checks.push('swapping unavailable saved devices does not lose assignments');
  await command('Page.navigate', { url: url.replace('role=program', 'role=preview') });
  await until(`document.body?.dataset.role==='preview'`, 'preview loaded'); await delay(400);
  await evaluate(`document.getElementById('video-find').click()`); await delay(100);
  assert.equal(await evaluate(`qa.requests.length`), 0, 'preview does not open cameras');
  await command('Page.navigate', { url: url.split('?')[0].replace('/presenter.html', '/presenter-led.html') });
  await until(`document.body?.dataset.role==='led'&&document.body.dataset.scene==='live'`, 'LED page initializes alongside video mode');
  assert.equal(await evaluate(`document.body.dataset.source`), 'rendered', 'LED uses rendered views while program owns capture devices');
  assert.equal(await evaluate(`qa.requests.length`), 0, 'LED never opens capture devices');
  assert.equal(await evaluate(`document.body.classList.contains('blanked')`), true, 'LED starts blanked by the broadcast bus');
  await evaluate(`qa.set('broadcast',{led:{program:{presenter:{visible:true}}}})`);
  await until(`!document.body.classList.contains('blanked')`, 'broadcast bus can reveal LED presenter');
  if (initial.presenterPublicConfig.googleMapsApiKey) await until(`Array.from(document.querySelectorAll('#shared-panorama .google-surface, #left-view .google-surface')).some(surface=>surface.style.visibility==='visible')`, 'LED rendered panorama remains available');
  await evaluate(`qa.set('broadcast',{led:{program:{presenter:{visible:false}}}})`);
  await until(`document.body.classList.contains('blanked')`, 'broadcast bus can blank LED presenter');
  assert.deepEqual(errors, []);
  const report = { browser: isOBS ? 'OBS Browser Source' : 'Chrome', userAgent: await evaluate('navigator.userAgent'), checks,
    errors, googleMaps: initial.presenterPublicConfig.googleMapsApiKey ? 'Live API and preview panorama verified' : 'No API key; layout and capture checks only',
    physicalHardware: 'Not tested; Chromium fake devices only' };
  await writeFile(path.join(artifacts, `${isOBS ? 'obs' : 'chrome'}-report.json`), JSON.stringify(report, null, 2));
  console.log(`${report.browser}: ${checks.length} checks passed; no uncaught errors. Two simulated inputs; physical hardware untested.`);
} finally {
  socket?.close(); if (processHandle?.exitCode === null) processHandle.kill();
  server.closeAllConnections(); server.close();
}
