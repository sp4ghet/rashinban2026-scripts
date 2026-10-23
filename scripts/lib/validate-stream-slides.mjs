import assert from 'node:assert/strict';
import { SLIDE_MODES, SLIDE_SEQUENCES } from '../../bundles/rashinban/src/broadcast/slides.ts';

export async function validateStreamSlides({ navigate, evaluate, until, click, screenshot, delay, values }) {
  const choose = async (selector, value) => {
    await evaluate(`{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(String(value))};el.dispatchEvent(new Event('change',{bubbles:true}));}`);
  };
  const mode = '[data-row=slides] select';
  const cue = '[data-row=slides] label:nth-of-type(2) select';
  const monitor = channel => `document.querySelector('.monitor[data-channel=${channel}] iframe.info').contentDocument`;
  await navigate('dashboard/switcher-stream.html', 1440, 1100);
  await until('document.querySelector("[data-row=slides] select") !== null');
  const originalEn = structuredClone(values.broadcast.en);
  const originalLed = structuredClone(values.broadcast.led);
  await choose(mode, 'day1-ending');
  await until(`${monitor('preview')}?.querySelector('#layer-bracket')?.hidden === false`);
  assert.equal(values.broadcast.stream.program.bracket.visible, false);
  await click('#take');
  await until(`${monitor('program')}?.querySelector('#layer-bracket')?.hidden === false`);
  await click('[data-slide-direction="1"]');
  await until(`${monitor('preview')}?.querySelector('#layer-slides')?.dataset.status === 'ready'`);
  assert.equal(values.broadcast.stream.preview.bracket.visible, false);
  assert.equal(values.broadcast.stream.program.bracket.visible, true);
  await screenshot('bracket-to-sponsor-preview');
  await click('#take');
  await until(`${monitor('program')}?.querySelector('#layer-slides')?.dataset.status === 'ready'`);
  assert.equal(values.broadcast.stream.program.bracket.visible, false);
  await click('[data-slide-direction="-1"]');
  await until('window.fixtureValues.broadcast.stream.preview.bracket.visible === true');
  await click('#revert');
  await until('window.fixtureValues.broadcast.stream.preview.slides.index === 1');

  // A hidden, previously displayed sponsor must not flash while a new image decodes.
  await click('#clear-preview');
  await until('window.fixtureValues.broadcast.stream.preview.slides.visible === false');
  await evaluate(`{ const win=document.querySelector('.monitor[data-channel=preview] iframe.info').contentWindow;
    win.originalDecode=win.HTMLImageElement.prototype.decode;
    win.HTMLImageElement.prototype.decode=function(){return new Promise(resolve=>setTimeout(resolve,600)).then(()=>win.originalDecode.call(this));}; }`);
  await choose(mode, 'day2-ending');
  await until('window.fixtureValues.broadcast.stream.preview.slides.mode === "day2-ending"');
  await until(`${monitor('preview')}?.querySelector('#layer-slides')?.dataset.status === 'loading'`);
  assert.equal(await evaluate(`(() => {const host=${monitor('preview')}.querySelector('#layer-slides');return host.hidden || host.querySelector('img')?.alt === 'Corporate award · Tamura Builds';})()`), true, 'never reveal the previous sponsor while the requested image loads');
  await until(`${monitor('preview')}?.querySelector('#layer-slides')?.dataset.status === 'ready'`);
  await evaluate(`{const win=document.querySelector('.monitor[data-channel=preview] iframe.info').contentWindow;win.HTMLImageElement.prototype.decode=win.originalDecode;}`);

  // Exercise every real cue, including both bracket entry/exit paths and clear cues.
  for (const selected of SLIDE_MODES) {
    await choose(mode, selected);
    await until(`window.fixtureValues.broadcast.stream.preview.slides.mode === ${JSON.stringify(selected)}`);
    for (const [index, expected] of SLIDE_SEQUENCES[selected].entries()) {
      await choose(cue, index);
      await until(`window.fixtureValues.broadcast.stream.preview.slides.index === ${index}`);
      if (expected.kind === 'image') {
        await until(`(() => { const host=${monitor('preview')}?.querySelector('#layer-slides');return host && !host.hidden && host.dataset.status === 'ready' && host.dataset.slide === ${JSON.stringify(expected.file)} && host.querySelector('img')?.naturalWidth > 0; })()`);
      } else {
        await until(`${monitor('preview')}?.querySelector('#layer-slides')?.hidden === true`);
        assert.equal(values.broadcast.stream.preview.bracket.visible, expected.kind === 'bracket');
      }
    }
    assert.equal(await evaluate(`document.querySelector('[data-slide-direction="1"]').disabled`), true);
  }
  assert.deepEqual(values.broadcast.en, originalEn);
  assert.deepEqual(values.broadcast.led, originalLed);
  await choose(mode, 'day1-opening');
  await until(`${monitor('preview')}?.querySelector('#layer-slides')?.dataset.status === 'ready'`);
  await screenshot('dashboard');
  await click('#clear-preview');
  await until('window.fixtureValues.broadcast.stream.preview.slides.visible === false');

  for (const layout of ['stream', 'led']) {
    await navigate('graphics/interval-' + layout + '.html');
    assert.equal(await evaluate('document.querySelectorAll(".interval-slide").length'), 2, 'interval needs two images for a crossfade');
    await until('document.querySelector(".interval-slide.visible")?.naturalWidth > 0');
    await evaluate(`window.slideChanges=[];new MutationObserver(()=>{const img=document.querySelector('.interval-slide.visible'); if(img && window.slideChanges.at(-1)?.src!==img.src)window.slideChanges.push({src:img.src,time:performance.now()});}).observe(document.querySelector('.interval-slides'),{subtree:true,attributes:true,attributeFilter:['class']});window.slideStarted=performance.now();`);
    const first = await evaluate('document.querySelector(".interval-slide.visible").src');
    await screenshot('interval-' + layout);
    await delay(9300);
    assert.equal(await evaluate('document.querySelector(".interval-slide.visible").src'), first, 'hold the current image for 10 seconds');
    await until('window.slideChanges.length > 0');
    const change = await evaluate('window.slideChanges[0].time-window.slideStarted');
    assert.ok(change >= 9700 && change < 11000, 'expected ~10,160 ms cadence, got ' + change);
    await delay(180);
    const opacity = await evaluate('[...document.querySelectorAll(".interval-slide")].map(img=>Number(getComputedStyle(img).opacity))');
    assert.ok(opacity.every(value=>value>0 && value<1), 'both images participate in the crossfade: ' + opacity);
    await delay(600);
    assert.notEqual(await evaluate('document.querySelector(".interval-slide.visible").src'), first);
  }
}
