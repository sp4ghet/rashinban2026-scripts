import { createCaptureUI } from './presenter/capture-ui.ts';
import { createRelayPublisher } from './presenter/relay.ts';
import { RELAY_MESSAGE, relayName, type RelayResponse } from '../presenter/relay-protocol.ts';

const name = relayName(new URLSearchParams(location.search).get('relay') ?? 'main');
const status = document.getElementById('relay-status')!;
document.getElementById('relay-name')!.textContent = name;
for (const [id, page, query] of [
  ['stream-url', 'presenter.html', '?role=program&videoRelay='],
  ['led-url', 'presenter-led.html', '?videoRelay='],
]) {
  const link = document.getElementById(id) as HTMLAnchorElement;
  link.href = page + query + encodeURIComponent(name); link.textContent = new URL(link.href).href;
}
let capture: ReturnType<typeof createCaptureUI> | null = null;
const publisher = createRelayPublisher({ room: name,
  request: request => nodecg.sendMessage(RELAY_MESSAGE, request) as Promise<RelayResponse>,
  active(value) { document.body.dataset.relayActive = String(value); capture?.update('video', value); },
  status(message) { status.textContent = message; },
});
capture = createCaptureUI(document.body, '?videoSetup=1', 'relay', {
  storageKey: 'rashinban:presenter-relay-inputs:' + name + ':v1',
  streamChanged: (side, stream) => publisher.setStream(side, stream),
});
capture.update('video', false);
document.getElementById('relay-start')!.addEventListener('click', () => { publisher.setActive(true); });
document.getElementById('relay-stop')!.addEventListener('click', () => { publisher.setActive(false); });
window.addEventListener('pagehide', () => { publisher.dispose(); capture?.dispose(); });
