import assert from 'node:assert/strict';

/** Uses real built graphics, dashboard controls and broadcast reducers with fixture replicants. */
export async function verifyLowerThirds({ navigate, evaluate, until, screenshot, delay, command }) {
  await command('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await navigate('/bundles/rashinban/graphics/info-stream.html', 'document.querySelector("#lower-third")');
  const apply = async patch => {
    await evaluate(`{const s=structuredClone(fixtureValues.broadcast);s.stream.program.playerCards.visible=false;Object.assign(s.stream.program.lowerThird,${JSON.stringify(patch)});emit('broadcast',s);}`);
    await delay(500);
  };
  await evaluate(`{const m=structuredClone(fixtureValues.matchResolved);m.label='GRANDFINALS';for(const side of ['left','right'])Object.assign(m[side],{name:'tozangezan',handle:'@TSoutherpacks',wins:1});emit('matchResolved',m);const next=structuredClone(m);next.left.name='Player';next.right.name='Player';emit('nextMatchResolved',next);}`);
  await apply({ visible: true, mode: 'scores', comingUp: true });
  await evaluate(`document.fonts.load('700 64px "kaneda-gothic"')`);
  assert.ok(await evaluate(`[...document.fonts].some(f=>f.family.includes('kaneda-gothic')&&f.weight==='700'&&f.status==='loaded')`), 'Kaneda Gothic must load; fallback fonts do not count as visual acceptance (use --adobe-fonts)');
  await evaluate(`document.body.style.setProperty('background','#fff','important')`);
  await screenshot('between-games');
  const geometry = await evaluate(`(()=>{const rows=[...document.querySelectorAll('.lt-score-row')];return rows.map(row=>{const r=row.getBoundingClientRect(),s=row.querySelector('.lt-score');return {x:r.x,y:r.y,width:r.width,height:r.height,color:getComputedStyle(row).backgroundColor,scoreColor:getComputedStyle(s).backgroundColor,score:s.textContent,name:row.querySelector('.lt-name').textContent,handle:row.querySelector('.lt-handle').textContent};});})()`);
  assert.deepEqual(geometry, [
    { x: 74, y: 844, width: 698, height: 81, color: 'rgb(204, 38, 38)', scoreColor: 'rgb(255, 48, 48)', score: '1', name: 'tozangezan', handle: '@TSoutherpacks' },
    { x: 74, y: 925, width: 698, height: 81, color: 'rgb(38, 105, 204)', scoreColor: 'rgb(48, 131, 255)', score: '1', name: 'tozangezan', handle: '@TSoutherpacks' },
  ]);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.lt-match')).display`), 'none', 'score mode hides matchup and coming up');
  assert.equal(await evaluate(`document.querySelector('.lt-compass').getBoundingClientRect().height`), 0, 'compass is not rendered in score mode');
  await evaluate(`{const m=structuredClone(fixtureValues.matchResolved);m.left.wins=2;m.right.wins=0;m.left.handle='';m.right.handle='@@Blue123';emit('matchResolved',m);}`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.lt-score')].map(e=>e.textContent)`), ['2', '0'], 'live match wins update scores');
  assert.ok(await evaluate(`document.querySelector('.lt-score-row .lt-handle').hidden`), 'empty handles take no space');
  assert.equal(await evaluate(`document.querySelector('[data-side=right] .lt-handle').textContent`), '@Blue123');
  await evaluate(`{const m=structuredClone(fixtureValues.matchResolved);m.left.name='Player';m.right.name='Player';emit('matchResolved',m);document.body.style.setProperty('background','#000','important');}`);
  await apply({ mode: 'match', comingUp: true });
  assert.equal(await evaluate(`document.querySelector('.lt-title').textContent`), 'GRANDFINALS');
  assert.equal(await evaluate(`document.querySelector('.lt-subtitle').textContent`), 'Player VS Player');
  assert.ok(await evaluate(`document.querySelector('.lt-scores').hidden`), 'between matches has no scores');
  const compass = await evaluate(`(async()=>{const i=document.querySelector('.lt-compass'),r=await fetch(i.src);return {complete:i.complete,width:i.naturalWidth,src:i.src,type:r.headers.get('content-type'),status:r.status};})()`);
  assert.ok(compass.complete&&compass.width===130&&compass.src.endsWith('/assets/logos/lower-third-compass.svg'), 'supplied compass SVG loads: '+JSON.stringify(compass));
  await screenshot('between-matches-coming-up');
  await apply({ comingUp: false });
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.lt-coming-up')).display`), 'none');
  await screenshot('between-matches');
  await apply({ visible: false });
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#lower-third')).opacity`), '0');
  await apply({ visible: true, comingUp: true });
  await evaluate(`{const m=structuredClone(fixtureValues.matchResolved);m.label='RASHINBAN 2026 / Losers Quarterfinals';m.left.name='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';m.right.name='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';m.left.handle='LongPlayerHandle12345';emit('matchResolved',m);emit('nextMatchResolved',m);}`);
  const fits = async () => evaluate(`[...document.querySelectorAll('#lower-third [data-lt-fit]')].filter(e=>e.getBoundingClientRect().height).every(e=>{const a=e.getBoundingClientRect(),b=e.parentElement.getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1&&a.right<=1920&&a.bottom<=1080;})`);
  assert.ok(await fits(), 'long match title and both matchups fit without clipping');
  await screenshot('long-matchup');
  await apply({ mode: 'scores' });
  assert.ok(await fits(), 'long alphanumeric names and handles fit score panel');
  await screenshot('long-player-names');
  await evaluate(`emit('matchResolved',null);emit('nextMatchResolved',null)`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.lt-name')].map(e=>e.textContent)`), ['TBD', 'TBD']);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.lt-score')].map(e=>e.textContent)`), ['0', '0']);
  await apply({ mode: 'match' });
  assert.equal(await evaluate(`document.querySelector('.lt-next').textContent`), 'TBD VS TBD');
  await apply({ mode: 'text', title: '<script>text</script>', subtitle: 'Back soon' });
  assert.equal(await evaluate(`document.querySelector('.lt-title').textContent`), '<script>text</script>');
  assert.ok(await evaluate(`!document.querySelector('.lt-title script')`), 'operator text stays text');
  await apply({ title: 'GRANDFINALS', subtitle: 'PLAYER VS PLAYER' });
  await screenshot('free-text');

  // Drive the actual switcher, including its actual preview/program iframe pages.
  await navigate('/bundles/rashinban/dashboard/switcher-stream.html', 'document.querySelector("[data-row=lowerThird] select")');
  await until(`document.querySelector('.monitor[data-channel=preview] iframe.info').contentDocument?.querySelector('#lower-third')`);
  await until(`document.querySelector('.monitor[data-channel=program] iframe.info').contentDocument?.querySelector('#lower-third')`);
  await evaluate(`document.querySelector('[data-row=playerCards] button.toggle').click()`);
  await until(`fixtureValues.broadcast.stream.preview.playerCards.visible===false`);
  await evaluate(`{for(const target of [window,...[...document.querySelectorAll('iframe.info')].map(f=>f.contentWindow)]){const m=structuredClone(target.fixtureValues.matchResolved);m.label='Grandfinals';m.left.name='Player1';m.right.name='Player2';target.emit('matchResolved',m);const n=structuredClone(m);n.left.name='Player3';n.right.name='Player4';target.emit('nextMatchResolved',n);}}`);
  await evaluate(`window.ltRow=document.querySelector('[data-row=lowerThird]');window.ltMode=ltRow.querySelector('select');window.ltToggle=label=>[...ltRow.querySelectorAll('button')].find(e=>e.textContent===label);window.ltSetMode=value=>{ltMode.value=value;ltMode.dispatchEvent(new Event('change'));};window.ltBus=channel=>fixtureValues.broadcast.stream[channel].lowerThird;window.ltGraphic=channel=>document.querySelector('.monitor[data-channel='+channel+'] iframe.info').contentDocument;`);
  await evaluate(`ltSetMode('scores')`);
  await until(`ltBus('preview').mode==='scores'`);
  await evaluate(`ltToggle('Visible').click()`);
  await until(`ltBus('preview').visible===true`);
  assert.equal(await evaluate(`ltBus('program').visible`), false, 'preview edits do not go on air');
  assert.ok(await evaluate(`ltToggle('Coming up').hidden`), 'Coming up control only appears for matchup mode');
  await evaluate(`document.querySelector('#take').click()`);
  await until(`ltBus('program').mode==='scores'&&ltBus('program').visible`);
  await until(`ltGraphic('program').querySelector('#lower-third').dataset.mode==='scores'`);
  await evaluate(`ltSetMode('match')`);
  await until(`ltBus('preview').mode==='match'`);
  assert.equal(await evaluate(`ltToggle('Coming up').hidden`), false);
  await evaluate(`ltToggle('Coming up').click()`);
  await until(`ltBus('preview').comingUp===true`);
  assert.equal(await evaluate(`ltBus('program').mode`), 'scores');
  await evaluate(`document.querySelector('#revert').click()`);
  await until(`ltBus('preview').mode==='scores'&&ltBus('preview').comingUp===false`);
  await evaluate(`ltSetMode('match')`);
  await until(`ltBus('preview').mode==='match'`);
  await evaluate(`ltToggle('Coming up').click()`);
  await until(`ltBus('preview').comingUp===true`);
  await evaluate(`document.querySelector('#take').click()`);
  await until(`ltBus('program').mode==='match'&&ltBus('program').comingUp===true`);
  await until(`!ltGraphic('program').querySelector('.lt-coming-up').hidden`);
  await screenshot('stream-switcher');
  await evaluate(`ltToggle('Coming up').click()`);
  await until(`ltBus('preview').comingUp===false`);
  assert.ok(await evaluate(`!ltGraphic('program').querySelector('.lt-coming-up').hidden`), 'coming up remains on program before TAKE');
  await evaluate(`document.querySelector('#take').click()`);
  await until(`ltGraphic('program').querySelector('.lt-coming-up').hidden`);
}
