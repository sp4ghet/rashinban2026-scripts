import { createCaptureInput } from './capture.ts';
import type { createRelayReceiver } from './relay.ts';
import type { RelayFeed } from '../../presenter/relay-protocol.ts';

type CameraRelay = Pick<ReturnType<typeof createRelayReceiver>, 'open' | 'onAvailable'>;

/** Camera reactions stay live; gameplay answer/freeze gates do not apply. */
export function createCameraOutput(root: HTMLElement, relay: CameraRelay) {
  const doc = root.ownerDocument;
  const slots = (['left', 'right'] as const).map(side => {
    const feed: RelayFeed = side === 'left' ? 'camera-left' : 'camera-right';
    const host = root.querySelector<HTMLElement>('.camera.' + side)!;
    const video = doc.createElement('video');
    video.id = 'camera-' + side + '-video';
    video.autoplay = true; video.muted = true; video.playsInline = true;
    const placeholder = doc.createElement('span');
    placeholder.textContent = 'CAMERA UNAVAILABLE';
    host.replaceChildren(video, placeholder);
    host.classList.remove('key-slot'); host.classList.add('relay-camera');
    const input = createCaptureInput({
      open: () => relay.open(feed),
      attach(stream) {
        video.srcObject = stream;
        if (stream) return video.play();
        video.pause();
      },
      status(value) { host.dataset.state = value.state; },
    });
    return { side, feed, input };
  });
  const unsubscribe = relay.onAvailable(feed => { slots.find(slot => slot.feed === feed)?.input.retryAvailable(); });
  return {
    update(active: boolean | Record<'left' | 'right', boolean>) {
      for (const slot of slots) slot.input.select(slot.feed, typeof active === 'boolean' ? active : active[slot.side]);
    },
    dispose() { unsubscribe(); slots.forEach(slot => slot.input.dispose()); },
  };
}
