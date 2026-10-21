// Real built LED pages with isolated NodeCG fixtures; no live state is touched.
import assert from 'node:assert/strict';

export async function verifyLedPages({ navigate, evaluate, until, screenshot, delay, command }) {
  await command('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  for (const query of ['', '?channel=preview']) {
    await navigate('/bundles/rashinban/graphics/info-led.html' + query, 'document.querySelector("#cards")');
    await evaluate(`emit('broadcast',undefined)`);
    await delay(550);
    assert.equal(await evaluate(`document.querySelector('#cards').classList.contains('visible')`), true, 'LED cards stay on with default/absent broadcast state');
    assert.equal(await evaluate(`document.querySelector('#banpick').classList.contains('visible')`), true, 'LED ban/pick stays on');
    assert.equal(await evaluate(`document.querySelector('#bracket')`), null, 'bracket is a separate source');
    await evaluate(`emit('broadcast',{stream:{preview:{playerCards:{page:'compact'}},program:{playerCards:{page:'stats',visible:false,player:'right',position:'right'}}},led:{program:{playerCards:{visible:false,page:'profile'},banpick:{visible:false}}}})`);
    assert.equal(await evaluate(`document.querySelector('#cards').dataset.page`), 'stats', 'LED follows Stream Program, not LED or Stream Preview');
    assert.equal(await evaluate(`document.querySelectorAll('.pcard:not([hidden])').length`), 2, 'Stream player selection never hides an LED player');
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.pcard')].map(c=>c.getBoundingClientRect().x)`), [36, 1404], 'Stream position never moves the LED cards');
    for (const page of ['profile', 'compact', 'stats']) {
      await evaluate(`{const s=structuredClone(fixtureValues.broadcast);s.stream.program.playerCards.page=${JSON.stringify(page)};emit('broadcast',s);}`);
      assert.equal(await evaluate(`document.querySelector('#cards').dataset.page`), page);
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('#cards')).opacity`), '1');
      const count = page === 'profile' ? 0 : 3;
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('.pcard')].map(c=>c.querySelectorAll('.result-row').length)`), [count, count]);
    }
    await screenshot(query ? 'led-pages-legacy-preview-url' : 'led-pages-cards');
    await evaluate(`emit('matchResolved',null)`);
    assert.equal(await evaluate(`document.querySelector('#cards').classList.contains('visible')`), false, 'missing match does not show stale players');
  }

  await navigate('/bundles/rashinban/graphics/bracket-led.html', 'document.querySelector("#match1-top")?.textContent');
  await evaluate(`emit('broadcast',undefined)`);
  assert.equal(await evaluate(`document.querySelector('#layer-bracket').hidden`), false, 'bracket is always on');
  assert.equal(await evaluate(`document.querySelector('#cards')`), null);
  assert.equal(await evaluate(`document.querySelector('#banpick')`), null);
  const background = await evaluate(`(() => {
    const bracket=document.querySelector('#led-bracket');
    const tint=getComputedStyle(bracket,'::before');
    const svg=bracket.querySelector('svg');
    const ancestors=[];for(let e=svg;e;e=e.parentElement)ancestors.push(getComputedStyle(e).opacity);
    return {tint:tint.backgroundImage,opacity:Number(tint.opacity),rootImage:getComputedStyle(bracket).backgroundImage,
      foreground:ancestors,rect:bracket.getBoundingClientRect().toJSON(),
      boxOpacity:getComputedStyle(document.querySelector('.match--player-background')).fillOpacity,
      textOpacity:getComputedStyle(document.querySelector('.match--player-name')).fillOpacity};
  })()`);
  assert.match(background.tint, /linear-gradient/, 'red/blue tint retained');
  assert.doesNotMatch(background.tint, /url\(/, 'static KV removed');
  assert.equal(background.rootImage, 'none', 'no opaque background behind the tint');
  assert.ok(background.opacity > 0 && background.opacity < 1, 'tint alone is translucent');
  assert.ok(background.foreground.every(value => value === '1'), 'no ancestor fades the bracket foreground');
  assert.equal(background.boxOpacity, '1');
  assert.equal(background.textOpacity, '1');
  assert.equal(background.rect.height, 576);
  // Remove the harness backdrop to capture the actual alpha channel.
  await evaluate(`document.body.style.setProperty('background','transparent','important')`);
  await command('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await screenshot('led-pages-bracket-alpha');
  // A colorful stand-in for the OBS background video makes the tint visible.
  await evaluate(`document.body.style.setProperty('background','linear-gradient(120deg,#c5a557,#356f7d,#71559f)','important')`);
  await screenshot('led-pages-bracket-composite');
  await command('Emulation.setDefaultBackgroundColorOverride');

  await navigate('/bundles/rashinban/graphics/presenter-led.html', 'document.body.dataset.role === "led"');
  await evaluate(`emit('broadcast',{led:{program:{presenter:{visible:false}},preview:{presenter:{visible:false}}}})`);
  await delay(100);
  assert.equal(await evaluate(`document.body.classList.contains('blanked')`), false, 'old LED visibility cannot blank presenter');
  assert.equal(await evaluate(`document.body.dataset.role`), 'led', 'presenter keeps its silent LED role');
  await screenshot('led-pages-presenter');
}
