// Keep the match boxes at their native size while moving the rows into the
// physical LED's top 1920x576 band. The standalone 1080p layout is unchanged.
import { FINALS_LAYOUT } from "./finals-layout.ts";
import { BOX, type BracketLayout } from "./svg.ts";

const DIVIDER_Y = 288;
const PAIR_GAP = 128;
const MID = { upper: 144, lower: 432 };
const paired = new Set([1, 2, 4, 5, 6, 7]);
const second = new Set([2, 5, 7]);
const COL_X = [200, 640, 1080, 1520];

export const LED_FINALS_LAYOUT: BracketLayout = {
  colX: COL_X,
  dividerY: DIVIDER_Y,
  matches: FINALS_LAYOUT.matches.map(match => ({
    ...match,
    col: match.optional ? 3 : match.col,
    y: MID[match.band] - BOX.bottom / 2
      + (paired.has(match.id) ? (second.has(match.id) ? PAIR_GAP / 2 : -PAIR_GAP / 2) : 0),
  })),
  connectors: FINALS_LAYOUT.connectors.map(connector => connector.route === "elbow" ? {
    ...connector,
    turns: [1830, 260, COL_X[2]! + BOX.right / 2, MID.upper + BOX.bottom / 2],
  } : connector),
};
