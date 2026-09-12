import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { acceptPlayerSnapshot } from './tie-range-player-state.ts';
import { decodePlayerMapRounds, playerCircleRadii, type PlayerMapRound } from './tie-range-player-map.ts';
const fixture = JSON.parse(readFileSync(new URL('../../docs/geoguessr/samples/player-tie-range/player-live-manual.json', import.meta.url), 'utf8'));

test('keeps geometry only for accepted paired results and never includes future panoramas', () => {
  const raw = structuredClone(fixture.resolvedDamage);
  raw.options.map = { maxErrorDistance: 14999250 };
  for (const round of raw.rounds) round.panorama = { lat: 9, lng: -1, panoId: 'do-not-copy' };
  raw.rounds.push({ roundNumber: 30, startTime: 'future', panorama: { lat: 40, lng: 50 } });
  const context = acceptPlayerSnapshot(null, raw, 'half').context!;
  const geometry = decodePlayerMapRounds(raw, context);
  assert.equal(geometry.length, context.input.rounds.length);
  assert.ok(geometry.length > 0);
  assert.ok(geometry.every(round => round.round < 30));
  assert.deepEqual(geometry[0].answer, { lat: 9, lng: -1 });
  assert.equal(JSON.stringify(geometry).includes('panoId'), false);
  assert.deepEqual(decodePlayerMapRounds({ ...raw, gameId: 'another' }, context), []);
  raw.rounds[0].startTime = 'restarted';
  assert.ok(!decodePlayerMapRounds(raw, context).some(round => round.round === 1));
});

const round: PlayerMapRound = { round: 1, identity: 'test', answer: { lat: 0, lng: 179 }, maxErrorDistance: 14999250, distances: [32800, 37100] };
test('uses presenter score-band boundary and closer guess distance for map circles', () => {
  const radii = playerCircleRadii(round, [4892, 4878], 54);
  assert.equal(radii[0], 32800);
  assert.ok(radii[1] > 49000 && radii[1] < 50000);
  assert.equal(playerCircleRadii(round, [4878, 4892], 54)[0], 37100);
  assert.equal(playerCircleRadii(round, [4892, 4892], 54)[0], 32800);
});
test('uses one 5K boundary and omits an unbounded outer circle', () => {
  assert.equal(playerCircleRadii(round, [5000, 4999], 0).length, 1);
  assert.deepEqual(playerCircleRadii(round, [10, 0], 50), [32800]);
  assert.deepEqual(playerCircleRadii({ ...round, maxErrorDistance: null }, [4892, 4878], 54), [32800]);
});
