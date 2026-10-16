import type { PlayerViewSource } from '../../presenter/settings.ts';
import type { RenderFrame } from './renderer.ts';
import { captureError, captureFrameMode, createCaptureInput, parseVideoInputs, type CaptureStatus, type RelayInputs } from './capture.ts';

import { RELAY_FEEDS, type RelayFeed } from '../../presenter/relay-protocol.ts';
const sides = ['left', 'right'] as const;

/** Device IDs and streams belong to this OBS/browser instance, never NodeCG. */
type CaptureIntegration = {
  relay?: { name: string; open(side: RelayFeed): Promise<MediaStream>; reconnect(): void; onAvailable(listener: (side: RelayFeed) => void): () => void };
  streamChanged?(side: RelayFeed, stream: MediaStream | null): void;
  storageKey?: string;
  cameraInputs?: boolean;
};
export function createCaptureUI(root: HTMLElement, search: string, output: 'stream' | 'led' | 'relay' = 'stream', integration: CaptureIntegration = {}) {
  // Do not automatically open the stream's physical devices in a second output.
  const storageKey = integration.storageKey ?? (output === 'led' ? 'rashinban:presenter-led-video-inputs:v1' : 'rashinban:presenter-video-inputs:v1');
  const doc = root.ownerDocument; const win = doc.defaultView!;
  const el = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const panel = el('video-setup'); const message = el('video-setup-message');
  const availability = el('video-setup-availability');
  const media = integration.relay ? undefined : win.navigator.mediaDevices;
  let disposed = false; let enabled = false; let source: PlayerViewSource = 'chroma';
  const empty: RelayInputs = { left: '', right: '', 'camera-left': '', 'camera-right': '' };
  const keys = integration.cameraInputs ? RELAY_FEEDS : sides;
  const parseInputs = (value: unknown): RelayInputs => integration.cameraInputs ? parseVideoInputs(value, true) : { ...empty, ...parseVideoInputs(value) };
  let config = { ...empty }; let scanGeneration = 0;
  let discovering = false;
  const supported = integration.relay ? typeof RTCPeerConnection === 'function' : win.isSecureContext && !!media?.getUserMedia && !!media?.enumerateDevices;
  if (!supported) message.textContent = win.isSecureContext
    ? 'Video capture is unavailable in this browser.' : 'Video capture needs HTTPS or localhost on the OBS computer.';
  try {
    const saved = integration.relay ? null : win.localStorage.getItem(storageKey);
    if (saved) config = parseInputs(JSON.parse(saved));
  } catch { message.textContent = 'Saved video inputs could not be loaded. Select both inputs again.'; }

  if (integration.relay) config = { ...empty, left: 'left', right: 'right' };
  const slots = keys.map(side => {
    const select = el<HTMLSelectElement>(`video-${side}-device`);
    const video = el<HTMLVideoElement>(`video-${side}-preview`);
    const host = el(`capture-${side}`); const canvas = el<HTMLCanvasElement>(`capture-${side}-canvas`);
    const context = canvas.getContext('2d', { alpha: false });
    let identity = ''; let hasFrame = false; let sampledFrame: number | null = null;
    let status: CaptureStatus = { state: 'idle', message: 'No input selected' };
    video.muted = true; video.autoplay = true; video.playsInline = true;
    function clear() {
      identity = ''; sampledFrame = null;
      if (!hasFrame) return;
      hasFrame = false; host.dataset.hasFrame = 'false';
      context?.clearRect(0, 0, canvas.width, canvas.height);
    }
    const input = createCaptureInput({
      open: deviceId => integration.relay ? integration.relay.open(side) : media!.getUserMedia({ audio: false, video: { deviceId: { exact: deviceId },
        width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } } }),
      attach(stream) {
        clear(); video.srcObject = stream;
        integration.streamChanged?.(side, stream);
        if (stream) return video.play();
        video.pause();
      },
      status(value) {
        status = value; host.dataset.state = value.state;
        el(`video-${side}-status`).textContent = integration.relay && value.state === 'error' ? 'Waiting for the capture relay. Check its inputs or reconnect.' : value.message;
        if (value.state !== 'ready' && value.state !== 'muted') clear();
      },
    });
    return { side, select, video, input, clear, get status() { return status; },
      paint(frame: RenderFrame | null) {
        // Camera inputs are previewed/published here, never sampled as gameplay.
        if (side !== 'left' && side !== 'right') return;
        const mode = captureFrameMode(frame);
        const id = frame?.playerIds?.[side];
        if (!frame || mode === 'hidden' || !id || !frame.state.players.some(player => player.id === id)) { clear(); return; }
        const nextIdentity = JSON.stringify([frame.state.gameId, frame.displayedRound ?? frame.state.round, id]);
        if (identity !== nextIdentity) { clear(); identity = nextIdentity; }
        if (mode !== 'live' || status.state !== 'ready' || video.readyState < 2 || !context) return;
        if (!video.videoWidth || !video.videoHeight) return;
        // The presentation loop can run faster than the input. Copy each new
        // decoded frame once, while keeping sampling behind the safety gates.
        const sourceFrame = video.getVideoPlaybackQuality?.().totalVideoFrames ?? video.currentTime;
        if (sampledFrame === sourceFrame) return;
        // Retain the last permitted pixels, rather than sampling a live video at
        // celebration time when the player may already be showing the answer.
        const width = Math.min(video.videoWidth, 1920);
        const height = Math.round(width * video.videoHeight / video.videoWidth);
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        try {
          context.drawImage(video, 0, 0, width, height); sampledFrame = sourceFrame;
          if (!hasFrame) { hasFrame = true; host.dataset.hasFrame = 'true'; }
        }
        catch { clear(); }
      } };
  });

  const unsubscribeRelay = integration.relay?.onAvailable(side => { slots.find(slot => slot.side === side)?.input.retryAvailable(); });
  function update() {
    const active = supported && source === 'video' && enabled && !discovering;
    for (const slot of slots) slot.input.select(config[slot.side], active);
    availability.textContent = integration.relay ? 'Gameplay relay ' + integration.relay.name + (active ? ' · subscribed' : ' · gameplay inactive') : source !== 'video' ? 'Select Video input in the presenter dashboard to start capture.'
      : !enabled ? 'Capture inactive. Previews, standby stream sources and sources without a fresh server clock do not open inputs.'
        : `${output === 'relay' ? 'Capture relay' : output === 'led' ? 'LED output' : 'Active program'} · video only · assignments saved for this output in this browser`;
  }
  function showDevices(devices: MediaDeviceInfo[]) {
    if (integration.relay) {
      for (const slot of slots) { slot.select.replaceChildren(new Option('Relay ' + slot.side + ' feed', slot.side)); slot.select.disabled = true; }
      return;
    }
    const cameras = devices.filter(device => device.kind === 'videoinput' && device.deviceId);
    for (const slot of slots) {
      const selected = slot.select.options.length ? slot.select.value : config[slot.side];
      const options = [new Option('No input', '')];
      cameras.forEach((device, index) => options.push(new Option(device.label || `Video input ${index + 1}`, device.deviceId)));
      if (selected && !cameras.some(device => device.deviceId === selected)) options.push(new Option('Saved input (unavailable)', selected));
      slot.select.replaceChildren(...options); slot.select.value = selected;
    }
  }
  async function scan(requestPermission = false, recoverInputs = false) {
    if (integration.relay || !supported || disposed || discovering) return;
    if (requestPermission && (source !== 'video' || !enabled)) {
      message.textContent = 'Video permission needs an active stream program or LED output with Video input mode selected.';
      return;
    }
    const token = ++scanGeneration;
    const button = el<HTMLButtonElement>('video-find'); button.disabled = true;
    try {
      let devices = await media!.enumerateDevices();
      if (disposed || token !== scanGeneration) return;
      showDevices(devices);
      const selectable = () => devices.filter(device => device.kind === 'videoinput' && device.deviceId);
      let permissionError: unknown = null;
      // Listing inputs does not require opening the default camera, which may
      // be busy or be an inactive virtual camera unrelated to either player.
      if (requestPermission && !selectable().length && !slots.some(slot => slot.status.state === 'ready')) {
        if (!enabled || source !== 'video') return;
        // Release pending/failed slot opens before the temporary permission probe.
        discovering = true; update();
        let permissionStream: MediaStream | null = null;
        try { permissionStream = await media!.getUserMedia({ audio: false, video: true }); }
        catch (error) { permissionError = error; }
        finally { permissionStream?.getTracks().forEach(track => track.stop()); }
        if (disposed || token !== scanGeneration || !enabled || source !== 'video') return;
        // Permission may have been granted even if that camera could not start.
        devices = await media!.enumerateDevices();
        if (disposed || token !== scanGeneration) return;
        showDevices(devices);
      }
      if (requestPermission) message.textContent = selectable().length
        ? `${selectable().length} video inputs found. Select the left and right feeds, then apply. Close setup before going on air.`
        : permissionError ? `Device discovery failed: ${captureError(permissionError)} No selectable video inputs were returned.`
          : 'No video inputs were reported by this browser. Check the capture device connection, driver and Windows camera access.';
      if (recoverInputs && enabled && source === 'video') {
        for (const slot of slots) {
          if (selectable().some(device => device.deviceId === config[slot.side])) slot.input.retryAvailable();
        }
      }
    } catch (error) { if (!disposed && token === scanGeneration) message.textContent = `Device discovery failed: ${captureError(error)}`; }
    finally {
      if (!disposed && token === scanGeneration) { discovering = false; button.disabled = false; update(); }
    }
  }
  function save(value: RelayInputs) {
    // Release all before swapping assignments: capture drivers may be exclusive.
    slots.forEach(slot => slot.input.select('', false)); config = value;
    try { win.localStorage.setItem(storageKey, JSON.stringify(integration.cameraInputs ? config : { left: config.left, right: config.right })); message.textContent = 'Video inputs saved in this browser.'; }
    catch { message.textContent = 'Inputs applied for this session; browser storage is unavailable.'; }
    update();
  }
  function onKey(event: KeyboardEvent) {
    // OBS Interact on Windows can supply the logical key without a physical code.
    if (event.key !== 'F8' && event.code !== 'F8') return;
    event.preventDefault();
    if (event.repeat) return;
    panel.hidden = !panel.hidden; if (!panel.hidden) void scan();
  }
  const onDevices = () => { void scan(false, true); };
  el('video-find').addEventListener('click', () => { void scan(true); });
  el('video-apply').addEventListener('click', () => {
    try { save(parseInputs(Object.fromEntries(slots.map(slot => [slot.side, slot.select.value])))); }
    catch (error) { message.textContent = error instanceof Error ? error.message : 'Invalid video inputs'; }
  });
  el('video-swap').addEventListener('click', () => {
    save({ left: config.right, right: config.left, 'camera-left': config['camera-right'], 'camera-right': config['camera-left'] });
    slots.forEach(slot => {
      const selected = config[slot.side];
      if (selected && !Array.from(slot.select.options).some(option => option.value === selected)) {
        slot.select.add(new Option('Saved input (unavailable)', selected));
      }
      slot.select.value = selected;
    });
  });
  el('video-reconnect').addEventListener('click', () => { integration.relay?.reconnect(); slots.forEach(slot => slot.input.reconnect()); void scan(); });
  el('video-close').addEventListener('click', () => { panel.hidden = true; });
  win.addEventListener('keydown', onKey); media?.addEventListener('devicechange', onDevices);
  panel.hidden = new URLSearchParams(search).get('videoSetup') !== '1';
  if (integration.relay) {
    for (const id of ['video-find', 'video-apply', 'video-swap']) el<HTMLButtonElement>(id).disabled = true;
    message.textContent = 'Inputs are configured on the capture relay page. This presenter never opens physical devices.';
  }
  showDevices([]); void scan(); update();
  return {
    setRelayStatus(value: string) {
      if (integration.relay) message.textContent = value + '. Inputs are configured on the capture relay page.';
    },
    update(nextSource: PlayerViewSource, active: boolean) {
      if (source === nextSource && enabled === active) return;
      source = nextSource; enabled = active; update();
    },
    render(frame: RenderFrame | null) { slots.forEach(slot => slot.paint(enabled && source === 'video' ? frame : null)); },
    dispose() {
      disposed = true; scanGeneration++; unsubscribeRelay?.();
      slots.forEach(slot => slot.input.dispose());
      win.removeEventListener('keydown', onKey); media?.removeEventListener('devicechange', onDevices);
    },
  };
}
