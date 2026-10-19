// Always-on LED bracket with its own silent KV background.
import { mountBracket } from "./layers/bracket.ts";
import { mustQuery } from "./layers/layer.ts";

mountBracket(mustQuery(document, "#layer-bracket")).apply({ visible: true });
