// Always-on LED bracket, composited over background video in OBS/ATEM.
import { mountBracket } from "./layers/bracket.ts";
import { mustQuery } from "./layers/layer.ts";

mountBracket(mustQuery(document, "#layer-bracket")).apply({ visible: true });
