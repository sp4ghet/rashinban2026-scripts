// LED info page: the venue screen shows the bracket, Ban & Pick stack and
// player cards, bound to the led bus (program by default, preview with
// ?channel=preview).
import { channelFromSearch } from "../broadcast/channel.ts";
import { bindLayers } from "./broadcast/bind.ts";
import { mountBanpick } from "./layers/banpick.ts";
import { mountBracket } from "./layers/bracket.ts";
import { mustQuery } from "./layers/layer.ts";
import { mountPlayerCards } from "./layers/player-cards.ts";

const channel = channelFromSearch(location.search);
// Not styled: lets a switcher monitor or DevTools tell preview from program.
document.body.dataset.channel = channel;

const banpick = mountBanpick(mustQuery(document, "#layer-banpick"));
const cards = mountPlayerCards(mustQuery(document, "#layer-cards"), "led");
const bracket = mountBracket(mustQuery(document, "#layer-bracket"));

bindLayers("led", channel, (layers) => {
  banpick.apply(layers.banpick);
  cards.apply(layers.playerCards);
  bracket.apply(layers.bracket);
});
