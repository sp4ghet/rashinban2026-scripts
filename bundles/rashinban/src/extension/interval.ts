import type NodeCG from "@nodecg/types";
import { defaultInterval, INTERVAL_MESSAGES, restoreInterval, timerCommand, updateContent, type IntervalState } from "../interval/state.ts";
import { REPLICANTS } from "../types/replicants.ts";

export function registerInterval(nodecg: NodeCG.ServerAPI): void {
  const rep = nodecg.Replicant<IntervalState>(REPLICANTS.interval, { defaultValue: defaultInterval() });
  rep.value = restoreInterval(rep.value);
  nodecg.listenFor(INTERVAL_MESSAGES.clock, (_data, ack) => {
    if (ack && !ack.handled) ack(null, Date.now());
  });
  for (const message of [INTERVAL_MESSAGES.content, INTERVAL_MESSAGES.timer]) {
    nodecg.listenFor(message, (data: unknown, ack) => {
      try {
        const current = restoreInterval(rep.value);
        rep.value = message === INTERVAL_MESSAGES.content ? updateContent(current, data) : timerCommand(current, data, Date.now());
        if (ack && !ack.handled) ack(null, rep.value);
      } catch (error) {
        if (ack && !ack.handled) ack(error instanceof Error ? error : new Error("Could not update interval."));
      }
    });
  }
}
