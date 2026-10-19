import type { PlayerCamerasLayer } from "../../broadcast/state.ts";
import { RELAY_MESSAGE, type RelayResponse } from "../../presenter/relay-protocol.ts";
import { createCameraOutput } from "../presenter/camera-output.ts";
import { createRelayReceiver } from "../presenter/relay.ts";
import { mustQuery } from "./layer.ts";

/** Live graphics receive cameras; dashboard placeholders never join the relay. */
export function mountPlayerCameras(host: HTMLElement, { placeholder = false }: { placeholder?: boolean } = {}) {
  host.innerHTML = '<div class="camera left" aria-label="Player Camera 1" hidden></div><div class="camera right" aria-label="Player Camera 2" hidden></div>';
  const left = mustQuery(host, ".left");
  const right = mustQuery(host, ".right");
  if (placeholder) {
    for (const [index, camera] of [left, right].entries()) {
      camera.innerHTML = `<div class="camera-placeholder"><strong>Player Camera ${index + 1}</strong><small>Preview placeholder</small></div>`;
    }
  }
  let relay: ReturnType<typeof createRelayReceiver> | null = null;
  let cameras: ReturnType<typeof createCameraOutput> | null = null;
  function dispose() {
    cameras?.dispose(); relay?.dispose();
    cameras = null; relay = null;
    host.hidden = true;
  }
  return {
    apply(layer: PlayerCamerasLayer) {
      if (relay && relay.name !== layer.relay) dispose();
      host.hidden = !layer.left && !layer.right;
      // Camera 2 wins if an external patch enables both; never show a split view.
      left.hidden = !layer.left || layer.right;
      right.hidden = !layer.right;
      if (placeholder) return;
      if (!relay) {
        relay = createRelayReceiver({ room: layer.relay, feeds: ["camera-left", "camera-right"],
          request: request => nodecg.sendMessage(RELAY_MESSAGE, request) as Promise<RelayResponse>,
          status(message) { host.dataset.relayStatus = message; },
        });
        cameras = createCameraOutput(host, relay);
      }
      // Keep both videos attached and decoding while hidden, including Program.
      // Preview/TAKE only changes visibility, so it cannot reopen a cold feed.
      relay.setActive(true);
      cameras!.update(true);
    },
    dispose,
  };
}
