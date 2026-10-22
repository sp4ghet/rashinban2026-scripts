import { channelFromSearch } from "../broadcast/channel.ts";
import { bindLayers } from "./broadcast/bind.ts";
import { mountCasters } from "./layers/casters.ts";
import { mustQuery } from "./layers/layer.ts";

const channel = channelFromSearch(location.search);
document.body.dataset.channel = channel;
const host = mustQuery(document, "#layer-casters");
host.hidden = false;
const casters = mountCasters(host, true);
bindLayers("en", channel, layers => casters.apply(layers.casters));

// Use the same 1080p coordinates at native 1080p or 4K browser-source sizes.
function resize() {
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  document.body.style.setProperty("--caster-scale", String(scale));
}
window.addEventListener("resize", resize);
resize();
