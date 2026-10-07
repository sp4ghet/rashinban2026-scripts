// LED info page: the venue screen shows only the Ban & Pick board and the
// player cards, bound to the led bus (program by default, preview with
// ?channel=preview).
import { channelFromSearch } from "../broadcast/channel.ts";
import { bindLayers } from "./broadcast/bind.ts";
import { mountBanpick } from "./layers/banpick.ts";
import { mustQuery } from "./layers/layer.ts";
import { mountPlayerCards } from "./layers/player-cards.ts";

const channel = channelFromSearch(location.search);
document.body.dataset.channel = channel;

const banpick = mountBanpick(mustQuery(document, "#layer-banpick"));
const cards = mountPlayerCards(mustQuery(document, "#layer-cards"));

bindLayers("led", channel, (layers) => {
  banpick.apply(layers.banpick);
  cards.apply(layers.playerCards);
});
