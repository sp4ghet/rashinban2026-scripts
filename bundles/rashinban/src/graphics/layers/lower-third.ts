// Lower third layer: "A vs B" + round label from the current match, or
// operator text, as decided by lowerThirdText(). Shown/hidden via apply().
import type { LowerThirdLayer } from "../../broadcast/state.ts";
import { lowerThirdText } from "../../broadcast/lower-third.ts";
import type { ResolvedMatch } from "../../match/state.ts";
import { REPLICANTS } from "../../types/replicants.ts";

const TEMPLATE = `<div id="lower-third"><div class="lt-title"></div><div class="lt-subtitle"></div></div>`;

export function mountLowerThird(host: HTMLElement) {
  host.innerHTML = TEMPLATE;
  const root = host.querySelector<HTMLElement>("#lower-third")!;
  const title = root.querySelector<HTMLElement>(".lt-title")!;
  const subtitle = root.querySelector<HTMLElement>(".lt-subtitle")!;

  let match: ResolvedMatch | undefined;
  let layer: LowerThirdLayer = { visible: false, mode: "match", title: "", subtitle: "" };

  function render() {
    const text = lowerThirdText(layer, match ? { label: match.label, left: match.left, right: match.right } : null);
    title.textContent = text.title;
    subtitle.textContent = text.subtitle;
    root.classList.toggle("visible", layer.visible);
  }

  nodecg.Replicant<ResolvedMatch>(REPLICANTS.matchResolved).on("change", (v) => {
    match = v;
    render();
  });

  return {
    apply(next: LowerThirdLayer) {
      layer = next;
      render();
    },
  };
}
