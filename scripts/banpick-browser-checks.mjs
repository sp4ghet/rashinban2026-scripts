import assert from 'node:assert/strict';

// Runs inside validate-player-cards.mjs's isolated fixture server and browser.
export async function verifyBanpick({ navigate, evaluate, until, screenshot, delay, command, adobeFonts = false }) {
  await command('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const message = (name, data) => evaluate(`nodecg.sendMessage(${JSON.stringify(name)},${JSON.stringify(data) ?? 'undefined'})`);
  const select = id => message('banpick:act', { optionId: id });
  const entries = () => evaluate(`[...document.querySelectorAll('.bp-stack-entry')].map(row=>({id:Number(row.dataset.id),status:row.dataset.status,by:row.dataset.by}))`);
  const checkFits = async output => {
    const layout = await evaluate(`(() => {
      const root=document.querySelector('#banpick'), r=root.getBoundingClientRect();
      const rows=[...root.querySelectorAll('.bp-stack-entry')];
      return {rect:r.toJSON(),fits:rows.every(row=>{
        const box=row.getBoundingClientRect();
        return box.left>=r.left&&box.right<=r.right&&box.bottom<=r.bottom&&
          [...row.querySelectorAll('.bp-selection-kind,.bp-selection-mode,.bp-selection-map')].every(el=>{
            const t=el.getBoundingClientRect();
            return t.left>=box.left&&t.right<=box.right&&t.top>=box.top&&t.bottom<=box.bottom&&el.scrollWidth<=el.clientWidth;
          });
      })};
    })()`);
    if (!layout.fits) {
      await screenshot(`banpick-${output}-overflow`);
      console.log(JSON.stringify(await evaluate(`[...document.querySelectorAll('.bp-stack-entry')].map(row=>({row:row.getBoundingClientRect().toJSON(),text:[...row.querySelectorAll('.bp-selection-kind,.bp-selection-mode,.bp-selection-map')].map(el=>({text:el.textContent,rect:el.getBoundingClientRect().toJSON(),font:getComputedStyle(el).font,width:el.clientWidth,scroll:el.scrollWidth}))}))`)));
    }
    assert.ok(layout.fits, `${output}: all map names and labels fit their rows`);
    assert.ok(await evaluate(`(() => {const h=document.querySelector('.bp-stack-heading'),r=h.getBoundingClientRect();return [...h.children].every(el=>{const b=el.getBoundingClientRect();return b.left>=r.left&&b.right<=r.right&&el.scrollWidth<=el.clientWidth;});})()`), 'match label and game number fit the black header');
    assert.equal(layout.rect.x, output === 'led' ? 540 : 73);
    assert.equal(layout.rect.y, output === 'led' ? 24 : 77);
    assert.equal(layout.rect.width, output === 'led' ? 840 : 450);
    assert.ok(layout.rect.bottom <= (output === 'led' ? 576 : 1080));
    if (output === 'led') {
      assert.ok(await evaluate(`(() => {
        const b=document.querySelector('#banpick').getBoundingClientRect();
        return [...document.querySelectorAll('.pcard')].every(el=>{
          const c=el.getBoundingClientRect();return c.top===b.top&&(c.right<=b.left||c.left>=b.right);
        });
      })()`), 'LED stack leaves both player cards clear');
    }
  };
  for (const output of ['stream', 'led']) {
    await navigate(`/bundles/rashinban/graphics/info-${output}.html`, 'document.querySelector("#banpick.visible")');
    await message('banpick:reset');
    assert.deepEqual(await entries(), []);
    await evaluate(`{const m=structuredClone(fixtureValues.matchResolved);m.label='Lower Quarter-Finals Match 2';emit('matchResolved',m);}`);
    assert.equal(await evaluate(`document.querySelector('.bp-match')?.textContent`), 'Lower Quarter-Finals Match 2');
    assert.equal(await evaluate(`document.querySelector('.bp-stage').textContent`), 'GAME 1');
    if (adobeFonts) {
      await until(`[...document.fonts].some(font=>font.family.includes('kaneda-gothic')&&font.status==='loaded')`);
      await evaluate('document.fonts.ready');
    }
    await select(4); await select(7); await select(1);
    assert.deepEqual((await entries()).map(row => row.id), [1, 7, 4]);
    assert.equal(await evaluate(`document.querySelector('.bp-selection-kind').textContent`), 'PICK /');
    await checkFits(output); await screenshot(`banpick-${output}-game-1`);
    // Stage changes clear immediately, before anyone confirms the next pick.
    await message('banpick:nextGame');
    assert.deepEqual(await entries(), []);
    assert.equal(await evaluate(`document.querySelector('.bp-stage').textContent`), 'GAME 2');
    await select(2);
    assert.deepEqual((await entries()).map(row => row.id), [2]);
    await checkFits(output); await screenshot(`banpick-${output}-game-2`);
    await message('banpick:nextGame');
    assert.deepEqual(await entries(), []);
    for (const [index, id] of [5, 6, 3, 8].entries()) {
      await select(id);
      assert.deepEqual((await entries()).filter(row=>row.status==='banned').map(row=>row.id), [5, 6, 3, 8].slice(0,index+1).reverse());
    }
    assert.deepEqual(await entries(), [
      { id: 9, status: 'remaining', by: '' }, { id: 8, status: 'banned', by: 'B' },
      { id: 3, status: 'banned', by: 'A' }, { id: 6, status: 'banned', by: 'A' }, { id: 5, status: 'banned', by: 'B' },
    ]);
    assert.equal(await evaluate(`document.querySelector('.bp-selection-kind').textContent`), 'DECIDER /');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.bp-selection-map')).textTransform`), 'uppercase');
    await checkFits(output); await screenshot(`banpick-${output}-game-3`);
    await evaluate(`{const m=structuredClone(fixtureValues.matchResolved);m.label='Lower Quarter-Finals Match 2 - Tournament Championship';emit('matchResolved',m);}`);
    await checkFits(output);
    await evaluate(`emit('matchResolved',null)`);
    assert.equal(await evaluate(`document.querySelector('.bp-match').textContent`), '', 'cleared match does not leave a stale title');
    await message('banpick:undo');
    assert.deepEqual((await entries()).map(row => row.id), [3, 6, 5]);
    await message('banpick:reset'); assert.deepEqual(await entries(), []);
    await evaluate(`{const s=structuredClone(fixtureValues.broadcast);s.${output}.program.banpick.visible=false;emit('broadcast',s);}`);
    await delay(350);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('#banpick')).opacity`), output === 'led' ? '1' : '0', 'only Stream responds to visibility controls');
  }

  // The screen edge follows the acting player even on the other player's tablet.
  await message('banpick:reset');
  await navigate('/bundles/rashinban/graphics/banpick-player.html?player=B', 'document.querySelectorAll(".bp-card").length===9');
  const frame = () => evaluate(`(() => {const p=document.querySelector('#panel'),s=getComputedStyle(p,'::before');return {color:s.borderTopColor,width:s.borderTopWidth,turn:p.dataset.turn,text:document.querySelector('#step').textContent};})()`);
  assert.deepEqual(await frame(), { color: 'rgb(255, 48, 48)', width: '36px', turn: 'A', text: 'Player A : BAN' });
  assert.equal(await evaluate(`document.querySelectorAll('.bp-card:not(:disabled)').length`), 0);
  await screenshot('banpick-tablet-player-a');
  await select(4);
  assert.equal((await frame()).color, 'rgb(48, 131, 255)');
  assert.equal((await frame()).text, 'Player B : BAN');
  assert.equal(await evaluate(`document.querySelectorAll('.bp-card:not(:disabled)').length`), 8);
  await screenshot('banpick-tablet-player-b');
  await select(7); await select(1);
  assert.equal((await frame()).turn, '');
  assert.equal((await frame()).color, 'rgb(92, 98, 112)', 'between games no player owns the frame');
  await message('banpick:nextGame');
  assert.equal((await frame()).text, 'Player B : PICK GAME 2');
  await screenshot('banpick-tablet-pick-game-2');
  const tabletFits = () => evaluate(`(() => {
    const edge=parseFloat(getComputedStyle(document.querySelector('#panel'),'::before').borderTopWidth);
    return document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight&&
      [...document.querySelectorAll('.bp-card')].every(card=>{const r=card.getBoundingClientRect(),m=card.querySelector('.bp-card-map').getBoundingClientRect();return r.left>=edge&&r.right<=innerWidth-edge&&r.bottom<=innerHeight-edge&&m.left>=r.left&&m.right<=r.right&&m.top>=r.top&&m.bottom<=r.bottom;})&&
      [...document.querySelectorAll('.player span,#step')].every(el=>{const r=el.getBoundingClientRect(),p=el.parentElement.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right&&r.top>=p.top&&r.bottom<=p.bottom;});
  })()`);
  for (const [width,height] of [[1920,1080],[1280,800],[1024,768],[768,1024]]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await delay(100);
    assert.ok(await tabletFits(), `tablet board and heading fit ${width}x${height}`);
    await screenshot(`banpick-tablet-${width}x${height}`);
  }
  await command('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.querySelector('.bp-card[data-id="3"]').click()`);
  await delay(250);
  await screenshot('banpick-tablet-confirmation');
  assert.ok(await evaluate(`(() => {const c=document.querySelector('#confirm').getBoundingClientRect();return [...document.querySelectorAll('.bp-card')].every(el=>{const r=el.getBoundingClientRect();return c.bottom<=r.top||c.top>=r.bottom||c.right<=r.left||c.left>=r.right;});})()`), 'confirmation leaves every map card visible for second-tap confirmation');
  await evaluate(`document.querySelector('#confirm-no').click()`);
  await evaluate(`{const s=structuredClone(fixtureValues.banPick);s.players.A='めうMeU';s.players.B='とても長いプレイヤー名 / Long Player Name';emit('banPick',s);}`);
  assert.ok(await tabletFits(), 'Japanese and long player names fit the tablet header and turn label');
  await screenshot('banpick-tablet-long-names');
  await command('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await message('banpick:reset');

  // Real dashboard controls, including the second-click selection confirmation.
  await navigate('/bundles/rashinban/dashboard/banpick-control.html', 'document.querySelectorAll(".bp-card").length===9');
  assert.equal(await evaluate(`document.querySelector('#next-game').disabled`), true);
  for (const id of [4, 7, 1]) {
    await evaluate(`document.querySelector('.bp-card[data-id="${id}"]').click()`);
    await evaluate(`document.querySelector('.bp-card[data-id="${id}"]').click()`);
    await until(`fixtureValues.banPick.actions.some(action=>action.optionId===${id})`);
  }
  assert.equal(await evaluate(`document.querySelectorAll('.bp-card:not(:disabled)').length`), 0);
  await evaluate(`document.querySelector('#next-game').click()`);
  await until(`fixtureValues.banPick.game===2`);
  assert.equal(await evaluate(`document.querySelectorAll('.bp-card:not(:disabled)').length`), 6);
  assert.equal(await evaluate(`document.querySelector('#next-game').disabled`), true);
  await select(2);
  assert.equal(await evaluate(`document.querySelector('#next-game').textContent`), 'Next game (1–1 only)');
  await screenshot('banpick-dashboard-game-2');
  await evaluate(`document.querySelector('#next-game').click()`);
  await until(`fixtureValues.banPick.game===3`);
  await evaluate(`document.querySelector('#undo').click()`);
  await until(`fixtureValues.banPick.game===2`);
  assert.equal(await evaluate(`fixtureValues.banPick.actions.length`), 4);

  // Both personal and shared tablets are disabled between games.
  for (const query of ['', '?player=A', '?player=B']) {
    await navigate('/bundles/rashinban/graphics/banpick-player.html' + query, 'document.querySelectorAll(".bp-card").length===9');
    assert.equal(await evaluate(`document.querySelectorAll('.bp-card:not(:disabled)').length`), 0);
    assert.match(await evaluate(`document.querySelector('#step').textContent`), /GAME 2 READY/);
    assert.equal(await evaluate(`document.querySelector('#confirm').classList.contains('visible')`), false);
  }
  await message('banpick:nextGame');
  assert.equal(await evaluate(`document.querySelectorAll('.bp-card:not(:disabled)').length`), 5, 'P2 tablet unlocks for the first Game 3 ban');
  await select(5);
  assert.equal(await evaluate(`document.querySelectorAll('.bp-card:not(:disabled)').length`), 0, 'P2 tablet locks for P1 bans');
  await navigate('/bundles/rashinban/graphics/banpick-player.html?player=A', 'document.querySelectorAll(".bp-card").length===9');
  assert.equal(await evaluate(`document.querySelectorAll('.bp-card:not(:disabled)').length`), 4);
  // First click selects; another option replaces it; a second click confirms once.
  await evaluate(`document.querySelector('.bp-card[data-id="3"]').click()`);
  assert.equal(await evaluate(`fixtureValues.banPick.actions.length`), 5);
  await evaluate(`document.querySelector('.bp-card[data-id="6"]').click()`);
  assert.equal(await evaluate(`fixtureValues.banPick.actions.length`), 5);
  await evaluate(`document.querySelector('.bp-card[data-id="6"]').click()`);
  await until(`fixtureValues.banPick.actions.length===6`);
  assert.equal(await evaluate(`fixtureValues.banPick.actions.at(-1).optionId`), 6);
  // The explicit menu still allows cancellation and confirmation.
  await evaluate(`document.querySelector('.bp-card[data-id="3"]').click();document.querySelector('#confirm-no').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('.bp-selected').length`), 0);
  await evaluate(`document.querySelector('.bp-card[data-id="3"]').click();document.querySelector('#confirm-yes').click()`);
  await until(`fixtureValues.banPick.actions.length===7`);
  assert.equal(await evaluate(`document.querySelectorAll('.bp-card:not(:disabled)').length`), 0);
  // Real touch input confirms too; rapid extra taps cannot send duplicates.
  await navigate('/bundles/rashinban/graphics/banpick-player.html?player=B', 'document.querySelectorAll(".bp-card").length===9');
  await evaluate(`{const send=nodecg.sendMessage;window.banpickSends=0;nodecg.sendMessage=async(...args)=>{window.banpickSends++;await new Promise(resolve=>setTimeout(resolve,300));return send(...args);};}`);
  await command('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const touchOption = async () => {
    const point = await evaluate(`(()=>{const r=document.querySelector('.bp-card[data-id="8"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await touchOption();
  assert.equal(await evaluate(`fixtureValues.banPick.actions.length`), 7);
  assert.equal(await evaluate(`document.querySelector('.bp-selected').dataset.id`), '8');
  await touchOption();
  assert.equal(await evaluate(`document.querySelector('#confirm-yes').disabled`), true);
  await evaluate(`document.querySelector('.bp-card[data-id="8"]').click();document.querySelector('#confirm-yes').click()`);
  await until(`fixtureValues.banPick.actions.length===8`);
  assert.equal(await evaluate(`window.banpickSends`), 1);
  await command('Emulation.setTouchEmulationEnabled', { enabled: false });
  console.log('Ban & Pick verified: all three stacks, newest-first ordering, automatic decider, undo/reset, stream/LED bounds, player-card clearance, dashboard Next game, paused tablet input, turn locks, second-click/tap confirmation, explicit Confirm/Cancel and duplicate-submit protection.');
}
