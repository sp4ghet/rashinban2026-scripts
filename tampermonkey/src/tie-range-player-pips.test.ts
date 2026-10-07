import assert from 'node:assert/strict';
import test from 'node:test';
import { pointPips, renderPointPips } from './tie-range-player-pips.ts';

class FakeElement {
  children: FakeElement[] = [];
  className = '';
  classes = new Set<string>();
  ownerDocument = { createElement: () => new FakeElement() };
  classList = { toggle: (name: string, force: boolean) => { if (force) this.classes.add(name); else this.classes.delete(name); } };
  get lastElementChild(): FakeElement | null { return this.children.at(-1) ?? null; }
  append(child: FakeElement) { this.children.push(child); }
  remove() { }
}

test('player pips mirror the presenter helper', () => {
  assert.deepEqual(pointPips(2, 7), [true, true, false, false, false, false, false]);
});

test('renderPointPips keeps exactly firstTo pips and fills the first points of them', () => {
  const container = new FakeElement();
  const removed: FakeElement[] = [];
  renderPointPips(container as unknown as HTMLElement, 3, 7);
  assert.equal(container.children.length, 7);
  assert.deepEqual(container.children.map(pip => pip.classes.has('filled')), [true, true, true, false, false, false, false]);
  renderPointPips(container as unknown as HTMLElement, 5, 7);
  assert.deepEqual(container.children.map(pip => pip.classes.has('filled')).filter(Boolean).length, 5);
  for (const pip of container.children) pip.remove = () => { removed.push(pip); container.children.pop(); };
  renderPointPips(container as unknown as HTMLElement, 1, 5);
  assert.equal(container.children.length, 5);
  assert.equal(removed.length, 2);
});
