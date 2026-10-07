// Caster desk layer. The title bar and sponsor banner are static markup;
// the two name cards come from the casters sheet tab (`casters`) plus the
// operator's slot selection (`castersState`, set in the Casters panel).
// Which cards (and whether the title bar) are on air comes from the
// broadcast bus via apply().
import { findCaster, withDefaults, type Caster, type CastersState } from "../../casters/casters.ts";
import type { CastersLayer } from "../../broadcast/state.ts";
import { REPLICANTS } from "../../types/replicants.ts";

const TEMPLATE = `<div id="casters">
  <div class="topbar"></div>
  <div class="mark">
    <img class="compass" src="assets/images/icon.svg" alt="" />
    <span class="wordmark">RASHINBAN 2026</span>
  </div>

  <div class="caster" id="caster-1" hidden>
    <div class="role"></div>
    <div class="name"></div>
    <div class="handle"></div>
  </div>
  <div class="caster" id="caster-2" hidden>
    <div class="role"></div>
    <div class="name"></div>
    <div class="handle"></div>
  </div>

  <!-- Static for now: three confirmed sponsors, no rotation. The 2025 page
       rotated a fourth+ logo through the right slot; add that back when the
       2026 sponsor list is final. -->
  <div class="banner">
    <img class="logo-red-tokyo" src="assets/logos/red-tokyo-logo.svg" alt="RED° Tokyo Tower" />
    <img src="assets/logos/tamura-builds-white.svg" alt="TAMURA BUILDS" />
    <img class="logo-geoguessr-record" src="assets/logos/geoguessr-record.svg" alt="GeoGuessr Record" />
  </div>
</div>`;

/** Kana/kanji need the Noto face; latin names use the condensed heading face. */
const hasJapanese = (text: string) => /[぀-ヿ㐀-鿿]/.test(text);

export function mountCasters(host: HTMLElement) {
  host.innerHTML = TEMPLATE;
  const cardEls = [host.querySelector<HTMLElement>("#caster-1")!, host.querySelector<HTMLElement>("#caster-2")!];
  const chrome = host.querySelectorAll<HTMLElement>(".topbar, .mark, .banner");

  let casters: Caster[] = [];
  let state: CastersState = withDefaults(undefined);
  let layer: CastersLayer = { titleBar: true, slots: [false, false] };

  function render() {
    for (const el of chrome) el.hidden = !layer.titleBar;
    for (const [index, card] of cardEls.entries()) {
      const caster = findCaster(casters, state.slots[index]!.name);
      // Off air, or selected someone the sheet no longer lists.
      card.hidden = !layer.slots[index] || !caster;
      if (!caster) continue;
      card.querySelector(".role")!.textContent = caster.role;
      const name = card.querySelector(".name")!;
      name.textContent = caster.name;
      name.classList.toggle("kana", hasJapanese(caster.name));
      card.querySelector(".handle")!.textContent = caster.twitter ? `@${caster.twitter}` : "";
    }
  }

  nodecg.Replicant<Caster[]>(REPLICANTS.casters).on("change", (value) => {
    casters = value ?? [];
    render();
  });

  nodecg.Replicant<CastersState>(REPLICANTS.castersState).on("change", (value) => {
    state = withDefaults(value);
    render();
  });

  return {
    apply(next: CastersLayer) {
      layer = next;
      render();
    },
  };
}
