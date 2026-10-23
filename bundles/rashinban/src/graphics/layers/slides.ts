import { slideCue, slideUrl, SLIDE_SEQUENCES, type SlidesLayer } from "../../broadcast/slides.ts";
import { decodedSlide } from "../slides/images.ts";
import type { Layer } from "./layer.ts";

/** Never reveal retained artwork for a different cue while a replacement decodes. */
export function mountSlides(host: HTMLElement): Layer<SlidesLayer> {
  host.hidden = true;
  let request = 0;
  let selection = "";
  let displayedFile = "";
  return { apply(layer) {
    const cue = slideCue(layer);
    const key = JSON.stringify(layer);
    if (selection === key) return;
    selection = key;
    const version = ++request;
    host.hidden = !layer.visible || cue.kind !== "image" || displayedFile !== cue.file;
    for (const index of [layer.index - 1, layer.index + 1]) {
      const neighbor = SLIDE_SEQUENCES[layer.mode][index];
      if (neighbor?.kind === "image") void decodedSlide(slideUrl(neighbor.file)).catch(() => {});
    }
    if (cue.kind !== "image") { host.dataset.status = "idle"; return; }
    host.dataset.slide = cue.file;
    host.dataset.status = "loading";
    void decodedSlide(slideUrl(cue.file)).then(image => {
      if (version !== request) return;
      const displayed = image.cloneNode() as HTMLImageElement;
      displayed.alt = cue.label;
      host.replaceChildren(displayed);
      displayedFile = cue.file;
      host.hidden = !layer.visible;
      host.dataset.status = "ready";
    }).catch(() => {
      if (version === request) {
        host.dataset.status = "error";
        selection = "";
      }
    });
  } };
}
