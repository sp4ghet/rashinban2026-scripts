type Hole = { x: number; y: number; width: number; height: number; radius: number };

function hole(element: HTMLElement): Hole | null {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  if (!rect.width || !rect.height || style.visibility === 'hidden') return null;
  const frame = element.classList.contains('player-window') ? getComputedStyle(element, '::after') : style;
  // Put the cutout edge beneath the opaque middle of the frame. If it shares
  // the frame's outer curve, two antialiased edges create a translucent seam.
  const inset = Math.min((parseFloat(frame.borderTopWidth) || 0) / 2, rect.width / 2, rect.height / 2);
  return { x: rect.x + inset, y: rect.y + inset, width: rect.width - 2 * inset, height: rect.height - 2 * inset,
    radius: Math.max(0, Math.min(parseFloat(style.borderTopLeftRadius) || 0, rect.width / 2, rect.height / 2) - inset) };
}

function cutouts(element: HTMLElement, holes: Hole[]) {
  if (!holes.length) { element.style.clipPath = ''; return; }
  const bounds = element.getBoundingClientRect();
  if (!bounds.width || !bounds.height) { element.style.clipPath = ''; return; }
  const paths = holes.map(rect => {
    const x = rect.x - bounds.x, y = rect.y - bounds.y, w = rect.width, h = rect.height, r = rect.radius;
    return `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${2 * r - w}a${r} ${r} 0 0 1 ${-r} ${-r}v${2 * r - h}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
  });
  element.style.clipPath = `path(evenodd, "M0 0H${bounds.width}V${bounds.height}H0Z${paths.join('')}")`;
}

/** Cut only the artwork underneath external inputs, retaining frames and badges.
 * Relayed cameras have no key-slot class and never become alpha holes. */
export function createChromaWindows(root: HTMLElement) {
  const backdrop = root.querySelector<HTMLElement>('.backdrop')!;
  const layers = [...root.querySelectorAll<HTMLElement>('#live-area, #preview-area, #results-area, #waiting-area, #summary-area, #transition')];
  const cameras = [...root.querySelectorAll<HTMLElement>('.camera')];
  let previous = '';
  const invalidate = () => { previous = ''; };
  const observer = new ResizeObserver(invalidate);
  for (const element of [backdrop, ...layers, ...cameras, ...root.querySelectorAll<HTMLElement>('.player-window')]) observer.observe(element);
  return {
    update(transparent: boolean) {
      // Fixed broadcast layouts only need new geometry on a scene/source change
      // or resize; avoid synchronous layout reads on every animation frame.
      const signature = [transparent, root.dataset.source, root.dataset.layout, root.dataset.lock, root.dataset.intermission, root.dataset.cameraWinner,
        ...layers.map(layer => `${layer.hidden}:${layer.style.visibility}`), ...cameras.map(camera => camera.className)].join('|');
      if (signature === previous) return;
      previous = signature;
      if (!transparent) { for (const layer of [backdrop, ...layers]) layer.style.clipPath = ''; return; }
      const cameraHoles = cameras.filter(camera => camera.classList.contains('key-slot')).map(hole).filter((value): value is Hole => !!value);
      const playerHoles = root.dataset.source === 'chroma'
        ? [...root.querySelectorAll<HTMLElement>('.player-window')].map(hole).filter((value): value is Hole => !!value) : [];
      cutouts(backdrop, [...playerHoles, ...cameraHoles]);
      // Cameras can overlap the preview, results map, or transition card.
      // Player holes affect only the backdrop: lock labels remain above them.
      for (const layer of layers) cutouts(layer, cameraHoles);
    },
    dispose() { observer.disconnect(); },
  };
}
