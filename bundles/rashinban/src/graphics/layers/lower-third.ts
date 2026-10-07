// Lower third layer: "A vs B" + round label from the current match, or
// operator text, as decided by lowerThirdText(). Shown/hidden via apply().
import type { LowerThirdLayer } from "../../broadcast/state.ts";
import { lowerThirdText } from "../../broadcast/lower-third.ts";
import type { ResolvedMatch } from "../../match/state.ts";
import { REPLICANTS } from "../../types/replicants.ts";
import { mustQuery, type Layer } from "./layer.ts";

const TEMPLATE = `<div id="lower-third"><div class="lt-title"></div><div class="lt-subtitle"></div></div>`;

export function mountLowerThird(host: HTMLElement): Layer<LowerThirdLayer> {
  host.innerHTML = TEMPLATE;
  const root = mustQuery(host, "#lower-third");
  const title = mustQuery(root, ".lt-title");
  const subtitle = mustQuery(root, ".lt-subtitle");

  let match: ResolvedMatch | null = null;
  let layer: LowerThirdLayer = { visible: false, mode: "match", title: "", subtitle: "" };

  function render() {
    const text = lowerThirdText(layer, match ?? null);
    title.textContent = text.title;
    subtitle.textContent = text.subtitle;
    root.classList.toggle("visible", layer.visible);
  }

  nodecg.Replicant<ResolvedMatch | null>(REPLICANTS.matchResolved).on("change", (v) => {
    match = v ?? null;
    render();
  });

  return {
    apply(next) {
      layer = next;
      render();
    },
  };
}
