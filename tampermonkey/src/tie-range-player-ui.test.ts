import assert from 'node:assert/strict';
import test from 'node:test';

import { summaryHealthColumnsByTeamColor } from './tie-range-player-ui.ts';

/** A header cell as GeoGuessr renders it, with an optional team pin (classes from a live team duel). */
function headerCell(pinClass: string | null): Element {
  const pin = pinClass === null ? null : { classList: pinClass.split(' ') };
  return { querySelector: () => pin } as unknown as Element;
}

const RED = 'team-pin_image__CwMKA team-pin_backgroundred__spuMX';
const BLUE = 'team-pin_image__CwMKA team-pin_backgroundblue__rkREy';

test('maps team duel summary health columns to blue/red by team pin colour', () => {
  // Captured layout: Round | best guess (red) | best guess (blue) | health (red) | health (blue).
  const header = [headerCell(null), headerCell(RED), headerCell(BLUE), headerCell(RED), headerCell(BLUE)];
  assert.deepEqual(summaryHealthColumnsByTeamColor(header, ['blue', 'red']), [4, 3]);
  const blueFirst = [headerCell(null), headerCell(BLUE), headerCell(RED), headerCell(BLUE), headerCell(RED)];
  assert.deepEqual(summaryHealthColumnsByTeamColor(blueFirst, ['blue', 'red']), [3, 4]);
});

test('returns null when the summary header has no usable team pins', () => {
  const oneVsOne = [headerCell(null), headerCell(null), headerCell(null), headerCell(null), headerCell(null)];
  assert.equal(summaryHealthColumnsByTeamColor(oneVsOne, ['blue', 'red']), null);
  const sameColour = [headerCell(null), headerCell(RED), headerCell(RED), headerCell(RED), headerCell(RED)];
  assert.equal(summaryHealthColumnsByTeamColor(sameColour, ['blue', 'red']), null);
  assert.equal(summaryHealthColumnsByTeamColor([headerCell(null)], ['blue', 'red']), null);
});
