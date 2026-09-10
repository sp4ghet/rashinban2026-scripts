import type { Competitor, SeriesState } from '../types/presenter.ts';

type RecordValue = Record<string, unknown>;

function record(value: unknown, field: string): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as RecordValue;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be text`);
  return value;
}

function playerId(value: unknown, field: string): string | null {
  if (value === null) return null;
  return text(value, field);
}

function wins(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2) {
    throw new Error(`${field} must be an integer from zero through two`);
  }
  return value;
}

function competitor(value: unknown, field: 'left' | 'right'): Competitor {
  const decoded = record(value, field);
  return {
    id: text(decoded.id, `${field}.id`),
    playerId: playerId(decoded.playerId, `${field}.playerId`),
    name: text(decoded.name, `${field}.name`),
    handle: text(decoded.handle, `${field}.handle`),
    wins: wins(decoded.wins, `${field}.wins`),
  };
}

export function parseSeries(input: unknown): SeriesState {
  const decoded = record(input, 'series');
  const id = text(decoded.id, 'id');
  if (decoded.source !== 'manual') throw new Error('source must be manual');
  const left = competitor(decoded.left, 'left');
  const right = competitor(decoded.right, 'right');
  if (right.id === left.id) throw new Error('right.id must differ from left.id');
  if (right.playerId !== null && right.playerId === left.playerId) {
    throw new Error('right.playerId must differ from left.playerId');
  }
  return { id, source: 'manual', left, right };
}
