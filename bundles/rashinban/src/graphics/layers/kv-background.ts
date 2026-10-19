import { KV_VIDEO_URL } from "../../config/scene-media.ts";

/** A silent background owned by its scene. Hidden scenes stop decoding video. */
export function mountKvBackground(host: HTMLElement): { setVisible(visible: boolean): void } {
  const video = document.createElement("video");
  video.className = "kv-background";
  video.src = KV_VIDEO_URL;
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.setAttribute("aria-hidden", "true");
  host.prepend(video);
  let visible = false;
  function sync() {
    if (!visible || document.hidden) { video.pause(); return; }
    if (video.paused) void video.play().catch(error => {
      // A scene can be hidden while its play request is still pending.
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.warn("KV background could not play", error);
    });
  }
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("pagehide", () => video.pause());
  window.addEventListener("pageshow", sync);
  return { setVisible(value) { visible = value; sync(); } };
}
