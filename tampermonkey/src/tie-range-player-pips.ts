import { pointPips } from '../../bundles/rashinban/src/graphics/presenter/layout.ts';

export { pointPips };

/** Keep `container` holding exactly `firstTo` pips, the first `points` of them filled. */
export function renderPointPips(container: HTMLElement, points: number | undefined, firstTo: number): void {
  const states = pointPips(points, firstTo);
  const document = container.ownerDocument;
  while (container.children.length < states.length) {
    const pip = document.createElement('i');
    pip.className = 'pip';
    container.append(pip);
  }
  while (container.children.length > states.length) container.lastElementChild!.remove();
  states.forEach((filled, index) => container.children[index].classList.toggle('filled', filled));
}
