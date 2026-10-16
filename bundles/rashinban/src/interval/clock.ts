import { clockOffset } from "../presenter/clock.ts";

export function createIntervalClock(deps: { monotonicNow(): number; sample(): Promise<unknown> }) {
  let offset: number | null = null, pending = false;
  return {
    now(): number | null { return offset === null ? null : deps.monotonicNow() + offset; },
    async sync(): Promise<void> {
      if (pending) return;
      pending = true;
      const sentMs = deps.monotonicNow();
      try {
        const serverMs = await deps.sample();
        const receivedMs = deps.monotonicNow();
        if (typeof serverMs === "number" && Number.isFinite(serverMs) && receivedMs >= sentMs && receivedMs - sentMs < 1000) {
          offset = clockOffset([{ sentMs, receivedMs, serverMs }]);
        }
      } catch { /* Continue on the last monotonic server estimate during a disconnect. */ }
      finally { pending = false; }
    },
  };
}
