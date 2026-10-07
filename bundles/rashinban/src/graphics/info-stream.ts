// Stream info page: composes the overlay layers and binds them to the
// stream bus (program by default, preview with ?channel=preview).
import { channelFromSearch } from "../broadcast/channel.ts";
import { bindLayers } from "./broadcast/bind.ts";
import { mountBanpick } from "./layers/banpick.ts";
import { mountCasters } from "./layers/casters.ts";
import { mustQuery } from "./layers/layer.ts";
import { mountLowerThird } from "./layers/lower-third.ts";
import { mountPlayerCards } from "./layers/player-cards.ts";

const channel = channelFromSearch(location.search);
// Not styled: lets a switcher monitor or DevTools tell preview from program.
document.body.dataset.channel = channel;

const casters = mountCasters(mustQuery(document, "#layer-casters"));
const banpick = mountBanpick(mustQuery(document, "#layer-banpick"));
const cards = mountPlayerCards(mustQuery(document, "#layer-cards"));
const lowerThird = mountLowerThird(mustQuery(document, "#layer-lower-third"));

bindLayers("stream", channel, (layers) => {
  casters.apply(layers.casters);
  banpick.apply(layers.banpick);
  cards.apply(layers.playerCards);
  lowerThird.apply(layers.lowerThird);
});
