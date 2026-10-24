import assert from 'node:assert/strict';
import test from 'node:test';
import * as info from '../player-info.ts';
import { rowToProfile } from '../../sheet/players.ts';
import type { StartggBracket, BracketSet } from '../../startgg/types.ts';

const profile = rowToProfile({ startgg_tag: 'meishin', startgg_entrant_id: '10', name: 'meishin', strengths: '精査,日本マップ' });
function fixture(): StartggBracket {
  const set = (id: number, own: number | null, other: number | null, groupId = 1): BracketSet => ({
    id, groupId, phaseId: groupId, identifier: String(id), round: id, side: 'winners', roundText: 'Round',
    state: 'completed', stateCode: 3, winnerEntrantId: own! > other! ? 10 : 20, loserEntrantId: own! > other! ? 20 : 10,
    displayScore: null, totalGames: null, wPlacement: null, lPlacement: null, startedAt: null, completedAt: id,
    streamName: null, slots: [{ index: 0, entrantId: 10, score: own, seedNum: null, prereq: null, placement: null },
      { index: 1, entrantId: 20, score: other, seedNum: null, prereq: null, placement: null }],
  });
  return {
    fetchedAt: 0, event: null, streamQueue: [],
    entrants: { 10: { id: 10, tag: 'meishin', name: 'meishin', prefix: null, initialSeedNum: 1 },
      20: { id: 20, tag: 'consus', name: 'consus', prefix: null, initialSeedNum: 2 } },
    phases: [{ id: 1, name: 'DAY1（TOP64）', order: 1, bracketType: null, groupCount: 1, numSeeds: 16, state: null, groupIds: [1] },
      { id: 2, name: 'DAY2（TOP8）', order: 2, bracketType: null, groupCount: 1, numSeeds: 8, state: null, groupIds: [2] }],
    groups: {
      1: { id: 1, phaseId: 1, identifier: 'A', bracketType: null, state: 3, winnersRounds: 0, losersRounds: 0, progressionsOut: [1, 2],
        seeds: [{ id: 1, seedNum: 1, entrantId: 10, placement: 1, isBye: false, source: null }], setIds: [1, 2, 3] },
      2: { id: 2, phaseId: 2, identifier: 'TOP8', bracketType: null, state: 1, winnersRounds: 0, losersRounds: 0, progressionsOut: [],
        seeds: [{ id: 2, seedNum: 1, entrantId: 10, placement: null, isBye: false, source: { phaseGroupId: 1, phaseId: 1, phaseGroupIdentifier: 'A', placement: 1 } }], setIds: [4] },
    }, sets: { 1: set(1, 2, 0), 2: set(2, 1, 2), 3: { ...set(3, 2, 0), state: 'active' }, 4: set(4, 3, 0, 2) },
  };
}

test('Day 1 record uses completed group matches, own score orientation and actual standings', () => {
  const data = info.playerInfoResults(fixture(), 10, []);
  assert.equal(data.placement, '1st - GROUP A');
  assert.deepEqual(data.setRecord, { wins: 1, losses: 1, percent: '50.0%' });
  assert.deepEqual(data.gameRecord, { wins: 3, losses: 2, percent: '60.0%' });
  assert.deepEqual(data.rows.map(row => [row.opponent, row.score]), [['consus', '2-0'], ['consus', '1-2']]);
  const reversed = fixture(); reversed.sets[1]!.slots.reverse();
  assert.deepEqual(info.playerInfoResults(reversed, 10, []), data);
});

test('missing and DQ scores never become fabricated games; byes are excluded', () => {
  const bracket = fixture(); bracket.sets[1]!.slots[0]!.score = null;
  assert.equal(info.playerInfoResults(bracket, 10, []).gameRecord, null);
  bracket.sets[1]!.slots[1]!.score = -1;
  assert.equal(info.playerInfoResults(bracket, 10, []).rows[0]!.score, 'W-DQ');
  bracket.sets[1]!.slots[1]!.entrantId = null;
  assert.equal(info.playerInfoResults(bracket, 10, []).rows.length, 1);
  assert.equal(info.playerInfoResults(null, 10, []).status, 'unavailable');
  assert.equal(info.playerInfoResults(bracket, null, []).status, 'unlinked');
});

test('translated identity keeps source linkage and falls back safely for ambiguous profiles', () => {
  const english = { ...profile, name: 'Meishin EN', strengths: 'Scanning, Japan' };
  const players = info.playerInfoPlayers([profile], fixture(), [english]);
  assert.equal(players[0]!.profile?.strengths, 'Scanning, Japan');
  assert.equal(players[0]!.entrantId, 10);
  assert.equal(players[0]!.top8, true);
  assert.equal(players[0]!.id, info.playerInfoPlayers([profile], fixture())[0]!.id);
  assert.equal(info.playerInfoPlayers([profile], fixture(), [english, english])[0]!.name, 'meishin');
  const duplicate = { ...profile, startggEntrantId: 99 };
  const stale = { ...profile, startggEntrantId: 999 };
  assert.equal(info.playerInfoPlayers([stale], fixture())[0]!.entrantId, 10);
  assert.equal(info.playerInfoPlayers([profile, duplicate], fixture()).find(p => p.id === 'entrant:99')?.entrantId, null);
});

test('photos match source identity with per-page overrides, single-photo fallback and no ambiguous guess', () => {
  const player = info.playerInfoPlayers([profile], fixture())[0]!;
  const asset = (base: string) => ({ base, url: '/assets/rashinban/player-info/' + base, sum: 'v1' });
  assert.match(info.playerInfoPhoto(player, 'profile', [asset('meishin-blank.jpg')])!, /meishin-blank.jpg/);
  assert.match(info.playerInfoPhoto(player, 'results', [asset('meishin-blank.jpg'), asset('meishin-1.jpg')])!, /meishin-1.jpg/);
  assert.match(info.playerInfoPhoto(player, 'profile', [asset('meishin-1.jpg'), asset('meishin-2.jpg')])!, /meishin-2.jpg/);
  assert.match(info.playerInfoPhoto(player, 'profile', [asset('meishin-1.jpg')])!, /meishin-1.jpg/);
  assert.equal(info.playerInfoPhoto(player, 'results', [asset('meishin.jpg'), asset('meishin.png')]), null);
  assert.equal(info.playerInfoPhoto(player, 'profile', [asset('other.jpg')]), null);
});

test('duplicate identities and shared filename aliases cannot display another player', () => {
  const first = { ...profile, geoguessrPlayerUid: '111111111111111111111111' };
  const duplicate = { ...first, name: 'Conflicting profile' };
  assert.ok(!info.playerInfoPlayers([first, duplicate], fixture()).some(p => p.id === 'uid:' + first.geoguessrPlayerUid));
  const other = { ...first, geoguessrPlayerUid: '222222222222222222222222', startggEntrantId: 20 };
  const players = info.playerInfoPlayers([first, other], fixture());
  const assets = [{ base: 'meishin-blank.jpg', url: '/assets/rashinban/player-info/meishin-blank.jpg' }];
  assert.ok(players.every(p => info.playerInfoPhoto(p, 'profile', assets) === null));
});

test('entrant-ID photos work without start.gg while results remain unavailable', () => {
  const player = info.playerInfoPlayers([profile], null)[0]!;
  assert.match(info.playerInfoPhoto(player, 'profile', [{ base: '10-blank.jpg', url: '/assets/rashinban/player-info/10-blank.jpg' }])!, /10-blank.jpg/);
  assert.equal(info.playerInfoResults(null, player.entrantId, []).status, 'unavailable');
});
