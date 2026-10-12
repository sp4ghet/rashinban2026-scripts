import assert from 'node:assert/strict';

// Runs inside validate-player-cards.mjs's isolated fixture server and browser.
export async function verifyBanpick({ navigate, evaluate, until, screenshot, delay, command }) {
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
    assert.equal(layout.rect.x, output === 'led' ? 552 : 60);
    assert.equal(layout.rect.y, output === 'led' ? 24 : 60);
    assert.equal(layout.rect.width, output === 'led' ? 816 : 440);
    assert.ok(layout.rect.bottom <= (output === 'led' ? 552 : 1080));
    if (output === 'led') {
      assert.ok(await evaluate(`(() => {
        const b=document.querySelector('#banpick').getBoundingClientRect();
        return [...document.querySelectorAll('.pcard')].every(el=>{
          const c=el.getBoundingClientRect();return c.right<=b.left||c.left>=b.right;
        });
      })()`), 'LED stack leaves both player cards clear');
    }
  };
  for (const output of ['stream', 'led']) {
    await navigate(`/bundles/rashinban/graphics/info-${output}.html`, 'document.querySelector("#banpick.visible")');
    await message('banpick:reset');
    assert.deepEqual(await entries(), []);
    assert.equal(await evaluate(`document.querySelector('.bp-turn-name').textContent`), 'Player A');
    await evaluate(`{const s=structuredClone(fixtureValues.banPick);s.players.A='めうMeU';emit('banPick',s);}`);
    assert.equal(await evaluate(`document.querySelector('.bp-turn-name').textContent`), 'めうMeU');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.bp-turn-name')).textTransform`), 'none');
    assert.match(await evaluate(`getComputedStyle(document.querySelector('.bp-turn-name')).fontFamily`), /Noto Sans JP/);
    assert.equal(await evaluate(`document.querySelector('.bp-turn-action').textContent`), 'BANNING');
    await screenshot(`banpick-${output}-player-name`);
    await select(4); await select(7); await select(1);
    assert.deepEqual((await entries()).map(row => row.id), [1, 7, 4]);
    assert.equal(await evaluate(`document.querySelector('.bp-turn').textContent`), 'READY');
    await checkFits(output); await screenshot(`banpick-${output}-game-1`);
    // Stage changes clear immediately, before anyone confirms the next pick.
    await message('banpick:nextGame');
    assert.deepEqual(await entries(), []);
    assert.equal(await evaluate(`document.querySelector('.bp-turn-name').textContent`), 'Player B');
    assert.equal(await evaluate(`document.querySelector('.bp-turn-action').textContent`), 'PICKING');
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
    assert.equal(await evaluate(`document.querySelector('.bp-selection-kind').textContent`), 'DECIDER · AUTO');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.bp-selection-map')).textTransform`), 'uppercase');
    await checkFits(output); await screenshot(`banpick-${output}-game-3`);
    await message('banpick:undo');
    assert.deepEqual((await entries()).map(row => row.id), [3, 6, 5]);
    await message('banpick:reset'); assert.deepEqual(await entries(), []);
    await evaluate(`{const s=structuredClone(fixtureValues.broadcast);s.${output}.program.banpick.visible=false;emit('broadcast',s);}`);
    await delay(350);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('#banpick')).opacity`), '0');
  }

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
