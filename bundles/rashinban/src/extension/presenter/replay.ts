import { readFileSync } from 'node:fs';
import path from 'node:path';

export type ReplayRow = { receivedAt: number; message: unknown };
export const REPLAY_FIXTURES = [
  'gs2-ws-full-duel-sequence.json',
  'gs2-ws-full-duel-sequence-manual-rounds.json',
  'gs2-ws-full-duel-sequence-maxroundtime.json',
  'gs2-ws-full-duel-sequence-aborted.json',
] as const;
export function replayRows(input: unknown): ReplayRow[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error('Replay must contain recorded messages');
  let previous = -Infinity;
  return input.map(row => {
    if (typeof row !== 'object' || row === null || typeof row.receivedAt !== 'number'
      || !Number.isFinite(row.receivedAt) || row.receivedAt < previous
      || typeof row.message !== 'object' || row.message === null || Array.isArray(row.message)) {
      throw new Error('Invalid replay row');
    }
    previous = row.receivedAt;
    return { receivedAt: row.receivedAt, message: structuredClone(row.message) };
  });
}

// Convert only absolute protocol timestamps, never durations or coordinates.
// Live callers pass -serverOffsetMs. Replay passes now - firstRecordedReceipt.
export function shiftMessageClock(input: unknown, deltaMs: number): unknown {
  if (Array.isArray(input)) return input.map(item => shiftMessageClock(item, deltaMs));
  if (typeof input !== 'object' || input === null) return input;
  return Object.fromEntries(Object.entries(input).map(([key, value]) => {
    if (key === 'time' && typeof value === 'number' && Number.isFinite(value)) return [key, value + deltaMs];
    if (['startTime', 'timerStartTime', 'endTime', 'created', 'timestamp'].includes(key)
      && typeof value === 'string' && Number.isFinite(Date.parse(value))) {
      return [key, new Date(Date.parse(value) + deltaMs).toISOString()];
    }
    return [key, shiftMessageClock(value, deltaMs)];
  }));
}

export function rebaseReplay(rows: ReplayRow[], nowMs: number): ReplayRow[] {
  const delta = nowMs - rows[0].receivedAt;
  return rows.map(row => ({ receivedAt: row.receivedAt + delta, message: shiftMessageClock(row.message, delta) }));
}

export function loadReplay(name: unknown, baseDir = process.cwd()): ReplayRow[] {
  if (typeof name !== 'string' || !(REPLAY_FIXTURES as readonly string[]).includes(name)) throw new Error('Unknown replay fixture');
  return replayRows(JSON.parse(readFileSync(path.join(baseDir, 'docs/geoguessr/samples', name), 'utf8')));
}

export function createReplay(rows: ReplayRow[], sink: (message: unknown, atMs: number) => void,
  deps: { now(): number; schedule(fn: () => void, delayMs: number): () => void }) {
  let cancel: (() => void) | null = null;
  let generation = 0;
  function stop() { generation++; cancel?.(); cancel = null; }
  function start() {
    stop();
    const own = generation;
    const rebased = rebaseReplay(rows, deps.now());
    let index = 0;
    const next = () => {
      if (generation !== own) return;
      while (index < rebased.length && rebased[index].receivedAt <= deps.now()) {
        const row = rebased[index++];
        sink(row.message, row.receivedAt);
      }
      if (index < rebased.length) cancel = deps.schedule(next, Math.max(0, rebased[index].receivedAt - deps.now()));
    };
    next();
  }
  return { start, stop, reconnect: start };
}
