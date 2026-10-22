// OBS owns scene switching; the English bus still selects the player/card page.
import { channelFromSearch } from "../broadcast/channel.ts";
import { bindLayers } from "./broadcast/bind.ts";
import { mustQuery } from "./layers/layer.ts";
import { mountPlayerCards } from "./layers/player-cards.ts";
import { mountPlayerCameras } from "./layers/player-cameras.ts";

const channel = channelFromSearch(location.search);
document.body.dataset.channel = channel;
const cameras = mountPlayerCameras(mustQuery(document, "#layer-player-cameras"), {
  placeholder: new URLSearchParams(location.search).get("cameraMode") === "placeholder",
});
const cards = mountPlayerCards(mustQuery(document, "#layer-cards"), "en");
window.addEventListener("pagehide", () => cameras.dispose());
bindLayers("en", channel, layers => {
  cameras.apply(layers.playerCameras);
  cards.apply(layers.playerCards);
});
