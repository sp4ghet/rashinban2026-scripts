import { EMPTY_MEDIA, type MediaManifest, type Stem, type AudioStatus } from '../../presenter/media.ts';
import { canPlayCue } from '../../presenter/cues.ts';
import type { Cue, CueKind, Timeline } from '../../types/presenter.ts';
import type { PresenterSettings } from '../../presenter/settings.ts';
export function stemOffset(epoch: number, now: number, start: number, end: number): number {
  const length = end - start;
  return start + (((now - epoch) / 1000 % length) + length) % length;
}
export interface PresenterAudio {
  load(manifest: MediaManifest): Promise<void>;
  sync(timeline: Timeline, settings: PresenterSettings, serverNowMs: number, programOwner?: string | null): void;
  /** Mandatory audible lease. Closes independently of the browser's JS thread. */
  lease(expiresAtMs: number, serverNowMs: number): void;
  status(): AudioStatus;
  stop(): void;
}
export function createAudio(context: AudioContext, fetchAsset: typeof fetch): PresenterAudio {
  const ramps = new WeakMap<AudioParam, { from: number; target: number; start: number; end: number }>();
  function fade(param: AudioParam, target: number, start: number, end: number) {
    const previous = ramps.get(param);
    // Track our linear envelopes so Firefox can hold an interrupted fade
    // without cancelAndHoldAtTime (which it does not implement).
    const progress = previous ? (previous.end <= previous.start ? 1
      : Math.max(0, Math.min(1, (start - previous.start) / (previous.end - previous.start)))) : 0;
    const from = previous ? previous.from + (previous.target - previous.from) * progress : param.value;
    if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(start);
    else { param.cancelScheduledValues(start); param.setValueAtTime(from, start); }
    if (end <= start) param.setValueAtTime(target, start);
    else param.linearRampToValueAtTime(target, end);
    ramps.set(param, { from, target, start, end });
  }
  const gate = context.createGain(); gate.gain.value = 0; gate.connect(context.destination);
  let media = EMPTY_MEDIA; let version = 0; let loading = false; let missing: string[] = [];
  let buffers: { stem: Stem; buffer: AudioBuffer }[] = [];
  let nodes: { source: AudioBufferSourceNode; gain: GainNode; stem: Stem; target: number; muted: boolean; music: Timeline['music'] | null }[] = [];
  let session = ''; let cutoff = -Infinity;
  let sounds: Partial<Record<CueKind, AudioBuffer>> = {};
  const played = new Set<string>(); const history = new Map<string, { game: string | null; round: number | null }>();
  let cueGeneration: string | null = null; let adopting = true;
  const cueNodes = new Map<string, { source: AudioBufferSourceNode; gain: GainNode; envelope: GainNode | null; naturalEnd: number; fading: boolean; cue: Cue; start: number; programOwner?: string | null }>();
  function cancelCue(id: string, retry: boolean) {
    const node = cueNodes.get(id); if (!node) return;
    node.source.stop(); node.source.disconnect(); node.gain.disconnect(); node.envelope?.disconnect(); cueNodes.delete(id);
    if (retry && (node.start > context.currentTime || node.cue.kind === 'count')) { played.delete(id); history.delete(id); }
  }
  function clearCues() { for (const id of cueNodes.keys()) cancelCue(id, true); adopting = true; }
  function syncCues(timeline: Timeline, settings: PresenterSettings, now: number, programOwner?: string | null) {
    const time = context.currentTime;
    if (cueGeneration !== timeline.generation) { clearCues(); cueGeneration = timeline.generation; }
    for (const [id, scope] of history) if (scope.game !== timeline.gameId || scope.round !== timeline.round && scope.round !== (timeline.round ?? 0) - 1) { played.delete(id); history.delete(id); }
    const valid = new Set(timeline.cues.map(c => c.id));
    const guesses = Object.values(timeline.observed);
    const bothGuessed = guesses.length >= 2 && guesses.every(player => player.guessed);
    const effect = timeline.effect === 'single-5k' ? media.fiveK.single : timeline.effect === 'double-5k' ? media.fiveK.double : null;
    for (const [id, node] of cueNodes) {
      if (node.envelope && node.start > time && bothGuessed) { cancelCue(id, false); continue; }
      if (!valid.has(id) && (node.start > time || node.cue.kind === 'count' || node.cue.kind === 'five-k') || timeline.phase === 'aborted' || node.cue.kind === 'five-k' && (effect?.soundtrack !== 'cue' || node.programOwner !== programOwner)) cancelCue(id, false);
      else {
        node.gain.gain.setValueAtTime(settings.muted ? 0 : settings.effectsGain * (node.cue.kind === 'pre-round-tick' ? 1.3 : 1), time);
        const endedEarly = (bothGuessed
          || ['results-transition', 'results-reveal', 'between-rounds', 'waiting-host', 'finished'].includes(timeline.phase))
          && now < node.cue.untilMs;
        if (node.envelope && !node.fading && endedEarly) {
          const end = Math.min(node.naturalEnd, time + 1);
          fade(node.envelope.gain, 0, time, end);
          node.source.stop(end); node.fading = true;
        }
      }
    }
    if (timeline.phase === 'aborted') return;
    for (const cue of timeline.cues) {
      const remember = () => { played.add(cue.id); history.set(cue.id, { game: timeline.gameId, round: timeline.round }); };
      const countdown = cue.kind === 'countdown';
      if (countdown && bothGuessed) continue;
      if (countdown && timeline.phase !== 'live' && timeline.phase !== 'pre-round') continue;
      if (adopting && cue.kind !== 'count' && !countdown && cue.atMs < now) { remember(); continue; }
      if (!canPlayCue(cue, now, played)) continue;
      const buffer = sounds[cue.sound ?? cue.kind]; if (!buffer || cue.kind === 'five-k' && (effect?.soundtrack !== 'cue' || programOwner === null)) continue;
      const offset = countdown ? Math.max(0, cue.offsetS ?? 0) + Math.max(0, (now - cue.atMs) / 1000) : 0;
      if (offset >= buffer.duration) { remember(); continue; }
      const start = time + Math.max(0, (cue.atMs - now) / 1000);
      // Keep far-future records eligible until an audible lease covers their start.
      if (start >= cutoff) continue;
      const end = cue.kind === 'count' ? Math.min(cue.untilMs, timeline.damageAtMs ?? cue.untilMs) : cue.untilMs;
      if (cue.kind === 'count' && end <= now) continue;
      const source = context.createBufferSource(); const gain = context.createGain();
      source.buffer = buffer; source.loop = cue.kind === 'count';
      gain.gain.setValueAtTime(settings.muted ? 0 : settings.effectsGain * (cue.kind === 'pre-round-tick' ? 1.3 : 1), time);
      const envelope = countdown ? context.createGain() : null;
      const naturalEnd = start + buffer.duration - offset;
      source.connect(gain);
      if (envelope) {
        gain.connect(envelope); envelope.connect(gate);
        const fadeInEnd = Math.min(start + 0.2, naturalEnd);
        envelope.gain.value = 0;
        fade(envelope.gain, 1, start, fadeInEnd);
        // Keep the authored ending intact on timeout. Only an early second
        // guess/result schedules a fade-out; the buffer otherwise ends itself.
      } else gain.connect(gate);
      source.start(start, cue.kind === 'count' ? Math.max(0, (now - cue.atMs) / 1000) % buffer.duration : offset);
      if (cue.kind === 'count' || cue.kind === 'five-k') source.stop(time + Math.max(0, (end - now) / 1000));
      cueNodes.set(cue.id, { source, gain, envelope, naturalEnd, fading: false, cue, start, programOwner }); remember();
      source.onended = () => { if (cueNodes.get(cue.id)?.source === source) cueNodes.delete(cue.id); source.disconnect(); gain.disconnect(); envelope?.disconnect(); };
    }
    adopting = false;
  }
  function cleanup() {
    clearCues();
    for (const node of nodes) { node.source.stop(); node.source.disconnect(); node.gain.disconnect(); }
    nodes = []; session = '';
  }
  function stop() { gate.gain.cancelScheduledValues(context.currentTime); gate.gain.setValueAtTime(0, context.currentTime); cutoff = -Infinity; cleanup(); }
  return {
    async load(value) {
      const token = ++version; cleanup(); media = value; buffers = []; sounds = {}; missing = []; loading = true;
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
      const decodedSounds = await Promise.all(Object.entries(value.sounds).map(async ([kind, url]) => {
        try {
          const response = await fetchAsset(url); if (!response.ok) throw Error();
          const buffer = await context.decodeAudioData(await response.arrayBuffer());
          if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) throw Error();
          return { kind: kind as CueKind, buffer };
        } catch { return { kind: kind as CueKind, buffer: null }; }
      }));
      if (token !== version) return;
      for (const item of decodedSounds) { if (item.buffer) sounds[item.kind] = item.buffer; else missing.push(`sound-${item.kind}`); }
      loading = false;
    },
    lease(deadline, now) {
      // Accepted clock samples have RTT <1s. Reserve 1s for midpoint
      // uncertainty, plus reported device buffering, without a JS expiry timer.
      const time = context.currentTime;
      if (cutoff <= time) cleanup();
      const latency = (context.baseLatency || 0) + (context.outputLatency || 0);
      cutoff = time + Math.max(0, (deadline - now - 1000) / 1000 - latency);
      gate.gain.cancelScheduledValues(time);
      gate.gain.setValueAtTime(context.state === 'running' && cutoff > time ? 1 : 0, time);
      gate.gain.setValueAtTime(0, cutoff);
    },
    sync(timeline, settings, now, programOwner) {
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
      syncCues(timeline, settings, now, programOwner);
      const ended = timeline.phase === 'aborted' || timeline.phase === 'finished';
      const music = ended ? 'idle' : timeline.music;
      for (const node of nodes) {
        const target = settings.muted || ended ? 0 : node.stem.gains[music] * settings.musicGain;
        if (target === node.target && settings.muted === node.muted && music === node.music) continue;
        node.target = target; node.muted = settings.muted; node.music = music;
        fade(node.gain.gain, target, time, settings.muted ? time : time + media.fadeMs[music] / 1000);
      }
    },
    status() {
      return { state: context.state !== 'running' ? 'suspended' : loading ? 'loading' : missing.length ? (buffers.length || Object.keys(sounds).length ? 'partial' : 'error') : buffers.length || Object.keys(sounds).length ? 'ready' : 'silent', missing: [...missing] };
    },
    stop,
  };
}
