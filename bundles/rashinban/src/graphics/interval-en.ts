import { mountInterval } from "./layers/interval.ts";
import { mustQuery } from "./layers/layer.ts";

// Always on: the operator switches this transparent source in OBS.
mountInterval(mustQuery(document, "#layer-interval"), "stream", true, { background: false })
  .apply({ visible: true });
