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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts/presenter-validation/motion');
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
  matchResolved: { id: 'motion-qa', label: 'GRAND FINALS' },
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
media.use('/rashinban/media', createMediaRouter({appRoot: root, sharedRoot: root, isWorktree: false}));
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
const pipDesign = () => evaluate(`['left','right'].map(side=>{
  const bar=document.querySelector('.health.'+side),s=getComputedStyle(bar),n=getComputedStyle(bar.querySelector('b')),p=getComputedStyle(bar.querySelector('.pip'));
  return {height:s.height,border:s.borderTopWidth,color:s.borderTopColor,radius:s.borderTopLeftRadius,background:s.backgroundColor,transform:s.transform,
    count:{width:n.width,height:n.height,font:n.fontSize,lineHeight:n.lineHeight,background:n.backgroundColor,transform:n.transform},
    pip:{width:p.width,height:p.height,border:p.borderTopWidth,shadow:p.boxShadow}};
})`);
let streamPipDesign;
const streamLockDesigns = new Map();
const lockDesign = () => evaluate(`['left','right'].map(side=>{
  const e=document.getElementById(side+'-lock'),s=getComputedStyle(e),shade=getComputedStyle(e.parentElement,'::before');
  return {hidden:e.hidden,font:s.font,color:s.color,shadow:s.textShadow,shade:shade.backgroundColor,content:shade.content};
})`);
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
  for (const output of ['stream', 'led']) {
    const led = output === 'led';
    await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/presenter${led ? '-led' : ''}.html?role=preview` });
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`document.getElementById('timer-value')?.textContent==='00:39'`)) break;
      await delay(100);
    }
    assert.equal(await evaluate(`document.getElementById('timer-value').textContent`), '00:39');
    await evaluate(`document.fonts.ready`);
    const fontDocument = await command('DOM.getDocument');
    const fontNode = await command('DOM.querySelector', { nodeId: fontDocument.root.nodeId, selector: '#timer-value' });
    const fontUsage = await command('CSS.getPlatformFontsForNode', { nodeId: fontNode.nodeId });
    assert.ok(fontUsage.fonts.some(font => font.familyName.toLowerCase().includes('kaneda') && font.glyphCount > 0), 'timer numerals must render in Kaneda Gothic');
    const alignment = await evaluate(`({timer:qa.rect('timer'),value:qa.rect('timer-value')})`);
    assert.ok(Math.abs(alignment.timer.x + alignment.timer.width / 2 - alignment.value.x - alignment.value.width / 2) < 1, 'timer numeral centered horizontally');
    assert.ok(Math.abs(alignment.timer.y + alignment.timer.height / 2 - alignment.value.y - alignment.value.height / 2) < 1, 'timer numeral centered vertically');
    await evaluate(`const initial56=structuredClone(qa.initial.presenterDuel);Object.assign(initial56.rounds[0],{startAtMs:qa.now-4000,timerStartAtMs:qa.now-4000,endAtMs:qa.now+56000});qa.set('presenterDuel',initial56);`);
    await settle(); await screenshot(`${output}-56`, led);
    const timer = await evaluate(`qa.rect('timer')`);
    for (const mode of ['MOVE', 'NM', 'NMPZ']) for (const source of ['rendered', 'video', 'chroma']) for (const lock of ['none', 'left', 'right', 'both']) {
      await evaluate(`qa.live('${mode}','${source}','${lock}')`); await settle();
      const current = await evaluate(`({timer:qa.rect('timer'),left:qa.rect('left-window'),right:qa.rect('right-window'),leftMap:qa.rect('left-map'),rightMap:qa.rect('right-map'),layout:document.body.dataset.layout,lock:document.body.dataset.lock})`);
      const lockKey=`${mode}/${source}/${lock}`,design=await lockDesign();
      if(led) assert.deepEqual(design,streamLockDesigns.get(lockKey),`LED lock typography, player colors and overlay match the stream for ${lockKey}`);
      else streamLockDesigns.set(lockKey,design);
      if (led || source === 'chroma') assert.deepEqual(current.timer, timer, `${output} fixed timer moved on ${mode}/${source}/${lock}`);
      if (led) {
        assert.deepEqual(current.left, {x:0,y:54,width:960,height:522});
        assert.deepEqual(current.right, {x:960,y:54,width:960,height:522});
        assert.deepEqual(current.timer, {x:862.5,y:276,width:195,height:78});
        if (current.lock === 'left' || current.lock === 'both') assert.deepEqual(current.leftMap, current.left);
        if (current.lock === 'right' || current.lock === 'both') assert.deepEqual(current.rightMap, current.right);
      } else {
        const singleLock = current.lock === 'left' || current.lock === 'right';
        assert.equal(current.timer.y, singleLock ? 229 : 557);
        assert.equal(current.timer.width,195);assert.equal(current.timer.height,78);
        assert.equal(current.left.y,335);assert.equal(current.right.y,335);
        assert.equal(current.left.height,522);assert.equal(current.right.height,522);
        assert.equal(current.left.width,singleLock ? current.lock==='left' ? 578 : 1278 : 928);
        assert.equal(current.right.width,singleLock ? current.lock==='right' ? 578 : 1278 : 928);
        if(source==='chroma')assert.equal(current.lock,'none','External gameplay must never resize on lock');
      }
      if (current.layout === 'shared' && ['left', 'right'].includes(current.lock)) {
        const shared = await evaluate(`(()=>{const el=document.getElementById('shared-panorama');const style=getComputedStyle(el);return{width:parseFloat(style.width)-parseFloat(style.borderLeftWidth)-parseFloat(style.borderRightWidth),height:parseFloat(style.height)-parseFloat(style.borderTopWidth)-parseFloat(style.borderBottomWidth)};})()`);
        ratio(shared);
      }
      if (led) {
        assert.equal(current.layout, 'dual');
        assert.equal(current.left.x + current.left.width, current.right.x, 'LED gameplay meets at the center seam');
        assert.ok(current.left.y + current.left.height <= 576 && current.right.y + current.right.height <= 576);
      }
      layouts.push({ output, mode, source, lock, ...current });
      if(mode==='MOVE'&&source==='rendered'&&['left','right','both'].includes(lock))await screenshot(`${output}-locked-${lock}`,led);
    }
    checks.push(`${output}: source-aware timer and lock geometry across modes and both sides; chroma remains fixed`);
    if(led) checks.push('LED: LOCKED IN matches stream typography, player colors and light overlay across all modes, sources and lock states');
    await evaluate(`qa.live('NM','rendered','none')`); await settle(); await screenshot(`${output}-39`, led);
    await evaluate(`qa.live('NM','rendered','left')`); await settle(); await screenshot(`${output}-locked`, led);
    const ledHeader = async () => evaluate(`['.competitor.left','.competitor.right','#left-wins','#right-wins','.match-info','.health.left','.health.right','.damage.left','.damage.right'].map(selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect(),s=getComputedStyle(e);return {selector,x:r.x,y:r.y,width:r.width,height:r.height,background:s.backgroundColor,font:s.fontFamily,border:s.border,transform:s.transform};})`);
    const header = led ? await ledHeader() : null;
    if (led) {
      assert.deepEqual(header.slice(0,5).map(({x,y,width,height})=>({x,y,width,height})), [
        {x:0,y:0,width:824,height:54},{x:1096,y:0,width:824,height:54},
        {x:824,y:0,width:75,height:54},{x:1021,y:0,width:75,height:54},{x:899,y:0,width:122,height:54}]);
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.mode-info small')).display`),'none');
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('.health')].map(e=>{const s=getComputedStyle(e);return {top:s.top,width:s.width,height:s.height,border:s.borderTopWidth,radius:s.borderTopLeftRadius,transform:s.transform};})`),[
        {top:'27px',width:'382px',height:'69px',border:'3px',radius:'10px',transform:'matrix(1, 0, -0.176327, 1, 0, 0)'},
        {top:'27px',width:'382px',height:'69px',border:'3px',radius:'10px',transform:'matrix(1, 0, 0.176327, 1, 0, 0)'}], 'Move the existing healthbars without redesigning them');
      assert.equal(await evaluate(`document.getElementById('mode').textContent`),'NO MOVE');
      assert.equal(await evaluate(`document.getElementById('multiplier').textContent`),'×1.0');
      await evaluate(`qa.set('presenterSeries',{...qa.initial.presenterSeries,left:{...qa.initial.presenterSeries.left,name:'とても長いプレイヤー名の表示確認',handle:'long_player_handle_for_layout'},right:{...qa.initial.presenterSeries.right,name:'A VERY LONG PLAYER NAME FOR LAYOUT',handle:''}})`);
      await settle();
      const names = await evaluate(`['left','right'].map(side=>({name:qa.rect(side+'-name'),handle:qa.rect(side+'-handle')}))`);
      for (const [i, side] of names.entries()) {
        const start = i ? 1120 : 418, end = i ? 1502 : 800;
        assert.ok(side.name.x >= start && side.name.x + side.name.width <= end, 'Long names stay between HP and wins');
        if (side.handle.width) assert.ok(side.handle.x >= start && side.handle.x + side.handle.width <= end, 'Handles stay in their identity panel');
      }
      await screenshot('led-long-names',true);
      await evaluate(`qa.set('presenterSeries',qa.initial.presenterSeries)`); await settle();
    }
    if (!led) {
      assert.equal(await evaluate(`document.querySelector('.presenter-sponsor').naturalWidth`),575,'Sponsor must load as SVG');
      assert.equal(await evaluate(`document.getElementById('match-label').textContent`),'GRAND FINALS');
      await evaluate(`qa.set('matchResolved',{id:'other-match',label:'STALE MATCH'})`); await settle();
      assert.equal(await evaluate(`document.getElementById('match-label').textContent`),'','Do not label a different series');
      await evaluate(`qa.set('matchResolved',qa.initial.matchResolved);qa.live('NM','rendered','none');const points=structuredClone(qa.initial.presenterDuel);points.pinpointing={teamIds:points.players.map(p=>p.teamId),firstTo:7,tieRange:'off',rounds:[],totals:[1,1],matchPoint:[false,false],terminal:null};qa.set('presenterDuel',points)`);
      await settle();
      assert.deepEqual(await evaluate(`['left','right'].map(side=>({points:document.getElementById(side+'-health').textContent,pips:document.querySelectorAll('#'+side+'-pips .pip').length,filled:document.querySelectorAll('#'+side+'-pips .filled').length,damage:getComputedStyle(document.querySelector('.damage.'+side)).display}))`),
        [{points:'1',pips:7,filled:1,damage:'none'},{points:'1',pips:7,filled:1,damage:'none'}]);
      await screenshot('stream-pinpointing');
      streamPipDesign=await pipDesign();
      streamPipDesign.forEach(bar=>assert.equal(bar.background,'rgba(0, 0, 0, 0)','Stream pip bars retain their transparent fill'));
      checks.push('stream: live match title, sponsor asset and authoritative Pinpointing counters');
      const normalBounds=await evaluate(`['left','right'].map(side=>document.getElementById(side+'-health').parentElement.getBoundingClientRect().toJSON())`);
      for (const totals of [[5,1],[1,6],[5,6],[4,4],[7,1]]) {
        await evaluate(`{const next=structuredClone(nodecg.Replicant('presenterDuel').value);next.pinpointing.totals=${JSON.stringify(totals)};qa.set('presenterDuel',next);}`);
        await settle();
        await screenshot('stream-pinpointing-'+totals.join('-'));
        const bars=await evaluate(`['left','right'].map(side=>{const e=document.getElementById(side+'-health').parentElement,s=getComputedStyle(e);return {matchPoint:e.dataset.matchPoint,border:s.borderTopColor,glow:s.boxShadow,rect:e.getBoundingClientRect().toJSON()};})`);
        bars.forEach((bar,i)=>{
          const matchPoint=totals[i]>=5&&totals[i]<7;
          assert.equal(bar.matchPoint,String(matchPoint));
          assert.equal(bar.border,i?'rgb(48, 131, 255)':'rgb(255, 48, 48)','Match point keeps the player-colored border');
          assert.equal(bar.glow!=='none',matchPoint,'Only match-point bars glow');
          if(matchPoint) assert.match(bar.glow,/rgb\(255, 213, 90\) 0px 0px 0px 3px/,'Yellow ring sits outside the player border');
          assert.deepEqual(bar.rect,normalBounds[i],'Match point must not move or resize the points bar');
        });
      }
      checks.push('stream: match point adds an outer yellow halo to either or both player-colored bars and resets below match point or after winning');
    }
    if (led) {
      await evaluate(`qa.live('MOVE','rendered','none');{const next=structuredClone(qa.initial.presenterDuel);next.mode='MOVE';next.pinpointing={teamIds:next.players.map(p=>p.teamId),firstTo:7,tieRange:'off',rounds:[],totals:[5,2],matchPoint:[true,false],terminal:null};qa.set('presenterDuel',next);}`);
      await settle();
      assert.equal(await evaluate(`document.getElementById('mode').textContent`),'MOVING');
      assert.deepEqual(await evaluate(`['left','right'].map(side=>({banner:getComputedStyle(document.querySelector('.damage.'+side)).display,points:document.getElementById(side+'-health').textContent,filled:document.querySelectorAll('#'+side+'-pips .filled').length}))`),
        [{banner:'none',points:'5',filled:5},{banner:'none',points:'2',filled:2}]);
      const pipColors=await evaluate(`['left','right'].map(side=>({sideColor:getComputedStyle(document.getElementById(side+'-wins')).backgroundColor,pips:[...document.querySelectorAll('#'+side+'-pips .filled')].map(e=>getComputedStyle(e).backgroundColor),empty:[...document.querySelectorAll('#'+side+'-pips .pip:not(.filled)')].map(e=>getComputedStyle(e).backgroundColor)}))`);
      pipColors.forEach(({sideColor,pips,empty})=>{
        assert.ok(pips.length>0);assert.ok(pips.every(color=>color===sideColor),'Filled LED pips must match their side of the header');
        assert.ok(empty.every(color=>color==='rgba(255, 255, 255, 0.3)'),'Unfilled LED pips match the stream style');
      });
      assert.deepEqual(await pipDesign(),streamPipDesign.map(bar=>({...bar,background:'rgb(0, 0, 0)'})),
        'LED uses an opaque black fill with the same rounded bar, pips and colored count caps');
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('.health')].map(e=>({color:getComputedStyle(e).borderTopColor,glow:getComputedStyle(e).boxShadow!=='none'}))`),
        [{color:'rgb(255, 48, 48)',glow:true},{color:'rgb(48, 131, 255)',glow:false}]);
      await screenshot('led-pinpointing-no-banners',true);
      await evaluate(`qa.live('NM','rendered','none')`);await settle();
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('.damage')].map(e=>getComputedStyle(e).display)`),['flex','flex']);
      checks.push('LED: points banners are hidden while pips and match point remain; health duels retain damage multipliers');
    }
    await evaluate(`qa.live('NM','rendered','none');const s=structuredClone(qa.initial.presenterDuel);s.rounds[0].startAtMs=qa.now+60000;qa.set('presenterDuel',s);qa.set('presenterTimeline',{...qa.initial.presenterTimeline,phase:'pre-round'});`);
    await settle();
    const preview = await evaluate(`({rect:qa.rect('preview-area'),panorama:qa.rect('preview-panorama'),hidden:document.getElementById('preview-area').hidden,timerHidden:document.getElementById('timer').hidden})`);
    ratio(preview.rect); ratio(preview.panorama); assert.equal(preview.rect.x + preview.rect.width / 2, 960); assert.equal(preview.hidden, false); assert.equal(preview.timerHidden, true);
    if (led) {
      assert.equal(preview.rect.y,54,'Round preview starts directly below the header');
      assert.equal(preview.rect.height,522,'Round preview uses the full remaining LED height');
      assert.equal(preview.rect.y+preview.rect.height,576,'Round preview reaches the bottom of the LED');
      assert.deepEqual(await ledHeader(),header,'Designer header persists through round preview');
    }
    await screenshot(`${output}-preview`, led);
    checks.push(`${output}: centered 16:9 preview`);

    const result = structuredClone(state); result.manualRoundStart = false;
    result.players.forEach((player, i) => { player.results = [{ round: result.round, score: i ? 3200 : 4500, bestGuess: null,
      healthBefore: 6000, healthAfter: i ? 4050 : 6000, damageDealt: i ? 0 : 1950, multiplier: 1.5 }]; });
    const scoring = advanceTimeline(null, result, epoch, false, DEFAULT_TIMING);
    await evaluate(`qa.live('NM','chroma','left')`); await settle();
    const liveWindows = await evaluate(`({left:qa.rect('left-window'),right:qa.rect('right-window')})`);
    for (const now of [epoch, scoring.revealAtMs - 1]) {
      await evaluate(`qa.now=${now};qa.set('presenterDuel',${JSON.stringify(result)});qa.set('presenterTimeline',${JSON.stringify(scoring)});`); await settle();
      const lead = await evaluate(`({transitionHidden:document.getElementById('transition').hidden,liveHidden:document.getElementById('live-area').hidden,resultsVisibility:document.getElementById('results-area').style.visibility,left:qa.rect('left-window'),right:qa.rect('right-window'),phaseLabel:document.getElementById('phase-label').textContent,scoringHidden:document.getElementById('scoring-layer').hidden})`);
      assert.equal(lead.transitionHidden,true,'No Round Complete interstitial before scoring');
      assert.equal(lead.liveHidden,false,'Keep the last live view until results are ready');
      assert.equal(lead.resultsVisibility,'hidden'); assert.equal(lead.scoringHidden,true);
      assert.deepEqual({left:lead.left,right:lead.right},liveWindows,'Retain the final player window layout');
      assert.notEqual(lead.phaseLabel,'ROUND COMPLETE');
    }
    const reveal = advanceTimeline(scoring, result, scoring.revealAtMs, false, DEFAULT_TIMING);
    await evaluate(`qa.now=${scoring.revealAtMs};qa.set('presenterTimeline',${JSON.stringify(reveal)});`); await settle();
    assert.deepEqual(await evaluate(`({liveHidden:document.getElementById('live-area').hidden,resultsVisibility:document.getElementById('results-area').style.visibility,transitionHidden:document.getElementById('transition').hidden,stage:document.body.dataset.scoring})`),
      {liveHidden:true,resultsVisibility:'visible',transitionHidden:true,stage:'entry'});
    checks.push(`${output}: final gameplay cuts directly to results and scoring without an interstitial`);
    if (led) {
      assert.deepEqual(await evaluate(`qa.rect('results-map')`),{x:460,y:104,width:1000,height:460});
      assert.deepEqual(await ledHeader(),header,'Designer header persists through scoring');
    }
    const tokens = [];
    for (const [name, offset] of [['count', 1585], ['anticipate', 3160], ['collision', 3360], ['multiplier', 4260], ['flight', 4960], ['multiplier-faded', 5160], ['impact-before', 5309], ['impact', 5310], ['impact-after', 5410], ['settled', 7310]]) {
      const now = scoring.revealAtMs + offset;
      const t = advanceTimeline(scoring, result, now, false, DEFAULT_TIMING);
      await evaluate(`qa.now=${now};qa.set('presenterDuel',${JSON.stringify(result)});qa.set('presenterTimeline',${JSON.stringify(t)});`); await settle();
      tokens.push({ name, ...await evaluate(`({stage:document.body.dataset.scoring,rect:qa.rect('score-token-right'),transform:document.getElementById('score-token-right').style.transform,opacity:document.getElementById('score-token-right').style.opacity,health:document.getElementById('right-health').textContent,multiplierHidden:document.getElementById('score-calculation').hidden})`) });
      if (!name.startsWith('impact-')) await screenshot(`${output}-score-${name}`, led);
    }
    const before = tokens.find(t => t.name === 'impact-before'), impact = tokens.find(t => t.name === 'impact');
    assert.equal(impact.stage, 'impact');
    assert.ok(Math.abs(before.rect.y - impact.rect.y) < 15, 'damage must not teleport at impact');
    assert.equal(impact.opacity, '1');
    assert.equal(tokens.find(t => t.name === 'flight').multiplierHidden, false);
    assert.equal(tokens.find(t => t.name === 'multiplier-faded').multiplierHidden, true);
    assert.equal(tokens.at(-1).health, '4050');
    await writeFile(path.join(artifacts, `${output}-motion.json`), JSON.stringify(tokens, null, 2));
    checks.push(`${output}: built scoring animation crosses impact continuously and settles authoritative HP`);
    // The production client deliberately never rewinds its synchronized clock.
    // Sample the red threshold after scoring, without rewinding time.
    await evaluate(`qa.live('NM','rendered','none');qa.now=${epoch + 24000}`); await settle();
    assert.equal(await evaluate(`document.getElementById('timer-value').textContent`), '00:15');
    assert.equal(await evaluate(`document.getElementById('timer').classList.contains('critical')`), true);
    assert.equal(await evaluate(`getComputedStyle(document.getElementById('timer-value')).color`), 'rgb(255, 48, 48)');
    {
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.timer-progress')).stroke`),'rgb(255, 48, 48)');
      assert.equal(await evaluate(`Number(document.getElementById('timer').style.getPropertyValue('--timer-offset'))`),-75,'Clockwise elapsed perimeter follows the deadline');
    }
    await screenshot(`${output}-15`, led);
    if (led) {
      await evaluate(`qa.set('presenterDuel',{...nodecg.Replicant('presenterDuel').value,paused:true})`); await settle();
      assert.equal(await evaluate(`document.getElementById('timer').hidden`),true);
      assert.equal(await evaluate(`document.getElementById('review-banner').hidden`),false);
      assert.deepEqual(await ledHeader(),header,'Header persists during review');
      await screenshot('led-review',true);
      await evaluate(`qa.set('presenterDuel',{...qa.initial.presenterDuel,status:'Finished',winnerTeamId:qa.initial.presenterDuel.players[0].teamId});qa.set('presenterTimeline',{...qa.initial.presenterTimeline,phase:'finished'})`); await settle();
      assert.equal(await evaluate(`document.body.dataset.scene`),'summary');
      const scoreboardOnly = items => items.filter(item => !item.selector.startsWith('.damage')&&!item.selector.startsWith('.health'));
      assert.deepEqual(scoreboardOnly(await ledHeader()),scoreboardOnly(header),'Scoreboard persists on the winner summary');
      assert.equal(await evaluate(`[...document.querySelectorAll('.health')].every(e=>getComputedStyle(e).display==='none')`),true,'HP bars are hidden between games');
      assert.equal(await evaluate(`document.getElementById('summary-area').hidden`),true);
      assert.equal(await evaluate(`document.body.dataset.intermission`),'before-game');
      await screenshot('led-summary',true);
      await evaluate(`qa.set('presenterDuel',{...qa.initial.presenterDuel,aborted:true})`); await settle();
      assert.equal(await evaluate(`document.body.dataset.scene`),'aborted');
      assert.deepEqual(scoreboardOnly(await ledHeader()),scoreboardOnly(header),'Scoreboard persists on cancellation');
      assert.equal(await evaluate(`[...document.querySelectorAll('.health')].every(e=>getComputedStyle(e).display==='none')`),true,'Cancelled games hide the HP bars');
      await evaluate(`qa.set('presenterTimeline',null)`); await settle();
      assert.equal(await evaluate(`document.body.dataset.scene`),'waiting');
      assert.deepEqual(await ledHeader(),header,'Header persists while waiting');
      assert.deepEqual(await evaluate(`qa.rect('waiting-area')`),{x:16,y:104,width:1888,height:460});
      checks.push('led: persistent designer header across preview, scoring, review, summary, cancellation and waiting; long names stay contained');
    }
    // Real scoring projections: +1/+2 by either bar, silent no-point rounds,
    // swapped player order, and expiry without replay when joining late.
    const awards=[
      {winner:0,gain:1,reason:'closest',scores:[4500,3200]},
      {winner:1,gain:1,reason:'closest',scores:[3200,4500]},
      {winner:0,gain:2,reason:'solo-5k',scores:[5000,3200]},
      {winner:1,gain:2,reason:'solo-5k',scores:[3200,5000]},
      {winner:1,gain:1,reason:'fastest-5k',scores:[5000,5000]},
      {winner:null,gain:0,reason:'tie',scores:[4000,4000]},
      {winner:null,gain:0,reason:'fastest-5k',scores:[5000,5000]},
      {winner:0,gain:2,reason:'solo-5k',scores:[5000,3200],swapped:true},
    ];
    for (const [index,{winner,gain,reason,scores,swapped=false}] of awards.entries()) {
      const result=structuredClone(state),series=structuredClone(initial.presenterSeries);
      if(swapped) [series.left.playerId,series.right.playerId]=[series.right.playerId,series.left.playerId];
      const winnerSide=winner===null?null:series.left.playerId===result.players[winner].id?'left':'right';
      const before=[4,4],points=winner===null?[0,0]:winner===0?[gain,0]:[0,gain],after=before.map((value,i)=>value+points[i]);
      result.mode='MOVE';result.manualRoundStart=false;
      result.players.forEach((player,i)=>{player.results=[{round:result.round,score:scores[i],bestGuess:null,healthBefore:6000,healthAfter:6000,damageDealt:0,multiplier:1}];});
      result.pinpointing={teamIds:result.players.map(player=>player.teamId),firstTo:7,tieRange:'off',totals:after,matchPoint:after.map(value=>value>=5),terminal:null,
        rounds:[{round:result.round,scores,guessedAtMs:[1,2],points,totalsBefore:before,totalsAfter:after,winner,reason,band:0,withinBand:reason==='tie',fiveKs:scores.filter(score=>score===5000).length}]};
      const start=epoch+40000+index*12000,timing=advanceTimeline(null,result,start,false,DEFAULT_TIMING);
      await evaluate(`qa.set('presenterSeries',${JSON.stringify(series)});`);
      for(const offset of [-1,0,200,500,800,1001,2500]) {
        const now=timing.scoring.verdictAtMs+offset,verdict=advanceTimeline(timing,result,now,false,DEFAULT_TIMING);
        await evaluate(`qa.now=${now};qa.set('presenterDuel',${JSON.stringify(result)});qa.set('presenterTimeline',${JSON.stringify(verdict)});`);await settle();
        assert.equal(await evaluate(`document.getElementById('verdict').hidden`),true,'No explanatory verdict banner');
        assert.equal(await evaluate(`document.getElementById('score-calculation').hidden`),true,'No damage multiplier in points rounds');
        const tokens=await evaluate(`['left','right'].map(side=>{const e=document.getElementById('score-token-'+side),s=getComputedStyle(e);return {side,hidden:e.hidden,text:e.textContent,color:s.color,opacity:Number(s.opacity),rect:qa.rect(e.id),bar:document.querySelector('.health.'+side).getBoundingClientRect().toJSON(),headerBottom:document.querySelector('.match-info').getBoundingClientRect().bottom,count:document.getElementById(side+'-health').textContent};})`);
        tokens.forEach(token=>{
          const visible=winnerSide===token.side&&offset>=0&&offset<1000;
          assert.equal(token.hidden,!visible,`${output} ${reason} ${winnerSide} ${offset}: only the awarded side shows a token`);
          const playerIndex=result.players.findIndex(player=>player.id===series[token.side].playerId);
          assert.equal(token.count,String((offset<0?before:after)[playerIndex]),'Points land with the award');
          if(!visible)return;
          assert.equal(token.text,'+'+gain);
          assert.equal(token.color,token.side==='left'?'rgb(255, 48, 48)':'rgb(48, 131, 255)');
          assert.ok(token.opacity>0);
          if(offset===800)assert.ok(token.opacity<1,'Award fades out');
          const gap=token.side==='left'?token.rect.x-token.bar.right:token.bar.x-(token.rect.x+token.rect.width);
          assert.ok(gap>=8&&gap<60,'Award sits next to the inner edge of its pip bar');
          if(led) assert.ok(token.rect.y>=token.headerBottom+8,'The entire LED award clears the header, including during its pop animation');
          else assert.ok(Math.abs(token.rect.y+token.rect.height/2-(token.bar.y+token.bar.height/2))<1,'Stream award stays vertically aligned with the bar');
          assert.ok(token.rect.y>=0&&token.rect.y+token.rect.height<=(led?576:1080),'Award stays within the output');
        });
        if(offset===500){
          const bars=await evaluate(`[...document.querySelectorAll('.health')].map(e=>({border:getComputedStyle(e).borderTopColor,glow:getComputedStyle(e).boxShadow}))`);
          bars.forEach((bar,i)=>{assert.equal(bar.border,i?'rgb(48, 131, 255)':'rgb(255, 48, 48)');assert.equal(bar.glow!=='none',['left','right'][i]===winnerSide);});
          await screenshot(`${output}-pinpointing-award-${index}-${winnerSide??'none'}`,led);
        }
      }
    }
    checks.push(output+': +1/+2 awards pop and fade next to the correct pip bar, including swapped players; no-point rounds show nothing; match-point halo retains player colors');
  }
  assert.deepEqual(errors, [], 'uncaught browser errors');
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify({ checks, errors, layouts }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, layoutCases: layouts.length, errors: errors.length, artifacts }, null, 2));
} finally {
  socket?.close(); chrome.kill(); await new Promise(resolve => server.close(resolve));
}
