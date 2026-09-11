import assert from 'node:assert/strict';
import { readFile, mkdir, access, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts/player-tie-range');
const sampleRoot = path.join(root, 'docs/geoguessr/samples/player-tie-range');
const [bundle, manual, full, native, limit] = await Promise.all([
  readFile(path.join(root, 'tampermonkey/rashinban-tie-range.user.js'), 'utf8'),
  readFile(path.join(sampleRoot, 'player-live-manual.json'), 'utf8').then(JSON.parse),
  readFile(path.join(sampleRoot, 'player-rest-full.json'), 'utf8').then(JSON.parse),
  readFile(path.join(sampleRoot, 'player-dom.json'), 'utf8').then(JSON.parse),
  readFile(path.join(sampleRoot, 'player-rest-live-limit.json'), 'utf8').then(JSON.parse),
]);
await mkdir(artifacts, { recursive: true });
const candidates = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
let chromePath;
for (const candidate of candidates) { try { await access(candidate); chromePath = candidate; break; } catch {} }
if (!chromePath) throw Error('Chrome was not found. Set CHROME_PATH to its executable.');

const preload = `
window.fixture = ${JSON.stringify(manual.created)};
window.manual = ${JSON.stringify(manual)};
window.full = ${JSON.stringify(full)};
window.limit = ${JSON.stringify(limit)};
window.native = ${JSON.stringify(native)};
window.saved = JSON.parse(sessionStorage.getItem('saved') || '{"rb-tie-range:mode":"full"}');
window.GM_getValue = (key, fallback) => saved[key] ?? fallback;
window.GM_setValue = (key, value) => { saved[key] = value; sessionStorage.setItem('saved', JSON.stringify(saved)); };
window.GM_deleteValue = key => { delete saved[key]; sessionStorage.setItem('saved', JSON.stringify(saved)); };
window.GM_registerMenuCommand = (_name, callback) => { window.openSettings = callback; };
window.requests = [];
window.fetchError = 0;
window.noGame = false;
window.fetch = async (url, init) => {
  requests.push({url:String(url),method:init?.method || 'GET'});
  if (fetchError) return {ok:false,status:fetchError,json:async()=>({})};
  let value;
  if (String(url).endsWith('/guest-users/id')) value = {id:'player-blue'};
  else if (String(url).endsWith('/parties/v2/active')) value = {partyId:'test-party',lobbyId:fixture.gameId,gameState:noGame?'NoGame':'Ongoing',gameType:'Duels'};
  else if (String(url).includes('/phonebook/')) value = {gameId:fixture.gameId,gameServerNodeId:'test-node',status:'Active'};
  else if (String(url).startsWith('https://gs2.geoguessr.com/')) value = structuredClone(fixture);
  else throw Error('Unexpected request: ' + url);
  return {ok:true,status:200,json:async()=>value};
};
window.scene = (kind='playing') => {
  const root = document.getElementById('native');
  root.className = 'duels_root__A75Oi';
  root.innerHTML = '<div id="native-timer">Timer / compass</div>' + native.playingHud +
    (kind==='result' ? native.damageResult : kind==='summary' ? native.summary + native.terminal.join('') : '');
};
window.refresh = () => window.dispatchEvent(new Event('focus'));
window.scene();
`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#151329;color:white;font:16px Arial;min-height:100vh}
#native{min-height:100vh;background:linear-gradient(140deg,#232946,#263e42)}
#native svg,#native img{display:none}
#native-timer{position:absolute;top:115px;left:45%}
[class*="hud_healthBars__"]{display:flex;justify-content:space-between;padding:40px}
[class*="hud_healthbar__"]{width:35%;background:#333;padding:8px}
[class*="round-score_root__"]{position:absolute;top:150px;left:10%;width:80%;min-height:300px}
[class*="round-score_damageAnimation__"]{min-height:90px}
[class*="game-summary-2_root__"]{position:relative;margin:180px auto 0;width:80%}
[class*="game-summary-2_playedRound__"],[class*="game-summary-2_playedRoundsHeader__"]{display:grid;grid-template-columns:repeat(5,1fr);padding:8px;min-height:35px}
[class*="summon-glow-text_root__"]{position:absolute;top:100px;left:40%}
</style></head><body><script id="__NEXT_DATA__" type="application/json">{"props":{"accountProps":{"account":{"user":{"userId":"player-blue"}}}}}</script><div id="native"></div><script>${preload.replaceAll('</script', '<\\/script')}</script></body></html>`;
const server = createServer((_req, res) => { res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); res.end(html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const profile = path.join(artifacts, `chrome-${Date.now()}`);
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank'], {windowsHide:true,stdio:'ignore'});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
let nextId = 0;
const pending = new Map();
const errors = [];
async function command(method, params={}) {
  const id = ++nextId;
  return await new Promise((resolve,reject) => {
    const timeout=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},15000);
    pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value);},reject:error=>{clearTimeout(timeout);reject(error);}});
    socket.send(JSON.stringify({id,method,params}));
  });
}
async function evaluate(expression) {
  const result=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails) throw Error(result.exceptionDetails.text+': '+JSON.stringify(result.exceptionDetails.exception));
  return result.result.value;
}
async function until(expression, label, timeout=7000) {
  const end=Date.now()+timeout;
  while(Date.now()<end){if(await evaluate(expression))return;await delay(100);}
  throw Error('Timed out: '+label+'\n'+await evaluate(`document.getElementById('rb-tie-range-player')?.shadowRoot?.querySelector('[data-rb="hud"]')?.textContent`));
}
async function screenshot(name) {
  await delay(300);
  const {writeFile}=await import('node:fs/promises');
  const result=await command('Page.captureScreenshot',{format:'png'});
  await writeFile(path.join(artifacts,name+'.png'),Buffer.from(result.data,'base64'));
}
const shadow = `document.getElementById('rb-tie-range-player')?.shadowRoot`;
try {
  let debugPort;
  for(let i=0;i<100;i++){try{debugPort=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await delay(100);}}
  if(!debugPort)throw Error('Chrome did not start');
  const pages=await fetch('http://127.0.0.1:'+debugPort+'/json/list').then(r=>r.json());
  socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=event=>{const msg=JSON.parse(event.data);if(msg.id){const call=pending.get(msg.id);if(call){pending.delete(msg.id);msg.error?call.reject(Error(msg.error.message)):call.resolve(msg.result);}}else if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params);};
  await command('Runtime.enable');
  await command('Page.enable');
  await command('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await command('Page.addScriptToEvaluateOnNewDocument',{source:bundle});
  await command('Page.navigate',{url:`http://127.0.0.1:${port}/party/lobby/TEST`});
  await until(`${shadow}?.textContent.includes('6000')`,'initial custom HP');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('[class*="hud_healthBars__"]')).display`),'none','native HP suppressed');
  assert.notEqual(await evaluate(`getComputedStyle(document.getElementById('native-timer')).visibility`),'hidden','timer remains visible');
  await screenshot('01-playing');

  await evaluate(`fixture=structuredClone(manual.resolvedDamage);refresh()`);
  await until(`requests.filter(r=>r.url.startsWith('https://gs2')).length>=2`,'new round snapshot');
  await delay(150);
  assert.ok(!(await evaluate(`${shadow}.textContent`)).includes('2295'),'result HP is not disclosed before native reveal');
  await evaluate(`scene('result')`);
  await until(`${shadow}?.textContent.includes('2295')`,'revealed custom damage');
  const resultText=await evaluate(`${shadow}.textContent`);
  assert.match(resultText,/3705|3,705/,'full damage inside the band');
  await screenshot('02-result');

  await evaluate(`scene('playing')`);
  await until(`getComputedStyle(document.querySelector('[class*="hud_healthBars__"]')).display==='none'`,'React remount suppression');
  await evaluate(`scene('result');openSettings()`);
  await until(`${shadow}?.querySelector('select')`,'settings menu');
  await screenshot('03-settings');

  // A saved preference never changes the scoring mode of an attached game.
  await evaluate(`var s=${shadow}.querySelector('[data-rb="mode-select"]');s.value='half';s.dispatchEvent(new Event('change'))`);
  await until(`saved['rb-tie-range:mode']==='half' && ${shadow}.querySelector('[data-rb="mode"]').textContent.includes('next duel')`,'next-duel mode capture');
  assert.match(await evaluate(`${shadow}.querySelector('[data-rb="mode"]').textContent`),/Full/);
  await command('Page.reload');
  await until(`${shadow}?.querySelector('[data-rb="mode"]').textContent.includes('Full')`,'captured mode survives real page reload');
  await evaluate(`fixture=structuredClone(manual.resolvedDamage);scene('result');refresh()`);
  await until(`${shadow}?.querySelector('[data-rb="team-1"] [data-rb="health"]').textContent==='2295'`,'saved scores recover after reload');

  // A remount from a prior result must not disclose the next settled round.
  await evaluate(`fixture=structuredClone(full);scene('result');refresh()`);
  await until(`saved['rashinban.tie-range.game.'+fixture.gameId]`,'new Half game captured');
  assert.equal(await evaluate(`${shadow}.querySelector('[data-rb="terminal"]').hidden`),true,'round-2 DOM cannot reveal round-5 knockout');
  await evaluate(`document.querySelector('[class*="round-score_roundNumber__"]').textContent='Round 5'`);
  await until(`${shadow}.querySelector('[data-rb="terminal-headline"]').textContent==='You lose'`,'matching result discloses custom knockout');
  await screenshot('04-terminal');
  await evaluate(`fixture.version+=1;fixture.currentRoundNumber=6;scene('playing');refresh()`);
  await until(`${shadow}.querySelector('[data-rb="terminal-headline"]').textContent==='You lose' && !${shadow}.querySelector('[data-rb="terminal"]').hidden`,'custom terminal stays pinned during later native round');
  await evaluate(`fixture.version+=1;fixture.currentRoundNumber=5;fixture.status='Ongoing';fixture.teams.forEach(t=>t.roundResults.pop());refresh()`);
  await until(`${shadow}.querySelector('[data-rb="terminal"]').hidden`,'rollback clears the custom terminal');
  await evaluate(`fixture=structuredClone(full);fixture.version=100;fixture.status='Ongoing';refresh()`);
  await until(`JSON.parse(saved['rashinban.tie-range.game.'+fixture.gameId]).sourceVersion===100`,'restarted round settles behind the reveal gate');
  assert.notEqual(await evaluate(`${shadow}.querySelector('[data-rb="team-0"] [data-rb="health"]').textContent`),'0','a newly settled restarted round must not reuse the old disclosure');
  assert.equal(await evaluate(`${shadow}.querySelector('[data-rb="terminal"]').hidden`),true);
  await evaluate(`scene('result');document.querySelector('[class*="round-score_roundNumber__"]').textContent='Round 5'`);
  await until(`!${shadow}.querySelector('[data-rb="terminal"]').hidden`,'restarted result reveals normally');
  await evaluate(`noGame=true;document.getElementById('native').replaceChildren();refresh()`);
  await until(`${shadow}.querySelector('[data-rb="terminal-detail"]').textContent.includes('wait for the host')`,'host abort preserves custom terminal');

  // Off affects the next game and restores native HP.
  await evaluate(`openSettings();var s=${shadow}.querySelector('[data-rb="mode-select"]');s.value='off';s.dispatchEvent(new Event('change'))`);
  await until(`saved['rb-tie-range:mode']==='off'`,'Off saved');
  await evaluate(`noGame=false;fixture=structuredClone(manual.created);fixture.gameId='off-game';scene('playing');refresh()`);
  await until(`saved['rashinban.tie-range.game.off-game'] && ${shadow}.querySelector('[data-rb="hud"]').hidden`,'new Off duel leaves native values');
  assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('[class*="hud_healthBars__"]')).display`),'none');

  // A summary alone discloses the custom round-limit draw and replaces all HP columns.
  await evaluate(`openSettings();var s=${shadow}.querySelector('[data-rb="mode-select"]');s.value='full';s.dispatchEvent(new Event('change'))`);
  await until(`saved['rb-tie-range:mode']==='full'`,'Full saved');
  await evaluate(`fixture=structuredClone(limit);scene('summary');refresh()`);
  await until(`${shadow}.querySelector('[data-rb="terminal-headline"]').textContent==='Draw'`,'custom round-limit draw');
  assert.equal(await evaluate(`document.querySelectorAll('[data-rb="summary-health"]').length`),6,'all summary HP cells replaced');
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('[data-rb="summary-health"]'),x=>x.textContent)`),Array(6).fill('6000'));
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('[class*="summon-glow-text_root__"]')).visibility`),'hidden','native win/loss banner suppressed');
  assert.equal(await evaluate(`document.querySelectorAll('[class*="game-summary-2_playedRound__"][role="button"]').length`),3,'summary navigation remains available');
  await screenshot('05-summary-draw');

  // Retained values must be visibly stale after loss of transport.
  await evaluate(`window.realNow=Date.now;Date.now=()=>realNow()+20000;fetchError=503;refresh()`);
  await until(`${shadow}.querySelector('[data-rb="diagnostic"]').textContent.includes('out of date')`,'stale diagnostic');
  await screenshot('06-stale');
  await evaluate(`Date.now=realNow;fetchError=0;refresh()`);

  // A known non-player must never get an oriented/custom player HUD.
  await evaluate(`document.getElementById('__NEXT_DATA__').textContent=JSON.stringify({props:{accountProps:{account:{user:{userId:'non-player'}}}}});refresh()`);
  await until(`getComputedStyle(document.querySelector('[class*="hud_healthBars__"]')).display!=='none'`,'non-player fallback');
  assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('[class*="hud_healthBars__"]')).display`),'none');

  await evaluate(`document.getElementById('__NEXT_DATA__').textContent=JSON.stringify({props:{accountProps:{account:{user:{userId:'player-blue'}}}}});fixture=structuredClone(manual.created);fixture.gameId='invalid-rules-game';delete fixture.options.roundWinMultiplierIncrement;scene('playing');refresh()`);
  await until(`${shadow}.querySelector('[data-rb="diagnostic"]').textContent.includes('missing')`,'invalid rules diagnostic content');
  assert.ok(await evaluate(`(()=>{let e=${shadow}.querySelector('[data-rb="diagnostic"]');while(e){if(e.hidden || getComputedStyle(e).display==='none')return false;e=e.parentElement;}return true})()`),'initial unavailable diagnostic is visible');

  // Navigation out must restore every native value and stop requests.
  await evaluate(`history.pushState({},'', '/maps');window.dispatchEvent(new PopStateEvent('popstate'))`);
  await until(`getComputedStyle(document.querySelector('[class*="hud_healthBars__"]')).display!=='none'`,'teardown restores native HP');
  await delay(600);
  const count=await evaluate('requests.length');
  await delay(2700);
  assert.equal(await evaluate('requests.length'),count,'no requests outside player routes');
  assert.deepEqual(await evaluate(`Array.from(new Set(requests.map(r=>r.method)))`),['GET'],'read-only player transport');
  assert.equal(errors.length,0,'no uncaught browser exceptions');
  console.log('Player browser validation passed: bootstrap, live routing, disclosure, damage, remount, settings, real reload, next-duel mode, terminal/abort retention, Off, summary draw, stale, non-player, teardown, read-only requests.');
  console.log('Screenshots: '+artifacts);
} finally {
  if(socket?.readyState===WebSocket.OPEN){try{await command('Browser.close');}catch{}socket.close();}
  server.close();
  await delay(250);
  if(chrome.exitCode===null)chrome.kill();
  if (path.dirname(path.resolve(profile)) !== path.resolve(artifacts)) throw Error('Unexpected Chrome profile path');
  await rm(profile, {recursive:true,force:true,maxRetries:3,retryDelay:200});
}
