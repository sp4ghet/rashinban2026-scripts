// DAY2 top-8 bracket overlay. Boxes and lines come from the finals layout;
// names, scores and the "on now" border come from the bracketFinals replicant
// (live start.gg or a recorded sample, chosen in the Bracket dashboard panel).
import { FINALS_LAYOUT } from "./bracket/finals-layout";
import { mountBracketView } from "./bracket/view";

mountBracketView(document.querySelector<SVGSVGElement>("#bracket")!, FINALS_LAYOUT);
