import assert from 'node:assert/strict';
import { rowToProfile } from '../../bundles/rashinban/src/sheet/players.ts';

export async function validatePlayerInfo({ navigate, evaluate, until, click, screenshot, delay, values, message, adobeFonts }) {
  const profile = rowToProfile({ startgg_tag: 'meishin', startgg_entrant_id: '10', name: 'meishin', twitter: 'meishin174', age: '21', rating: '1514',
    favorite_mode: 'MOVE', strengths: '精査,日本マップ', favorite_food: 'そば米汁', message: '5K狙いでプレイします' });
  values.players = [profile, rowToProfile({ startgg_tag: 'consus', startgg_entrant_id: '20', name: 'consus' })];
  values.playersEn = [{ ...profile, strengths: 'Scanning, Japan maps', favoriteFood: 'Soba rice soup', message: 'Playing for the 5K!' }];
  values['assets:player-info'] = [{ base: 'meishin-blank.jpg', url: '/assets/rashinban/player-info/meishin-blank.jpg', sum: 'v1' }];
  const sets = Object.fromEntries(Array.from({ length: 8 }, (_, index) => {
    const id = index + 1, won = index < 7, score = won ? index === 6 ? 2 : 3 : 0, other = won ? index < 2 ? 1 : 0 : 2;
    return [id, { id, groupId: 1, phaseId: 1, identifier: String(id), round: id, side: 'winners', roundText: 'Day 1', state: 'completed',
      winnerEntrantId: won ? 10 : 20, loserEntrantId: won ? 20 : 10, completedAt: id,
      slots: [{ entrantId: 10, score }, { entrantId: 20, score: other }] }];
  }));
  values.startggBracket = { fetchedAt: 0, event: null, streamQueue: [], sets,
    entrants: { 10: { id: 10, tag: 'meishin', name: 'meishin' }, 20: { id: 20, tag: 'consus', name: 'consus' } },
    phases: [{ id: 1, name: 'DAY1', order: 1, groupIds: [1] }, { id: 2, name: 'DAY2', order: 2, groupIds: [2] }],
    groups: { 1: { id: 1, identifier: 'A', seeds: [{ entrantId: 10, placement: 1 }], setIds: Object.keys(sets).map(Number) },
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
      assert.equal(await evaluate('(()=>{const image=document.querySelector(".pi-photo"); return image.naturalWidth / image.naturalHeight;})()'), 16 / 9);
      assert.equal(await evaluate('document.querySelector(".pi-placement").textContent'), '1st - GROUP A');
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
}
