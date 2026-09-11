import assert from 'node:assert/strict';
import test from 'node:test';
import { createCelebrationUnderlay } from '../../graphics/presenter/celebration.ts';
import type { RenderFrame } from '../../graphics/presenter/renderer.ts';
import { applySnapshot } from '../normalize.ts';
import { seedViews } from '../telemetry.ts';
import { sample } from './fixtures.ts';

function live(): RenderFrame {
  const state = applySnapshot(null, sample('gs2-ws-DuelStarted.json')).state!;
  return { state, views: seedViews(state), source: 'rendered', displayedRound: state.round,
    playerIds: { left: state.players[0].id, right: state.players[1].id },
    projection: { phase: 'live', answer: null, remainingMs: 1000, players: [] } };
}
test('celebration retains an immutable last live frame without exposing result data or reset telemetry', () => {
  const hold = createCelebrationUnderlay();
  const frame = live(); hold.render(frame, false);
  const expected = structuredClone(frame);
  frame.projection.phase = 'results-transition';
  frame.views.players[frame.playerIds!.left!]!.panorama.heading = 999;
  const result = hold.render(frame, true);
  assert.deepEqual(result, { ...expected, frozen: true });
  assert.equal(result.projection.answer, null);
  assert.deepEqual(hold.render(frame, true), result);
  frame.projection.phase = 'results-reveal'; frame.projection.answer = frame.state.rounds[0].panorama;
  assert.equal(hold.render(frame, false), frame);
  frame.projection.phase = 'results-transition';
  assert.equal(hold.render(frame, true), frame, 'reveal discards the retained frame');
});
test('celebration cannot restore another game, round, mode, mapping, source or disconnected frame', () => {
  for (const change of [
    (f: RenderFrame) => { f.state.gameId = 'new-game'; },
    (f: RenderFrame) => { f.state.round++; },
    (f: RenderFrame) => { f.displayedRound = null; },
    (f: RenderFrame) => { f.state.mode = 'MOVE'; },
    (f: RenderFrame) => { f.playerIds!.left = null; },
    (f: RenderFrame) => { f.source = 'chroma'; },
  ]) {
    const hold = createCelebrationUnderlay(); const frame = live(); hold.render(frame, false);
    frame.projection.phase = 'results-transition'; change(frame);
    assert.equal(hold.render(frame, true), frame);
  }
  const hold = createCelebrationUnderlay(); const frame = live(); hold.render(frame, false); hold.reset();
  frame.projection.phase = 'results-transition'; assert.equal(hold.render(frame, true), frame);
  const fresh = createCelebrationUnderlay(); assert.equal(fresh.render(frame, true), frame);
});
test('retained frame accepts NodeCG Replicant proxies', () => {
  const hold = createCelebrationUnderlay(); const frame = live();
  frame.state = new Proxy(frame.state, {});
  frame.views = new Proxy(frame.views, {});
  assert.doesNotThrow(() => hold.render(frame, false));
  frame.projection.phase = 'results-transition';
  assert.equal(hold.render(frame, true).frozen, true);
});
