import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPTY_INTERMISSION, selectIntermission, updateIntermission } from '../intermission.ts';
import { cameraScene } from '../../graphics/presenter/intermission.ts';
import { projectScene } from '../../graphics/presenter/scene.ts';
import { applySnapshot } from '../normalize.ts';
import { advanceTimeline, DEFAULT_TIMING, finishEffect } from '../timeline.ts';
import type { SeriesState } from '../../types/presenter.ts';
import { sample } from './fixtures.ts';

function fixture() {
  const state = structuredClone(applySnapshot(null, sample('gs2-ws-DuelStarted.json')).state!);
  const competitor = (i: number) => ({ id: `side-${i}`, playerId: state.players[i].id, name: `Player ${i}`, handle: '', wins: 0 });
  const series: SeriesState = { id: 'match', source: 'manual', left: competitor(0), right: competitor(1) };
  state.status = 'Finished'; state.winnerTeamId = state.players[1].teamId;
  return { state, series };
}

test('completed game selects post-game; operator selection survives repeated snapshots and disconnect', () => {
  const { state, series } = fixture();
  const ended = updateIntermission(EMPTY_INTERMISSION, state, series);
  assert.equal(ended.view, 'end-of-last-game');
  assert.equal(ended.lastGame?.winnerCompetitorId, series.right.id);
  const before = selectIntermission(ended, { view: 'before-game' });
  assert.deepEqual(updateIntermission(before, state, series), before);
  assert.deepEqual(updateIntermission(before, null, series), before);
  assert.equal(selectIntermission(before, { view: 'end-of-last-game' }).view, 'end-of-last-game');
  assert.equal(updateIntermission(before, { ...state, gameId: 'next' }, series).view, 'end-of-last-game');
});

test('winner follows the mapped player, including side swaps; draw and abort are balanced', () => {
  const { state, series } = fixture();
  const timeline = advanceTimeline(null, state, 10000, true, DEFAULT_TIMING);
  let control = updateIntermission(EMPTY_INTERMISSION, state, series);
  let scene = projectScene(state, timeline, 10000);
  assert.equal(cameraScene(scene, control, series).winner, 'right');
  const swapped = { ...series, left: series.right, right: series.left };
  assert.equal(cameraScene(scene, control, swapped).winner, 'left');
  const lobby = { ...series, left: { ...series.left, playerId: null }, right: { ...series.right, playerId: null } };
  const retained = updateIntermission(control, null, lobby);
  assert.deepEqual(retained, control);
  assert.equal(cameraScene({ ...scene, kind: 'waiting', gameId: null }, retained, lobby).winner, 'right');
  for (const flag of ['isDraw', 'aborted'] as const) {
    const neutral = { ...state, [flag]: true };
    control = updateIntermission(control, neutral, series);
    scene = projectScene(neutral, timeline, 10000);
    assert.equal(cameraScene(scene, control, series).winner, 'none');
    assert.equal(cameraScene(scene, control, series).label, flag === 'isDraw' ? 'DRAW' : 'GAME CANCELLED');
  }
});

test('match change, invalid mapping and rollback cannot show a stale winner', () => {
  const { state, series } = fixture();
  const control = updateIntermission(EMPTY_INTERMISSION, state, series);
  const next = { ...series, id: 'new-match', right: { ...series.right, playerId: 'someone-else' } };
  assert.equal(updateIntermission(control, state, next).lastGame, null);
  const rematch = { ...series, id: 'new-match' };
  const cleared = updateIntermission(control, state, rematch);
  assert.equal(cleared.lastGame, null);
  assert.equal(updateIntermission(cleared, state, rematch).lastGame, null);
  const scene = projectScene(state, advanceTimeline(null, state, 10000, true, DEFAULT_TIMING), 10000);
  assert.equal(cameraScene(scene, control, next).view, 'before-game');
  assert.equal(updateIntermission(control, { ...state, status: 'Ongoing' }, series).lastGame, null);
  assert.throws(() => selectIntermission(EMPTY_INTERMISSION, { view: 'end-of-last-game' }), /No completed game/);
  for (const input of [null, [], {}, { view: 'live' }, { view: 'before-game', unexpected: true }]) assert.throws(() => selectIntermission(control, input));
});

test('camera views never interrupt final scoring, live play, or round previews', () => {
  const { state, series } = fixture();
  state.players.forEach((p, i) => p.results = [{ round: state.round, score: i ? 4500 : 5000, bestGuess: null,
    healthBefore: 6000, healthAfter: 5500, damageDealt: 500, multiplier: 1 }]);
  let timeline = advanceTimeline(null, state, 10000, false, DEFAULT_TIMING);
  const control = updateIntermission(EMPTY_INTERMISSION, state, series);
  assert.equal(cameraScene(projectScene(state, timeline, 10000), control, series).view, 'none');
  timeline = finishEffect(timeline, timeline.generation, 15200, DEFAULT_TIMING);
  assert.equal(cameraScene(projectScene(state, timeline, timeline.holdAtMs! - 1), control, series).view, 'none');
  const settled = projectScene(state, timeline, timeline.holdAtMs!);
  assert.equal(cameraScene(settled, control, series).view, 'end-of-last-game');
  assert.equal(cameraScene(settled, selectIntermission(control, { view: 'before-game' }), series).view, 'before-game');
  for (const kind of ['live', 'preview', 'results', 'transition'] as const) assert.equal(cameraScene({ ...settled, kind }, control, series).view, 'none');
});
