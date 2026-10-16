// Always-on LED player cards and Ban & Pick. OBS/ATEM switches whole pages.
import { defaultLayers } from "../broadcast/state.ts";
import { bindLayers } from "./broadcast/bind.ts";
import { mountBanpick } from "./layers/banpick.ts";
import { mustQuery } from "./layers/layer.ts";
import { mountPlayerCards } from "./layers/player-cards.ts";

const banpick = mountBanpick(mustQuery(document, "#layer-banpick"));
const cards = mountPlayerCards(mustQuery(document, "#layer-cards"), "led");
const cardLayer = { ...defaultLayers("led").playerCards, visible: true };
banpick.apply({ visible: true });
cards.apply(cardLayer);

// Only the on-air page is shared. Stream visibility, player and position never
// affect LED; even old ?channel=preview URLs follow Stream Program.
bindLayers("stream", "program", (layers) => {
  cards.apply({ ...cardLayer, page: layers.playerCards.page });
});
