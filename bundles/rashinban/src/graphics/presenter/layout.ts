import type { Mode } from '../../types/presenter.ts';

export function layoutKind(mode: Mode, source: 'rendered' | 'chroma'): 'shared' | 'dual' {
  return mode === 'NMPZ' && source === 'rendered' ? 'shared' : 'dual';
}
