import { createAudio } from './audio.ts';
import type { createPresenterClient } from './client.ts';
import type { MediaManifest } from '../../presenter/media.ts';
import type { PresenterSettings } from '../../presenter/settings.ts';
import type { Timeline } from '../../types/presenter.ts';

/** Shared browser lifecycle; cue dispatch remains owned by the entry point. */
export function createAudioOutput(client: ReturnType<typeof createPresenterClient>) {
  const context = new AudioContext();
  const engine = createAudio(context, fetch);
  let disposed = false; let pendingAck: number | null = null; let lastLease = ''; let lastState = context.state;
  let current: { timeline: Timeline | undefined; settings: PresenterSettings } | undefined;
  const unlock = new URLSearchParams(location.search).has('audioUnlock') ? document.createElement('button') : null;
  if (unlock) {
    unlock.id = 'audio-unlock'; unlock.textContent = 'Enable audio in this browser';
    unlock.style.cssText = 'position:fixed;left:12px;top:12px;z-index:10000;padding:12px';
    unlock.onclick = () => {
      // Clear previous audio-clock automation before resuming a suspended clock.
      engine.stop(); lastLease = '';
      void context.resume().then(() => { if (current) sync(current.timeline, current.settings); }).catch(() => {});
    };
    document.body.append(unlock);
  }
  function publish() {
    const status = engine.status(); client.setAudioStatus(status); document.body.dataset.audio = status.state;
    if (unlock) unlock.hidden = context.state === 'running';
  }
  function sync(timeline: Timeline | undefined, settings: PresenterSettings) {
    if (disposed) return; current = { timeline, settings };
    const releasing = client.releasingAudio();
    const lease = client.audioLease(settings.audioOutput);
    if (!lease || !timeline || context.state !== 'running') {
      engine.stop(); lastLease = ''; document.body.dataset.audioOwner = 'false';
      if (releasing && pendingAck !== releasing.token) {
        pendingAck = releasing.token;
        // Gate and source stops are submitted before acknowledgement. Allow
        // queued output to drain; a stalled JS thread delays this ack safely.
        setTimeout(() => {
          if (!disposed) void client.acknowledgeAudioMute(releasing.token).finally(() => { pendingAck = null; });
        }, Math.max(100, ((context.baseLatency || 0) + (context.outputLatency || 0)) * 1000 + 50));
      }
    } else {
      const key = `${lease.token}:${lease.expiresAtMs}`;
      if (key !== lastLease) { engine.lease(lease.expiresAtMs, client.now()); lastLease = key; }
      engine.sync(timeline, settings, client.now()); document.body.dataset.audioOwner = 'true';
    }
    publish();
  }
  context.onstatechange = () => {
    // Automatic suspension must never preserve a previously audible graph.
    if (context.state !== lastState) { engine.stop(); lastLease = ''; lastState = context.state; }
    publish(); if (current) sync(current.timeline, current.settings);
  };
  publish();
  return {
    engine,
    async load(media: MediaManifest) { const loading = engine.load(media); publish(); await loading; if (!disposed) { publish(); if (current) sync(current.timeline, current.settings); } },
    sync,
    dispose() { disposed = true; engine.stop(); context.onstatechange = null; unlock?.remove(); void context.close(); },
  };
}
