import assert from 'node:assert/strict';
import test from 'node:test';

import { mutationNeedsImmediateReconcile, type MutationLike } from './tie-range-player-mutations.ts';

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

type FakeElement = {
  nodeType: number;
  className: string;
  parentElement: FakeElement | null;
  children: FakeElement[];
  matches(selector: string): boolean;
  closest(selector: string): FakeElement | null;
  querySelector(selector: string): FakeElement | null;
};

/** Match the `[class*="prefix"]` and `.class` selectors the module uses against a class list. */
function matchesOne(element: FakeElement, selector: string): boolean {
  const contains = /^\[class\*="([^"]+)"\]$/.exec(selector);
  if (contains) return element.className.includes(contains[1]);
  if (selector.startsWith('.')) return element.className.split(/\s+/).includes(selector.slice(1));
  return false;
}

function element(className: string, parent: FakeElement | null = null): FakeElement {
  const node: FakeElement = {
    nodeType: ELEMENT_NODE,
    className,
    parentElement: parent,
    children: [],
    matches(selector) { return selector.split(/,\s*/).some(part => matchesOne(node, part)); },
    closest(selector) {
      for (let current: FakeElement | null = node; current; current = current.parentElement) {
        if (current.matches(selector)) return current;
      }
      return null;
    },
    querySelector(selector) {
      for (const child of node.children) {
        if (child.matches(selector)) return child;
        const nested = child.querySelector(selector);
        if (nested) return nested;
      }
      return null;
    },
  };
  parent?.children.push(node);
  return node;
}

function attributes(target: FakeElement, attributeName = 'style'): MutationLike {
  return { type: 'attributes', target, attributeName, addedNodes: [], removedNodes: [] };
}

function childList(target: FakeElement, added: FakeElement[] = [], removed: FakeElement[] = []): MutationLike {
  return { type: 'childList', target, addedNodes: added, removedNodes: removed };
}

function duelPage() {
  const page = element('in-game_root__x');
  const root = element('duels_root__x', page);
  const hud = element('game_topHud__x', root);
  const compass = element('panorama-compass_compass__x', hud);
  const needle = element('panorama-compass_latitude__x', compass);
  const healthBars = element('hud_healthBars__x', root);
  const fill = element('health-bar-2_fill__x', healthBars);
  const guessMap = element('gm-style', root);
  const tile = element('gm-tile', guessMap);
  return { page, root, compass, needle, healthBars, fill, guessMap, tile };
}

test('compass and other per-frame style changes do not reconcile immediately', () => {
  const { needle, compass, fill } = duelPage();
  assert.equal(mutationNeedsImmediateReconcile([attributes(needle), attributes(compass)]), false);
  // Native HP springs animate inside bars that are already hidden.
  assert.equal(mutationNeedsImmediateReconcile([attributes(fill)]), false);
});

test('visibility changes on watched elements or their ancestors reconcile immediately', () => {
  const { page, root, healthBars } = duelPage();
  assert.equal(mutationNeedsImmediateReconcile([attributes(healthBars, 'class')]), true);
  assert.equal(mutationNeedsImmediateReconcile([attributes(root, 'hidden')]), true);
  assert.equal(mutationNeedsImmediateReconcile([attributes(page, 'class')]), true);
});

test('native result and damage nodes reconcile immediately when they appear or leave', () => {
  const { root } = duelPage();
  const result = element('round-score_root__x');
  element('round-score_damageAnimation__x', result);
  assert.equal(mutationNeedsImmediateReconcile([childList(root, [result])]), true);
  assert.equal(mutationNeedsImmediateReconcile([childList(root, [], [result])]), true);
  const damage = element('damage-animation_root__x');
  assert.equal(mutationNeedsImmediateReconcile([childList(root, [damage])]), true);
});

test('content changes inside watched surfaces reconcile immediately', () => {
  const { healthBars } = duelPage();
  const summary = element('game-summary-2_root__x');
  const row = element('game-summary-2_playedRound__x', summary);
  assert.equal(mutationNeedsImmediateReconcile([childList(row, [element('cell')])]), true);
  assert.equal(mutationNeedsImmediateReconcile([childList(healthBars, [element('bar')])]), true);
});

test('map tile churn is deferred, but the native answer marker is not', () => {
  const { guessMap, tile } = duelPage();
  const result = element('round-score_root__x');
  const resultMap = element('gm-style', result);
  assert.equal(mutationNeedsImmediateReconcile([childList(guessMap, [element('gm-tile')])]), false);
  assert.equal(mutationNeedsImmediateReconcile([childList(resultMap, [element('gm-tile')])]), false);
  assert.equal(mutationNeedsImmediateReconcile([attributes(tile)]), false);
  const marker = element('result-map_correctLocation__x');
  assert.equal(mutationNeedsImmediateReconcile([childList(resultMap, [marker])]), true);
});

test('native count-up text and spring styles inside watched surfaces are deferred', () => {
  const { root } = duelPage();
  const result = element('round-score_root__x', root);
  const wrapper = element('', result);
  const damage = element('damage-animation_root__x', wrapper);
  const score = element('damage-animation_score__x', damage);
  const text = { nodeType: TEXT_NODE } as unknown as FakeElement;
  assert.equal(mutationNeedsImmediateReconcile([childList(score, [text], [text])]), false);
  assert.equal(mutationNeedsImmediateReconcile([attributes(wrapper, 'style')]), false);
  assert.equal(mutationNeedsImmediateReconcile([attributes(damage, 'style')]), false);
  assert.equal(mutationNeedsImmediateReconcile([attributes(wrapper, 'class')]), true);
  assert.equal(mutationNeedsImmediateReconcile([childList(score, [], [element('digit')])]), true);
});

test('text nodes and unrelated additions are deferred', () => {
  const { root } = duelPage();
  const text = { nodeType: TEXT_NODE } as unknown as FakeElement;
  assert.equal(mutationNeedsImmediateReconcile([childList(root, [text])]), false);
  assert.equal(mutationNeedsImmediateReconcile([childList(root, [element('chat_message__x')])]), false);
  assert.equal(mutationNeedsImmediateReconcile([]), false);
});
