import assert from 'node:assert/strict';

// Runs inside validate-player-cards.mjs's isolated fixture server and browser.
export async function verifyBanpick({ navigate, evaluate, until, screenshot, delay, command, adobeFonts = false }) {
  await command('DOM.enable');
  await command('CSS.enable');
  const renderedFaces = async selector => {
    const { root } = await command('DOM.getDocument');
    const { nodeId } = await command('DOM.querySelector', { nodeId: root.nodeId, selector });
    const { fonts } = await command('CSS.getPlatformFontsForNode', { nodeId });
    return fonts.filter(font => font.glyphCount > 0);
  };
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
      const headers = await evaluate(`[...document.querySelectorAll('.pcard')].map(card=>{const h=card.querySelector('.head'),r=h.getBoundingClientRect(),s=getComputedStyle(h,'::before');return {bandBottom:r.bottom-parseFloat(s.bottom),labels:[...h.children].map(name=>({text:name.textContent,bottom:name.getBoundingClientRect().bottom}))};})`);
      assert.ok(headers.every(header=>header.labels.every(label=>label.bottom<=header.bandBottom)), `long LED profiles keep names and handles inside the solid header: ${JSON.stringify(headers)}`);
      assert.ok(await evaluate(`[...document.querySelectorAll('.pcard')].every(card=>{const r=card.getBoundingClientRect();return [...card.querySelectorAll('.name,.twitter,.value')].every(el=>{const b=el.getBoundingClientRect();return b.left>=r.left&&b.right<=r.right&&b.bottom<=r.bottom;});})`), 'long LED profile fields stay within their cards');
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
    if (adobeFonts) {
      await evaluate('document.fonts.ready');
      for (const [selector, face] of [
        ['.bp-stack-entry[data-status="banned"] .bp-selection-mode', 'KanedaGothic-Bold'],
        ['.bp-stack-entry[data-status="banned"] .bp-selection-kind', 'KanedaGothic-Bold'],
        ['.bp-stack-entry[data-status="picked"] .bp-selection-mode', 'KanedaGothic-BoldItalic'],
        ['.bp-stack-entry[data-status="picked"] .bp-selection-kind', 'KanedaGothic-BoldItalic'],
        ['.bp-stage', 'KanedaGothic-BoldItalic'],
      ]) assert.deepEqual((await renderedFaces(selector)).map(font=>font.postScriptName), [face], `${output}: ${selector} uses the actual designer Bold face`);
      for (const [weight, style] of [['400', 'normal'], ['700', 'normal'], ['700', 'italic']]) {
        assert.ok(await evaluate(`[...document.fonts].some(font=>font.family.includes('kaneda-gothic')&&font.weight==='${weight}'&&font.style==='${style}'&&font.status==='loaded')`), `${output}: real Kaneda ${weight} ${style} is loaded, without relying on a substituted weight or synthetic italic`);
      }
    }
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
    if (output === 'led') {
      // Match the artwork's profile and longest map text on the real five-row state.
      const original = await evaluate(`({match:structuredClone(fixtureValues.matchResolved),banPick:structuredClone(fixtureValues.banPick)})`);
      await evaluate(`{const m=structuredClone(fixtureValues.matchResolved);for(const side of [m.left,m.right]){side.name='Shiina';side.handle='si417_';Object.assign(side.profile,{age:'32',rating:'2300',favoriteMode:'NO MOVE',strengths:'経験',favoriteFood:'おいしいもの',message:'自信無いですけど頑張ります'});}emit('matchResolved',m);const s=structuredClone(fixtureValues.banPick);for(const option of s.options)option.map='An Arbitrary Rural Intersectionguessr';emit('banPick',s);document.body.style.setProperty('background','url("assets/presenter-kv.jpg") center top / 1920px 576px no-repeat','important');}`);
      await evaluate('document.fonts.ready');
      await evaluate(`(async()=>{const bg=new Image();bg.src='assets/presenter-kv.jpg';await bg.decode();})()`);
      await checkFits(output);
      await screenshot('banpick-led-designer-layout', { x: 0, y: 0, width: 1920, height: 576, scale: 1 });
      const modeCrop = await evaluate(`(()=>{const r=document.querySelector('.bp-stack-entry[data-id="3"]').getBoundingClientRect();return{x:r.right-160,y:r.y,width:160,height:r.height,scale:2};})()`);
      await screenshot('banpick-led-move-bold', modeCrop);
      const designer = await evaluate(`(() => {
        const cards=[...document.querySelectorAll('.pcard')],rows=[...document.querySelectorAll('.bp-stack-entry')];
        return {cards:cards.map(card=>{const r=card.getBoundingClientRect(),head=card.querySelector('.head'),h=head.getBoundingClientRect(),s=getComputedStyle(head,'::before');return {x:r.x,y:r.y,width:r.width,height:r.height,headerHeight:h.bottom-parseFloat(s.bottom)-r.top};}),rows:rows.map(row=>{const r=row.getBoundingClientRect();return {y:r.y,height:r.height};})};
      })()`);
      assert.deepEqual(designer.cards.map(({headerHeight,...rect})=>rect), [{x:36,y:24,width:480,height:528},{x:1404,y:24,width:480,height:528}], 'LED cards use the designer outer margins and 24px center gutters');
      if (adobeFonts) for (const card of designer.cards) assert.ok(Math.abs(card.headerHeight-92)<1, 'LED solid name band matches the 92px designer height');
      assert.deepEqual(designer.rows, [106,198,290,382,474].map(y=>({y,height:80})), 'all five LED strips match the reference spacing within the physical band');
      await evaluate(`emit('matchResolved',${JSON.stringify(original.match)});emit('banPick',${JSON.stringify(original.banPick)});document.body.style.removeProperty('background');`);
    }
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
  const renderedFonts = async selector => (await renderedFaces(selector)).map(font => font.familyName);
  assert.ok((await renderedFonts('.bp-card-map')).some(font => /Akshar/i.test(font)), 'tablet map names actually render in Akshar');
  const cardAppearance = id => evaluate(`(() => {
    const card=document.querySelector('.bp-card[data-id="${id}"]'),map=card.querySelector('.bp-card-map'),tag=card.querySelector('.bp-card-tag');
    const c=getComputedStyle(card),m=getComputedStyle(map),t=getComputedStyle(tag),r=card.getBoundingClientRect(),b=tag.getBoundingClientRect();
    return {border:c.borderTopColor,background:c.backgroundColor,mapOpacity:m.opacity,mapDecoration:m.textDecorationLine,label:tag.textContent,labelColor:t.color,labelFont:t.fontFamily,
      labelCentered:Math.abs(r.x+r.width/2-b.x-b.width/2)<1&&Math.abs(r.y+r.height/2-b.y-b.height/2)<1,labelClip:t.clipPath};
  })()`);
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
  for (const [id, player, color] of [[4, 'A', 'rgb(255, 48, 48)'], [7, 'B', 'rgb(48, 131, 255)']]) {
    const appearance = await cardAppearance(id);
    assert.equal(appearance.background, 'rgb(0, 0, 0)', 'banned maps have a black background');
    assert.equal(appearance.border, 'rgba(0, 0, 0, 0)', 'bans use the centered label instead of a pick border');
    assert.ok(Number(appearance.mapOpacity) < 0.3, 'banned map name is dimmed behind the label');
    assert.equal(appearance.mapDecoration, 'none');
    assert.equal(appearance.label, `Player ${player} - BAN`);
    assert.equal(appearance.labelColor, color);
    assert.ok(appearance.labelFont.startsWith('kaneda-gothic'));
    assert.ok(appearance.labelCentered);
    assert.equal(appearance.labelClip, 'none');
  }
  if (adobeFonts) assert.ok((await renderedFonts('.bp-card[data-status="banned"] .bp-card-tag')).some(font => /Kaneda/i.test(font)), 'ban labels actually render in Kaneda Gothic');
  assert.equal((await cardAppearance(1)).border, 'rgb(255, 48, 48)', 'Player A pick has a red border');
  assert.equal((await frame()).turn, '');
  assert.equal((await frame()).color, 'rgb(92, 98, 112)', 'between games no player owns the frame');
  await message('banpick:nextGame');
  assert.equal((await frame()).text, 'Player B : PICK GAME 2');
  await screenshot('banpick-tablet-pick-game-2');
  const tabletFits = () => evaluate(`(() => {
    const edge=parseFloat(getComputedStyle(document.querySelector('#panel'),'::before').borderTopWidth);
    return document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight&&
      [...document.querySelectorAll('.bp-card')].every(card=>{const r=card.getBoundingClientRect(),m=card.querySelector('.bp-card-map').getBoundingClientRect();return r.left>=edge&&r.right<=innerWidth-edge&&r.bottom<=innerHeight-edge&&m.left>=r.left&&m.right<=r.right&&m.top>=r.top&&m.bottom<=r.bottom;})&&
      [...document.querySelectorAll('.player span,#step,.bp-card[data-status="banned"] .bp-card-tag')].every(el=>{const r=el.getBoundingClientRect(),p=el.parentElement.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right&&r.top>=p.top&&r.bottom<=p.bottom;});
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
  await screenshot('banpick-tablet-selected');
  assert.equal(await evaluate(`document.querySelector('#confirm') === null`), true, 'selecting a map never opens a confirmation panel');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#panel header')).visibility`), 'visible', 'player names stay visible while a map is selected');
  assert.equal(await evaluate(`document.querySelector('.bp-selected').dataset.id`), '3');
  assert.equal(await evaluate(`fixtureValues.banPick.actions.length`), 3, 'the first tap only selects');
  await evaluate(`{const s=structuredClone(fixtureValues.banPick);s.players.A='めうMeU';s.players.B='とても長いプレイヤー名 / Long Player Name';emit('banPick',s);}`);
  assert.ok(await tabletFits(), 'Japanese and long player names fit the tablet header and turn label');
  assert.equal((await cardAppearance(7)).label, 'とても長いプレイヤー名 / Long Player Name - BAN', 'ban label identifies the actual player');
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
    assert.equal(await evaluate(`document.querySelectorAll('.bp-selected').length`), 0);
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
  // Each new selection still needs two taps, including consecutive turns.
  await evaluate(`document.querySelector('.bp-card[data-id="3"]').click()`);
  assert.equal(await evaluate(`fixtureValues.banPick.actions.length`), 6);
  await evaluate(`document.querySelector('.bp-card[data-id="3"]').click()`);
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
  assert.equal(await evaluate(`document.querySelectorAll('.bp-card:not(:disabled)').length`), 0);
  await touchOption();
  await evaluate(`document.querySelector('.bp-card[data-id="8"]').click()`);
  await until(`fixtureValues.banPick.actions.length===8`);
  assert.equal(await evaluate(`window.banpickSends`), 1);
  assert.equal((await cardAppearance(1)).border, 'rgb(255, 48, 48)', 'Player A pick stays red after later actions');
  assert.equal((await cardAppearance(2)).border, 'rgb(48, 131, 255)', 'Player B pick stays blue after later actions');
  assert.equal((await cardAppearance(9)).border, 'rgb(255, 255, 255)', 'final remaining map has a white border');
  assert.ok(await tabletFits(), 'completed board labels fit their cards');
  await screenshot('banpick-tablet-complete');
  await command('Emulation.setTouchEmulationEnabled', { enabled: false });
  console.log('Ban & Pick verified: all three stacks, newest-first ordering, automatic decider, undo/reset, stream/LED bounds, player-card clearance, dashboard Next game, paused tablet input, turn locks, double-tap submission without a confirmation panel and duplicate-submit protection.');
}
