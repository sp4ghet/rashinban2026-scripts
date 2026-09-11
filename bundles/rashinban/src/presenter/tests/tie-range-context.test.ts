import assert from 'node:assert/strict';
import test from 'node:test';
import { sample } from './fixtures.ts';
import { applySnapshot, rollbackRound } from '../normalize.ts';
import { updateRuleContext } from '../tie-range-context.ts';
import type { DuelState } from '../../types/presenter.ts';

function resolved(): DuelState {
  const rows = sample('gs2-ws-full-duel-sequence-manual-rounds.json') as { message: unknown }[];
  let state: DuelState | null = null;
  for (const row of rows) state = applySnapshot(state, row.message).state;
  return state!;
}

test('mode latches per game, including Created, and survives serialized restoration', () => {
  const state = applySnapshot(null, sample('gs2-ws-DuelStarted-created-not-started.json')).state!;
  const first = updateRuleContext(null, state, 'full');
  assert.equal(first.mode, 'full');
  const restored = JSON.parse(JSON.stringify(first));
  const updated = updateRuleContext(restored, { ...state, version: state.version + 1 }, 'half');
  assert.equal(updated.mode, 'full');
  assert.equal(updateRuleContext(updated, { ...state, gameId: 'next' }, 'half').mode, 'half');
  assert.equal(updateRuleContext(null, state, 'off').mode, 'off');
  assert.equal(updateRuleContext(first, state, 'off').mode, 'full');
});

test('paired settled scores, guesses and answers are frozen without mutating source', () => {
  const source = resolved();
  const first = updateRuleContext(null, source, 'full');
  const changed = structuredClone(source); changed.version++;
  changed.players[0].results[0].score = 0;
  changed.players[0].results[0].bestGuess = null;
  changed.rounds[0].panorama.lat = 80;
  const updated = updateRuleContext(first, changed, 'half');
  assert.deepEqual(updated.source.players[0].results[0], first.source.players[0].results[0]);
  assert.deepEqual(updated.source.rounds[0], first.source.rounds[0]);
  assert.equal(changed.players[0].results[0].score, 0);
  assert.equal(changed.rounds[0].panorama.lat, 80);
  assert.notEqual(first.source, source);
});

test('authoritative rollback clears settled input from its target while retaining the mode', () => {
  const source = resolved();
  const first = updateRuleContext(null, source, 'full');
  const next = structuredClone(source); next.version++; next.round = 2; next.status = 'Ongoing';
  for (const player of next.players) player.results = player.results.filter(result => result.round < 2);
  const target = rollbackRound(source, next, { code: 'DuelNewRound' });
  assert.equal(target, 2);
  const rolledBack = updateRuleContext(first, next, 'off', target);
  assert.equal(rolledBack.mode, 'full');
  assert.deepEqual(rolledBack.source.players.map(player => player.results.length), [1, 1]);
  const replayed = structuredClone(source); replayed.version += 2;
  replayed.players[0].results.find(result => result.round === 2)!.score = 1234;
  const updated = updateRuleContext(rolledBack, replayed, 'off');
  assert.equal(updated.source.players[0].results.find(result => result.round === 2)!.score, 1234);
});

test('rollback detector distinguishes a repeated snapshot and same-round restart', () => {
  const source = resolved();
  assert.equal(rollbackRound(source, source, { code: 'DuelNewRound' }), undefined);
  const next = structuredClone(source); next.version++;
  next.rounds.find(round => round.number === next.round)!.startAtMs! += 1000;
  assert.equal(rollbackRound(source, next, { code: 'DuelNewRound' }), source.round);
  assert.equal(rollbackRound(source, next, { code: 'DuelMasterSnapshot' }), undefined);
});

test('explicit rollback can reopen an aborted source while generic snapshots cannot', () => {
  const previous = resolved(); previous.aborted = true;
  const rows = sample('gs2-ws-full-duel-sequence-manual-rounds.json') as any[];
  const restart = structuredClone(rows.find(row => row.message.code === 'DuelNewRound'
    && row.message.duel.state.currentRoundNumber === 2)!.message);
  restart.duel.state.version = previous.version + 1;
  const accepted = applySnapshot(previous, restart);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.state?.aborted, false);
  assert.equal(accepted.state?.round, 2);
});

test('disabled mode preserves incoming server results without freezing corrections', () => {
  const source = resolved();
  const first = updateRuleContext(null, source, 'off');
  const corrected = structuredClone(source); corrected.players[0].results[0].score = 42;
  assert.equal(updateRuleContext(first, corrected, 'full').source.players[0].results[0].score, 42);
});
