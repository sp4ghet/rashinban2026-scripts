// Browser-side glue between the broadcast bus replicant and a page's layers.
import { withDefaults, type BroadcastOutput, type BroadcastState, type LayersFor } from "../../broadcast/state.ts";
import type { Channel } from "../../broadcast/channel.ts";
import { REPLICANTS } from "../../types/replicants.ts";

/** Calls apply with this output's layers for the page's channel whenever the bus changes. */
export function bindLayers<O extends BroadcastOutput>(output: O, channel: Channel, apply: (layers: LayersFor<O>) => void): void {
  nodecg.Replicant<BroadcastState>(REPLICANTS.broadcast).on("change", (value) => {
    apply(withDefaults(value)[output][channel] as LayersFor<O>);
  });
}
