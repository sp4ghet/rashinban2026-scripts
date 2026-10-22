// Caster desk layer. Name cards come from the casters sheet tab. Selection and visibility
// belong to the output's broadcast bus, so preview edits cannot change program.
import { findCaster, type Caster } from "../../casters/casters.ts";
import { defaultLayers, type CastersLayer } from "../../broadcast/state.ts";
import { REPLICANTS } from "../../types/replicants.ts";
import { mustQuery, type Layer } from "./layer.ts";

const cardMarkup = (id: string) => `<div class="caster" id="${id}" hidden>
  <div class="band role"><span class="band-content"></span></div>
  <div class="band name"><span class="band-content"></span></div>
  <div class="band handle"><span class="band-content"></span></div>
</div>`;

const TEMPLATE = `<div id="casters">
  ${cardMarkup("caster-1")}
  ${cardMarkup("caster-2")}
  ${cardMarkup("caster-3")}
</div>`;

/** Kana/kanji need the Noto face; latin names use the condensed heading face. */
const hasJapanese = (text: string) => /[぀-ヿ㐀-鿿]/.test(text);

export function mountCasters(host: HTMLElement, english = false): Layer<CastersLayer> {
  host.innerHTML = TEMPLATE;
  const cards = ["left", "right", "center"].map((side, index) => ({
    side: side as keyof CastersLayer["names"],
    el: mustQuery(host, `#caster-${index + 1}`),
    visible: false,
    name: "",
    animations: [] as Animation[],
  }));

  let casters: Caster[] = [];
  let layer: CastersLayer = defaultLayers("stream").casters;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const closed = "inset(0 50% 0 50%)";
  const open = "inset(0 0% 0 0%)";
  // Measured from the reference: about 65% open after 0.33s and 96% after
  // 1.03s, with a long settling tail. Sampling the exponential keeps the
  // original motion more closely than a generic CSS ease-out curve.
  const reveal = Array.from({ length: 61 }, (_, index) => ({
    clipPath: `inset(0 ${index === 60 ? 0 : 50 * Math.exp(-9.5 * index / 60)}% 0 ${index === 60 ? 0 : 50 * Math.exp(-9.5 * index / 60)}%)`,
  }));

  function animate(card: typeof cards[number], visible: boolean) {
    // Capture both masks before cancellation so an interrupted entrance never
    // flashes its still-closed role/handle or jumps the name to full width.
    const currentClips = new Map<Element, string>();
    if (!visible) for (const element of card.el.querySelectorAll(".band, .band-content")) {
      const clip = getComputedStyle(element).clipPath;
      currentClips.set(element, clip === "none" ? open : clip);
    }
    for (const animation of card.animations) animation.cancel();
    card.animations = [];
    card.visible = visible;
    card.el.dataset.visible = String(visible);
    if (reducedMotion.matches) {
      card.el.hidden = !visible;
      return;
    }
    card.el.hidden = false;
    for (const [part, delay] of [["name", 0], ["role", 200], ["handle", 600]] as const) {
      const band = mustQuery(card.el, `.${part}`);
      if (band.hidden) continue;
      const content = mustQuery(band, ".band-content");
      // Two masks chase each other: the outside mask reveals a leading white
      // strip (red for the handle), then the colored content follows it.
      // Text is clipped at its final size, never stretched with the strip.
      card.animations.push(band.animate(
        visible ? reveal : [{ clipPath: currentClips.get(band)! }, { clipPath: closed }],
        { duration: visible ? 3000 : 220, delay: visible ? delay : 0,
          easing: visible ? "linear" : "ease-in", fill: "both" },
      ));
      card.animations.push(content.animate(
        visible ? reveal : [{ clipPath: currentClips.get(content)! }, { clipPath: closed }],
        { duration: visible ? 3000 : 220, delay: visible ? delay + 100 : 0,
          easing: visible ? "linear" : "ease-in", fill: "both" },
      ));
    }
    if (!visible) {
      const last = card.animations.at(-1);
      if (last) last.onfinish = () => { if (!card.visible) card.el.hidden = true; };
      else card.el.hidden = true;
    }
  }

  function fitEnglishText() {
    if (!english) return;
    for (const content of host.querySelectorAll<HTMLElement>(".caster:not([hidden]) .band:not([hidden]) .band-content")) {
      content.style.fontSize = "";
      const style = getComputedStyle(content);
      const box = content.getBoundingClientRect();
      if (!box.width || !content.offsetWidth) continue;
      const scale = box.width / content.offsetWidth;
      const available = (content.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) * scale;
      const range = document.createRange();
      range.selectNodeContents(content);
      const width = range.getBoundingClientRect().width;
      if (width > available) content.style.fontSize = `${parseFloat(style.fontSize) * available / width}px`;
    }
  }

  function render() {
    for (const [index, card] of cards.entries()) {
      const caster = findCaster(casters, layer.names[card.side]);
      const visible = Boolean((index === 2 ? layer.center : layer.slots[index]) && caster);
      if (!visible || !caster) {
        if (card.visible) animate(card, false);
        continue;
      }
      const role = mustQuery(card.el, ".role");
      role.hidden = !caster.role;
      mustQuery(role, ".band-content").textContent = caster.role;
      const name = mustQuery(card.el, ".name");
      mustQuery(name, ".band-content").textContent = caster.name;
      name.classList.toggle("kana", hasJapanese(caster.name));
      const handle = mustQuery(card.el, ".handle");
      handle.hidden = !caster.twitter;
      mustQuery(handle, ".band-content").textContent = caster.twitter ? `@${caster.twitter}` : "";
      if (!card.visible || card.name !== caster.name) animate(card, true);
      card.name = caster.name;
    }
    fitEnglishText();
  }

  nodecg.Replicant<Caster[]>(english ? REPLICANTS.castersEn : REPLICANTS.casters).on("change", (value) => {
    casters = value ?? [];
    render();
  });

  if (english) {
    void document.fonts.ready.then(fitEnglishText);
    document.fonts.addEventListener("loadingdone", fitEnglishText);
  }

  return {
    apply(next) {
      layer = next;
      render();
    },
  };
}
