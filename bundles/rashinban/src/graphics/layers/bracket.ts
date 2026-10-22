import type { ToggleLayer } from "../../broadcast/state.ts";
import { LED_FINALS_LAYOUT } from "../bracket/led-layout.ts";
import { mountBracketView } from "../bracket/view.ts";
import { FINALS_LAYOUT } from "../bracket/finals-layout.ts";
import { STREAM_BRACKET_SVG } from "../bracket/stream-template.ts";
import { mountKvBackground } from "./kv-background.ts";
import type { Layer } from "./layer.ts";

export function mountBracket(host: HTMLElement, output: "stream" | "led" = "led", english = false): Layer<ToggleLayer> {
  host.hidden = true;
  host.innerHTML = output === "stream" ? `<div class="bracket-wrapper">${STREAM_BRACKET_SVG}</div>` : `
    <div id="led-bracket">
      <svg id="bracket" class="bracket-svg" viewBox="0 0 1920 576" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Finals bracket">
        <!-- Same translucent bands and left-edge glow as Stream, split at LED mid-height. -->
        <rect class="filter" x="-100" y="-100" width="2512" height="388" fill="#ff005e" />
        <rect class="filter-bright" x="-1000" y="-100" width="1050" height="388" fill="#ff005e" />
        <rect class="filter" x="-100" y="288" width="2512" height="800" fill="#0051ff" />
        <rect class="filter-bright" x="-1000" y="288" width="1050" height="800" fill="#0051ff" />
        <text class="bracket-band-label" x="64" y="144" transform="rotate(-90 64 144)">UPPER</text>
        <text class="bracket-band-label" x="64" y="432" transform="rotate(-90 64 432)">LOWER</text>
        <text class="bracket-riser-label" x="1516" y="248">LOWER FINAL WINNER</text>
        <text class="bracket-champion" x="1643" y="75">CHAMPION</text>
        <g id="bracket-lines"></g>
        <g id="bracket-matches"></g>
      </svg>
    </div>`;
  const background = mountKvBackground(host.firstElementChild as HTMLElement);
  mountBracketView(host.querySelector<SVGSVGElement>("#bracket")!, output === "stream" ? FINALS_LAYOUT : LED_FINALS_LAYOUT, english);
  return { apply(layer) { host.hidden = !layer.visible; background.setVisible(layer.visible); } };
}
