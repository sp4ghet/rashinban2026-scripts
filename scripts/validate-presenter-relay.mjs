// Real WebRTC connections and actual relay broker, with fake Chromium devices.
// Does not connect to live NodeCG or acquire physical cameras.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRelayBroker } from '../bundles/rashinban/src/extension/presenter/video-relay.ts';
import { applySnapshot } from '../bundles/rashinban/src/presenter/normalize.ts';
import { seedViews } from '../bundles/rashinban/src/presenter/telemetry.ts';
import { advanceTimeline, DEFAULT_TIMING } from '../bundles/rashinban/src/presenter/timeline.ts';
import { DEFAULT_SETTINGS } from '../bundles/rashinban/src/presenter/settings.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cameraTest = process.argv.includes('--cameras');
const inputCount = cameraTest ? 4 : 2;
const out = path.join(root, 'artifacts/presenter-validation', cameraTest ? 'relay-cameras' : 'relay');
await mkdir(out, { recursive: true });
const state = applySnapshot(null, JSON.parse(await readFile(path.join(root, 'docs/geoguessr/samples/gs2-ws-DuelStarted.json'), 'utf8'))).state;
state.rounds[0].startAtMs = Date.now() - 1000; state.rounds[0].endAtMs = Date.now() + 600000;
const initial = { presenterDuel: state, presenterViews: seedViews(state), presenterTimeline: advanceTimeline(null, state, Date.now(), false, DEFAULT_TIMING),
  presenterSettings: { ...DEFAULT_SETTINGS, viewSource: 'video' },
  presenterSeries: { id: 'relay-qa', source: 'manual', left: { id: 'l', name: 'LEFT', handle: '', wins: 0, playerId: state.players[0].id }, right: { id: 'r', name: 'RIGHT', handle: '', wins: 0, playerId: state.players[1].id } },
  presenterClients: { clients: [], program: null }, presenterPublicConfig: { googleMapsApiKey: '' }, broadcast: { led: { program: { presenter: { visible: true } } } } };
const bootstrap = `
window.qa={initial:${JSON.stringify(initial)},requests:[],streams:[],relayJoins:0,noOwnership:false,blockSignal:false,dropAnswer:false,droppedAnswers:0,dropOffer:new URLSearchParams(location.search).has('dropOffer'),droppedOffers:0};
qa.peers=[];const RealPeer=RTCPeerConnection;window.RTCPeerConnection=class extends RealPeer{constructor(...args){super(...args);qa.peers.push(this);}};
const reps=new Map();
qa.set=(name,value)=>{const rep=nodecg.Replicant(name);rep.value=value;rep.listeners.forEach(fn=>fn(value));};
window.nodecg={Replicant(name){if(!reps.has(name))reps.set(name,{value:qa.initial[name],listeners:[],on(event,fn){this.listeners.push(fn);queueMicrotask(()=>fn(this.value));}});return reps.get(name);},
async sendMessage(name,body){if(name==='presenter:video-relay'){if(body.action==='join')qa.relayJoins++;if(qa.blockSignal)throw Error('Offline test');const result=await fetch('/signal',{method:'POST',body:JSON.stringify(body)}).then(r=>r.json());if(qa.dropOffer&&result.messages?.some(m=>m.signal.type==='offer')){qa.dropOffer=false;qa.droppedOffers++;throw Error('Lost offer acknowledgement test');}if(qa.dropAnswer&&result.messages?.some(m=>m.signal.type==='answer')){qa.dropAnswer=false;qa.droppedAnswers++;throw Error('Lost answer acknowledgement test');}return result;}if(name==='presenter:clock')return Date.now();if(name==='presenter:client'&&body.role==='program'&&!qa.noOwnership)qa.set('presenterClients',{clients:[],program:{clientId:body.clientId,expiresAtMs:Date.now()+60000}});return true;}};
const getMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia=async options=>{qa.requests.push(options);if(!location.pathname.includes('presenter-capture'))throw Error('Receiver attempted physical capture');const stream=await getMedia(options);qa.streams.push(stream);return stream;};
qa.active=()=>qa.streams.flatMap(s=>s.getTracks()).filter(t=>t.readyState==='live').length;
qa.hash=side=>document.getElementById('capture-'+side+'-canvas').toDataURL();
qa.sources=()=>['left','right'].map(side=>document.getElementById('video-'+side+'-preview').srcObject?.getVideoTracks()[0]?.getSettings().deviceId);
qa.cameraSources=()=>['left','right'].map(side=>document.getElementById('camera-'+side+'-video')?.srcObject?.getVideoTracks()[0]?.getSettings().deviceId);
qa.cameraHash=side=>{const v=document.getElementById('camera-'+side+'-video');const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);return c.toDataURL();};
qa.mode=mode=>qa.set('presenterSettings',{...nodecg.Replicant('presenterSettings').value,viewSource:mode});
qa.hold=()=>qa.set('presenterTimeline',{...nodecg.Replicant('presenterTimeline').value,phase:'results-transition',effect:'single-5k'});
qa.reset=()=>qa.set('presenterTimeline',structuredClone(qa.initial.presenterTimeline));
`;
const broker = createRelayBroker();
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/signal') {
      const chunks = []; for await (const c of req) chunks.push(c);
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(broker.request(JSON.parse(Buffer.concat(chunks).toString())))); return;
    }
    const name = new URL(req.url, 'http://localhost').pathname.slice(1);
    if (!/^[\w/.-]+$/.test(name) || name.includes('..')) { res.writeHead(404).end(); return; }
    let body = await readFile(path.join(root, 'bundles/rashinban/graphics', name));
    if (name.endsWith('.html')) body = Buffer.from(body.toString().replace(/<script src="(presenter(?:-capture)?\.js)">/, '<script>' + bootstrap + '</script><script src="$1">'));
    res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'application/javascript' : 'image/jpeg'); res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const profile = path.join(out, 'chrome-' + Date.now()); const pages = []; const errors = []; const checks = [];
const browser = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream=device-count=' + (cameraTest ? 5 : 3) + ',fps=30', 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let debugPort;
async function page(url) {
  const target = await fetch('http://127.0.0.1:' + debugPort + '/json/new?about:blank', { method: 'PUT' }).then(r => r.json());
  const socket = new WebSocket(target.webSocketDebuggerUrl); let id = 0; const pending = new Map();
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) { const p = pending.get(message.id); if (p) { pending.delete(message.id); clearTimeout(p.timer); message.error ? p.reject(Error(message.error.message)) : p.resolve(message.result); } }
    else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  };
  const p = { socket,
    call(method, params = {}) { return new Promise((resolve, reject) => { const n = ++id; const timer = setTimeout(() => { pending.delete(n); reject(Error('CDP timeout ' + method)); }, 10000); pending.set(n, { resolve, reject, timer }); socket.send(JSON.stringify({ id: n, method, params })); }); },
    async eval(expression) { await this.call('Page.bringToFront'); const r = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; },
    async until(expression, label, timeout = 25000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) { if (await this.eval(expression)) { checks.push(label); return; } await delay(100); }
      throw Error(label + ': ' + JSON.stringify(await this.eval("({data:document.body.dataset,setup:document.getElementById('video-setup')?.innerText,status:document.getElementById('relay-status')?.innerText})")));
    },
  };
  pages.push(p); await p.call('Runtime.enable'); await p.call('Page.enable');
  await p.call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await p.call('Page.navigate', { url: base + url }); await p.until("document.readyState==='complete'&&typeof qa!=='undefined'", 'loaded ' + url);
  return p;
}
const camerasReady = "['left','right'].every(side=>document.querySelector('.camera.'+side)?.dataset.state==='ready'&&document.getElementById('camera-'+side+'-video')?.readyState>=2)";
const ready = "['left','right'].every(side=>document.getElementById('capture-'+side)?.dataset.hasFrame==='true')";
try {
  for (let i = 0; i < 100; i++) { try { debugPort = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await delay(100); } }
  if (!debugPort) throw Error('Chrome did not start');
  const owner = await page('/presenter-capture.html?relay=main');
  assert.equal(await owner.eval('qa.requests.length'), 0, 'capture waits for Start');
  await owner.eval("document.getElementById('relay-start').click()");
  await owner.until("document.body.dataset.relayActive==='true'", 'publisher owns relay');
  await owner.until("document.querySelectorAll('#video-left-device option').length===" + (cameraTest ? 6 : 4), 'fake devices available');
  if (cameraTest) {
    assert.equal(await owner.eval("document.querySelectorAll('#video-camera-left-device,#video-camera-right-device').length"), 2, 'capture page offers separate camera input slots');
    await owner.eval("document.getElementById('video-camera-left-device').selectedIndex=4;document.getElementById('video-camera-right-device').selectedIndex=5");
  }
  await owner.eval("document.getElementById('video-left-device').selectedIndex=1;document.getElementById('video-right-device').selectedIndex=3;document.getElementById('video-apply').click()");
  await owner.until('qa.active()===' + inputCount, 'each selected physical input is opened once');
  const cameraIds = cameraTest ? await owner.eval("['camera-left','camera-right'].map(feed=>document.getElementById('video-'+feed+'-preview').srcObject.getVideoTracks()[0].id)") : [];
  const originalIds = await owner.eval("['left','right'].map(side=>document.getElementById('video-'+side+'-preview').srcObject.getVideoTracks()[0].id)");
  const stream = await page('/presenter.html?role=program&videoRelay=main&videoSetup=1&dropOffer=1' + (cameraTest ? '&relayCameras=1' : ''));
  const led = await page('/presenter-led.html?videoRelay=main');
  await stream.until(ready, 'stream recovers from a lost offer acknowledgement');
  assert.equal(await stream.eval('qa.droppedOffers'), 1, 'fault injection drops exactly one offer'); await led.until(ready, 'LED receives both WebRTC tracks');
  if (!cameraTest) assert.equal(await stream.eval("document.querySelectorAll('.camera.key-slot').length"), 2, 'legacy relay URL retains external-camera key regions');
  if (cameraTest) {
    await stream.until(camerasReady, 'stream displays both player cameras');
    assert.deepEqual(await stream.eval("['left','right'].map(side=>{const r=document.querySelector('.camera.'+side).getBoundingClientRect();return [r.x,r.y,r.width,r.height];})"), [[60,756,360,260],[1500,756,360,260]], 'existing camera geometry is preserved');
    assert.deepEqual(await stream.eval('qa.cameraSources()'), cameraIds, 'camera tracks have their own correct side identities');
    assert.equal(await stream.eval("['left','right'].every(side=>document.getElementById('camera-'+side+'-video').muted&&document.getElementById('camera-'+side+'-video').srcObject.getAudioTracks().length===0)"), true, 'relayed cameras are silent');
    await led.until("qa.peers.some(pc=>pc.connectionState==='connected'&&pc.getTransceivers().filter(t=>t.currentDirection==='recvonly').length===2)", 'LED negotiates gameplay only');
  }
  for (const viewer of [stream, led]) {
    assert.equal(await viewer.eval('qa.requests.length'), 0, 'receiver never opens hardware');
    await viewer.eval("document.getElementById('video-find').click()");
    assert.equal(await viewer.eval('qa.requests.length'), 0, 'receiver cannot probe permission');
    await viewer.eval("document.getElementById('video-close').click();qa.before=qa.hash('left')");
    await viewer.until("qa.hash('left')!==qa.before", 'received video advances');
    assert.deepEqual(await viewer.eval('qa.sources()'), originalIds, 'left/right tracks are not reversed');
  }
  assert.equal(await owner.eval('qa.requests.length'), inputCount, 'two viewers reuse the same physical captures');
  if (cameraTest) {
    await owner.eval("qa.originalCamera=document.getElementById('video-camera-left-device').value;document.getElementById('video-camera-left-device').value=document.getElementById('video-left-device').value;document.getElementById('video-apply').click()");
    assert.equal(await owner.eval('qa.requests.length'), inputCount, 'duplicate assignment leaves the active hardware unchanged');
    assert.equal(await owner.eval('qa.active()'), inputCount);
    await owner.eval("document.getElementById('video-camera-left-device').value=qa.originalCamera");
  }
  await owner.eval('qa.dropAnswer=true');
  await led.eval("document.getElementById('video-reconnect').click()");
  await owner.until('qa.droppedAnswers===1', 'lost answer acknowledgement injected');
  await led.until(ready, 'LED recovers from a lost answer acknowledgement');
  const duplicate = await page('/presenter-capture.html?relay=main');
  await duplicate.eval("document.getElementById('relay-start').click()");
  await duplicate.until("document.getElementById('relay-status').textContent.includes('already has')", 'second publisher rejected');
  assert.equal(await duplicate.eval('qa.requests.length'), 0, 'rejected publisher never opens cameras');
  await duplicate.eval("document.getElementById('relay-stop').click()");
  await stream.eval('qa.hold()'); await delay(200); await stream.eval("qa.frozen=qa.hash('left')"); await delay(400);
  assert.equal(await stream.eval("qa.frozen===qa.hash('left')"), true, 'relay pixels freeze during celebration');
  if (cameraTest) {
    await stream.eval("qa.cameraBefore=qa.cameraHash('left')");
    await stream.until("qa.cameraHash('left')!==qa.cameraBefore", 'player cameras stay live during gameplay freezes');
  }
  await led.eval("qa.before=qa.hash('left')"); await led.until("qa.hash('left')!==qa.before", 'LED remains live while stream freezes');
  await stream.eval("qa.reset();qa.mode('rendered')"); await delay(1500);
  assert.equal(await owner.eval('qa.active()'), inputCount, 'disabling one output does not stop physical capture');
  await led.eval("qa.before=qa.hash('left')"); await led.until("qa.hash('left')!==qa.before", 'LED survives stream mode change');
  if (cameraTest) {
    await stream.until(camerasReady, 'cameras remain connected in rendered mode');
    await stream.eval("qa.cameraBefore=qa.cameraHash('left');qa.mode('chroma')");
    await stream.until("qa.cameraHash('left')!==qa.cameraBefore", 'cameras remain live in chroma mode');
  }
  await stream.eval("qa.mode('video')"); await stream.until(ready, 'stream reconnects after mode change');
  await stream.call('Page.reload'); await stream.until(ready, 'stream reload recovers with a lost offer');
  assert.equal(await owner.eval('qa.requests.length'), inputCount, 'viewer reload does not reopen devices');
  await owner.eval("document.getElementById('video-swap').click()");
  await owner.until("['left','right'].every(side=>document.getElementById('video-'+side+'-preview').srcObject?.getVideoTracks()[0]?.readyState==='live')", 'swapped capture tracks active');
  const swappedIds = await owner.eval("['left','right'].map(side=>document.getElementById('video-'+side+'-preview').srcObject.getVideoTracks()[0].id)");
  const swapped = 'JSON.stringify(qa.sources())===' + JSON.stringify(JSON.stringify(swappedIds));
  await stream.until(ready + '&&' + swapped, 'input swap reaches stream with correct sides');
  await led.until(ready + '&&' + swapped, 'input swap reaches LED with correct sides');
  if (cameraTest) {
    const swappedCameras = await owner.eval("['camera-left','camera-right'].map(feed=>document.getElementById('video-'+feed+'-preview').srcObject.getVideoTracks()[0].id)");
    await stream.until(camerasReady + '&&JSON.stringify(qa.cameraSources())===' + JSON.stringify(JSON.stringify(swappedCameras)), 'swap moves camera and gameplay assignments together');
    await owner.eval("document.getElementById('video-camera-left-device').value='';document.getElementById('video-apply').click()");
    await stream.until("document.querySelector('.camera.left').dataset.state!=='ready'&&document.querySelector('.camera.right').dataset.state==='ready'", 'unassigned left camera leaves the right camera available');
    await stream.until(ready, 'missing camera does not hide gameplay');
    await owner.eval("document.getElementById('video-camera-left-device').selectedIndex=5;document.getElementById('video-apply').click()");
    await stream.until(camerasReady, 'camera returns after reassigning input');
  }
  await owner.eval("document.getElementById('video-left-device').value='';document.getElementById('video-apply').click()");
  await owner.until('qa.active()===' + (inputCount - 1), 'one input can remain unassigned');
  await led.until("document.getElementById('capture-left').dataset.hasFrame==='false'&&document.getElementById('capture-right').dataset.hasFrame==='true'", 'missing left input leaves the right feed available');
  await owner.eval("document.getElementById('video-left-device').selectedIndex=3;document.getElementById('video-apply').click()");
  await led.until(ready, 'LED recovers when the missing input returns');
  await stream.until(ready, 'stream recovers when the missing input returns');
  if (cameraTest) {
    await owner.eval("document.getElementById('video-left-device').value='';document.getElementById('video-right-device').value='';document.getElementById('video-apply').click()");
    await owner.until('qa.active()===2', 'camera-only relay opens no gameplay devices');
    await stream.eval("qa.mode('rendered')");
    await stream.until(camerasReady, 'camera-only relay works with rendered gameplay');
    await owner.eval("document.getElementById('video-left-device').selectedIndex=3;document.getElementById('video-right-device').selectedIndex=1;document.getElementById('video-apply').click()");
    await stream.eval("qa.mode('video')");
    await stream.until(ready + '&&' + camerasReady, 'all four feeds return after camera-only operation');
  }
  await owner.eval("document.getElementById('relay-stop').click()");
  await owner.until('qa.active()===0', 'Stop releases all selected capture tracks');
  await led.until("document.getElementById('capture-left').dataset.hasFrame==='false'", 'publisher stop clears receiver pixels');
  if (cameraTest) await stream.until("['left','right'].every(side=>document.getElementById('camera-'+side+'-video').srcObject===null)", 'publisher stop clears both camera videos');
  await stream.until("document.getElementById('video-setup-message').textContent.includes('Waiting for the capture page')", 'setup exposes missing publisher status');
  await owner.eval("document.getElementById('relay-start').click()");
  await stream.until(ready, 'stream reconnects after publisher restart'); await led.until(ready, 'LED reconnects after publisher restart');
  await owner.eval('qa.blockSignal=true');
  await owner.until('qa.active()===0', 'signaling loss releases hardware before takeover');
  await led.until("document.getElementById('capture-left').dataset.hasFrame==='false'", 'signaling loss clears remote gameplay before recovery');
  if (cameraTest) await stream.until("['left','right'].every(side=>document.getElementById('camera-'+side+'-video').srcObject===null)", 'signaling loss clears remote cameras before recovery');
  await owner.eval('qa.blockSignal=false');
  await owner.until('qa.active()===' + inputCount, 'signaling recovery reacquires selected inputs');
  await led.until(ready, 'LED recovers after signaling resumes'); await stream.until(ready, 'stream recovers after signaling resumes');
  if (cameraTest) {
    await stream.until(camerasReady, 'cameras recover after signaling resumes');
    await stream.eval("qa.noOwnership=true;qa.set('presenterClients',{clients:[],program:null})");
    await stream.until("['left','right'].every(side=>document.getElementById('camera-'+side+'-video').srcObject===null)", 'program ownership loss releases camera subscriptions');
    assert.equal(await owner.eval('qa.active()'), 4, 'ownership change does not close capture hardware');
    await stream.eval('qa.noOwnership=false');
    await stream.until(camerasReady, 'camera subscriptions recover with program ownership');
    const cameraPreview = await page('/presenter.html?role=preview&videoRelay=main&relayCameras=1');
    await cameraPreview.eval("document.getElementById('video-reconnect').click()");
    await delay(1200);
    assert.equal(await cameraPreview.eval('qa.relayJoins'), 0, 'preview Reconnect cannot start a subscription');
    assert.equal(await cameraPreview.eval('qa.requests.length'), 0);
    assert.equal(await cameraPreview.eval('qa.peers.length'), 0, 'preview does not join the camera relay');
  }
  const preview = await page('/presenter-led.html?channel=preview&videoRelay=main');
  await delay(1200); assert.equal(await preview.eval('qa.requests.length'), 0);
  assert.equal(await preview.eval("document.getElementById('capture-left').dataset.hasFrame==='true'"), false, 'preview does not subscribe');
  for (const [name, viewer] of [['stream', stream], ['led', led], ['capture', owner]]) {
    if (name !== 'capture') await viewer.eval("document.getElementById('video-close').click()");
    await viewer.call('Page.bringToFront'); await delay(100);
    const shot = await viewer.call('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(out, name + '.png'), Buffer.from(shot.data, 'base64'));
  }
  assert.deepEqual(errors, []);
  const report = { checks, errors, physicalHardware: 'Not tested; Chromium fake devices only', userAgent: await owner.eval('navigator.userAgent') };
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log('WebRTC relay: ' + checks.length + ' checks passed; two receivers, ' + inputCount + ' fake inputs; no uncaught errors.');
} catch (error) {
  const diagnostic = [];
  for (const p of pages) diagnostic.push(await p.eval(`(async()=>({url:location.href,data:{...document.body.dataset},videos:[...document.querySelectorAll('video')].map(v=>({id:v.id,width:v.videoWidth,height:v.videoHeight,ready:v.readyState,paused:v.paused,tracks:v.srcObject?.getTracks().map(t=>({id:t.id,muted:t.muted,state:t.readyState,settings:t.getSettings()}))})),peers:await Promise.all(qa.peers.map(async p=>({state:p.connectionState,signaling:p.signalingState,transceivers:p.getTransceivers().map(t=>({mid:t.mid,direction:t.currentDirection,sender:t.sender.track?.id,receiver:t.receiver.track?.id,muted:t.receiver.track?.muted})),stats:[...await p.getStats()].map(x=>x[1]).filter(x=>['inbound-rtp','outbound-rtp'].includes(x.type))})))}))()`).catch(e=>String(e)));
  await writeFile(path.join(out,'failure.json'),JSON.stringify(diagnostic,null,2));
  throw error;
} finally {
  for (const p of pages) p.socket.close();
  if (browser.exitCode === null) browser.kill(); server.closeAllConnections(); server.close();
}
