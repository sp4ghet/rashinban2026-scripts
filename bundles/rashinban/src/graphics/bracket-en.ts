import { mountBracket } from "./layers/bracket.ts";
import { mustQuery } from "./layers/layer.ts";

// Always on, with shared bracket data and English display names.
mountBracket(mustQuery(document, "#layer-bracket"), "stream", true, { background: false })
  .apply({ visible: true });
