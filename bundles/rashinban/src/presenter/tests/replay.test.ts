import assert from 'node:assert/strict';
import test from 'node:test';
import { replayRows, rebaseReplay, shiftMessageClock, loadReplay } from '../../extension/presenter/replay.ts';
import { sample } from './fixtures.ts';
import { applySnapshot } from '../normalize.ts';

test('replay preserves receipt intervals and shifts snapshot and telemetry clocks together', () => {
  const input = [
    { receivedAt: 1000, message: { code: 'DuelStarted', duel: { state: { rounds: [{ startTime: '1970-01-01T00:00:02.000Z', endTime: null }], created: '1970-01-01T00:00:00.500Z' } } } },
    { receivedAt: 1250, message: { code: 'LiveStreamSamples', payload: [{ time: 1200, type: 'PanoZoom', payload: { zoom: 2 } }] } },
  ];
  const rows = rebaseReplay(replayRows(input), 10000);
  assert.deepEqual(rows, [
    { receivedAt: 10000, message: { code: 'DuelStarted', duel: { state: { rounds: [{ startTime: '1970-01-01T00:00:11.000Z', endTime: null }], created: '1970-01-01T00:00:09.500Z' } } } },
    { receivedAt: 10250, message: { code: 'LiveStreamSamples', payload: [{ time: 10200, type: 'PanoZoom', payload: { zoom: 2 } }] } },
  ]);
  assert.equal(input[1].receivedAt, 1250);
});

test('replay rejects malformed rows, decreasing clocks and paths outside its fixture allowlist', () => {
  for (const value of [null, {}, [], [{ receivedAt: '1000', message: {} }], [{ receivedAt: 0 }], [{ receivedAt: 3, message: {} }, { receivedAt: 2, message: {} }]]) {
    assert.throws(() => replayRows(value));
  }
  for (const name of ['../../.secrets/geoguessr.json', '/etc/passwd', 'gs2-spectator-snapshot.json', null]) {
    assert.throws(() => loadReplay(name));
  }
});

test('live ingestion subtracts server offset exactly once including guess timestamps', () => {
  const raw = sample('gs2-ws-DuelPlayerGuessed.json');
  const original = applySnapshot(null, raw).state!;
  const shifted = applySnapshot(null, shiftMessageClock(raw, -2500)).state!;
  assert.equal(shifted.rounds[0].startAtMs, original.rounds[0].startAtMs! - 2500);
  assert.equal(shifted.players[0].guesses[0].createdAtMs, Date.parse('2026-09-10T12:15:32.369Z'));
  assert.equal(original.players[0].guesses[0].createdAtMs, Date.parse('2026-09-10T12:15:34.869Z'));
});

test('repository replay fixtures load through the finite allowlist', () => {
  const rows = loadReplay('gs2-ws-full-duel-sequence-manual-rounds.json');
  assert.ok(rows.length > 10);
  assert.equal(rows[0].receivedAt, 1789051186025);
});
