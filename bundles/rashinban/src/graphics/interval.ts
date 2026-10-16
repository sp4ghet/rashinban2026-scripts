import { channelFromSearch } from "../broadcast/channel.ts";
import { bindLayers } from "./broadcast/bind.ts";
import { mountInterval } from "./layers/interval.ts";
import { mustQuery } from "./layers/layer.ts";

const output = document.body.dataset.output === "led" ? "led" : "stream";
const interval = mountInterval(mustQuery(document, "#layer-interval"), output);
if (output === "led") {
  // LED pages are always on; OBS/ATEM switches the whole source.
  interval.apply({ visible: true });
} else {
  const channel = channelFromSearch(location.search);
  document.body.dataset.channel = channel;
  bindLayers("stream", channel, layers => interval.apply(layers.interval));
}
