import assert from 'node:assert/strict';
import { createInitialState } from '../bundles/rashinban/src/broadcast/state.ts';

// Built graphics and real dropdown handlers, using the isolated fixture server.
export async function verifyCasters({ navigate, evaluate, until, screenshot, delay, command }) {
  const directory = [
    { name: 'Stephen', role: '解説', twitter: 'StephGeoguessr' },
    { name: 'Kai', role: '実況', twitter: 'KaiGeoguessr' },
    { name: 'SD', role: 'MC', twitter: 'sd_geoguessr' },
    { name: 'めうめう', role: '', twitter: '' },
    { name: '<img src=x onerror=alert(1)>', role: 'Guest', twitter: '' },
  ];
  const message = (name, data) => evaluate(`nodecg.sendMessage(${JSON.stringify(name)},${JSON.stringify(data)})`);
  const patch = casters => message('broadcast:setPreview', { output: 'stream', patch: { casters } });
  const take = () => message('broadcast:take', { output: 'stream' });
  await command('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await navigate('/bundles/rashinban/graphics/info-stream.html', 'document.querySelector("#casters")');
  const initial = createInitialState().stream.preview;
  await message('broadcast:setPreview', { output: 'stream', patch: initial });
  await take();
  await delay(600); // Let the previously visible fixture layers finish hiding.
  assert.equal(await evaluate(`document.querySelectorAll('#casters .topbar,#casters .mark,#casters .banner').length`), 0, 'caster title and sponsor banner are removed');
  await evaluate(`emit('casters',${JSON.stringify(directory)})`);
  await patch({ slots: [true, true], names: { left: 'Stephen', right: 'Kai' } });
  assert.equal(await evaluate(`document.querySelector('#caster-1').hidden`), true, 'preview selection does not put program on air');
  await take();
  await evaluate(`window.casterAnimations=[...document.querySelector('#casters').getAnimations({subtree:true})];casterAnimations.forEach(a=>{a.pause();a.currentTime=0;})`);
  await evaluate('document.fonts.ready');
  if (process.argv.includes('--adobe-fonts')) {
    assert.ok(await evaluate(`[...document.fonts].some(font=>font.family.includes('kaneda-gothic')&&font.status==='loaded')`), 'production Kaneda Gothic font is loaded');
  }
  const clip = selector => evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).clipPath`);
  assert.equal(await clip('#caster-1 .name'), 'inset(0px 50%)');
  for (const time of [100, 350, 750, 3700]) {
    await evaluate(`casterAnimations.forEach(a=>a.currentTime=${time})`);
    if (time === 100) {
      assert.notEqual(await clip('#caster-1 .name'), 'inset(0px 50%)', 'name starts immediately, with no black pre-roll');
      assert.equal(await clip('#caster-1 .role'), 'inset(0px 50%)', 'role follows name');
      assert.equal(await clip('#caster-1 .handle'), 'inset(0px 50%)', 'handle follows last');
    }
    if (time === 350) {
      assert.notEqual(await clip('#caster-1 .name'), await clip('#caster-1 .name .band-content'), 'white leading edge remains ahead of the red strip');
    }
    await screenshot(`casters-pair-${time}ms`);
  }
  await evaluate('casterAnimations.forEach(a=>a.finish())');
  const pair = await evaluate(`[...document.querySelectorAll('.caster:not([hidden])')].map(el=>({name:el.querySelector('.name').textContent,x:el.offsetLeft,y:el.offsetTop,width:el.offsetWidth}))`);
  assert.deepEqual(pair, [
    { name: 'Stephen', x: 330, y: 180, width: 390 },
    { name: 'Kai', x: 1200, y: 180, width: 390 },
  ]);
  await evaluate(`emit('casters',structuredClone(fixtureValues.casters));emit('broadcast',structuredClone(fixtureValues.broadcast));`);
  assert.ok(await evaluate(`casterAnimations.every(a=>document.querySelector('#casters').getAnimations({subtree:true}).includes(a))`), 'sheet polling/unrelated bus updates do not replay cards');

  await patch({ slots: [false, false], center: true, names: { center: 'SD' } });
  await take(); await delay(3800);
  assert.equal(await evaluate(`document.querySelector('#caster-1').hidden&&document.querySelector('#caster-2').hidden`), true);
  assert.deepEqual(await evaluate(`(()=>{const e=document.querySelector('#caster-3'),r=e.getBoundingClientRect();return {name:e.querySelector('.name').textContent,x:r.x,y:r.y,width:r.width,height:r.height}})()`),
    { name: 'SD', x: 765, y: 729, width: 390, height: 170 });
  await screenshot('casters-center');
  // Hiding during the reveal must not flash bands that have not appeared yet.
  await patch({ center: false }); await take(); await delay(300);
  await patch({ center: true }); await take();
  await evaluate(`document.querySelector('#caster-3').getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=50;})`);
  const currentClips = () => evaluate(`[...document.querySelectorAll('#caster-3 .band,#caster-3 .band-content')].map(e=>getComputedStyle(e).clipPath)`);
  const partialClips = await currentClips();
  await patch({ center: false }); await take();
  await evaluate(`document.querySelector('#caster-3').getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=0;})`);
  assert.deepEqual(await currentClips(), partialClips, 'early hide starts at the current masks without flashing the unopened strips');
  await evaluate(`document.querySelector('#caster-3').getAnimations({subtree:true}).forEach(a=>a.finish())`);
  await delay(50);
  // A rapid hide/show must cancel the old completion callback.
  await patch({ center: false }); await take();
  await patch({ center: true }); await take(); await delay(300);
  assert.equal(await evaluate(`document.querySelector('#caster-3').hidden`), false);
  await patch({ names: { center: 'めうめう' } }); await take(); await delay(1800);
  assert.equal(await evaluate(`document.querySelector('#caster-3 .name').classList.contains('kana')`), true);
  assert.equal(await evaluate(`document.querySelector('#caster-3 .role').hidden&&document.querySelector('#caster-3 .handle').hidden`), true);
  await screenshot('casters-japanese');
  await evaluate(`emit('casters',[])`); await delay(300);
  assert.equal(await evaluate(`document.querySelector('#caster-3').hidden`), true, 'missing sheet row hides the stale card');
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await evaluate(`emit('casters',${JSON.stringify(directory)})`);
  assert.equal(await evaluate(`document.querySelector('#caster-3').hidden`), false);
  assert.equal(await evaluate(`document.querySelector('#caster-3').getAnimations({subtree:true}).length`), 0);
  await command('Emulation.setEmulatedMedia', { features: [] });

  await command('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate('/bundles/rashinban/dashboard/switcher-stream.html', 'document.querySelectorAll("[data-row=casters] select").length===3');
  const preview = `document.querySelector('[data-channel=preview] iframe.info').contentDocument`;
  const program = `document.querySelector('[data-channel=program] iframe.info').contentDocument`;
  await until(`${preview}?.querySelector('#caster-3')&&${program}?.querySelector('#caster-3')`);
  await evaluate(`emit('casters',${JSON.stringify(directory)});for(const frame of document.querySelectorAll('iframe.info'))frame.contentWindow.emit('casters',${JSON.stringify(directory)});`);
  const choose = (index, name) => evaluate(`(()=>{const s=document.querySelectorAll('[data-row=casters] select')[${index}];s.focus();s.value=${JSON.stringify(name)};s.dispatchEvent(new Event('change',{bubbles:true}));s.blur()})()`);
  await choose(2, 'SD');
  await until(`fixtureValues.broadcast.stream.preview.casters.names.center==='SD'`);
  assert.equal(await evaluate(`fixtureValues.broadcast.stream.program.casters.names.center`), 'めうめう');
  assert.equal(await evaluate(`${program}.querySelector('#caster-3 .name').textContent`), 'めうめう');
  assert.equal(await evaluate(`${preview}.querySelector('#caster-3 .name').textContent`), 'SD');
  await evaluate(`document.querySelector('#revert').click()`);
  await until(`document.querySelectorAll('[data-row=casters] select')[2].value==='めうめう'`);
  await choose(2, 'SD'); await until(`fixtureValues.broadcast.stream.preview.casters.names.center==='SD'`);
  await evaluate(`document.querySelector('#take').click()`);
  await until(`${program}.querySelector('#caster-3 .name').textContent==='SD'`);
  await delay(3800); await screenshot('casters-stream-controller');
  const clickPair = () => evaluate(`document.querySelector('[data-row=casters] button').click()`);
  await clickPair();
  await until(`fixtureValues.broadcast.stream.preview.casters.slots.every(Boolean)`);
  assert.deepEqual(await evaluate(`fixtureValues.broadcast.stream.program.casters.slots`), [false, false]);
  assert.equal(await evaluate(`document.querySelector('[data-row=casters] button').getAttribute('aria-pressed')`), 'true');
  assert.equal(await evaluate(`fixtureValues.broadcast.stream.preview.casters.center`), true);
  await evaluate(`document.querySelector('#swap').click()`);
  await until(`fixtureValues.broadcast.stream.program.casters.slots.every(Boolean)&&fixtureValues.broadcast.stream.preview.casters.slots.every(v=>!v)`);
  await until(`${program}.querySelector('#caster-1').dataset.visible==='true'&&${program}.querySelector('#caster-2').dataset.visible==='true'`);
  await evaluate(`document.querySelector('#swap').click()`);
  await until(`fixtureValues.broadcast.stream.preview.casters.slots.every(Boolean)&&fixtureValues.broadcast.stream.program.casters.slots.every(v=>!v)`);
  await evaluate(`document.querySelector('#clear-preview').click()`);
  await until(`!fixtureValues.broadcast.stream.preview.casters.center&&fixtureValues.broadcast.stream.preview.casters.slots.every(v=>!v)`);
  await until(`${preview}.querySelector('#caster-1').hidden&&${preview}.querySelector('#caster-2').hidden&&${preview}.querySelector('#caster-3').hidden`);
  assert.equal(await evaluate(`fixtureValues.broadcast.stream.preview.casters.names.center`), 'SD');
  assert.equal(await evaluate(`${program}.querySelector('#caster-3').hidden`), false, 'clear preview leaves program on air');
  await screenshot('casters-cleared-preview');
  await evaluate(`document.querySelector('#revert').click()`);
  await until(`fixtureValues.broadcast.stream.preview.casters.center&&document.querySelector('#swap').disabled`);
  // A legacy/Companion half-pair still counts as on and one click hides both.
  await patch({ slots: [false, true] });
  assert.equal(await evaluate(`document.querySelector('[data-row=casters] button').getAttribute('aria-pressed')`), 'true');
  await clickPair();
  await until(`fixtureValues.broadcast.stream.preview.casters.slots.every(v=>!v)`);
  await choose(2, ''); await until(`fixtureValues.broadcast.stream.preview.casters.names.center===''`);
  assert.equal(await evaluate(`${program}.querySelector('#caster-3').hidden`), false);
  await evaluate(`document.querySelector('#take').click()`);
  await until(`${program}.querySelector('#caster-3').hidden`);
  await patch({ names: { left: 'Missing caster', right: '<img src=x onerror=alert(1)>' } });
  assert.match(await evaluate(`document.querySelectorAll('[data-row=casters] select')[0].selectedOptions[0].textContent`), /not in sheet/);
  assert.equal(await evaluate(`document.querySelectorAll('[data-row=casters] select img').length`), 0, 'sheet names are text, never markup');
  await evaluate(`emit('casters',[])`);
  assert.equal(await evaluate(`document.querySelectorAll('[data-row=casters] select')[0].value`), 'Missing caster', 'empty directory preserves operator selection');
  console.log('Casters verified: staggered masked reveal, pair/center geometry, no title/banner, no replay on refresh, rapid hide/show, missing rows, Japanese names, reduced motion, paired toggle, three dropdowns, Preview/TAKE/SWAP/clear/revert, safe option text.');
}
