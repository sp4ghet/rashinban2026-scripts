import type { PlayerViewSource } from '../../presenter/settings.ts';
import type { RenderFrame } from './renderer.ts';
import { captureError, captureFrameMode, createCaptureInput, parseVideoInputs, type CaptureStatus, type VideoInputs } from './capture.ts';

const sides = ['left', 'right'] as const;
const storageKey = 'rashinban:presenter-video-inputs:v1';

/** Device IDs and streams belong to this OBS/browser instance, never NodeCG. */
export function createCaptureUI(root: HTMLElement, search: string) {
  const doc = root.ownerDocument; const win = doc.defaultView!;
  const el = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const panel = el('video-setup'); const message = el('video-setup-message');
  const availability = el('video-setup-availability');
  const media = win.navigator.mediaDevices;
  let disposed = false; let enabled = false; let source: PlayerViewSource = 'chroma';
  let config: VideoInputs = { left: '', right: '' }; let scanGeneration = 0;
  let discovering = false;
  const supported = win.isSecureContext && !!media?.getUserMedia && !!media?.enumerateDevices;
  if (!supported) message.textContent = win.isSecureContext
    ? 'Video capture is unavailable in this browser.' : 'Video capture needs HTTPS or localhost on the OBS computer.';
  try {
    const saved = win.localStorage.getItem(storageKey);
    if (saved) config = parseVideoInputs(JSON.parse(saved));
  } catch { message.textContent = 'Saved video inputs could not be loaded. Select both inputs again.'; }

  const slots = sides.map(side => {
    const select = el<HTMLSelectElement>(`video-${side}-device`);
    const video = el<HTMLVideoElement>(`video-${side}-preview`);
    const host = el(`capture-${side}`); const canvas = el<HTMLCanvasElement>(`capture-${side}-canvas`);
    const context = canvas.getContext('2d', { alpha: false });
    let identity = ''; let status: CaptureStatus = { state: 'idle', message: 'No input selected' };
    video.muted = true; video.autoplay = true; video.playsInline = true;
    function clear() {
      identity = ''; host.dataset.hasFrame = 'false';
      context?.clearRect(0, 0, canvas.width, canvas.height);
    }
    const input = createCaptureInput({
      open: deviceId => media.getUserMedia({ audio: false, video: { deviceId: { exact: deviceId },
        width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } } }),
      attach(stream) {
        clear(); video.srcObject = stream;
        if (stream) return video.play();
        video.pause();
      },
      status(value) {
        status = value; host.dataset.state = value.state;
        el(`video-${side}-status`).textContent = value.message;
        if (value.state !== 'ready') clear();
      },
    });
    return { side, select, video, input, clear, get status() { return status; },
      paint(frame: RenderFrame | null) {
        const mode = captureFrameMode(frame);
        const id = frame?.playerIds?.[side];
        if (!frame || mode === 'hidden' || !id || !frame.state.players.some(player => player.id === id)) { clear(); return; }
        const nextIdentity = JSON.stringify([frame.state.gameId, frame.displayedRound ?? frame.state.round, id]);
        if (identity !== nextIdentity) { clear(); identity = nextIdentity; }
        if (mode !== 'live' || status.state !== 'ready' || video.readyState < 2 || !context) return;
        if (!video.videoWidth || !video.videoHeight) return;
        // Retain the last permitted pixels, rather than sampling a live video at
        // celebration time when the player may already be showing the answer.
        const width = Math.min(video.videoWidth, 1920);
        const height = Math.round(width * video.videoHeight / video.videoWidth);
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        try { context.drawImage(video, 0, 0, width, height); host.dataset.hasFrame = 'true'; }
        catch { clear(); }
      } };
  });

  function update() {
    const active = supported && source === 'video' && enabled && !discovering;
    for (const slot of slots) slot.input.select(config[slot.side], active);
    availability.textContent = source !== 'video' ? 'Select Video input in the presenter dashboard to start capture.'
      : !enabled ? 'Only the active program source opens video inputs. Previews and standby sources stay inactive.'
        : 'Active program · video only · assignments saved in this browser';
  }
  function showDevices(devices: MediaDeviceInfo[]) {
    const cameras = devices.filter(device => device.kind === 'videoinput' && device.deviceId);
    for (const slot of slots) {
      const selected = slot.select.options.length ? slot.select.value : config[slot.side];
      const options = [new Option('No input', '')];
      cameras.forEach((device, index) => options.push(new Option(device.label || `Video input ${index + 1}`, device.deviceId)));
      if (selected && !cameras.some(device => device.deviceId === selected)) options.push(new Option('Saved input (unavailable)', selected));
      slot.select.replaceChildren(...options); slot.select.value = selected;
    }
  }
  async function scan(requestPermission = false) {
    if (!supported || disposed || discovering) return;
    if (requestPermission && (source !== 'video' || !enabled)) {
      message.textContent = 'Video permission can only be requested in the active program source while Video input mode is selected.';
      return;
    }
    const token = ++scanGeneration;
    const button = el<HTMLButtonElement>('video-find'); button.disabled = true;
    try {
      let devices = await media.enumerateDevices();
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
        try { permissionStream = await media.getUserMedia({ audio: false, video: true }); }
        catch (error) { permissionError = error; }
        finally { permissionStream?.getTracks().forEach(track => track.stop()); }
        if (disposed || token !== scanGeneration || !enabled || source !== 'video') return;
        // Permission may have been granted even if that camera could not start.
        devices = await media.enumerateDevices();
        if (disposed || token !== scanGeneration) return;
        showDevices(devices);
      }
      if (requestPermission) message.textContent = selectable().length
        ? `${selectable().length} video inputs found. Select the left and right feeds, then apply. Close setup before going on air.`
        : permissionError ? `Device discovery failed: ${captureError(permissionError)} No selectable video inputs were returned.`
          : 'No video inputs were reported by this browser. Check the capture device connection, driver and Windows camera access.';
    } catch (error) { if (!disposed && token === scanGeneration) message.textContent = `Device discovery failed: ${captureError(error)}`; }
    finally {
      if (!disposed && token === scanGeneration) { discovering = false; button.disabled = false; update(); }
    }
  }
  function save(value: VideoInputs) {
    // Release both before swapping assignments: capture drivers may be exclusive.
    slots.forEach(slot => slot.input.select('', false)); config = value;
    try { win.localStorage.setItem(storageKey, JSON.stringify(config)); message.textContent = 'Video inputs saved in this browser.'; }
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
  const onDevices = () => { void scan(); };
  el('video-find').addEventListener('click', () => { void scan(true); });
  el('video-apply').addEventListener('click', () => {
    try { save(parseVideoInputs({ left: slots[0].select.value, right: slots[1].select.value })); }
    catch (error) { message.textContent = error instanceof Error ? error.message : 'Invalid video inputs'; }
  });
  el('video-swap').addEventListener('click', () => {
    save({ left: config.right, right: config.left });
    slots.forEach(slot => { slot.select.value = config[slot.side]; });
  });
  el('video-reconnect').addEventListener('click', () => { slots.forEach(slot => slot.input.reconnect()); void scan(); });
  el('video-close').addEventListener('click', () => { panel.hidden = true; });
  win.addEventListener('keydown', onKey); media?.addEventListener('devicechange', onDevices);
  panel.hidden = new URLSearchParams(search).get('videoSetup') !== '1';
  showDevices([]); void scan(); update();
  return {
    update(nextSource: PlayerViewSource, ownsProgram: boolean) {
      if (source === nextSource && enabled === ownsProgram) return;
      source = nextSource; enabled = ownsProgram; update();
    },
    render(frame: RenderFrame | null) { slots.forEach(slot => slot.paint(enabled && source === 'video' ? frame : null)); },
    dispose() {
      disposed = true; scanGeneration++;
      slots.forEach(slot => slot.input.dispose());
      win.removeEventListener('keydown', onKey); media?.removeEventListener('devicechange', onDevices);
    },
  };
}
