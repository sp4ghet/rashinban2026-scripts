import assert from 'node:assert/strict';
import { rowToProfile } from '../bundles/rashinban/src/sheet/players.ts';

export async function verifyPlayerCardsDesign({ navigate, evaluate, card, screenshot, command, fits, adobeFonts, values, bracket, makeSet }) {
  const highlights = 'WORLD CHAMPIONSHIP 2026 - 出場\nWORLD CHAMPIONSHIP 2026 APAC - 優勝\nRASHINBAN 2025 - 3RD';
  const profile = rowToProfile({ startgg_entrant_id: '10', startgg_tag: 'Shiina', name: 'Shiina', twitter: 'si417_', age: '32', rating: '2300',
    favorite_mode: 'NO MOVE', strengths: '経験', favorite_food: 'おいしいもの', message: '自信無いですけど頑張ります', major_tournament: highlights });
  const match = structuredClone(values.matchResolved);
  Object.assign(match.left, { name: 'Shiina', handle: 'si417_', profile });
  const results = structuredClone(bracket);
  results.phases = [{ id: 1, name: 'DAY 1', order: 1, groupIds: [1] }, { id: 2, name: 'DAY 2', order: 2, groupIds: [2] }];
  results.sets = Object.fromEntries(Array.from({ length: 8 }, (_, i) => {
    const set = makeSet(i + 1, `2026-10-11T${String(i + 1).padStart(2, '0')}:00:00Z`, `TOP ${64 >> Math.min(i, 4)}`, i < 6 ? 3 : i === 6 ? 2 : 0, i < 2 ? 1 : i === 7 ? 2 : 0);
    return [set.id, set];
  }));
  const emit = (key, value) => evaluate(`emit(${JSON.stringify(key)},${JSON.stringify(value)})`);
  const visibleLabels = () => evaluate(`[...document.querySelectorAll('#card-1 .label')].filter(el=>el.getClientRects().length).map(el=>el.textContent)`);
  const height = () => evaluate(`document.querySelector('#card-1').getBoundingClientRect().height`);
  await command('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  for (const output of ['stream', 'led', 'en']) {
    await navigate('/bundles/rashinban/graphics/' + (output === 'en' ? 'player-cards-en.html' : `info-${output}.html`), 'document.querySelector("#cards")');
    await emit('players', [profile, values.players[1]]);
    const translated = { ...profile, strengths: 'Experience', favoriteFood: 'Good food', message: 'I will do my best!', extra: {} };
    await emit('playersEn', [translated]);
    await emit('matchResolved', match);
    await emit('startggBracket', results);
    const select = patch => card({ visible: true, player: 'left', position: 'left', ...patch }, output === 'en' ? 'en' : 'stream');
    await select({ page: 'profile' });
    await new Promise(resolve => setTimeout(resolve, 550));
    if (adobeFonts) assert.ok(await evaluate(`[...document.fonts].some(f=>f.family.includes('kaneda-gothic')&&f.weight==='700'&&f.status==='loaded')`), `${output}: Kaneda loaded`);
    assert.deepEqual(await visibleLabels(), ['Age', 'Rating', 'Favorite game mode', 'Strengths', 'Favorite food', 'Message']);
    assert.ok(await fits(), `${output}: reference profile fits`);
    const profileHeight = await height();
    assert.equal(await evaluate(`document.querySelector('#card-1').getBoundingClientRect().top`), output === 'led' ? 24 : 90);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('#card-1')).backgroundColor`), 'rgb(255, 45, 45)');
    await screenshot(`design-${output}-profile`);
    await select({ page: 'stats', resultsDate: '1900-01-01', resultsPage: 99 });
    assert.deepEqual(await visibleLabels(), ['Career highlights', 'Recent matches', 'Day 1 results']);
    assert.equal(await evaluate(`document.querySelector('#card-1 .highlights-text').textContent`), highlights, `${output}: shared highlights remain available`);
    assert.equal(await evaluate(`document.querySelector('#card-1 .match-record').textContent`), '7-1 (87.5%)');
    assert.equal(await evaluate(`document.querySelector('#card-1 .game-record').textContent`), '20-4 (83.3%)');
    assert.equal(await evaluate(`document.querySelectorAll('#card-1 .result-row').length`), 5);
    assert.ok(await fits(), `${output}: results and highlights fit`);
    await screenshot(`design-${output}-highlights`);
    if (output === 'en') {
      await emit('playersEn', [{ ...translated, extra: { major_tournament: 'Translated highlight' } }]);
      assert.equal(await evaluate(`document.querySelector('#card-1 .highlights-text').textContent`), 'Translated highlight');
      await emit('playersEn', [translated]);
    }
    const noHighlights = structuredClone(match);
    noHighlights.left.profile.extra = {};
    await emit('players', [noHighlights.left.profile, values.players[1]]);
    await emit('matchResolved', noHighlights);
    assert.deepEqual(await visibleLabels(), ['Age', 'Rating', 'Recent matches', 'Day 1 results']);
    assert.ok(await fits(), `${output}: results without highlights fit`);
    await screenshot(`design-${output}-results`);
    await select({ page: 'compact' });
    assert.deepEqual(await visibleLabels(), ['Favorite game mode', 'Strengths', 'Day 1 results']);
    assert.equal(await evaluate(`document.querySelectorAll('#card-1 .result-row').length`), 0);
    assert.ok(await height() < profileHeight, `${output}: compact shrinks vertically`);
    assert.ok(await fits(), `${output}: compact fits`);
    await screenshot(`design-${output}-compact`);
    await emit('startggBracket', null);
    assert.equal(await evaluate(`document.querySelector('#card-1 .day1-empty').textContent`), 'Day 1 results unavailable');
    assert.equal(await evaluate(`document.querySelector('#card-1 .records').hidden`), true);
    assert.ok(await fits());
    await emit('startggBracket', results);
    const sparse = structuredClone(noHighlights);
    Object.assign(sparse.left.profile, { age: '', rating: '', favoriteMode: '', favoriteFood: '', message: '', extra: { major_tournament: ' \n ' } });
    await emit('playersEn', []);
    await emit('players', [sparse.left.profile]);
    await emit('matchResolved', sparse);
    await select({ page: 'profile' });
    assert.deepEqual(await visibleLabels(), ['Strengths']);
    assert.ok(await height() < profileHeight, `${output}: empty fields disappear and card shrinks`);
    await screenshot(`design-${output}-sparse`);
    const long = structuredClone(match);
    long.left.name = 'たいけい/Taikei';
    long.left.profile = { ...values.players[0], extra: { major_tournament: highlights.repeat(2) } };
    await emit('matchResolved', long);
    for (const page of ['profile', 'stats', 'compact']) {
      await select({ page });
      assert.ok(await fits(), `${output}: long ${page} text fits`);
    }
    await emit('players', [profile, { ...values.players[1], name: 'Very long opponent display name that wraps across the card' }]);
    await select({ page: 'stats' });
    assert.ok(await fits(), output + ': long opponents and multiline highlights fit together');
    const unsafe = structuredClone(match);
    unsafe.left.name = '<img src=x onerror=alert(1)>';
    unsafe.left.profile.extra.major_tournament = '<img src=x onerror=alert(1)>\nMixed Case';
    await emit('matchResolved', unsafe);
    await select({ page: 'stats' });
    assert.equal(await evaluate(`document.querySelectorAll('#cards img').length`), 0);
    assert.equal(await evaluate(`document.querySelector('#card-1 .highlights-text').textContent`), unsafe.left.profile.extra.major_tournament);
    await emit('matchResolved', null);
    assert.equal(await evaluate(`document.querySelector('#cards').classList.contains('visible')`), false);
  }
  await navigate('/bundles/rashinban/graphics/info-stream.html');
  for (const page of ['profile', 'stats', 'compact']) for (const player of ['left', 'right']) for (const position of ['left', 'right']) {
    await card({ page, player, position });
    const shown = await evaluate(`[...document.querySelectorAll('.pcard:not([hidden])')].map(el=>({name:el.querySelector('.name').textContent,x:el.getBoundingClientRect().x,color:getComputedStyle(el).backgroundColor}))`);
    assert.deepEqual(shown, [{ name: player === 'left' ? 'Stephen' : 'eeeeeeeeeeee', x: position === 'left' ? 110 : 1010, color: player === 'left' ? 'rgb(255, 45, 45)' : 'rgb(48, 131, 255)' }]);
    assert.ok(await fits(), `${page}: ${player} at ${position} fits`);
  }
}
