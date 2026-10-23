import { shuffledIntervalSlides, INTERVAL_SLIDE_HOLD_MS, INTERVAL_SLIDE_PREPARE_MS, INTERVAL_SLIDE_FADE_MS } from "../../interval/slides.ts";
import { decodedSlide } from "./images.ts";

/** Two decoded images crossfade using the original 2025 slideshow cadence. */
export function mountIntervalSlides(host: HTMLElement) {
  const slides = shuffledIntervalSlides();
  const images = [new Image(), new Image()];
  for (const image of images) {
    image.className = "interval-slide";
    image.style.transition = `opacity ${INTERVAL_SLIDE_FADE_MS}ms ease-out`;
  }
  host.replaceChildren(...images);
  const url = (index: number) => "/bundles/rashinban/graphics/assets/interval-slides/" + encodeURIComponent(slides[index]);
  let requested = false, active = false, ready = false, disposed = false;
  let timer: number | undefined, version = 0, top = 0, next = 1;

  function schedule() {
    if (!active || !ready || timer !== undefined) return;
    timer = window.setTimeout(() => { timer = undefined; void advance(++version); }, INTERVAL_SLIDE_HOLD_MS);
  }
  async function advance(token: number) {
    const index = next;
    const target = images[1 - top];
    try {
      const loaded = await decodedSlide(url(index));
      if (token !== version || !active) return;
      target.src = loaded.src;
      target.alt = slides[index];
      await target.decode();
      if (token !== version || !active) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        if (token !== version || !active) return;
        target.classList.add("visible");
        images[top].classList.remove("visible");
        top = 1 - top;
        next = (index + 1) % slides.length;
        host.dataset.index = String(index);
        void decodedSlide(url(next)).catch(() => {});
        schedule();
      }, INTERVAL_SLIDE_PREPARE_MS);
    } catch {
      if (token !== version || !active) return;
      // Keep the current good image and try the following file on the next tick.
      next = (index + 1) % slides.length;
      schedule();
    }
  }
  async function initialize(index = 0): Promise<void> {
    try {
      const loaded = await decodedSlide(url(index));
      if (disposed) return;
      images[0].src = loaded.src;
      images[0].alt = slides[index];
      await images[0].decode();
      if (disposed) return;
      images[0].classList.add("visible");
      host.dataset.index = String(index);
      next = (index + 1) % slides.length;
      ready = true;
      void decodedSlide(url(next)).catch(() => {});
      schedule();
    } catch {
      if (!disposed && index + 1 < slides.length) await initialize(index + 1);
    }
  }
  function updateVisibility() {
    const visible = requested && !document.hidden && !disposed;
    if (visible === active) return;
    active = visible;
    ++version;
    window.clearTimeout(timer);
    timer = undefined;
    schedule();
  }
  document.addEventListener("visibilitychange", updateVisibility);
  void initialize();
  return {
    setVisible(visible: boolean) { requested = visible; updateVisibility(); },
    dispose() {
      disposed = true;
      updateVisibility();
      document.removeEventListener("visibilitychange", updateVisibility);
    },
  };
}
