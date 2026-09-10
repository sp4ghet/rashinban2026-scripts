import type { ApplyResult, DuelState } from '../types/presenter.ts';
import { decodeSnapshot } from './protocol.ts';

export function applySnapshot(previous: DuelState | null, message: unknown): ApplyResult {
  const decoded = decodeSnapshot(message);
  if (decoded.state === null) {
    return { state: previous, accepted: false, warnings: decoded.warnings };
  }

  const next = decoded.state;
  if (previous?.gameId === next.gameId && next.version <= previous.version) {
    return { state: previous, accepted: false, warnings: [] };
  }

  return { state: next, accepted: true, warnings: decoded.warnings };
}
