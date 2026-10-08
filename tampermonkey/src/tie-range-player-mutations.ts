/** GeoGuessr surfaces the player HUD reads or hides. Class names carry a build hash suffix. */
export const CLASS_SELECTORS = {
  duelRoot: '[class*="duels_root__"]',
  healthBars: '[class*="hud_healthBars__"]',
  resultRoot: '[class*="round-score_root__"]',
  resultRound: '[class*="round-score_roundNumber__"]',
  damage: '[class*="round-score_damageAnimation__"]',
  summary: '[class*="game-summary-2_root__"]',
  summaryHeader: '[class*="game-summary-2_playedRoundsHeader__"]',
  summaryRow: '[class*="game-summary-2_playedRound__"]',
  roundNumber: '[class*="game-summary-2_roundNumber__"]',
  terminal: '[class*="summon-glow-text_root__"]',
} as const;

const DAMAGE_ANIMATION = '[class*="damage-animation_root__"]';
const ANSWER_MARKER = '[class*="result-map_correctLocation__"], [data-qa="correct-location"]';

/** Elements whose presence or visibility changes what the HUD shows. */
const WATCHED = [...Object.values(CLASS_SELECTORS), DAMAGE_ANIMATION, ANSWER_MARKER].join(', ');

/** Surfaces whose contents are read or hidden, so new children there matter. */
const WATCHED_CONTENT = [
  CLASS_SELECTORS.healthBars,
  CLASS_SELECTORS.resultRoot,
  CLASS_SELECTORS.summary,
  CLASS_SELECTORS.terminal,
  DAMAGE_ANIMATION,
].join(', ');

/** Google Maps and Street View DOM: tiles and controls churn on every pan. */
const MAP_DOM = '.gm-style';

type ElementLike = {
  nodeType: number;
  matches(selector: string): boolean;
  closest(selector: string): unknown;
  querySelector(selector: string): unknown;
};

export type MutationLike = {
  type: string;
  target: unknown;
  attributeName?: string | null;
  addedNodes: ArrayLike<unknown>;
  removedNodes: ArrayLike<unknown>;
};

const ELEMENT_NODE = 1;

function asElement(node: unknown): ElementLike | null {
  return typeof node === 'object' && node !== null && (node as ElementLike).nodeType === ELEMENT_NODE
    ? node as ElementLike : null;
}

function touchesWatched(node: unknown): boolean {
  const element = asElement(node);
  return element !== null && (element.matches(WATCHED) || element.querySelector(WATCHED) !== null);
}

/**
 * Whether a batch must reconcile before the next paint. Native damage must be
 * hidden the moment it appears, but the compass, map tiles and HP springs
 * mutate on every frame and only need an occasional catch-up pass.
 */
export function mutationNeedsImmediateReconcile(records: ArrayLike<MutationLike>): boolean {
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.type === 'attributes') {
      // A watched element, or an ancestor whose visibility hides or shows one.
      // Inline styles are animation springs (and our own writes); they only
      // need the catch-up pass.
      if (record.attributeName !== 'style' && touchesWatched(record.target)) return true;
      continue;
    }
    if (record.type !== 'childList') continue;
    for (const nodes of [record.addedNodes, record.removedNodes]) {
      for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
        if (touchesWatched(nodes[nodeIndex])) return true;
      }
    }
    const target = asElement(record.target);
    if (target && target.closest(WATCHED_CONTENT) !== null && target.closest(MAP_DOM) === null) {
      // New or removed elements need hiding or remapping; text swaps such as
      // the native count-up inherit the hidden state of their parent.
      for (const nodes of [record.addedNodes, record.removedNodes]) {
        for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
          if (asElement(nodes[nodeIndex])) return true;
        }
      }
    }
  }
  return false;
}
