// DAY2 top 8, measured from the designer's 1920x1080 tournament reference.
import { type BracketLayout, type LayoutConnector, type LayoutMatch, type MatchBox } from "./svg.ts";

// The reset sits slightly farther right than the lower final.
export const COL_X = [640, 962, 1310, 1534, 1591];
export const DIVIDER_Y = 596;
export const STREAM_BOX: MatchBox = {
  left: 0, right: 199, scoreWidth: 32, rowHeight: 31,
  bottomRowY: 33, midY: 32, bottom: 64,
  nameX: 7, nameY: 24, scoreY: 26,
};

export const MATCHES: LayoutMatch[] = [
  { id: 1, col: 0, y: 182, band: "upper", round: "Winners Semifinal" },
  { id: 2, col: 0, y: 350, band: "upper", round: "Winners Semifinal" },
  { id: 3, col: 1, y: 268, band: "upper", round: "Winners Final" },
  { id: 4, col: 0, y: 722, band: "lower", round: "Losers R1" },
  { id: 5, col: 0, y: 890, band: "lower", round: "Losers R1" },
  { id: 6, col: 1, y: 722, band: "lower", round: "Losers Quarterfinal" },
  { id: 7, col: 1, y: 890, band: "lower", round: "Losers Quarterfinal" },
  { id: 8, col: 2, y: 808, band: "lower", round: "Losers Semifinal" },
  { id: 9, col: 3, y: 808, band: "lower", round: "Losers Final" },
  { id: 10, col: 2, y: 268, band: "upper", round: "Grand Final" },
  { id: 11, col: 4, y: 268, band: "upper", round: "Reset", optional: true },
];

export const CONNECTORS: LayoutConnector[] = [
  { from: [1, 2], to: 3 },
  { from: [4], to: 6 },
  { from: [5], to: 7 },
  { from: [6, 7], to: 8 },
  { from: [8], to: 9 },
  { from: [3], to: 10 },
  // The lower-final winner returns to the feeder immediately before the GF.
  { from: [9], to: 10, route: "elbow", turns: [1786, 482, 1232, 300] },
  { from: [10], to: 11, optional: true },
];

export const FINALS_LAYOUT: BracketLayout = {
  colX: COL_X, dividerY: DIVIDER_Y, matches: MATCHES, connectors: CONNECTORS,
  box: STREAM_BOX, joinOffset: 25, championGap: 36,
};
