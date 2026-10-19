// DAY2 top-8 bracket overlay. Boxes and lines come from the finals layout;
// names, scores and the "on now" border come from the bracketFinals replicant
// (live start.gg or a recorded sample, chosen in the Bracket dashboard panel).
import { mountBracket } from "./layers/bracket.ts";
import { mustQuery } from "./layers/layer.ts";

mountBracket(mustQuery(document, "#layer-bracket"), "stream").apply({ visible: true });
