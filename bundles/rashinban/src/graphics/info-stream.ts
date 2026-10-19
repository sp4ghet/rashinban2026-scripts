// Stream info page: composes the overlay layers and binds them to the
// stream bus (program by default, preview with ?channel=preview).
import { channelFromSearch } from "../broadcast/channel.ts";
import { bindLayers } from "./broadcast/bind.ts";
import { mountBanpick } from "./layers/banpick.ts";
import { mountCasters } from "./layers/casters.ts";
import { mustQuery } from "./layers/layer.ts";
import { mountLowerThird } from "./layers/lower-third.ts";
import { mountInterval } from "./layers/interval.ts";
import { mountBracket } from "./layers/bracket.ts";
import { mountPlayerCards } from "./layers/player-cards.ts";

import { mountPlayerCameras } from "./layers/player-cameras.ts";

const channel = channelFromSearch(location.search);
// Not styled: lets a switcher monitor or DevTools tell preview from program.
document.body.dataset.channel = channel;

// Switcher monitors show the camera selection without adding relay receivers.
const playerCameras = mountPlayerCameras(mustQuery(document, "#layer-player-cameras"), {
  placeholder: new URLSearchParams(location.search).get("cameraMode") === "placeholder",
});
window.addEventListener("pagehide", () => playerCameras.dispose());

const casters = mountCasters(mustQuery(document, "#layer-casters"));
const banpick = mountBanpick(mustQuery(document, "#layer-banpick"));
const cards = mountPlayerCards(mustQuery(document, "#layer-cards"), "stream");
const lowerThird = mountLowerThird(mustQuery(document, "#layer-lower-third"));
const interval = mountInterval(mustQuery(document, "#layer-interval"), "stream");
const bracket = mountBracket(mustQuery(document, "#layer-bracket"), "stream");

bindLayers("stream", channel, (layers) => {
  playerCameras.apply(layers.playerCameras);
  casters.apply(layers.casters);
  banpick.apply(layers.banpick);
  cards.apply(layers.playerCards);
  lowerThird.apply(layers.lowerThird);
  interval.apply(layers.interval);
  bracket.apply({ visible: layers.bracket.visible && !layers.interval.visible });
});
