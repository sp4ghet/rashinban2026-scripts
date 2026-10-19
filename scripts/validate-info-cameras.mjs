// Actual switcher + WebRTC broker, using synthetic cameras, never production NodeCG.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRelayBroker } from '../bundles/rashinban/src/extension/presenter/video-relay.ts';
import { createInitialState, setPreview, take, revertPreview } from '../bundles/rashinban/src/broadcast/state.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'artifacts/presenter-validation/info-cameras');
await mkdir(out, { recursive: true });
let broadcast = createInitialState();
const broker = createRelayBroker(), subscribers = new Set(), checks = [], errors = [];
const check = (label, actual, expected = true) => { assert.deepEqual(actual, expected, label); checks.push(label); };
const bootstrap = () => `
window.qa={requests:[],streams:[],peers:[],messages:[],initial:{broadcast:${JSON.stringify(broadcast)}}};
const RealPeer=RTCPeerConnection;
window.RTCPeerConnection=class extends RealPeer{constructor(...args){super(...args);qa.peers.push(this);}};
const reps=new Map();
qa.set=(name,value)=>{const rep=nodecg.Replicant(name);rep.value=value;rep.listeners.forEach(fn=>fn(value));};
window.nodecg={
Replicant(name){if(!reps.has(name))reps.set(name,{value:qa.initial[name],listeners:[],on(event,fn){this.listeners.push(fn);queueMicrotask(()=>fn(this.value));}});return reps.get(name);},
async sendMessage(name,body){qa.messages.push(name);return fetch('/message',{method:'POST',body:JSON.stringify({name,body})}).then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error);return v;});}
};
const updates=location.pathname.includes('presenter-capture')?null:new EventSource('/events');
if(updates)updates.onmessage=e=>qa.set('broadcast',JSON.parse(e.data));
addEventListener('pagehide',()=>updates?.close());
const getMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia=async options=>{qa.requests.push(options);if(!location.pathname.includes('presenter-capture'))throw Error('Receiver opened hardware');const stream=await getMedia(options);qa.streams.push(stream);return stream;};
qa.active=()=>qa.streams.flatMap(s=>s.getTracks()).filter(t=>t.readyState==='live').length;
qa.frame=c=>document.querySelector('.monitor[data-channel='+c+'] iframe.info');
qa.doc=c=>qa.frame(c).contentDocument;qa.win=c=>qa.frame(c).contentWindow;
qa.camera=(c,s)=>qa.doc(c).querySelector('.camera.'+s);
qa.showing=(c,s)=>!qa.doc(c).getElementById('layer-player-cameras').hidden&&!qa.camera(c,s).hidden&&qa.camera(c,s).querySelector('.camera-placeholder strong')?.textContent==='Player Camera '+(s==='left'?'1':'2');
qa.button=label=>[...document.querySelectorAll('[data-row=playerCameras] button')].find(b=>b.textContent===label);
`;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write('data:' + JSON.stringify(broadcast) + '\n\n');
      subscribers.add(res); req.on('close', () => subscribers.delete(res)); return;
    }
    if (url.pathname === '/message') {
      const chunks = []; for await (const c of req) chunks.push(c);
      const { name, body } = JSON.parse(Buffer.concat(chunks).toString());
      let result = true;
      if (name === 'presenter:video-relay') result = broker.request(body);
      else if (name === 'interval:clock') result = Date.now();
      else if (name.startsWith('broadcast:')) {
        if (name === 'broadcast:setPreview') broadcast = setPreview(broadcast, body.output, body.patch);
        else if (name === 'broadcast:take') broadcast = take(broadcast, body.output);
        else if (name === 'broadcast:revertPreview') broadcast = revertPreview(broadcast, body.output);
        else throw Error('Unexpected broadcast message: ' + name);
        for (const client of subscribers) client.write('data:' + JSON.stringify(broadcast) + '\n\n');
        result = broadcast;
      }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result)); return;
    }
    const name = decodeURIComponent(url.pathname.slice(1));
    if (!/^[\w/.-]+$/.test(name) || name.includes('..')) { res.writeHead(404).end(); return; }
    let bytes = await readFile(path.join(root, name));
    if (name.endsWith('.html')) bytes = Buffer.from(bytes.toString().replace(/<link[^>]+href="https:[^>]+>/g, '')
      .replace('</head>', '<script>' + bootstrap() + '</script></head>'));
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
    res.setHeader('Content-Type', mime[path.extname(name)] || 'application/octet-stream'); res.end(bytes);
  } catch (error) { res.writeHead(req.url === '/message' ? 400 : 404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port, profile = path.join(out, 'chrome-' + Date.now());
const browser = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream=device-count=3,fps=30', 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let debugPort;
const pages = [];
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
    async eval(expression) { const r = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; },
    async until(expression, label, timeout = 30000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) { if (await this.eval(expression)) { checks.push(label); return; } await delay(100); }
      throw Error(label + ': ' + JSON.stringify(await this.eval("({data:document.body.dataset,status:document.getElementById('relay-status')?.textContent,error:document.getElementById('error')?.textContent,cameras:[...document.querySelectorAll('iframe.info')].map(f=>f.contentDocument?.getElementById('layer-player-cameras')?.outerHTML)})")));
    },
    async screenshot(name) { const r = await this.call('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(out, name + '.png'), Buffer.from(r.data, 'base64')); },
  };
  pages.push(p); await p.call('Runtime.enable'); await p.call('Page.enable');
  await p.call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await p.call('Page.navigate', { url: base + url });
  await p.until("document.readyState==='complete'&&typeof qa!=='undefined'", 'loaded ' + url); return p;
}
try {
  for (let i = 0; i < 100; i++) { try { debugPort = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await delay(100); } }
  if (!debugPort) throw Error('Chrome did not start');
  const owner = await page('/bundles/rashinban/graphics/presenter-capture.html?relay=main');
  await owner.eval("document.getElementById('relay-start').click()");
  await owner.until("document.querySelectorAll('#video-camera-left-device option').length===4", 'fake cameras listed');
  await owner.eval("document.getElementById('video-camera-left-device').selectedIndex=1;document.getElementById('video-camera-right-device').selectedIndex=3;document.getElementById('video-apply').click()");
  await owner.until('qa.active()===2', 'two camera inputs opened once');
  const cameraIds = await owner.eval("['camera-left','camera-right'].map(f=>document.getElementById('video-'+f+'-preview').srcObject.getVideoTracks()[0].id)");
  const panel = await page('/bundles/rashinban/dashboard/switcher-stream.html');
  await panel.until("['preview','program'].every(c=>qa.doc(c)?.getElementById('layer-player-cameras'))", 'both dashboard info monitors loaded');
  check('switcher monitors never subscribe to the camera relay', await panel.eval("['preview','program'].every(c=>qa.win(c).qa.messages.filter(n=>n==='presenter:video-relay').length===0)"));
  check('switcher monitors have no camera video elements', await panel.eval("['preview','program'].every(c=>qa.doc(c).querySelectorAll('#layer-player-cameras video').length===0)"));
  const program = await page('/bundles/rashinban/graphics/info-stream.html');
  const programReady = "['left','right'].every(s=>document.querySelector('.camera.'+s).dataset.state==='ready'&&document.getElementById('camera-'+s+'-video').readyState>=2)";
  await program.until(programReady, 'actual Program graphic preloads both hidden cameras', 8000);
  check('preloading keeps actual Program transparent', await program.eval("document.getElementById('layer-player-cameras').hidden"));
  await owner.until("qa.peers.filter(pc=>pc.connectionState==='connected').length===1", 'only actual output is a camera receiver');
  const monitorWarmFrames = "(()=>{qa.originalVideos=[...document.querySelectorAll('#layer-player-cameras video')].map(v=>v.srcObject);qa.coldFrames=[];qa.visibleChecks=0;qa.checkFrame=()=>{const host=document.getElementById('layer-player-cameras');for(const slot of host.querySelectorAll('.camera')){const video=slot.querySelector('video');if(!host.hidden&&!slot.hidden){qa.visibleChecks++;if(slot.dataset.state!=='ready'||video.readyState<2||video.paused)qa.coldFrames.push({side:slot.className,state:slot.dataset.state,ready:video.readyState});}}};qa.frameObserver=new MutationObserver(qa.checkFrame);qa.frameObserver.observe(document.getElementById('layer-player-cameras'),{subtree:true,attributes:true,attributeFilter:['hidden','data-state']});qa.checkFrames=()=>{qa.checkFrame();qa.raf=requestAnimationFrame(qa.checkFrames);};qa.checkFrames();})()";
  await program.eval(monitorWarmFrames);
  await panel.eval("qa.button('Player Camera 1').click()");
  await panel.until("qa.showing('preview','left')", 'camera 1 placeholder appears in dashboard Preview');
  check('camera 1 placeholder is full screen', await panel.eval("(()=>{const r=qa.camera('preview','left').getBoundingClientRect();return [r.x,r.y,r.width,r.height];})()"), [0,0,1920,1080]);
  check('Preview leaves Program monitor transparent', await panel.eval("qa.doc('program').getElementById('layer-player-cameras').hidden"));
  check('Preview leaves actual Program transparent', await program.eval("document.getElementById('layer-player-cameras').hidden"));
  check('actual output only negotiates camera tracks', await program.eval("qa.peers.some(pc=>pc.connectionState==='connected'&&pc.getTransceivers().map(t=>t.currentDirection).join(',')==='inactive,inactive,recvonly,recvonly')"));
  await panel.eval("document.getElementById('take').click()");
  await panel.until("qa.showing('program','left')", 'TAKE puts camera 1 placeholder on Program monitor');
  await program.until("!document.getElementById('layer-player-cameras').hidden&&!document.querySelector('.camera.left').hidden", 'TAKE reveals actual camera 1');
  check('actual Program receives camera 1 identity', await program.eval("document.getElementById('camera-left-video').srcObject.getVideoTracks()[0].getSettings().deviceId"), cameraIds[0]);
  await program.eval("qa.hashVideo=()=>{const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;canvas.getContext('2d').drawImage(document.getElementById('camera-left-video'),0,0,160,90);return canvas.toDataURL();};qa.before=qa.hashVideo()");
  await program.until('qa.hashVideo()!==qa.before', 'actual camera pixels advance');
  await panel.eval("qa.button('Player Camera 2').click()");
  await panel.until("qa.showing('preview','right')&&qa.camera('preview','left').hidden", 'camera 2 replaces camera 1 placeholder in Preview');
  check('Program stays on camera 1 while camera 2 is staged', await panel.eval("qa.showing('program','left')&&qa.camera('program','right').hidden"));
  check('actual Program stays on camera 1 while camera 2 is staged', await program.eval("!document.querySelector('.camera.left').hidden&&document.querySelector('.camera.right').hidden"));
  check('camera 2 placeholder is full screen', await panel.eval("(()=>{const r=qa.camera('preview','right').getBoundingClientRect();return [r.x,r.y,r.width,r.height];})()"), [0,0,1920,1080]);
  await panel.screenshot('camera-2-preview-camera-1-program');
  await panel.eval("document.getElementById('revert').click()");
  await panel.until("qa.showing('preview','left')&&qa.camera('preview','right').hidden", 'Revert restores camera 1 placeholder');
  await panel.eval("qa.button('Player Camera 2').click()");
  await panel.until("qa.showing('preview','right')", 'camera 2 can be selected again');
  await panel.eval("document.getElementById('take').click()");
  await panel.until("qa.showing('program','right')", 'TAKE puts camera 2 placeholder on Program monitor');
  await program.until("!document.querySelector('.camera.right').hidden&&document.querySelector('.camera.right').dataset.state==='ready'", 'standalone info-stream reveals the warm camera');
  check('actual Program receives camera 2 identity', await program.eval("document.getElementById('camera-right-video').srcObject.getVideoTracks()[0].getSettings().deviceId"), cameraIds[1]);
  check('actual Program switches preserve the original video streams', await program.eval("[...document.querySelectorAll('#layer-player-cameras video')].every((v,i)=>v.srcObject===qa.originalVideos[i])"));
  check('camera switches do not renegotiate', await program.eval('qa.peers.length'), 1);
  check('transition monitor sampled actual Program camera', await program.eval('qa.visibleChecks>0'));
  check('no unavailable frames in actual Program transitions', await program.eval('qa.coldFrames'), []);
  check('camera videos are silent', await program.eval("[...document.querySelectorAll('#layer-player-cameras video')].every(v=>v.muted&&v.srcObject.getAudioTracks().length===0)"));
  check('physical captures opened only once', await owner.eval('qa.requests.length'), 2);
  check('receivers never request physical cameras', await panel.eval("qa.requests.length===0&&['preview','program'].every(c=>qa.win(c).qa.requests.length===0)"));
  // Use a real nameplate now that the always-visible caster title bar is retired.
  const casterFixture = JSON.stringify([{name:'Test caster',role:'Caster',twitter:''}]);
  await program.eval("qa.set('casters',"+casterFixture+")");
  await panel.eval("for(const channel of ['preview','program'])qa.win(channel).qa.set('casters',"+casterFixture+")");
  await panel.eval("nodecg.sendMessage('broadcast:setPreview',{output:'stream',patch:{casters:{slots:[true,true],names:{left:'Test caster',right:'Test caster'}}}})");
  await panel.eval("nodecg.sendMessage('broadcast:take',{output:'stream'})");
  await program.until("document.querySelector('#caster-1').dataset.visible==='true'", 'caster nameplate appears above live camera');
  await panel.until("qa.doc('preview').querySelector('#caster-1').dataset.visible==='true'", 'caster nameplate appears above preview camera');
  await program.eval("document.querySelector('#casters').getAnimations({subtree:true}).forEach(a=>a.finish())");
  await panel.eval("qa.doc('preview').querySelector('#casters').getAnimations({subtree:true}).forEach(a=>a.finish())");
  const overlayAboveCamera = selector => "(()=>{for(const e of document.querySelectorAll('.layer,.layer *'))e.style.pointerEvents='auto';const card=document.querySelector('#caster-1 .name'),r=card.getBoundingClientRect(),stack=document.elementsFromPoint(r.x+r.width/2,r.y+r.height/2);return stack.indexOf(card)>=0&&stack.indexOf(card)<stack.indexOf(document.querySelector("+JSON.stringify(selector)+"));})()";
  check('caster overlay paints above actual camera', await program.eval(overlayAboveCamera('.camera.right video')));
  check('caster overlay paints above dashboard placeholder', await panel.eval('qa.win("preview").eval('+JSON.stringify(overlayAboveCamera('.camera.right .camera-placeholder'))+')'));
  await program.screenshot('camera-2-under-stream-overlays');
  await owner.eval("document.getElementById('relay-stop').click()");
  await program.until("!document.getElementById('camera-right-video').srcObject", 'publisher stop clears stale output frames');
  check('placeholder remains labeled when relay is unavailable', await panel.eval("qa.showing('preview','right')&&qa.showing('program','right')"));
  await owner.eval("document.getElementById('relay-start').click()");
  await program.until(programReady, 'actual output reconnects after publisher restart');
  await panel.eval("qa.button('Player Camera 2').click()");
  await panel.until("qa.doc('preview').getElementById('layer-player-cameras').hidden", 'hiding cameras clears Preview placeholder');
  check('Program stays selected until TAKE', await panel.eval("qa.showing('program','right')"));
  await panel.eval("document.getElementById('take').click()");
  await panel.until("qa.doc('program').getElementById('layer-player-cameras').hidden", 'TAKE hides Program placeholder');
  await program.until("document.getElementById('layer-player-cameras').hidden&&"+programReady, 'actual Program keeps both hidden cameras ready');
  await program.eval('qa.coldFrames=[];qa.previousChecks=qa.visibleChecks');
  await panel.eval("qa.button('Player Camera 1').click()");
  await panel.until("!nodecg.Replicant('broadcast').value.stream.program.playerCameras.left&&qa.showing('preview','left')", 'hidden camera can be staged again');
  await panel.eval("document.getElementById('take').click()");
  await program.until("!document.getElementById('layer-player-cameras').hidden&&!document.querySelector('.camera.left').hidden", 'TAKE reveals the retained Program camera');
  await program.until('qa.visibleChecks>qa.previousChecks', 'actual Program reenable was sampled');
  check('reenabling a hidden camera has no cold frames', await program.eval('qa.coldFrames'), []);
  const alternate = await page('/bundles/rashinban/graphics/presenter-capture.html?relay=stage-2');
  await alternate.eval("document.getElementById('relay-start').click()");
  await alternate.until("document.querySelectorAll('#video-camera-left-device option').length===4", 'alternate room lists inputs');
  await alternate.eval("document.getElementById('video-camera-left-device').selectedIndex=3;document.getElementById('video-apply').click()");
  await alternate.until('qa.active()===1', 'alternate relay has its camera');
  const alternateId = await alternate.eval("document.getElementById('video-camera-left-preview').srcObject.getVideoTracks()[0].id");
  await panel.eval("{const field=document.querySelector('[data-row=playerCameras] input');field.value='stage-2';field.dispatchEvent(new Event('change'));}");
  await panel.until("nodecg.Replicant('broadcast').value.stream.preview.playerCameras.relay==='stage-2'", 'new relay source staged');
  check('relay change leaves Preview placeholder visible', await panel.eval("qa.showing('preview','left')"));
  check('relay change leaves actual Program source intact', await program.eval("nodecg.Replicant('broadcast').value.stream.program.playerCameras.relay"), 'main');
  await panel.eval("document.getElementById('take').click()");
  await program.until("document.getElementById('camera-left-video').srcObject?.getVideoTracks()[0]?.getSettings().deviceId==="+JSON.stringify(alternateId), 'TAKE switches actual Program relay');
  await panel.eval("qa.button('Player Camera 2').click()");
  await panel.until("qa.showing('preview','right')", 'unassigned camera still has selection placeholder');
  await panel.eval("document.getElementById('take').click()");
  await program.until("!document.querySelector('.camera.right').hidden&&document.querySelector('.camera.right').dataset.state!=='ready'", 'actual output shows unavailable state for an unassigned camera');
  await alternate.eval("document.getElementById('video-camera-right-device').selectedIndex=1;document.getElementById('video-apply').click()");
  await program.until(programReady, 'newly assigned camera recovers without output reload');
  check('dashboard adds no camera subscriptions across all actions', await panel.eval("['preview','program'].every(c=>qa.win(c).qa.peers.length===0&&qa.win(c).qa.messages.filter(n=>n==='presenter:video-relay').length===0&&qa.doc(c).querySelectorAll('#layer-player-cameras video').length===0)"));
  await program.eval("qa.retainedTracks=[...document.querySelectorAll('#layer-player-cameras video')].flatMap(v=>v.srcObject.getTracks());dispatchEvent(new Event('pagehide'))");
  check('unloading releases the warm subscriptions', await program.eval("qa.retainedTracks.every(t=>t.readyState==='ended')&&qa.peers.every(pc=>pc.connectionState==='closed')"));
  await program.call('Page.navigate', { url: 'about:blank' });
  const livePreview = await page('/bundles/rashinban/graphics/info-stream.html?channel=preview');
  await livePreview.until(programReady, 'standalone Preview without placeholder mode still receives live cameras');
  check('no runtime exceptions', errors, []);
  await writeFile(path.join(out,'report.json'), JSON.stringify({checks,errors},null,2)+'\n');
  console.log(JSON.stringify({passed:checks.length,out}));
} catch(error) {
  await writeFile(path.join(out,'failure.json'), JSON.stringify({message:error.message,stack:error.stack,checks,errors},null,2)); throw error;
} finally {
  for(const p of pages){try{await p.call('Page.navigate',{url:'about:blank'});}catch{}}
  try{await pages[0]?.call('Browser.close');}catch{}
  for(const p of pages)p.socket.close();
  browser.kill(); for(const res of subscribers)res.end();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
