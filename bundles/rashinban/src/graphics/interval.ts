import { mountInterval } from "./layers/interval.ts";
import { mustQuery } from "./layers/layer.ts";

const output = document.body.dataset.output === "led" ? "led" : "stream";
const interval = mountInterval(mustQuery(document, "#layer-interval"), output);
// Standalone pages are always on; OBS/ATEM switches the whole source.
// The interval layer in info-stream follows the Stream switcher instead.
interval.apply({ visible: true });
