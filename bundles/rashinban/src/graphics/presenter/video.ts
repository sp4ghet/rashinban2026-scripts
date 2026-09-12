export type VideoPort = { play(): Promise<void>; stop(): void; onEnded(fn: () => void): void; onError(fn: () => void): void };
import type { EffectAsset, MediaManifest } from '../../presenter/media.ts';
import { mediaPlaybackUrl } from '../../config/media-url.ts';
export function createVideoPlayer(makeVideo: () => HTMLVideoElement, schedule: (fn: () => void, ms: number) => () => void) {
  const videos = new Map<string, HTMLVideoElement>();
  let active: { generation: string; asset: EffectAsset; video: HTMLVideoElement; cancel(): void } | null = null;
  function cancel() { active?.cancel(); active = null; }
  function remove(video: HTMLVideoElement) { video.pause(); video.removeAttribute('src'); video.load(); video.remove(); }
  return {
    preload(media: MediaManifest) {
      const urls = new Set([media.fiveK.single?.url, media.fiveK.double?.url].filter((url): url is string => !!url));
      if (active && !urls.has(active.asset.url)) cancel();
      for (const [url, video] of videos) if (!urls.has(url)) { remove(video); videos.delete(url); }
      for (const url of urls) if (!videos.has(url)) {
        const video = makeVideo(); video.hidden = true; video.muted = true; video.preload = 'auto'; video.playsInline = true;
        video.src = mediaPlaybackUrl(url); videos.set(url, video); video.load();
      }
    },
    play(asset: EffectAsset, generation: string, complete: (generation: string, failed: boolean) => void, muted = false, gain = 1) {
      cancel();
      const video = videos.get(asset.url);
      if (!video) { complete(generation, true); return; }
      let ended = () => {}; let error = () => {}; let metadata = () => {};
      const timers: (() => void)[] = [];
      const port: VideoPort = {
        play() {
          video.hidden = false; video.muted = muted || asset.soundtrack !== 'embedded'; video.volume = Math.max(0, Math.min(1, gain));
          return new Promise<void>((resolve, reject) => {
            if (video.error) { reject(new Error('Video failed during preload')); return; }
            function begin() {
              if (!Number.isFinite(video!.duration) || video!.duration <= 0 || video!.duration * 1000 > asset.watchdogMs || video!.error) {
                reject(new Error('Invalid video duration or media')); return;
              }
              timers.push(schedule(() => error(), Math.min(asset.watchdogMs, video!.duration * 1000 + 1000)));
              try { video!.currentTime = 0; resolve(video!.play()); } catch (e) { reject(e); }
            }
            metadata = begin;
            if (video.readyState >= 1) begin();
            else { timers.push(schedule(() => error(), asset.watchdogMs)); video.addEventListener('loadedmetadata', metadata, { once: true }); }
          });
        },
        stop() {
          for (const stop of timers) stop();
          video.removeEventListener('ended', ended); video.removeEventListener('error', error); video.removeEventListener('loadedmetadata', metadata);
          video.pause(); video.muted = true; video.hidden = true;
        },
        onEnded(fn) { ended = fn; video.addEventListener('ended', ended); },
        onError(fn) { error = fn; video.addEventListener('error', error); },
      };
      const playback = { generation, asset: { ...asset }, video, cancel: () => {} };
      active = playback;
      playback.cancel = playCelebration(port, generation, (g, failed) => {
        if (active === playback) active = null;
        complete(g, failed);
      });
    },
    update(generation: string | null, owns: boolean, effect: string, muted: boolean, gain: number) {
      if (!active) return;
      if (!owns || active.generation !== generation || effect === 'none') { cancel(); return; }
      active.video.muted = muted || active.asset.soundtrack !== 'embedded';
      active.video.volume = Math.max(0, Math.min(1, gain));
    },
    dispose() { cancel(); for (const video of videos.values()) remove(video); videos.clear(); },
  };
}
export function playCelebration(port: VideoPort, generation: string, complete: (generation: string, failed: boolean) => void): () => void {
  let settled = false;
  function finish(failed: boolean) {
    if (settled) return;
    settled = true; port.stop(); complete(generation, failed);
  }
  port.onEnded(() => finish(false)); port.onError(() => finish(true));
  try { void port.play().catch(() => finish(true)); } catch { finish(true); }
  return () => { if (!settled) { settled = true; port.stop(); } };
}
