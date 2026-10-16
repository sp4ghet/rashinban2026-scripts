import { createIntervalClock } from "./clock.ts";
import { INTERVAL_MESSAGES } from "./state.ts";

/** Shared clock for dashboard/graphics, independent of a remote computer's wall clock. */
export function startIntervalClock() {
  const clock = createIntervalClock({ monotonicNow: () => performance.now(), sample: async () => {
    let timeout: number | undefined;
    try {
      return await Promise.race([nodecg.sendMessage(INTERVAL_MESSAGES.clock), new Promise<undefined>(resolve => {
        timeout = window.setTimeout(() => resolve(undefined), 1000);
      })]);
    } finally { window.clearTimeout(timeout); }
  } });
  const sync = () => { void clock.sync(); };
  sync();
  const refresh = window.setInterval(sync, 10000);
  window.addEventListener("pageshow", sync);
  window.addEventListener("pagehide", event => {
    if (event.persisted) return;
    window.clearInterval(refresh);
    window.removeEventListener("pageshow", sync);
  });
  return clock;
}
