// Designer lower thirds share the match data and Stream Preview/Program bus.
import { defaultLayers, type LowerThirdLayer } from "../../broadcast/state.ts";
import { lowerThirdText } from "../../broadcast/lower-third.ts";
import type { ResolvedMatch } from "../../match/state.ts";
import { REPLICANTS } from "../../types/replicants.ts";
import { mustQuery, type Layer } from "./layer.ts";

const TEMPLATE = `<div id="lower-third">
  <div class="lt-scores" hidden>
    ${["left", "right"].map(side => `<div class="lt-score-row" data-side="${side}">
      <div class="lt-score"></div>
      <div class="lt-player"><span class="lt-name"><span data-lt-fit></span></span><span class="lt-handle"><span data-lt-fit></span></span></div>
    </div>`).join("")}
  </div>
  <div class="lt-match" hidden>
    <img class="lt-compass" src="assets/logos/lower-third-compass.svg" alt="" />
    <div class="lt-current"><div class="lt-title"><span data-lt-fit></span></div><div class="lt-subtitle"><span data-lt-fit></span></div></div>
    <div class="lt-coming-up" hidden><span class="lt-coming-label">COMING UP</span><span class="lt-next"><span data-lt-fit></span></span></div>
  </div>
</div>`;

export function mountLowerThird(host: HTMLElement): Layer<LowerThirdLayer> {
  host.innerHTML = TEMPLATE;
  const root = mustQuery(host, "#lower-third");
  const scores = mustQuery(root, ".lt-scores");
  const matchBlock = mustQuery(root, ".lt-match");
  const title = mustQuery(root, ".lt-title span");
  const subtitle = mustQuery(root, ".lt-subtitle span");
  const comingUp = mustQuery(root, ".lt-coming-up");
  const nextNames = mustQuery(root, ".lt-next span");
  let match: ResolvedMatch | null = null;
  let nextMatch: ResolvedMatch | null = null;
  let layer = defaultLayers("stream").lowerThird;

  // Keep the reference font sizes; condense only text that exceeds its space.
  function fit() {
    if (!layer.visible) return;
    for (const span of root.querySelectorAll<HTMLElement>("[data-lt-fit]")) {
      span.style.transform = "";
      const available = span.parentElement!.clientWidth;
      if (available > 0 && span.scrollWidth > available) span.style.transform = `scaleX(${available / span.scrollWidth})`;
    }
  }

  function render() {
    const text = lowerThirdText(layer, match);
    title.textContent = text.title;
    subtitle.textContent = text.subtitle;
    nextNames.textContent = lowerThirdText({ ...layer, mode: "match" }, nextMatch).subtitle;
    for (const side of ["left", "right"] as const) {
      const row = mustQuery(scores, `[data-side="${side}"]`);
      const player = match?.[side];
      const handle = player?.handle.trim().replace(/^@+/, "") ?? "";
      mustQuery(row, ".lt-score").textContent = String(player?.wins ?? 0);
      mustQuery(row, ".lt-name span").textContent = player?.name.trim() || "TBD";
      mustQuery(row, ".lt-handle span").textContent = handle ? `@${handle}` : "";
      mustQuery(row, ".lt-handle").hidden = !handle;
    }
    scores.hidden = layer.mode !== "scores";
    matchBlock.hidden = layer.mode === "scores";
    comingUp.hidden = layer.mode !== "match" || !layer.comingUp;
    root.dataset.mode = layer.mode;
    root.classList.toggle("visible", layer.visible);
    root.setAttribute("aria-hidden", String(!layer.visible));
    fit();
  }

  nodecg.Replicant<ResolvedMatch | null>(REPLICANTS.matchResolved).on("change", (v) => {
    match = v ?? null;
    render();
  });

  nodecg.Replicant<ResolvedMatch | null>(REPLICANTS.nextMatchResolved).on("change", value => {
    nextMatch = value ?? null;
    render();
  });
  void document.fonts.ready.then(fit);
  document.fonts.addEventListener("loadingdone", fit);

  return {
    apply(next) {
      layer = next;
      render();
    },
  };
}
