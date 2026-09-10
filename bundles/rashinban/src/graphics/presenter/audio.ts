import { EMPTY_MEDIA, type MediaManifest, type Stem, type AudioStatus } from '../../presenter/media.ts';
import type { Timeline } from '../../types/presenter.ts';
import type { PresenterSettings } from '../../presenter/settings.ts';
export function stemOffset(epoch: number, now: number, start: number, end: number): number {
  const length = end - start;
  return start + (((now - epoch) / 1000 % length) + length) % length;
}
export interface PresenterAudio {
  load(manifest: MediaManifest): Promise<void>;
  sync(timeline: Timeline, settings: PresenterSettings, serverNowMs: number): void;
  /** Mandatory audible lease. Closes independently of the browser's JS thread. */
  lease(expiresAtMs: number, serverNowMs: number): void;
  status(): AudioStatus;
  stop(): void;
}
export function createAudio(context: AudioContext, fetchAsset: typeof fetch): PresenterAudio {
  const gate = context.createGain(); gate.gain.value = 0; gate.connect(context.destination);
  let media = EMPTY_MEDIA; let version = 0; let loading = false; let missing: string[] = [];
  let buffers: { stem: Stem; buffer: AudioBuffer }[] = [];
  let nodes: { source: AudioBufferSourceNode; gain: GainNode; stem: Stem; target: number; muted: boolean; music: Timeline['music'] | null }[] = [];
  let session = ''; let cutoff = -Infinity;
  function cleanup() {
    for (const node of nodes) { node.source.stop(); node.source.disconnect(); node.gain.disconnect(); }
    nodes = []; session = '';
  }
  function stop() { gate.gain.cancelScheduledValues(context.currentTime); gate.gain.setValueAtTime(0, context.currentTime); cutoff = -Infinity; cleanup(); }
  return {
    async load(value) {
      const token = ++version; cleanup(); media = value; buffers = []; missing = []; loading = true;
      const decoded = await Promise.all(value.stems.map(async stem => {
        try {
          const response = await fetchAsset(stem.url); if (!response.ok) throw Error();
          const buffer = await context.decodeAudioData(await response.arrayBuffer());
          if (![stem.loopStartS, stem.loopEndS, buffer.duration].every(Number.isFinite)
            || stem.loopStartS < 0 || stem.loopEndS <= stem.loopStartS || stem.loopEndS > buffer.duration) throw Error();
          return { stem, buffer };
        } catch { return { stem, buffer: null }; }
      }));
      if (token !== version) return;
      const length = value.stems[0] ? value.stems[0].loopEndS - value.stems[0].loopStartS : 0;
      for (const item of decoded) {
        if (!item.buffer || Math.abs(item.stem.loopEndS - item.stem.loopStartS - length) > 1e-6) missing.push(item.stem.id);
        else buffers.push({ stem: item.stem, buffer: item.buffer });
      }
      loading = false;
    },
    lease(deadline, now) {
      // Accepted clock samples have RTT <1s. Reserve 1s for midpoint
      // uncertainty, plus reported device buffering, without a JS expiry timer.
      const time = context.currentTime;
      const latency = (context.baseLatency || 0) + (context.outputLatency || 0);
      cutoff = time + Math.max(0, (deadline - now - 1000) / 1000 - latency);
      gate.gain.cancelScheduledValues(time);
      gate.gain.setValueAtTime(context.state === 'running' && cutoff > time ? 1 : 0, time);
      gate.gain.setValueAtTime(0, cutoff);
    },
    sync(timeline, settings, now) {
      if (context.state !== 'running' || cutoff <= context.currentTime) { stop(); return; }
      const nextSession = `${timeline.gameId ?? ''}:${timeline.musicEpochMs}`;
      if (session && session !== nextSession) cleanup();
      const time = context.currentTime;
      if (!nodes.length && buffers.length) {
        session = nextSession; const start = time + 0.05;
        nodes = buffers.map(({ stem, buffer }) => {
          const source = context.createBufferSource(); const gain = context.createGain(); gain.gain.value = 0;
          source.buffer = buffer; source.loop = true; source.loopStart = stem.loopStartS; source.loopEnd = stem.loopEndS;
          source.connect(gain); gain.connect(gate);
          source.start(start, stemOffset(timeline.musicEpochMs, now + (start - time) * 1000, stem.loopStartS, stem.loopEndS));
          return { source, gain, stem, target: NaN, muted: false, music: null };
        });
      }
      const ended = timeline.phase === 'aborted' || timeline.phase === 'finished';
      const music = ended ? 'idle' : timeline.music;
      for (const node of nodes) {
        const target = settings.muted || ended ? 0 : node.stem.gains[music] * settings.musicGain;
        if (target === node.target && settings.muted === node.muted && music === node.music) continue;
        node.target = target; node.muted = settings.muted; node.music = music; node.gain.gain.cancelAndHoldAtTime(time);
        if (settings.muted) node.gain.gain.setValueAtTime(0, time);
        else node.gain.gain.linearRampToValueAtTime(target, time + media.fadeMs[music] / 1000);
      }
    },
    status() {
      return { state: context.state !== 'running' ? 'suspended' : loading ? 'loading' : missing.length ? (buffers.length ? 'partial' : 'error') : buffers.length ? 'ready' : 'silent', missing: [...missing] };
    },
    stop,
  };
}
