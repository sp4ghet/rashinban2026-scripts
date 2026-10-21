type Layout = 'presenter' | 'stream' | 'led';
type Slide = { file: string; name: string; x: number; width: number; height: number };

// Coordinates on the 1920px canvas, measured from the supplied design references.
// The supporting sponsors are one supplied strip, not individual rotating logos.
const SLIDES: Record<Layout, readonly Slide[]> = {
  presenter: [
    { file: 'tamura-builds.svg', name: 'TAMURA BUILDS', x: 672.5, width: 575, height: 575 * 87 / 598 },
    { file: 'geo_logo.svg', name: 'GeoGuessr', x: 816, width: 340, height: 340 * 40 / 208 },
    { file: 'voicemod.png', name: 'Voicemod', x: 768, width: 384, height: 384 * 48 / 403 },
  ],
  stream: [
    { file: 'tamura-builds.svg', name: 'TAMURA BUILDS', x: 964, width: 598, height: 87 },
    { file: 'geo_logo.svg', name: 'GeoGuessr', x: 1140, width: 340, height: 340 * 40 / 208 },
    { file: 'voicemod.png', name: 'Voicemod', x: 1100, width: 384, height: 384 * 48 / 403 },
    { file: 'stream-logos.png', name: 'Supporting sponsors', x: 716, width: 1127, height: 81 },
  ],
  led: [
    { file: 'tamura-builds.svg', name: 'TAMURA BUILDS', x: 819, width: 282, height: 282 * 87 / 598 },
    { file: 'geo_logo.svg', name: 'GeoGuessr', x: 888, width: 144, height: 144 * 40 / 208 },
    { file: 'voicemod.png', name: 'Voicemod', x: 848, width: 224, height: 224 * 48 / 403 },
    { file: 'led-logos.png', name: 'Supporting sponsors', x: 583, width: 795, height: 58 },
  ],
};

/** 12 seconds per slide: fade out, swap invisibly, hold 300ms, then fade in. */
export function mountSponsorRotation(image: HTMLImageElement, layout: Layout): () => void {
  const slides = SLIDES[layout];
  const cached = slides.map(slide => {
    const asset = new Image();
    asset.src = `assets/sponsor-logos/${slide.file}`;
    return asset;
  });
  let index = 0;
  let swap: number | undefined;
  let fade: number | undefined;
  image.classList.add('sponsor-rotation');
  function show(next: number) {
    const slide = slides[next]!;
    image.alt = slide.name;
    image.style.left = `${slide.x}px`;
    image.style.width = `${slide.width}px`;
    image.style.height = `${slide.height}px`;
    image.src = cached[next]!.src;
    index = next;
  }
  show(0);
  const interval = window.setInterval(() => {
    const next = (index + 1) % slides.length;
    const asset = cached[next]!;
    // Hold the current slide if the next image has not loaded successfully.
    if (!asset.complete || asset.naturalWidth === 0) return;
    image.style.opacity = '0';
    const swapWhenInvisible = () => {
      // CSS transitions begin on a painted frame, potentially after the timer.
      // Wait for the actual opacity so a delayed frame cannot expose the swap.
      if (Number(getComputedStyle(image).opacity) !== 0) {
        swap = window.setTimeout(swapWhenInvisible, 16);
        return;
      }
      show(next);
      fade = window.setTimeout(() => { image.style.opacity = '1'; }, 300);
    };
    swap = window.setTimeout(swapWhenInvisible, 300);
  }, 12000);
  const dispose = () => {
    window.clearInterval(interval);
    window.clearTimeout(swap);
    window.clearTimeout(fade);
    window.removeEventListener('pagehide', onPageHide);
  };
  function onPageHide(event: PageTransitionEvent) { if (!event.persisted) dispose(); }
  window.addEventListener('pagehide', onPageHide);
  return dispose;
}
