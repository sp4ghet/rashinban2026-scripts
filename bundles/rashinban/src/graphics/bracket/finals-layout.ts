// Layout for the DAY2 top 8, ported from rashinban2026's
// assets/js/finals-bracket-layout.js: four seeded into the upper half and four
// into the lower half, so there is no upper round 1 and losers R1 is fed from
// DAY1. Vertical positions are derived from VIEW and PAIR_GAP so both halves
// stay symmetric about the divider.
//
// Fills the 1920x1080 canvas at 1:1. The red/blue bands and the UPPER / LOWER /
// LOWER FINAL WINNER wordmarks in brackets-finals.html are placed against
// DIVIDER_Y, UPPER_MID, LOWER_MID and RISER_* by hand; move them together.
import { BOX, type BracketLayout, type LayoutConnector, type LayoutMatch } from "./svg.ts";

/** Left edge of each column's boxes. Leaves x < 190 for the UPPER/LOWER wordmarks. */
export const COL_X = [200, 640, 1080, 1520];

/** The vertical region the bracket fills. */
const VIEW = { y: 60, height: 960 };

/** Vertical distance between two sibling matches, shared by both halves. */
const PAIR_GAP = 260;

/** Halfway down the framed region (540), so the two halves get equal height. */
export const DIVIDER_Y = VIEW.y + VIEW.height / 2;

const UPPER_MID = (VIEW.y + DIVIDER_Y) / 2; // 300
const LOWER_MID = (DIVIDER_Y + VIEW.y + VIEW.height) / 2; // 780

/** y of the first of a pair, so the pair straddles `mid`. */
const pairTop = (mid: number) => mid - (PAIR_GAP + BOX.bottom) / 2;
/** y of a lone match centred on `mid`. */
const centred = (mid: number) => mid - BOX.bottom / 2;

export const MATCHES: LayoutMatch[] = [
  { id: 1, col: 0, y: pairTop(UPPER_MID), band: "upper", round: "Winners Semifinal" },
  { id: 2, col: 0, y: pairTop(UPPER_MID) + PAIR_GAP, band: "upper", round: "Winners Semifinal" },
  { id: 3, col: 1, y: centred(UPPER_MID), band: "upper", round: "Winners Final" },

  { id: 4, col: 0, y: pairTop(LOWER_MID), band: "lower", round: "Losers R1" },
  { id: 5, col: 0, y: pairTop(LOWER_MID) + PAIR_GAP, band: "lower", round: "Losers R1" },
  { id: 6, col: 1, y: pairTop(LOWER_MID), band: "lower", round: "Losers Quarterfinal" },
  { id: 7, col: 1, y: pairTop(LOWER_MID) + PAIR_GAP, band: "lower", round: "Losers Quarterfinal" },
  { id: 8, col: 2, y: centred(LOWER_MID), band: "lower", round: "Losers Semifinal" },
  { id: 9, col: 3, y: centred(LOWER_MID), band: "lower", round: "Losers Final" },

  { id: 10, col: 2, y: centred(UPPER_MID), band: "upper", round: "Grand Final" },
  // Only played if the lower-bracket player takes the first set.
  { id: 11, col: 3, y: centred(UPPER_MID), band: "upper", round: "Reset", optional: true },
];

/** Where the losers-final riser turns: right of the reset box, below the label, above the divider. */
const RISER_X = 1830;
const RISER_Y = 470;

export const CONNECTORS: LayoutConnector[] = [
  { from: [1, 2], to: 3 },
  { from: [4], to: 6 },
  { from: [5], to: 7 },
  { from: [6, 7], to: 8 },
  { from: [8], to: 9 },
  { from: [3], to: 10 },
  // The losers final sits right of the grand final, so its winner comes back
  // left and up into the bottom of the GF box.
  {
    from: [9],
    to: 10,
    route: "elbow",
    turns: [RISER_X, RISER_Y, COL_X[2]! + (BOX.left + BOX.right) / 2, centred(UPPER_MID) + BOX.bottom],
  },
  { from: [10], to: 11, optional: true },
];

export const FINALS_LAYOUT: BracketLayout = {
  colX: COL_X,
  dividerY: DIVIDER_Y,
  matches: MATCHES,
  connectors: CONNECTORS,
};
