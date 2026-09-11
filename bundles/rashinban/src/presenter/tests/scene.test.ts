import assert from 'node:assert/strict';
import test from 'node:test';
import { projectScene } from '../../graphics/presenter/scene.ts';
import { applySnapshot } from '../normalize.ts';
import { advanceTimeline, DEFAULT_TIMING, finishEffect } from '../timeline.ts';
import { sample } from './fixtures.ts';

function state() {
  const s = structuredClone(applySnapshot(null, sample('gs2-ws-DuelStarted.json')).state!);
  const next = structuredClone(s.rounds[0]); next.number = s.round + 1; next.startAtMs = null;
  next.panorama.panoId = 'known-next-pano'; s.rounds.push(next);
  return s;
}
function result() {
  const s = state();
  s.players.forEach((p, i) => {
    p.health = i ? 5800 : 6000;
    p.results = [{ round: s.round, score: i ? 4800 : 5000, bestGuess: null,
      healthBefore: 6000, healthAfter: p.health, damageDealt: i ? 0 : 200, multiplier: 1 }];
  });
  return s;
}
test('unstarted initial rounds preview without changing authoritative round and scheduled starts count down', () => {
  const s = state(); s.status = 'Created'; s.rounds[0].startAtMs = null;
  let t = advanceTimeline(null, s, 10000, true, DEFAULT_TIMING);
  assert.equal(projectScene(s, t, 10000).previewRound, s.round);
  assert.equal(projectScene(s, t, 10000).countdown, null);
  s.status = 'Ongoing'; s.rounds[0].startAtMs = 13000;
  t = advanceTimeline(t, s, 10000, false, DEFAULT_TIMING);
  for (const [now, count] of [[10000, 3], [11000, 2], [12000, 1]]) assert.equal(projectScene(s, t, now).countdown, count);
  t = advanceTimeline(t, s, 13000, false, DEFAULT_TIMING);
  assert.equal(projectScene(s, t, 13000).kind, 'live');
  assert.equal(projectScene(s, t, 13000).previewRound, null);
});
test('both automatic and manual results preview only after all 5K and scoring stages settle', () => {
  for (const manual of [true, false]) {
    const s = result(); s.manualRoundStart = manual;
    let t = advanceTimeline(null, s, 10000, false, DEFAULT_TIMING);
    assert.equal(projectScene(s, t, 10000).previewRound, null);
    assert.equal(projectScene(s, t, 10000).prewarmRound, s.round + 1);
    t = finishEffect(t, t.generation, 15200, DEFAULT_TIMING);
    for (const now of [15200, t.damageAtMs!, t.holdAtMs! - 1]) assert.equal(projectScene(s, t, now).previewRound, null);
    const scene = projectScene(s, t, t.holdAtMs!);
    assert.equal(scene.kind, 'preview'); assert.equal(scene.previewRound, s.round + 1);
    assert.equal(s.round, 1); assert.equal(t.round, 1);
    assert.equal(scene.projection.answer, null); assert.equal(scene.projection.scoring, undefined);
    assert.deepEqual(scene.projection.players.map(p => [p.health, p.score, p.locked]), [[6000, null, false], [5800, null, false]]);
    s.rounds.pop(); assert.equal(projectScene(s, t, t.holdAtMs! + 60000).kind, 'results');
  }
});
test('finished winner persists, never revealing a privileged unused round', () => {
  const s = result(); s.status = 'Finished'; s.winnerTeamId = s.players[1].teamId;
  const t = advanceTimeline(null, s, 10000, true, DEFAULT_TIMING);
  for (const now of [10000, 16001, 1000000]) {
    const scene = projectScene(s, t, now);
    assert.equal(scene.kind, 'summary'); assert.equal(scene.winnerTeamId, s.players[1].teamId);
    assert.equal(scene.previewRound, null); assert.equal(scene.prewarmRound, null);
    assert.equal(scene.winnerPlayerId, s.players[1].id);
  }
  s.isDraw = true; assert.equal(projectScene(s, t, 10000).winnerTeamId, null);
  s.aborted = true; assert.equal(projectScene(s, t, 10000).kind, 'aborted');
  assert.equal(projectScene(s, t, 10000).winnerTeamId, null);
});
test('paused scenes retain their valid presentation without a countdown; new games and rollback clear it', () => {
  const s = result(); const t = advanceTimeline(null, s, 10000, true, DEFAULT_TIMING);
  const before = projectScene(s, t, 10000); assert.equal(before.kind, 'preview');
  s.paused = true; const paused = projectScene(s, t, 12000, before);
  assert.equal(paused.kind, 'preview'); assert.equal(paused.paused, true); assert.equal(paused.countdown, null);
  s.gameId = 'new-game'; assert.equal(projectScene(s, t, 13000, before).kind, 'waiting');
  const fresh = state(); fresh.paused = true;
  const freshTimeline = advanceTimeline(null, fresh, 10000, true, DEFAULT_TIMING);
  const scene = projectScene(fresh, freshTimeline, 10000, before);
  assert.notEqual(scene.previewRound, before.previewRound);
  assert.equal(scene.projection.remainingMs, null);
});
test('round limit blocks a next preview and final scoring finishes before the winner appears', () => {
  const s = result(); s.maxRounds = 1;
  let t = advanceTimeline(null, s, 10000, false, DEFAULT_TIMING);
  s.status = 'Finished'; assert.notEqual(projectScene(s, t, 10000).kind, 'summary');
  t = finishEffect(t, t.generation, 15200, DEFAULT_TIMING);
  assert.notEqual(projectScene(s, t, t.holdAtMs! - 1).kind, 'summary');
  s.status = 'Ongoing'; assert.equal(projectScene(s, t, t.holdAtMs!).kind, 'results');
  assert.equal(projectScene(s, t, t.holdAtMs!).prewarmRound, null);
  s.status = 'Finished'; assert.equal(projectScene(s, t, t.holdAtMs!).kind, 'summary');
});
test('a final snapshot arriving before its timeline cannot skip the final round scoring', () => {
  const s = result(); const previous = advanceTimeline(null, s, 10000, true, DEFAULT_TIMING);
  s.round = 2; s.status = 'Finished'; s.winnerTeamId = s.players[0].teamId;
  s.players.forEach(player => player.results.push({ ...player.results[0], round: 2, score: 5000 }));
  const mismatched = projectScene(s, previous, 20000);
  assert.notEqual(mismatched.kind, 'summary'); assert.equal(mismatched.winnerPlayerId, null);
  const finalTimeline = advanceTimeline(previous, s, 20000, false, DEFAULT_TIMING);
  assert.equal(finalTimeline.effect, 'double-5k');
  assert.notEqual(projectScene(s, finalTimeline, 20000).kind, 'summary');
});
test('knockout results cannot prewarm or preview before the Finished event, including paused retention', () => {
  const s = result(); const t = advanceTimeline(null, s, 10000, true, DEFAULT_TIMING);
  const preview = projectScene(s, t, 10000); assert.equal(preview.kind, 'preview');
  s.players[1].health = 0; s.players[1].results[0].healthAfter = 0;
  for (const paused of [false, true]) {
    s.paused = paused;
    const scene = projectScene(s, t, 10000, preview);
    assert.equal(scene.kind, 'results'); assert.equal(scene.previewRound, null); assert.equal(scene.prewarmRound, null);
  }
});
