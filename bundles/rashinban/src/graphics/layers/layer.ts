// Shared shape and helpers for the layer modules mounted by the info pages.

/** What a mounted layer exposes to the page: its slice of the broadcast bus. */
export type Layer<L> = { apply(layer: L): void };

/** querySelector that fails loudly: a miss means the layer's template is wrong. */
export function mustQuery<T extends HTMLElement = HTMLElement>(host: ParentNode, selector: string): T {
  const el = host.querySelector<T>(selector);
  if (!el) throw new Error(`layer markup missing ${selector}`);
  return el;
}
