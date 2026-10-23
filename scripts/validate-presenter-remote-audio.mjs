// Real browser audio/video fixtures and checks, used by validate-presenter-relay.
import assert from 'node:assert/strict';

const samples = 48000 * 2;
const wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 48000) * 8000), 44 + i * 2);
let video;
export async function serveAudioFixture(req, res) {
  const name = new URL(req.url, 'http://localhost').pathname;
  if (name === '/qa-effect.webm' && req.method === 'POST') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    video = Buffer.concat(chunks); res.end('ok'); return true;
  }
  if (name === '/rashinban/media/effects/remote-qa.wav' || name === '/rashinban/media/music/remote-qa.wav') {
    res.setHeader('Content-Type', 'audio/wav'); res.end(wav); return true;
  }
  if (name === '/rashinban/media/video/remote-qa.webm' && video) {
    res.setHeader('Content-Type', 'video/webm'); res.end(video); return true;
  }
  return false;
}

// Instrument the real Web Audio API; the analyser measures the engine's output
// after its actual audio gate, and source records retain its scheduling calls.
export const audioBootstrap = `
qa.audioContexts=[];qa.audioSources=[];qa.messages=[];
const RealAudioContext=AudioContext;
window.AudioContext=class extends RealAudioContext {
  constructor(...args){super(...args);qa.audioContexts.push(this);}
  createGain(){const gain=super.createGain();if(!this.qaGate){this.qaGate=gain;this.qaMeter=this.createAnalyser();gain.connect(this.qaMeter);}return gain;}
  createBufferSource(){const source=super.createBufferSource();const entry={source,starts:[],stops:[]};qa.audioSources.push(entry);
    const start=source.start.bind(source),stop=source.stop.bind(source);
    source.start=(...args)=>{entry.starts.push(args);return start(...args);};
    source.stop=(...args)=>{entry.stops.push(args);return stop(...args);};return source;}
};
qa.energy=()=>{const meter=qa.audioContexts[0]?.qaMeter;if(!meter)return 0;const data=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(data);return Math.sqrt(data.reduce((s,x)=>s+x*x,0)/data.length);};
const send=nodecg.sendMessage.bind(nodecg);nodecg.sendMessage=(name,body)=>{qa.messages.push({name,body});return send(name,body);};
`;

export async function validateRemoteAudio(page, checks) {
  const p = await page('/presenter-remote.html');
  await p.until("document.body.dataset.audio==='suspended' && !document.getElementById('audio-unlock').hidden", 'remote offers audio activation when autoplay is blocked');
  await p.call('Runtime.evaluate', { expression: "document.getElementById('audio-unlock').click()", userGesture: true });
  await p.until("document.body.dataset.audioPlayback==='local' && document.getElementById('audio-unlock').hidden", 'audio activation starts local playback without a program owner');
  await p.eval(`
    qa.media={stems:[{id:'tone',url:'/assets/rashinban/music/remote-qa.wav',loopStartS:0,loopEndS:2,gains:{idle:1,round:1,urgent:1,results:1}}],
      fadeMs:{idle:0,round:0,urgent:0,results:0},sounds:{guess:'/assets/rashinban/effects/remote-qa.wav','five-k':'/assets/rashinban/effects/remote-qa.wav'},fiveK:{single:null,double:null}};
    qa.set('presenterMedia',qa.media);
    qa.set('presenterTimeline',{...qa.initial.presenterTimeline,music:'round',musicEpochMs:Date.now(),phase:'live',cues:[]});
  `);
  await p.until("document.body.dataset.audio==='ready' && qa.energy()>0.02", 'remote music produces audio without a shared lease');
  assert.equal(await p.eval("document.body.dataset.audioOwner"), 'false');
  await p.eval("qa.set('presenterSettings',{...nodecg.Replicant('presenterSettings').value,muted:true})");
  await p.until('qa.energy()<0.001', 'remote audio respects mute');
  await p.eval("qa.set('presenterSettings',{...nodecg.Replicant('presenterSettings').value,muted:false,audioOutput:'separate'})");
  await p.until('qa.energy()>0.02', 'remote audio resumes independently of the global output mode');
  await p.eval("qa.media.stems=[];qa.set('presenterMedia',qa.media)");
  await p.until("document.body.dataset.audio==='ready' && qa.energy()<0.001", 'cue-only fixture ready');
  await p.eval(`qa.audioSources=[];qa.cueAt=Date.now()+700;qa.expectedStart=qa.audioContexts[0].currentTime+0.7;
    qa.set('presenterTimeline',{...nodecg.Replicant('presenterTimeline').value,cues:[{id:'remote-guess',kind:'guess',atMs:qa.cueAt,untilMs:qa.cueAt+2000,playerId:null}]});`);
  await p.until('qa.audioSources.length===1', 'remote schedules a cue on its local audio clock');
  assert.ok(await p.eval('Math.abs(qa.audioSources[0].starts[0][0]-qa.expectedStart)<0.1'), 'cue audio is aligned to the same clock as local visuals');
  await p.until('qa.energy()>0.02', 'scheduled remote cue produces audio');

  // Record a short local WebM with an embedded soundtrack, then serve it through
  // the same canonical media URL path as real event clips.
  await p.eval(`(async()=>{
    const context=qa.audioContexts[0],dest=context.createMediaStreamDestination(),osc=context.createOscillator();osc.connect(dest);osc.start();
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const paint=()=>{const c=canvas.getContext('2d');c.fillStyle='#ff0044';c.fillRect(0,0,160,90);};paint();
    const stream=canvas.captureStream(30);stream.addTrack(dest.stream.getAudioTracks()[0]);const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8,opus'});const chunks=[];
    recorder.ondataavailable=e=>chunks.push(e.data);const stopped=new Promise(resolve=>recorder.onstop=resolve);const timer=setInterval(paint,30);recorder.start();
    await new Promise(resolve=>setTimeout(resolve,1500));recorder.stop();await stopped;clearInterval(timer);osc.stop();stream.getTracks().forEach(t=>t.stop());
    await fetch('/qa-effect.webm',{method:'POST',body:new Blob(chunks,{type:'video/webm'})});
    qa.asset={url:'/assets/rashinban/video/remote-qa.webm',watchdogMs:3000,soundtrack:'embedded'};
    qa.media.fiveK={single:qa.asset,double:qa.asset};qa.set('assets:video',[{url:qa.asset.url}]);qa.set('presenterMedia',qa.media);
  })()`);
  await p.until("[...document.querySelectorAll('.celebration-video')].some(v=>v.readyState>=2)", 'embedded soundtrack fixture preloaded');
  for (const effect of ['single-5k', 'double-5k']) {
    await p.eval("qa.set('presenterSettings',{...nodecg.Replicant('presenterSettings').value,effectsGain:0.5,celebrationGain:0.4,cueGains:{...qa.initial.presenterSettings.cueGains,'five-k':0}})");
    await p.eval(`qa.audioSources=[];qa.set('presenterTimeline',{...qa.initial.presenterTimeline,phase:'results-transition',effect:${JSON.stringify(effect)},cues:[{id:${JSON.stringify(effect)},kind:'five-k',atMs:Date.now()+500,untilMs:Date.now()+4000,playerId:null}]})`);
    await p.until("[...document.querySelectorAll('.celebration-video')].some(v=>!v.hidden&&!v.paused&&!v.muted&&v.volume===0.2&&v.currentTime>0.05)", effect + ' embedded audio uses global and video faders independently of the cue fader');
    assert.equal(await p.eval("(()=>{const v=[...document.querySelectorAll('.celebration-video')].find(v=>!v.hidden);const stream=v.captureStream();const audible=stream.getAudioTracks().length>0;stream.getTracks().forEach(t=>t.stop());return audible;})()"), true, 'playing celebration contains an audio track');
    assert.equal(await p.eval('qa.audioSources.length'), 0, 'embedded soundtracks do not also play the five-k cue');
    await p.eval("qa.videoTime=[...document.querySelectorAll('.celebration-video')].find(v=>!v.hidden).currentTime;qa.set('presenterSettings',{...nodecg.Replicant('presenterSettings').value,celebrationGain:0})");
    await p.until("[...document.querySelectorAll('.celebration-video')].some(v=>!v.hidden&&!v.paused&&v.volume===0&&v.currentTime>=qa.videoTime)", effect + ' video fader silences an active clip without restarting it');
    await p.eval("qa.set('presenterSettings',{...nodecg.Replicant('presenterSettings').value,celebrationGain:0.25})");
    await p.until("[...document.querySelectorAll('.celebration-video')].some(v=>!v.hidden&&!v.paused&&v.volume===0.125)", effect + ' video volume changes during playback');
    await p.until("[...document.querySelectorAll('.celebration-video')].every(v=>v.hidden)", effect + ' completes locally');
  }
  await p.eval("qa.set('presenterSettings',{...nodecg.Replicant('presenterSettings').value,effectsGain:1,celebrationGain:0,cueGains:qa.initial.presenterSettings.cueGains})");
  await p.eval(`qa.media.fiveK.single={...qa.asset,soundtrack:'cue'};qa.set('presenterMedia',qa.media)`);
  await p.until("document.body.dataset.audio==='ready'", 'separate celebration cue ready');
  await p.eval("qa.audioSources=[];qa.set('presenterTimeline',{...qa.initial.presenterTimeline,phase:'results-transition',effect:'single-5k',cues:[{id:'remote-cue-5k',kind:'five-k',atMs:Date.now()+500,untilMs:Date.now()+4000,playerId:null}]})");
  await p.until('qa.audioSources.length===1 && qa.energy()>0.02', 'remote celebration cue plays without a program owner');
  assert.equal(await p.eval("[...document.querySelectorAll('.celebration-video')].filter(v=>!v.hidden).every(v=>v.muted)"), true);
  await p.eval("qa.stopsBefore=qa.audioSources[0].stops.length;qa.set('presenterClients',{clients:[],program:{clientId:'different-main',expiresAtMs:Date.now()+6000}})");
  assert.equal(await p.eval('qa.audioSources[0].stops.length===qa.stopsBefore'), true, 'program transfer cannot cancel remote sound');
  await p.eval("qa.set('presenterTimeline',{...nodecg.Replicant('presenterTimeline').value,phase:'aborted',effect:'none',cues:[]})");
  await p.until('qa.energy()<0.001', 'aborting the local visuals stops remote sound');
  assert.equal(await p.eval("qa.messages.some(m=>['presenter:effect-ended','presenter:audio-muted'].includes(m.name))"), false, 'remote never controls shared effect/audio completion');
  checks.push('local music/cue clock, embedded 5K and 10K sound, no double soundtrack, mute and cancellation');
}
