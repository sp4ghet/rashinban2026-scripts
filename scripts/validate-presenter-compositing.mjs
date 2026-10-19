// Isolated built-page checks with a controlled presenter clock. No live game,
// camera, Google API or NodeCG runtime is changed by this script.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createMediaRouter } from '../bundles/rashinban/src/extension/config/assets.ts';
import { applySnapshot } from '../bundles/rashinban/src/presenter/normalize.ts';
import { seedViews } from '../bundles/rashinban/src/presenter/telemetry.ts';
import { advanceTimeline, DEFAULT_TIMING } from '../bundles/rashinban/src/presenter/timeline.ts';
import { DEFAULT_SETTINGS } from '../bundles/rashinban/src/presenter/settings.ts';
import { EMPTY_INTERMISSION, updateIntermission } from '../bundles/rashinban/src/presenter/intermission.ts';

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
  presenterSeries: { id: 'motion-qa', source: 'manual', left: { id: 'a', name: 'PLAYER LEFT', handle: '@playerleft', wins: 1, playerId: state.players[0].id },
    right: { id: 'b', name: 'PLAYER RIGHT', handle: '@playerright', wins: 2, playerId: state.players[1].id } },
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
const media = express();
media.use('/rashinban/media', createMediaRouter({ appRoot: root, sharedRoot: root, isWorktree: false }));
const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/rashinban/media/')) { media(req, res); return; }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const file = path.resolve(root, 'bundles/rashinban/graphics', '.' + url.pathname);
    if (!file.startsWith(path.join(root, 'bundles/rashinban/graphics') + path.sep)) throw Error('Invalid path');
    let data = await readFile(file);
    if (file.endsWith('.html')) data = data.toString().replace('<script src="presenter.js">', `<script>${bootstrap}</script><script src="presenter.js">`);
    res.setHeader('Content-Type', { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream');
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
    for (let i=0;i<100;i++) { if(await evaluate(`document.getElementById('timer-value')?.textContent==='00:39'`))break;await delay(100); }
    if (led) {
      for (let i=0;i<100;i++) { if(await evaluate(`document.querySelector('.backdrop video')?.readyState>=2`))break;await delay(100); }
      const kv=await evaluate(`(()=>{qa.kv=document.querySelector('.backdrop video');const v=qa.kv,r=v.getBoundingClientRect();return {src:new URL(v.currentSrc).pathname,muted:v.muted,loop:v.loop,autoplay:v.autoplay,inline:v.playsInline,paused:v.paused,ready:v.readyState>=2,width:v.videoWidth,height:v.videoHeight,fit:getComputedStyle(v).objectFit,rect:{x:r.x,y:r.y,width:r.width,height:r.height},time:v.currentTime};})()`);
      assert.equal(kv.src,'/rashinban/media/background/presenter-led-kv.mp4');
      assert.equal(kv.muted,true);assert.equal(kv.loop,true);assert.equal(kv.autoplay,true);assert.equal(kv.inline,true);
      assert.equal(kv.paused,false);assert.equal(kv.ready,true);assert.ok(kv.width>0&&kv.height>0);
      assert.equal(kv.fit,'cover');assert.deepEqual(kv.rect,{x:0,y:0,width:1920,height:576});
      await delay(300);
      assert.ok(await evaluate(`qa.kv.currentTime>${kv.time}`),'KV frames advance');
      await evaluate(`qa.kv.currentTime=qa.kv.duration-.15`);
      for (let i=0;i<50;i++) { if(await evaluate(`!qa.kv.seeking&&qa.kv.currentTime<1`))break;await delay(100); }
      assert.equal(await evaluate(`!qa.kv.paused&&!qa.kv.ended&&qa.kv.currentTime<1`),true,'KV loops at the end');
      checks.push('LED: the actual loop_002 MP4 decodes, plays silently and loops inside the 1920x576 band');
    } else {
      assert.equal(await evaluate(`document.querySelector('.backdrop video')`),null);
      assert.match(await evaluate(`getComputedStyle(document.querySelector('.backdrop')).backgroundImage`),/presenter-kv\.jpg/);
      checks.push('stream: original static KV image retained without a background video');
    }
    const viewY=led ? 300 : 400, cameraY=led ? 800 : 900;
    await evaluate(`qa.live('NM','chroma','none');qa.set('presenterSettings',{...qa.initial.presenterSettings,viewSource:'chroma',keyColor:'transparent'})`);
    await settle();
    const livePixels = await pixels([[100,viewY],[1800,viewY],[960,led?20:180],[300,cameraY],[1600,cameraY]]);
    transparent(livePixels[0]); transparent(livePixels[1]); opaque(livePixels[2]);
    if(!led){transparent(livePixels[3]);transparent(livePixels[4]);}
    await screenshot(output+'-transparent-live',led);
    checks.push(output+': gameplay holes have zero alpha while the header stays opaque');

    // The cutout must end underneath the solid frame. Sharing its outer curve
    // creates a translucent seam that exposes OBS footage outside the window.
    const edgePoints=await evaluate(`['left-window','right-window'].flatMap(id=>{
      const e=document.getElementById(id),r=e.getBoundingClientRect(),radius=parseFloat(getComputedStyle(e).borderTopLeftRadius),points=[];
      if (!radius) return points;
      for(const [cx,cy,start] of [[r.x+radius,r.y+radius,180],[r.right-radius,r.y+radius,270],[r.right-radius,r.bottom-radius,0],[r.x+radius,r.bottom-radius,90]])
        for(let a=start;a<=start+90;a+=5)points.push([Math.floor(cx+(radius-.25)*Math.cos(a*Math.PI/180)),Math.floor(cy+(radius-.25)*Math.sin(a*Math.PI/180))]);
      return points;
    })`);
    const edgePixels=await pixels(edgePoints);
    let timerPixels=[];
    {
      await evaluate(`qa.now=${epoch+33000}`);await settle();
      const timer=await evaluate(`qa.rect('timer')`);
      timerPixels=await pixels([[Math.floor(timer.x+timer.width-2),timer.y+39],[Math.floor(timer.x+timer.width*.7),timer.y+2],[Math.floor(timer.x+timer.width/2),timer.y+timer.height-2]]);
      await screenshot(output+'-timer-six-seconds',led);
      await evaluate(`qa.now=${epoch}`);await settle();
    }
    assert.deepEqual({translucentFramePixels:edgePixels.filter(rgba=>rgba[3]!==255).length,timerBackground:timerPixels},
      {translucentFramePixels:0,timerBackground:Array(3).fill([17,20,33,255])},
      'Frame edges must remain opaque; the receded timer outline must reveal the full-size pill background');
    checks.push(output+': rounded frame edges stay opaque and the timer keeps its complete silhouette');

    await evaluate(`qa.live('NM','chroma','left');qa.set('presenterSettings',{...qa.initial.presenterSettings,viewSource:'chroma',keyColor:'transparent'})`);
    await settle();
    const label=await evaluate(`qa.rect('left-lock')`);
    const labelPoints=[];
    for(let y=Math.ceil(label.y);y<label.y+label.height;y+=2)
      for(let x=Math.ceil(label.x);x<label.x+label.width;x+=2) labelPoints.push([x,y]);
    const labelAlpha=(await pixels(labelPoints)).map(rgba=>rgba[3]);
    assert.equal(Math.max(...labelAlpha),255,'Lock text should render at full opacity');
    assert.equal(Math.min(...labelAlpha),102,'Lock text should have only the full-window overlay behind it');
    const lockedPixels=await pixels([[100,viewY],[1800,viewY]]);
    assert.deepEqual(lockedPixels[0],led ? [0,0,0,102] : [255,255,255,102],'Locked window should have a 40% overlay');
    transparent(lockedPixels[1]);
    await screenshot(output+'-transparent-lock',led);
    checks.push(output+': full-opacity lock text over a 40% window overlay; unlocked feed stays transparent');

    await evaluate(`qa.live('NM','chroma','none');qa.set('presenterSettings',{...qa.initial.presenterSettings,viewSource:'chroma',keyColor:'transparent'});const next=structuredClone(qa.initial.presenterDuel);next.rounds[0].startAtMs=qa.now+60000;qa.set('presenterDuel',next);qa.set('presenterTimeline',{...qa.initial.presenterTimeline,phase:'pre-round'});`);
    await settle();
    assert.equal(await evaluate(`document.getElementById('preview-area').hidden`),false);
    const preview=await pixels([[960,viewY],[100,viewY],[300,cameraY],[1600,cameraY]]);
    opaque(preview[0]);opaque(preview[1]);
    if(!led){transparent(preview[2]);transparent(preview[3]);}
    assert.notDeepEqual(preview[0].slice(0,3),[255,0,255]);
    if(led) assert.equal(await evaluate(`getComputedStyle(document.getElementById('preview-map')).display`),'none');
    await screenshot(output+'-transparent-preview',led);
    checks.push(output+': preview content and KV backdrop stay opaque with transparent camera holes');

    const result=structuredClone(state);
    result.players.forEach((p,i)=>{p.results=[{round:result.round,score:i?3200:4500,bestGuess:null,healthBefore:6000,healthAfter:i?4700:6000,damageDealt:i?0:1300,multiplier:1}];});
    const timing=advanceTimeline(null,result,epoch,false,DEFAULT_TIMING);
    await evaluate(`qa.set('presenterDuel',${JSON.stringify(result)});qa.set('presenterTimeline',${JSON.stringify(timing)});qa.now=${timing.revealAtMs+8000};`);
    await settle();
    assert.equal(await evaluate(`document.getElementById('results-area').hidden`),false);
    const results=await pixels([[960,500],[300,cameraY],[1600,cameraY],[100,viewY]]);
    opaque(results[0]);opaque(results[3]);
    const surroundings=await pixels([[100,200],[1820,200],[10,570]]);
    surroundings.forEach(opaque);
    if(led) {
      assert.equal(await evaluate(`document.querySelector('.backdrop video')===qa.kv&&!qa.kv.paused&&qa.kv.muted`),true);
      // Confirm the opaque backdrop pixels come from the playing video.
      await evaluate(`qa.kv.style.visibility='hidden'`);
      (await pixels([[100,200],[1820,200]])).forEach(rgba=>assert.ok(rgba[3]<255));
      await evaluate(`qa.kv.style.visibility=''`);
    }
    if(!led){transparent(results[1]);transparent(results[2]);}
    await screenshot(output+'-transparent-results',led);
    checks.push(output+': results retain the KV backdrop and preserve camera alpha over the map');

    if(!led){
      await evaluate(`document.querySelectorAll('.camera').forEach(el=>{el.classList.remove('key-slot');el.classList.add('relay-camera')});`);
      await settle();
      const cameras=await pixels([[300,cameraY],[1600,cameraY]]);cameras.forEach(opaque);
      checks.push('stream: relayed camera regions remain opaque');
    }
    const finished = { ...result, status: 'Finished', winnerTeamId: result.players[0].teamId };
    const finalTiming = advanceTimeline(null, finished, epoch, true, DEFAULT_TIMING);
    const between = updateIntermission(EMPTY_INTERMISSION, finished, initial.presenterSeries);
    await evaluate(`qa.set('presenterDuel',${JSON.stringify(finished)});qa.set('presenterTimeline',${JSON.stringify(finalTiming)});qa.set('presenterIntermission',${JSON.stringify(between)});`);
    await settle();
    if (led) {
      assert.equal(await evaluate(`document.body.dataset.intermission`),'end-of-last-game');
      assert.equal(await evaluate(`document.querySelectorAll('.camera').length`),2);
      await evaluate(`qa.cameraNodes=[...document.querySelectorAll('.camera')].map((el,i)=>{
        const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
        const ctx=canvas.getContext('2d');ctx.fillStyle=i?'#34212b':'#1b3049';ctx.fillRect(0,0,1920,1080);
        ctx.strokeStyle=i?'#f05060':'#458af2';ctx.lineWidth=10;ctx.beginPath();ctx.arc(960,440,210,0,Math.PI*2);ctx.stroke();
        ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font='48px sans-serif';ctx.fillText(i?'RIGHT CAMERA':'LEFT CAMERA',960,760);
        const video=el.querySelector('video');video.srcObject=canvas.captureStream(1);el.dataset.state='ready';return video;
      });`);
      const header = () => evaluate(`['.competitor.left','.competitor.right','.match-info','.health.left','.health.right','#left-wins','#right-wins'].map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect(),style=getComputedStyle(e);return {x:r.x,y:r.y,width:r.width,height:r.height,display:style.display};})`);
      const expectedHeader = await header();
      assert.equal(expectedHeader[0].y,0);assert.equal(expectedHeader[0].height,54);
      assert.equal(expectedHeader[1].y,0);assert.equal(expectedHeader[1].height,54);
      expectedHeader.forEach(r=>assert.notEqual(r.display,'none','Keep the complete LED header'));
      for (const [view,winner] of [['before-game',null],['end-of-last-game',initial.presenterSeries.left.id],['end-of-last-game',initial.presenterSeries.right.id],['end-of-last-game',null]]) {
        await evaluate(`qa.set('presenterIntermission',{...nodecg.Replicant('presenterIntermission').value,view:'${view}',lastGame:{...nodecg.Replicant('presenterIntermission').value.lastGame,winnerCompetitorId:${JSON.stringify(winner)},draw:${winner===null}}})`);
        await settle();
        const cameras=await evaluate(`[...document.querySelectorAll('.camera')].map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,display:getComputedStyle(e).display,fit:getComputedStyle(e.querySelector('video')).objectFit};})`);
        assert.deepEqual(cameras,[{x:0,y:36,width:960,height:540,display:'block',fit:'cover'},{x:960,y:36,width:960,height:540,display:'block',fit:'cover'}]);
        assert.deepEqual(await header(),expectedHeader,'No corner identities or winner-sized camera panels on LED');
        assert.equal(await evaluate(`document.getElementById('summary-area').hidden`),true);
        assert.equal(await evaluate(`document.querySelector('.pregame-symbol').getBoundingClientRect().y+document.querySelector('.pregame-symbol').getBoundingClientRect().height/2`),288);
        const samples=await pixels([[957,100],[962,100],[970,5],[100,400],[1800,400],[100,700]]);
        assert.deepEqual(samples.slice(0,3),[[255,48,48,255],[255,48,48,255],[255,255,255,255]]);
        // Captured video passes through a color conversion; allow rounding in RGB.
        for (const [index,expected] of [[3,[27,48,73]],[4,[52,33,43]]]) {
          opaque(samples[index]);expected.forEach((channel,i)=>assert.ok(Math.abs(samples[index][i]-channel)<=3));
        }
        transparent(samples[5]);
        await screenshot('led-'+view+'-'+(winner??'draw'),true);
      }
      assert.equal(await evaluate(`qa.cameraNodes.every((v,i)=>v===document.querySelectorAll('.camera video')[i]&&v.srcObject.active&&v.muted)`),true);
      // A lobby with no duel retains the selected camera view and header names.
      await evaluate(`qa.set('presenterDuel',null);qa.set('presenterIntermission',{...nodecg.Replicant('presenterIntermission').value,view:'before-game'})`);await settle();
      assert.equal(await evaluate(`document.body.dataset.intermission`),'before-game');
      assert.equal(await evaluate(`document.getElementById('left-name').textContent`),initial.presenterSeries.left.name);
      checks.push('LED: before/after-game cameras stay 50/50 behind the full header, with the stream seam and compass, no corner names, and persistent silent videos');
    } else {
      // A 1920x1080 chart makes centre cropping and aspect distortion visible.
      await evaluate(`qa.cameraNodes=[...document.querySelectorAll('.camera')].map((el,i)=>{
        const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
        const ctx=canvas.getContext('2d');ctx.fillStyle=i?'#34212b':'#1b3049';ctx.fillRect(0,0,1920,1080);
        ctx.strokeStyle='#ffffff22';ctx.lineWidth=2;for(let x=0;x<1920;x+=120){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,1080);ctx.stroke();}
        ctx.strokeStyle=i?'#f05060':'#458af2';ctx.lineWidth=10;ctx.beginPath();ctx.arc(960,440,210,0,Math.PI*2);ctx.stroke();
        ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font='48px sans-serif';ctx.fillText(i?'RIGHT CAMERA':'LEFT CAMERA',960,760);ctx.font='30px sans-serif';ctx.fillText('1920 × 1080 · centre crop',960,810);
        const video=document.createElement('video');video.muted=true;video.autoplay=true;video.srcObject=canvas.captureStream(1);el.replaceChildren(video);el.dataset.state='ready';return video;
      });`);
      await settle();
      const rects=()=>evaluate(`[...document.querySelectorAll('.camera')].map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,fit:getComputedStyle(e.querySelector('video')).objectFit,position:getComputedStyle(e.querySelector('video')).objectPosition}})`);
      let cameras=await rects();
      assert.equal(cameras[0].width,1049);assert.equal(cameras[1].width,717);
      cameras.forEach(r=>{assert.equal(r.y,65);assert.equal(r.height,951);});
      assert.equal(cameras[0].x,60);assert.equal(cameras[1].x,1143);
      cameras.forEach(r=>{assert.equal(r.fit,'cover');assert.equal(r.position,'50% 50%');assert.ok(r.x>=0&&r.x+r.width<=1920&&r.y+r.height<=1080);});
      assert.equal(await evaluate(`document.getElementById('summary-area').hidden`),true);
      assert.equal(await evaluate(`document.getElementById('camera-scene-label').textContent`),'WINNER');
      await screenshot('stream-post-game-left');
      checks.push('stream: post-game panels match the design geometry; both 16:9 inputs crop at their centre');

      await evaluate(`qa.set('presenterIntermission',{...nodecg.Replicant('presenterIntermission').value,view:'before-game'})`);
      await settle();cameras=await rects();
      cameras.forEach(r=>{assert.equal(r.width,960);assert.equal(r.height,1080);assert.equal(r.y,0);});
      assert.equal(cameras[0].x,0);assert.equal(cameras[1].x,960);
      assert.equal(cameras[0].x+cameras[0].width,cameras[1].x);
      assert.equal(await evaluate(`getComputedStyle(document.getElementById('camera-scene-label')).display`),'none');
      await screenshot('stream-before-game');
      checks.push('stream: Before-Game cameras cover the screen edge to edge with no outer margins or gap');

      await evaluate(`qa.set('presenterIntermission',{...nodecg.Replicant('presenterIntermission').value,view:'end-of-last-game',lastGame:{...nodecg.Replicant('presenterIntermission').value.lastGame,winnerCompetitorId:qa.initial.presenterSeries.right.id}})`);
      await settle();cameras=await rects();
      assert.equal(cameras[0].width,717);assert.equal(cameras[1].width,1049);
      assert.equal(cameras[0].x,60);assert.equal(cameras[1].x,811);
      await screenshot('stream-post-game-right');
      checks.push('stream: a right-side winner mirrors the dominant camera layout');

      await evaluate(`qa.set('presenterIntermission',{...nodecg.Replicant('presenterIntermission').value,lastGame:{...nodecg.Replicant('presenterIntermission').value.lastGame,winnerCompetitorId:null,draw:true}})`);
      await settle();cameras=await rects();
      assert.equal(cameras[0].width,cameras[1].width);
      assert.equal(await evaluate(`document.getElementById('camera-scene-label').textContent`),'DRAW');
      assert.equal(await evaluate(`qa.cameraNodes.every((v,i)=>v===document.querySelectorAll('.camera video')[i]&&v.srcObject.active)`),true);
      checks.push('stream: draws are balanced and all scene switches preserve the video elements and streams');
    }
    (await pixels([[10,led?700:570],[1910,led?700:570]])).forEach(led?transparent:opaque);
    if(led) assert.equal(await evaluate(`document.querySelector('.backdrop video')===qa.kv&&!qa.kv.paused&&qa.kv.muted`),true);
    else assert.match(await evaluate(`getComputedStyle(document.querySelector('.backdrop')).backgroundImage`),/presenter-kv\.jpg/);
    checks.push(output+': intermission retains its KV background; the area below the LED band stays transparent');
    await evaluate(`qa.live('NM','chroma','none');qa.set('presenterSettings',{...qa.initial.presenterSettings,viewSource:'chroma',keyColor:'#00ff00'})`);
    await settle();
    if(!led){
      assert.equal(await evaluate(`document.body.dataset.intermission`),'none');
      assert.equal(await evaluate(`document.querySelector('.camera').getBoundingClientRect().width`),374);
      checks.push('stream: gameplay automatically restores the normal camera dock');
    } else {
      assert.equal(await evaluate(`document.body.dataset.intermission`),'none');
      assert.equal(await evaluate(`[...document.querySelectorAll('.camera')].every(e=>getComputedStyle(e).display==='none')`),true);
      checks.push('LED: gameplay hides both intermission cameras and restores the existing player views');
    }
    const keyed=await pixels([[100,viewY],[1800,viewY]]);
    keyed.forEach(rgba=>assert.deepEqual(rgba,[0,255,0,255]));
    checks.push(output+': switching back to green restores opaque key windows');
  }
  assert.deepEqual(errors, [], 'uncaught browser errors');
  await writeFile(path.join(artifacts,'report.json'),JSON.stringify({checks,errors},null,2));
  console.log(JSON.stringify({checks:checks.length,errors:errors.length,artifacts},null,2));
} finally {
  socket?.close(); chrome.kill(); await new Promise(resolve=>server.close(resolve));
}
