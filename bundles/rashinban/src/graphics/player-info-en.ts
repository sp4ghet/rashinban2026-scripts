import { channelFromSearch } from '../broadcast/channel.ts';
import { bindLayers } from './broadcast/bind.ts';
import { mustQuery } from './layers/layer.ts';
import { mountPlayerInfo } from './layers/player-info.ts';

const channel = channelFromSearch(location.search);
document.body.dataset.channel = channel;
const info = mountPlayerInfo(mustQuery(document, '#layer-player-info'), true);
bindLayers('en', channel, layers => info.apply(layers.playerInfo));
