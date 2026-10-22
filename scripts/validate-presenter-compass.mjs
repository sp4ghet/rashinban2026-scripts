// Isolated CSS/layout check. Uses the real adapter with a synthetic Maps boundary.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'artifacts/presenter-compass');
await mkdir(out, { recursive: true });
const graphics = path.join(root, 'bundles/rashinban/graphics');
const harness = await build({ stdin: { contents: `
import {googleAdapter} from './bundles/rashinban/src/graphics/presenter/google.ts';
let now=0;
class Pano {
  constructor(el){el.style.background='linear-gradient(165deg, #8db7c8 0%, #ccd9cc 38%, #3c5842 39%, #233c2f 70%, #777e70 71%)';el.innerHTML='<span style="position:absolute;left:8px;bottom:4px;color:white">Google</span>';}
  setVisible(){} setPov(p){this.pov=p;} setZoom(){} setPano(id){this.id=id;} getPano(){return this.id;} addListener(){} unbindAll(){}
}
const api={StreetViewPanorama:Pano,StreetViewService:class{getPanorama(r,cb){queueMicrotask(()=>cb({location:{pano:r.pano}},'OK'));}},event:{trigger(){},clearInstanceListeners(){}}};
const adapter=googleAdapter(document.body,api,e=>{throw Error(e)},()=>{},()=>now);
const surfaces=Object.fromEntries(['left-view','right-view','preview-panorama'].map(id=>[id,adapter.panorama(id)]));
window.qa={show(preview,source='rendered',heading=0,inactive=true){
  Object.assign(document.body.dataset,{source,phase:preview?'pre-round':'live',scene:preview?'preview':'live',layout:'dual'});
  for(const el of document.querySelectorAll('.player-map')){el.dataset.inactive=String(inactive);el.innerHTML='<span>Minimap</span>';}
  for(const id of ['waiting-area','summary-area','results-area'])document.getElementById(id).hidden=true;
  document.getElementById('live-area').hidden=preview;document.getElementById('preview-area').hidden=!preview;
  for(const [id,s] of Object.entries(surfaces))s.render({lat:1,lng:2,panoId:'fixture',heading,pitch:0,zoom:1},{identity:id,visible:id==='preview-panorama'?preview:!preview&&source==='rendered'});
  now+=250;
  for(const [id,s] of Object.entries(surfaces))s.render({lat:1,lng:2,panoId:'fixture',heading,pitch:0,zoom:1},{identity:id,visible:id==='preview-panorama'?preview:!preview&&source==='rendered'});
},rect(el){const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};}};
qa.show(false);qa.ready=true;
`, resolveDir: root, loader: 'ts' }, bundle: true, write: false, format: 'iife' });
const server = createServer(async (req,res) => {
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(harness.outputFiles[0].contents);return;}
    const file=path.resolve(graphics,'.'+url.pathname);if(!file.startsWith(graphics+path.sep))throw Error('path');
    let data=await readFile(file);
    if(file.endsWith('.html'))data=data.toString().replace('<script src="presenter.js">','<script src="fixture.js">').replace(/<link[^>]+https:[^>]+>/g,'');
    res.setHeader('Content-Type',{'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[path.extname(file)]||'application/octet-stream');res.end(data);
  }catch(e){res.writeHead(404);res.end(String(e));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=path.join(out,'chrome-'+Date.now());
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--no-default-browser-check','--disable-background-networking','about:blank'],{windowsHide:true,stdio:'ignore'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let socket,counter=0;const pending=new Map(),checks=[],errors=[];
const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++counter;const timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout'));},15000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params}));});
async function evaluate(expression){const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
try {
  let target;
  for(let i=0;i<100;i++){try{const port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);target=(await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json())).find(t=>t.type==='page');if(target)break;}catch{}await delay(100);}
  assert.ok(target,'Chrome starts');socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params);};
  await command('Runtime.enable');await command('Page.enable');await command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  for(const page of ['presenter','presenter-remote','presenter-led']){
    await command('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'+page+'.html'});
    for(let i=0;i<100;i++){if(await evaluate('!!window.qa?.ready'))break;await delay(50);}
    assert.equal(await evaluate('!!window.qa?.ready'),true);await delay(200);
    for(const preview of [false,true])for(const source of preview?['rendered','chroma','video']:['rendered'])for(const inactive of preview?[true]:[true,false]){
      await evaluate(`qa.show(${preview},'${source}',90,${inactive})`);await delay(50);
      const data=await evaluate(`Array.from(document.querySelectorAll('.streetview-compass')).filter(el=>el.checkVisibility()).map(el=>({slot:el.parentElement.id,loaded:el.querySelector('img').complete&&el.querySelector('img').naturalWidth>0,transform:el.querySelector('img').style.transform,pointer:getComputedStyle(el).pointerEvents,compass:qa.rect(el),host:qa.rect(el.parentElement),topmost:document.elementFromPoint(el.getBoundingClientRect().x+16,el.getBoundingClientRect().y+16)?.closest('.player-view,#preview-panorama')?.id}))`);
      assert.equal(data.length,preview?1:2);
      for(const item of data){assert.equal(item.loaded,true);assert.equal(item.transform,'rotate(-90deg)');assert.equal(item.pointer,'none');assert.equal(item.topmost,item.slot,JSON.stringify(item));assert.equal(item.compass.width,32);assert.equal(item.compass.x-item.host.x,18);assert.equal(item.host.bottom-item.compass.bottom,item.slot==='left-view'?(!inactive?264:page.endsWith('led')?194:34):preview&&!page.endsWith('led')?248:34);}
      checks.push({page,preview,source,inactive,compasses:data});
      const shot=await command('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:1920,height:page.endsWith('led')?576:1080,scale:1}});
      await writeFile(path.join(out,`${page}-${preview?'preview-'+source:'live-'+(inactive?'inactive':'active')}.png`),Buffer.from(shot.data,'base64'));
    }
  }
  const comparisons=[];
  if(process.argv.includes('--compare-reference')){
    // Fetch the actual published component styles and needle independently of our implementation.
    const cssUrl='https://www.geoguessr.com/_next/static/css/349107d66d428d4f.css';
    const svgUrl='https://www.geoguessr.com/_next/static/media/compass.f79e0d30.svg';
    const [css,svg]=await Promise.all([cssUrl,svgUrl].map(async url=>{const response=await fetch(url);assert.ok(response.ok,url);return response.text();}));
    const rules=css.match(/\.compass_(?:compass|circle|indicator)__[^{}]+\{[^{}]+\}/g);
    assert.equal(rules?.length,3,'upstream compass rules still exist');
    const classes=Object.fromEntries(rules.map(rule=>[rule.match(/^\.compass_([^_]+)/)[1],rule.match(/^\.([^{}]+)/)[1]]));
    await writeFile(path.join(out,'reference.css'),rules.join('\n'));
    await writeFile(path.join(out,'reference.svg'),svg);
    await evaluate(`(()=>{const style=document.createElement('style');style.textContent=${JSON.stringify(rules.join('\n'))};document.head.append(style);qa.comparison=document.createElement('div');qa.comparison.style.cssText='position:fixed;left:200px;top:700px;width:160px;height:160px;z-index:2147483647;--ds-color-white-100:#fff';document.body.append(qa.comparison);})()`);
    for(const size of [32,128])for(const background of ['#234333','#d9e0e4','#10131f'])for(const heading of [0,45,90,137,180,270]){
      await evaluate(`qa.show(true,'rendered',${heading});qa.comparison.style.background=${JSON.stringify(background)}`);
      const shots=[];
      for(const reference of [true,false]){
        await evaluate(`(async()=>{const el=${reference?`document.createElement('div')`:`document.querySelector('#preview-panorama .streetview-compass').cloneNode(true)`};
          if(${reference}){el.className=${JSON.stringify(classes.compass)};const circle=document.createElement('div');circle.className=${JSON.stringify(classes.circle)};const needle=document.createElement('img');needle.className=${JSON.stringify(classes.indicator)};needle.src=${JSON.stringify('data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64'))};needle.style.transform='rotate(${-heading}deg)';el.append(circle,needle);}
          el.style.cssText='position:absolute;left:${(160-size)/2}px;top:${(160-size)/2}px;bottom:auto;--size:${size}px;--compass-size:${size}px';qa.comparison.replaceChildren(el);await el.querySelector('img').decode();})()`);
        const shot=await command('Page.captureScreenshot',{format:'png',clip:{x:200,y:700,width:160,height:160,scale:1}});
        shots.push(shot.data);
      }
      const differentPixels=await evaluate(`(async()=>{const pixels=await Promise.all(${JSON.stringify(shots)}.map(async data=>{const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();const canvas=document.createElement('canvas');canvas.width=160;canvas.height=160;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);return ctx.getImageData(0,0,160,160).data;}));let n=0;for(let i=0;i<pixels[0].length;i+=4)if([0,1,2,3].some(c=>pixels[0][i+c]!==pixels[1][i+c]))n++;return n;})()`);
      comparisons.push({size,background,heading,differentPixels});
      if(size===128&&background==='#234333'&&heading===137){
        await writeFile(path.join(out,'geoguessr-reference.png'),Buffer.from(shots[0],'base64'));
        await writeFile(path.join(out,'presenter-matched.png'),Buffer.from(shots[1],'base64'));
      }
      assert.equal(differentPixels,0,JSON.stringify(comparisons.at(-1)));
    }
    await evaluate('qa.comparison.remove()');
    console.log(comparisons.length+' pixel-identical comparisons against published GeoGuessr styles and asset');
  }
  assert.deepEqual(errors,[]);await writeFile(path.join(out,'report.json'),JSON.stringify({checks,comparisons,errors},null,2));console.log(checks.length+' browser layout scenarios passed');
}finally{socket?.close();chrome.kill();await new Promise(r=>server.close(r));}
