import type NodeCG from "@nodecg/types";
import { defaultInterval, INTERVAL_MESSAGES, restoreInterval, timerCommand, updateContent, type IntervalState } from "../interval/state.ts";
import { REPLICANTS } from "../types/replicants.ts";

export function registerInterval(nodecg: NodeCG.ServerAPI): void {
  const rep = nodecg.Replicant<IntervalState>(REPLICANTS.interval, { defaultValue: defaultInterval() });
  rep.value = restoreInterval(rep.value);
  const en = nodecg.Replicant<IntervalState>(REPLICANTS.intervalEn, { defaultValue: defaultInterval() });
  en.value = restoreInterval(en.value);
  nodecg.listenFor(INTERVAL_MESSAGES.clock, (_data, ack) => {
    if (ack && !ack.handled) ack(null, Date.now());
  });
  for (const message of [INTERVAL_MESSAGES.content, INTERVAL_MESSAGES.timer, INTERVAL_MESSAGES.timerEn]) {
    nodecg.listenFor(message, (data: unknown, ack) => {
      try {
        const target = message === INTERVAL_MESSAGES.timerEn ? en : rep;
        const current = restoreInterval(target.value);
        target.value = message === INTERVAL_MESSAGES.content ? updateContent(current, data) : timerCommand(current, data, Date.now());
        if (ack && !ack.handled) ack(null, target.value);
      } catch (error) {
        if (ack && !ack.handled) ack(error instanceof Error ? error : new Error("Could not update interval."));
      }
    });
  }
}
