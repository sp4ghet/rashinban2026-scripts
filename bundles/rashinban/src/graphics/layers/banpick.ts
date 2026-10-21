// Read-only, current-game selection stack shared by the stream and LED outputs.
import { createInitialState, deriveStack, type BanPickState } from "../../banpick/rules.ts";
import type { ToggleLayer } from "../../broadcast/state.ts";
import type { ResolvedMatch } from "../../match/state.ts";
import { REPLICANTS } from "../../types/replicants.ts";
import { shortMode } from "../banpick/board.ts";
import { mustQuery, type Layer } from "./layer.ts";

export function mountBanpick(host: HTMLElement): Layer<ToggleLayer> {
  host.innerHTML = `<section id="banpick" aria-label="Ban and pick">
    <header class="bp-stack-heading"><span class="bp-match"></span><span class="bp-stage"></span></header>
    <div class="bp-stack"></div>
  </section>`;
  const root = mustQuery(host, "#banpick");
  const stack = mustQuery(host, ".bp-stack");
  const stage = mustQuery(host, ".bp-stage");
  const match = mustQuery(host, ".bp-match");
  function fitText() {
    for (const label of root.querySelectorAll<HTMLElement>(".bp-selection-map, .bp-match")) {
      label.style.fontSize = "";
      if (label.scrollWidth > label.clientWidth && label.clientWidth > 0) {
        const size = parseFloat(getComputedStyle(label).fontSize);
        label.style.fontSize = `${Math.floor(size * (label.clientWidth - 1) / label.scrollWidth * 10) / 10}px`;
      }
    }
  }
  void document.fonts.ready.then(fitText);
  document.fonts.addEventListener("loadingdone", fitText);

  nodecg.Replicant<ResolvedMatch | null>(REPLICANTS.matchResolved).on("change", value => {
    match.textContent = value?.label.trim() ?? "";
    fitText();
  });

  nodecg.Replicant<BanPickState>(REPLICANTS.banPick).on("change", (raw) => {
    const state = raw ?? createInitialState();
    const view = deriveStack(state);
    root.dataset.game = String(view.game);
    stage.textContent = `GAME ${view.game}`;
    const existing = new Map([...stack.querySelectorAll<HTMLElement>(".bp-stack-entry")]
      .map(row => [row.dataset.id!, row]));
    const keep = new Set(view.entries.map(entry => String(entry.option.id)));
    for (const [id, row] of existing) if (!keep.has(id)) row.remove();
    view.entries.forEach((entry, index) => {
      const key = String(entry.option.id);
      let row = existing.get(key);
      if (!row) {
        row = document.createElement("article");
        row.className = "bp-stack-entry";
        row.dataset.id = key;
        row.innerHTML = `<span class="bp-selection-kind"></span><span class="bp-selection-map"></span><span class="bp-selection-mode"></span>`;
      }
      row.dataset.status = entry.status;
      row.dataset.by = entry.by ?? "";
      mustQuery(row, ".bp-selection-kind").textContent = entry.status === "remaining"
        ? "DECIDER /"
        : entry.status === "banned" ? "BANNED /" : "PICK /";
      mustQuery(row, ".bp-selection-mode").textContent = shortMode(entry.option.mode);
      mustQuery(row, ".bp-selection-map").textContent = entry.option.map;
      if (stack.children[index] !== row) stack.insertBefore(row, stack.children[index] ?? null);
    });
    fitText();
  });

  return {
    apply(layer) {
      root.classList.toggle("visible", layer.visible);
    },
  };
}
