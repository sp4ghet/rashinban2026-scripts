import assert from 'node:assert/strict';
import { rowToProfile } from '../../bundles/rashinban/src/sheet/players.ts';

export async function validatePlayerInfo({ navigate, evaluate, until, click, screenshot, delay, values, message, adobeFonts }) {
  const profile = rowToProfile({ startgg_tag: 'meishin', startgg_entrant_id: '10', name: 'meishin', twitter: 'meishin174', age: '21', rating: '1514',
    favorite_mode: 'MOVE', strengths: '精査,日本マップ', favorite_food: 'そば米汁', message: '5K狙いでプレイします' });
  const opponentNames = ['consus', 'Kaede', 'raGe', 'eeeeeeeeeee', '山田太郎', 'sp4ghet', 'J', 'nasi-goreng'];
  values.players = [profile, ...opponentNames.map((name, i) => rowToProfile({ startgg_tag: `opponent-${20 + i}`, startgg_entrant_id: String(20 + i), name }))];
  values.playersEn = [{ ...profile, strengths: 'Scanning, Japan maps', favoriteFood: 'Soba rice soup', message: 'Playing for the 5K!' }];
  values['assets:player-info'] = [{ base: 'meishin-blank.jpg', url: '/assets/rashinban/player-info/meishin-blank.jpg', sum: 'v1' }];
  const sets = Object.fromEntries(Array.from({ length: 8 }, (_, index) => {
    const id = index + 1, won = index < 7, score = won ? index === 6 ? 2 : 3 : 0, other = won ? index < 2 ? 1 : 0 : 2;
    return [id, { id, groupId: 1, phaseId: 1, identifier: String(id), round: id, side: 'winners', roundText: 'Day 1', state: 'completed',
      winnerEntrantId: won ? 10 : 20 + index, loserEntrantId: won ? 20 + index : 10, completedAt: id,
      slots: [{ entrantId: 10, score }, { entrantId: 20 + index, score: other }] }];
  }));
  values.startggBracket = { fetchedAt: 0, event: null, streamQueue: [], sets,
    entrants: { 10: { id: 10, tag: 'meishin', name: 'meishin' }, ...Object.fromEntries(opponentNames.map((name, i) => [20 + i, { id: 20 + i, tag: `opponent-${20 + i}`, name }])) },
    phases: [{ id: 1, name: 'DAY1', order: 1, groupIds: [1] }, { id: 2, name: 'DAY2', order: 2, groupIds: [2] }],
    groups: { 1: { id: 1, identifier: '1', seeds: [{ entrantId: 10, placement: 1 }], setIds: Object.keys(sets).map(Number) },
      2: { id: 2, identifier: 'TOP8', seeds: [{ entrantId: 10, seedNum: 1 }], setIds: [] } } };
  const choose = (selector, value) => evaluate(`{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));}`);
  const host = 'document.querySelector("#layer-player-info")';
  const monitor = channel => `document.querySelector('.monitor[data-channel=${channel}] iframe.info').contentDocument`;
  const photoVisible = `${host} && !${host}.hidden && ${host}.dataset.status === 'ready'`;
  const originalEn = structuredClone(values.broadcast.en), originalLed = structuredClone(values.broadcast.led);
  await navigate('dashboard/switcher-stream.html', 1600, 1080);
  await until('document.querySelector("[data-row=playerInfo]") !== null');
  assert.equal(await evaluate('document.querySelector("[data-row=slides]").nextElementSibling.dataset.row'), 'playerInfo');
  await choose('[data-row=slides] select', 'day2-opening');
  await until('document.querySelector("[data-row=slides] label:nth-of-type(2) select").dataset.mode === "day2-opening"');
  await choose('[data-row=slides] label:nth-of-type(2) select', '23');
  await until(`${monitor('preview')}?.querySelector('#layer-player-info')?.hidden === false`);
  assert.equal(values.broadcast.stream.program.playerInfo.visible, false);
  await screenshot('switcher-preview');
  await click('#take');
  await until(`${monitor('program')}?.querySelector('#layer-player-info')?.hidden === false`);
  await click('[data-info-direction="1"]');
  await until('fixtureValues.broadcast.stream.preview.playerInfo.page === "profile"');
  assert.equal(values.broadcast.stream.program.playerInfo.page, 'results');
  await click('#revert');
  await until('fixtureValues.broadcast.stream.preview.playerInfo.page === "results"');
  await click('[data-info-direction="1"]');
  await until('fixtureValues.broadcast.stream.preview.playerInfo.page === "profile"');
  await click('#take');
  await until('fixtureValues.broadcast.stream.program.playerInfo.page === "profile"');
  await click('[data-slide-direction="1"]');
  await until('fixtureValues.broadcast.stream.preview.playerInfo.visible === false');
  assert.equal(values.broadcast.stream.program.playerInfo.visible, true);
  await click('#swap');
  await until('fixtureValues.broadcast.stream.program.playerInfo.visible === false');
  await click('#clear-preview');
  await until('fixtureValues.broadcast.stream.preview.playerInfo.visible === false');
  assert.deepEqual(values.broadcast.en, originalEn); assert.deepEqual(values.broadcast.led, originalLed);

  const bounds = async () => {
    const bad = await evaluate(`Array.from(document.querySelectorAll('.player-info [data-fit]')).filter(el=>el.offsetParent!==null && (el.scrollWidth>el.clientWidth+1 || el.scrollHeight>el.clientHeight+1)).map(el=>({class:el.className,text:el.textContent,scroll:[el.scrollWidth,el.scrollHeight],client:[el.clientWidth,el.clientHeight]}))`);
    assert.deepEqual(bad, [], 'all text fits');
    const overlaps = await evaluate(`Array.from(document.querySelectorAll('.pi-field')).filter(el=>el.offsetParent!==null && el.nextElementSibling?.classList.contains('pi-field') && el.querySelector('.pi-value').getBoundingClientRect().bottom > el.nextElementSibling.getBoundingClientRect().top).map(el=>el.className)`);
    assert.deepEqual(overlaps, [], 'profile answers stay clear of the next label');
    assert.equal(await evaluate('document.querySelector(".pi-name").getBoundingClientRect().height > 0 && document.querySelector(".pi-handle").getBoundingClientRect().height > 0'), true, 'name and handle remain visible on both pages');
    if (await evaluate('document.querySelector(".player-info").dataset.page === "profile"')) {
      assert.equal(await evaluate('document.querySelector(".pi-header").getBoundingClientRect().bottom <= document.querySelector(".pi-numbers").getBoundingClientRect().top'), true, 'page 2 header stays above Age/Rating');
    }
    const bottom = await evaluate(`document.querySelector(document.querySelector('.player-info').dataset.page === 'profile' ? '.pi-profile-body' : '.pi-results-body')?.getBoundingClientRect().bottom`);
    assert.ok(Math.abs(bottom - 1008) < 1, 'the entire content block aligns 72px above the bottom on both pages');
  };
  for (const output of ['stream', 'en']) {
    for (const page of ['results', 'profile']) {
      await message('broadcast:setPreview', { output, patch: { playerInfo: { visible: true, playerId: 'entrant:10', page }, slides: { visible: false }, interval: { visible: false }, bracket: { visible: false } } });
      await message('broadcast:take', { output });
      await navigate(output === 'stream' ? 'graphics/info-stream.html' : 'graphics/player-info-en.html');
      await until(photoVisible);
      if (adobeFonts) {
        await evaluate('document.fonts.load("700 58px kaneda-gothic")');
        assert.equal(await evaluate('Array.from(document.fonts).some(f=>f.family.includes("kaneda-gothic") && f.weight==="700" && f.status==="loaded")'), true, 'Adobe font loaded');
      }
      await bounds();
      if (page === 'profile') assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.pi-value'), el=>getComputedStyle(el).fontSize)`), ['38px', '38px', '38px', '38px'], 'short profile answers retain their authored font size');
      assert.equal(await evaluate('(()=>{const image=document.querySelector(".pi-photo"); return image.naturalWidth / image.naturalHeight;})()'), 16 / 9);
      assert.equal(await evaluate('document.querySelector(".pi-placement").textContent'), '1st - Group A');
      assert.equal(await evaluate('document.querySelector(".pi-records .pi-label").textContent'), 'MATCH COUNT');
      if (page === 'results') {
        assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".pi-opponent"), el=>el.textContent)'), opponentNames, 'opponents retain sheet capitalization');
        assert.equal(await evaluate('Array.from(document.querySelectorAll(".pi-opponent"), el=>getComputedStyle(el).textTransform).every(value=>value==="none")'), true, 'CSS does not uppercase player names');
        const scores = await evaluate('Array.from(document.querySelectorAll(".pi-score"), el=>({x:el.getBoundingClientRect().x,right:el.getBoundingClientRect().right,text:el.textContent}))');
        assert.equal(scores.length, 8);
        for (const column of [scores.slice(0, 4), scores.slice(4)]) {
          assert.equal(new Set(column.map(score=>score.x)).size, 1, 'scores share one left edge per column');
          assert.equal(new Set(column.map(score=>score.right)).size, 1, 'scores share one right edge per column');
        }
        assert.ok(await evaluate(`document.querySelectorAll('.pi-versus')[4].getBoundingClientRect().left - document.querySelectorAll('.pi-score')[0].getBoundingClientRect().right >= 100`), 'scores have a generous gap before the second VS column');
        assert.equal(await evaluate(`getComputedStyle(document.querySelectorAll('.pi-opponent')[3]).fontSize`), await evaluate(`getComputedStyle(document.querySelector('.pi-opponent')).fontSize`), 'the longest expected name fits at the same size as short names');
        assert.equal(await evaluate('document.querySelector(".pi-highlights").hidden'), true, 'no empty highlights label');
      }
      assert.equal(await evaluate('document.querySelector(".pi-sets").textContent'), '7-1 (87.5%)');
      assert.equal(await evaluate('document.querySelector(".pi-games").textContent'), '20-4 (83.3%)');
      if (output === 'en') assert.equal(await evaluate('document.querySelector(".pi-strengths .pi-value").textContent'), 'Scanning, Japan maps');
      await screenshot(`${output}-${page}`);
    }
  }
  const originalProfile = structuredClone(values.playersEn[0]);
  values.playersEn[0] = { ...originalProfile, name: 'A very long international tournament player name', twitter: 'a_long_social_handle_123456',
    strengths: 'Detailed map scanning, Japanese roads, navigation and careful pinpointing across several regions.',
    message: 'I am looking forward to competing with everyone. Thank you for supporting this tournament and all the players!' };
  await until('document.querySelector(".pi-name").textContent.startsWith("A very long")');
  await bounds(); await screenshot('en-profile-long');
  const profileSizes = () => evaluate(`Array.from(document.querySelectorAll('.pi-value'), el=>getComputedStyle(el).fontSize)`);
  const initialProfileSizes = await profileSizes();
  for (let refresh = 0; refresh < 3; refresh++) {
    values.playersEn[0].extra = { ...values.playersEn[0].extra, validation_tick: String(refresh) };
    await until(`fixtureValues.playersEn[0].extra.validation_tick === '${refresh}'`);
    assert.deepEqual(await profileSizes(), initialProfileSizes, 'unrelated sheet refreshes cannot change fitted profile sizes');
  }
  await message('broadcast:setPreview', { output: 'en', patch: { playerInfo: { page: 'results' } } });
  await message('broadcast:take', { output: 'en' });
  await until('document.querySelector(".player-info").dataset.page === "results"');
  await bounds(); await screenshot('en-results-long');
  values.playersEn[0] = { ...originalProfile, message: '<img src=x onerror=alert(1)>' };
  await until('document.querySelector(".pi-message .pi-value").textContent.startsWith("<img")');
  assert.equal(await evaluate('document.querySelector(".pi-message img")'), null, 'sheet text remains literal');
  values.playersEn[0] = originalProfile;
  values['assets:player-info'] = [];
  await until(`${host}.hidden`);
  values['assets:player-info'] = [{ base: 'meishin-blank.jpg', url: '/assets/rashinban/player-info/meishin-blank.jpg', sum: 'v2' }];
  await until(photoVisible);
  values.playersEn[0].rating = '1600';
  await until('document.querySelector(".pi-rating").textContent === "1600"');
  const streamBefore = structuredClone(values.broadcast.stream);
  await navigate('dashboard/switcher-en.html', 1600, 1080);
  await until('document.querySelector("[data-row=playerInfo]") !== null');
  await choose('#monitor-scene', 'player-info');
  await until(`${monitor('program')}?.querySelector('#layer-player-info')?.hidden === false`);
  await choose('[data-row=playerInfo] label:nth-of-type(2) select', 'profile');
  await until('fixtureValues.broadcast.en.preview.playerInfo.page === "profile"');
  await click('#take');
  await until(`${monitor('program')}?.querySelector('.player-info')?.dataset.page === 'profile'`);
  assert.deepEqual(values.broadcast.stream, streamBefore);
  await screenshot('english-switcher');

  const highlights = [
    ['cocos', 'ここす', 'RASHINBAN 2025 TOP 8'],
    ['tozangezan', 'Tozan', 'RASHINBAN 2025 BEST 8\nAPAC CUP 2026 本戦出場'],
    ['Nowlo', 'nowlo', 'RASHINBAN 2025 BEST 6\nAPAC CUP 2026 BEST 16\nGeoGuessr World Championship 2026 Open Wildcard BEST 8'],
  ];
  for (const [name, tag, career] of highlights) {
    values.players[0] = { ...profile, name, startggTag: tag, extra: { major_tournament: career } };
    values.playersEn[0] = { ...values.players[0], name: `EN ${name}`, extra: {} };
    values['assets:player-info'] = [{ base: `${tag}-blank.jpg`, url: '/assets/rashinban/player-info/meishin-blank.jpg', sum: 'career' }];
    for (const output of ['stream', 'en']) {
      await message('broadcast:setPreview', { output, patch: { playerInfo: { visible: true, playerId: 'entrant:10', page: 'results' } } });
      await message('broadcast:take', { output });
      await navigate(output === 'stream' ? 'graphics/info-stream.html' : 'graphics/player-info-en.html');
      await until(photoVisible);
      if (adobeFonts) await evaluate('document.fonts.load("700 24px kaneda-gothic")');
      await bounds();
      assert.equal(await evaluate('document.querySelector(".pi-highlights-text").textContent'), career, 'English falls back to the shared highlights');
      assert.equal(await evaluate('document.querySelector(".pi-highlights").hidden'), false);
      assert.equal(await evaluate('getComputedStyle(document.querySelector(".pi-highlights-text")).whiteSpace'), 'pre-line', 'sheet line breaks are preserved');
      assert.ok(await evaluate(`document.querySelector('.pi-results-body').getBoundingClientRect().top >= document.querySelector('.pi-placement').getBoundingClientRect().bottom + 12`), 'results stay clear of the placement');
      assert.ok(await evaluate(`document.querySelector('.pi-highlights').getBoundingClientRect().top >= document.querySelector('.pi-matches').getBoundingClientRect().bottom + 24`), 'highlights stay clear of match results');
      assert.ok(await evaluate(`Math.abs(document.querySelector('.pi-highlights-text').getBoundingClientRect().bottom - 1008) < 1`), 'career text shares the content bottom edge');
      if (name === 'Nowlo') {
        const style = await evaluate(`(()=>{const s=getComputedStyle(document.querySelector('.pi-highlights-text'));return {family:s.fontFamily,size:s.fontSize,weight:s.fontWeight}})()`);
        assert.equal(style.size, '24px'); assert.equal(style.weight, '700'); assert.ok(style.family.startsWith('kaneda-gothic'));
        if (adobeFonts) assert.equal(await evaluate('Array.from(document.fonts).some(f=>f.family.includes("kaneda-gothic") && f.weight==="700" && f.status==="loaded")'), true);
      }
      await screenshot(`${output}-${name}-highlights`);
      if (output === 'en') {
        values.playersEn[0].extra.major_tournament = 'English career highlight';
        await until('document.querySelector(".pi-highlights-text").textContent === "English career highlight"');
        values.playersEn[0].extra.major_tournament = '<img src=x onerror=alert(1)>';
        await until('document.querySelector(".pi-highlights-text").textContent.startsWith("<img")');
        assert.equal(await evaluate('document.querySelector(".pi-highlights img")'), null, 'career highlights remain literal sheet text');
        delete values.playersEn[0].extra.major_tournament;
      }
      await message('broadcast:setPreview', { output, patch: { playerInfo: { page: 'profile' } } });
      await message('broadcast:take', { output });
      await until('document.querySelector(".player-info").dataset.page === "profile"');
      await bounds();
      assert.equal(await evaluate('document.querySelector(".pi-highlights").getBoundingClientRect().height'), 0, 'career highlights appear only on results');
    }
  }
  values.players[0].extra.major_tournament = ' \n ';
  await message('broadcast:setPreview', { output: 'en', patch: { playerInfo: { page: 'results' } } });
  await message('broadcast:take', { output: 'en' });
  await until('document.querySelector(".pi-highlights").hidden && document.querySelector(".player-info").dataset.page === "results"');
  await bounds();
  assert.ok(await evaluate(`Math.abs(document.querySelector('.pi-matches').getBoundingClientRect().bottom - 1008) < 1`), 'clearing highlights moves the full result block back to the bottom');

  // The rundown must drive both the menu and every two-page Next transition,
  // independently of sheet order and translated display names.
  const openingPlayers = [
    ['meishin174', 'meishin'], ['ここす', 'cocos'], ['しよえ', 'shiyoe'], ['Tozan', 'tozangezan'],
    ['nowlo', 'Nowlo'], ['Stephen', 'Stephen'], ['Zion', 'Zion'], ['RTD | kmap', 'kmap'],
  ].map(([tag, name], index) => rowToProfile({ startgg_tag: tag, name, startgg_entrant_id: String(100 + index) }));
  values.players = [...openingPlayers].reverse();
  values.playersEn = openingPlayers.map(player => ({ ...player, name: `EN ${player.name}` }));
  values.startggBracket = null;
  const playerSelect = '[data-row=playerInfo] label:first-of-type select';
  for (const output of ['stream', 'en']) {
    await message('broadcast:setPreview', { output, patch: { playerInfo: { visible: false, playerId: '', page: 'results' } } });
    const programBefore = structuredClone(values.broadcast[output].program);
    await navigate(`dashboard/switcher-${output}.html`, 1600, 1080);
    await until(`document.querySelector(${JSON.stringify(playerSelect)})?.options.length === 9`);
    const options = await evaluate(`Array.from(document.querySelector(${JSON.stringify(playerSelect)}).options).slice(1).map(option=>({value:option.value,label:option.textContent}))`);
    assert.deepEqual(options.map(option => option.value), openingPlayers.map((_, i) => `entrant:${100 + i}`));
    assert.deepEqual(options.map(option => option.label), openingPlayers.map(player => output === 'en' ? `EN ${player.name}` : player.name));
    for (let step = 1; step < 16; step++) {
      await click('[data-info-direction="1"]');
      const expected = { visible: false, playerId: `entrant:${100 + Math.floor(step / 2)}`, page: step % 2 ? 'profile' : 'results' };
      await until(`fixtureValues.broadcast.${output}.preview.playerInfo.playerId === ${JSON.stringify(expected.playerId)} && fixtureValues.broadcast.${output}.preview.playerInfo.page === ${JSON.stringify(expected.page)}`);
    }
    assert.equal(await evaluate(`document.querySelector('[data-info-direction="1"]').disabled`), true);
    assert.deepEqual(values.broadcast[output].program, programBefore, 'ordering/navigation does not change program before TAKE');
  }
}
