import assert from 'node:assert/strict';

// Exercise painted frames, asset loads and placement on the actual built pages.
export async function validateSponsorRotation(evaluate, screenshot, layout, prefix = layout) {
  const selector = layout === 'presenter' ? '.presenter-sponsor' : '.interval-sponsors img';
  assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`), 1,
    `${prefix}: only one sponsor slide is displayed at a time`);
  const result = await evaluate(`(async () => {
    const img = document.querySelector(${JSON.stringify(selector)});
    const timer = fixtureIntervals.find(timer => timer.ms === 12000);
    if (!timer) throw Error('Sponsor rotation is missing');
    clearInterval(timer.id);
    const changes = [], samples = [];
    const observer = new MutationObserver(() => changes.push({name: img.alt, opacity: Number(getComputedStyle(img).opacity)}));
    observer.observe(img, {attributes: true, attributeFilter: ['src']});
    timer.callback();
    const started = new Date().getTime();
    while (new Date().getTime() - started < 1050) {
      samples.push({name: img.alt, opacity: Number(getComputedStyle(img).opacity)});
      await new Promise(requestAnimationFrame);
    }
    observer.disconnect();
    return {changes, samples};
  })()`);
  for (const name of ['TAMURA BUILDS', 'GeoGuessr']) {
    assert.ok(result.samples.some(s => s.name === name && s.opacity > .05 && s.opacity < .95), `${prefix}: ${name} fades`);
  }
  assert.ok(result.changes.length && result.changes.every(s => s.opacity < .01), `${prefix}: swap only when invisible: ${JSON.stringify(result.changes)}`);
  const expected = layout === 'presenter'
    ? [['GeoGuessr', 816, 340], ['Voicemod', 768, 384], ['TAMURA BUILDS', 672.5, 575]]
    : layout === 'led'
      ? [['GeoGuessr', 888, 144], ['Voicemod', 848, 224], ['Supporting sponsors', 583, 795], ['TAMURA BUILDS', 819, 282]]
      : [['GeoGuessr', 1140, 340], ['Voicemod', 1100, 384], ['Supporting sponsors', 716, 1127], ['TAMURA BUILDS', 964, 598]];
  for (const [name, x, width] of expected) {
    const box = await evaluate(`(() => {
      const img = document.querySelector(${JSON.stringify(selector)}), rect = img.getBoundingClientRect();
      return {name: img.alt, x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        loaded: img.complete && img.naturalWidth > 0, opacity: Number(getComputedStyle(img).opacity), visible: img.checkVisibility()};
    })()`);
    assert.equal(box.name, name, `${prefix}: rotation order`);
    assert.ok(box.loaded && box.visible && box.opacity === 1, `${prefix}: ${name} is fully visible and loaded`);
    assert.ok(Math.abs(box.x - x) < 1 && Math.abs(box.width - width) < 1, `${prefix}: ${name} respects the reference x and size: ${JSON.stringify(box)}`);
    const centerY = layout === 'presenter' ? 955 : layout === 'led' ? 504.5 : 956.5;
    assert.ok(Math.abs(box.y + box.height / 2 - centerY) < 1, `${prefix}: ${name} stays in the on-screen sponsor slot`);
    assert.ok(box.y >= 0 && box.y + box.height <= (layout === 'led' ? 576 : 1035), `${prefix}: ${name} is not clipped`);
    await screenshot(`${prefix}-sponsor-${name.toLowerCase().replaceAll(' ', '-')}`);
    await evaluate(`new Promise(resolve => { fixtureIntervals.find(timer => timer.ms === 12000).callback(); setTimeout(resolve, 1050); })`);
  }
  return result;
}
