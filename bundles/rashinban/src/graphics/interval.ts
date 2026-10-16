import { channelFromSearch } from "../broadcast/channel.ts";
import { bindLayers } from "./broadcast/bind.ts";
import { mountInterval } from "./layers/interval.ts";
import { mustQuery } from "./layers/layer.ts";

const output = document.body.dataset.output === "led" ? "led" : "stream";
const channel = channelFromSearch(location.search);
document.body.dataset.channel = channel;
const interval = mountInterval(mustQuery(document, "#layer-interval"), output);
bindLayers(output, channel, layers => interval.apply(layers.interval));
