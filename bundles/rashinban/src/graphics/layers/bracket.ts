import type { ToggleLayer } from "../../broadcast/state.ts";
import { LED_FINALS_LAYOUT } from "../bracket/led-layout.ts";
import { mountBracketView } from "../bracket/view.ts";
import type { Layer } from "./layer.ts";

export function mountBracket(host: HTMLElement): Layer<ToggleLayer> {
  host.hidden = true;
  host.innerHTML = `
    <div id="led-bracket">
      <svg id="bracket" class="bracket-svg" viewBox="0 0 1920 576" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Finals bracket">
        <text class="bracket-band-label" x="64" y="144" transform="rotate(-90 64 144)">UPPER</text>
        <text class="bracket-band-label" x="64" y="432" transform="rotate(-90 64 432)">LOWER</text>
        <text class="bracket-riser-label" x="1516" y="248">LOWER FINAL WINNER</text>
        <g id="bracket-lines"></g>
        <g id="bracket-matches"></g>
      </svg>
    </div>`;
  mountBracketView(host.querySelector<SVGSVGElement>("#bracket")!, LED_FINALS_LAYOUT);
  return { apply(layer) { host.hidden = !layer.visible; } };
}
