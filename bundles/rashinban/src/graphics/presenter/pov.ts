export type Pov = { heading: number; pitch: number; zoom: number };

const DURATION_MS = 200;
const MAX_FRAME_GAP_MS = 500;
const copy = (value: Pov): Pov => ({ heading: value.heading, pitch: value.pitch, zoom: value.zoom });
const same = (a: Pov, b: Pov) => a.heading === b.heading && a.pitch === b.pitch && a.zoom === b.zoom;

/** Interpolates only the latest received pose, using the caller's monotonic frame time. */
export function createPovSmoother() {
  let from: Pov | null = null; let target: Pov | null = null; let startedAt = 0; let lastAt: number | null = null;
  function current(at: number): Pov {
    if (same(from!, target!)) return copy(target!);
    const progress = Math.max(0, Math.min(1, (at - startedAt) / DURATION_MS));
    if (progress === 1) return copy(target!);
    if (progress === 0) return copy(from!);
    const headingDelta = ((target!.heading - from!.heading) % 360 + 540) % 360 - 180;
    return {
      heading: ((from!.heading + headingDelta * progress) % 360 + 360) % 360,
      pitch: from!.pitch + (target!.pitch - from!.pitch) * progress,
      zoom: from!.zoom + (target!.zoom - from!.zoom) * progress,
    };
  }
  return {
    sample(next: Pov, at: number, snap = false): Pov {
      if (!target || !from || lastAt === null || snap || at < lastAt || at - lastAt > MAX_FRAME_GAP_MS) {
        from = copy(next); target = copy(next); startedAt = at; lastAt = at; return copy(next);
      }
      const value = current(at); lastAt = at;
      if (!same(next, target)) { from = value; target = copy(next); startedAt = at; }
      return value;
    },
    reset() { from = null; target = null; lastAt = null; },
  };
}
