// Caster desk overlay. The title bar and sponsor banner are static markup;
// the two name cards come from the casters sheet tab (`casters`) plus the
// operator's slot selection (`castersState`, set in the Casters panel).
import { findCaster, withDefaults, type Caster, type CastersState } from "../casters/casters";
import { REPLICANTS } from "../types/replicants";

const cardEls = [document.getElementById("caster-1")!, document.getElementById("caster-2")!];

let casters: Caster[] = [];
let state: CastersState = withDefaults(undefined);

/** Kana/kanji need the Noto face; latin names use the condensed heading face. */
const hasJapanese = (text: string) => /[぀-ヿ㐀-鿿]/.test(text);

function render() {
  for (const [index, card] of cardEls.entries()) {
    const slot = state.slots[index]!;
    const caster = findCaster(casters, slot.name);
    // Off air, or selected someone the sheet no longer lists.
    card.hidden = !slot.enabled || !caster;
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
