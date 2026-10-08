import type { RenderFrame } from './renderer.ts';

export type VideoInputs = { left: string; right: string };
export type CaptureStatus = { state: 'idle' | 'opening' | 'ready' | 'muted' | 'error'; message: string };
export type CaptureDeps = {
  open(deviceId: string): Promise<MediaStream>;
  attach(stream: MediaStream | null): Promise<void> | void;
  status(value: CaptureStatus): void;
};
export function parseVideoInputs(value: unknown): VideoInputs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid video inputs');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => key !== 'left' && key !== 'right')
    || typeof input.left !== 'string' || typeof input.right !== 'string'
    || input.left.length > 512 || input.right.length > 512) throw new Error('Invalid video inputs');
  if (input.left && input.left === input.right) throw new Error('Choose a different input for each player');
  return { left: input.left, right: input.right };
}

/** Stop consuming live pixels as soon as authoritative state settles the round. */
export function captureFrameMode(frame: RenderFrame | null): 'live' | 'frozen' | 'hidden' {
  if (!frame || frame.source !== 'video' || frame.projection.phase !== 'live' || frame.projection.answer) return 'hidden';
  if (frame.frozen) return 'frozen';
  const { state } = frame;
  if (frame.displayedRound !== undefined && frame.displayedRound !== state.round) return 'hidden';
  const round = state.rounds.find(item => item.number === state.round);
  if (!round || round.startAtMs === null) return 'hidden';
  return state.aborted || state.status === 'Finished'
    || state.players.some(player => player.results.some(result => result.round === state.round))
    || state.players.every(player => player.guesses.some(guess => guess.round === state.round)) ? 'frozen' : 'live';
}

export function captureError(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Video permission denied. In OBS, enable media access and reload this source.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Selected video input is unavailable. Check its connection and select it again.';
  if (name === 'NotReadableError' || name === 'AbortError') return `Video input could not start (${name}). Check its connection, driver, and whether another application or OBS source is using it, then reconnect.`;
  return 'Video input failed. Check the device and reconnect.';
}

/** One device per slot. Superseded permission/play promises never revive a feed. */
export function createCaptureInput(deps: CaptureDeps) {
  let selected = ''; let enabled = false; let disposed = false; let generation = 0;
  let stream: MediaStream | null = null; let removeListeners = () => {};
  const stop = (value: MediaStream) => value.getTracks().forEach(track => track.stop());
  function release() {
    generation++; removeListeners(); removeListeners = () => {};
    if (stream) stop(stream);
    stream = null;
    void Promise.resolve(deps.attach(null)).catch(() => {});
  }
  async function open() {
    release();
    if (disposed || !enabled || !selected) { deps.status({ state: 'idle', message: selected ? 'Capture inactive' : 'No input selected' }); return; }
    const token = generation;
    deps.status({ state: 'opening', message: 'Opening video input…' });
    try {
      const next = await deps.open(selected);
      if (token !== generation || disposed) { stop(next); return; }
      stream = next;
      const track = next.getVideoTracks()[0];
      if (!track || track.readyState === 'ended') throw new Error('No live video track');
      const ended = () => {
        if (token !== generation) return;
        release(); deps.status({ state: 'error', message: 'Video input disconnected. Reconnect the device, then retry.' });
      };
      let playing = false;
      const signal = () => {
        if (token === generation && playing) deps.status(track.muted
          ? { state: 'muted', message: 'Video signal interrupted' } : { state: 'ready', message: 'Connected' });
      };
      track.addEventListener('ended', ended); track.addEventListener('mute', signal); track.addEventListener('unmute', signal);
      removeListeners = () => {
        track.removeEventListener('ended', ended); track.removeEventListener('mute', signal); track.removeEventListener('unmute', signal);
      };
      await deps.attach(next);
      if (token !== generation || disposed) return;
      if (next.getVideoTracks()[0]?.readyState !== 'live') { ended(); return; }
      playing = true; signal();
    } catch (error) {
      if (token !== generation || disposed) return;
      release(); deps.status({ state: 'error', message: captureError(error) });
    }
  }
  return {
    select(deviceId: string, active: boolean) {
      if (disposed || (selected === deviceId && enabled === active)) return;
      selected = deviceId; enabled = active; void open();
    },
    reconnect() { if (!disposed) void open(); },
    dispose() { if (!disposed) { disposed = true; release(); deps.status({ state: 'idle', message: 'Capture inactive' }); } },
  };
}
