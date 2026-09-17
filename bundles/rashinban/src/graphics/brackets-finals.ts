// DAY2 top-8 bracket overlay. Boxes and lines come from the finals layout;
// names, scores and the "on now" border come from the bracketFinals replicant
// (live start.gg or a recorded sample, chosen in the Bracket dashboard panel).
import type { BracketFinals, BracketRow } from "../bracket/finals";
import { REPLICANTS } from "../types/replicants";
import { FINALS_LAYOUT } from "./bracket/finals-layout";
import { renderBracket } from "./bracket/svg";

renderBracket(FINALS_LAYOUT, {
  linesHost: document.getElementById("bracket-lines")!,
  matchesHost: document.getElementById("bracket-matches")!,
});

const optional = new Set(FINALS_LAYOUT.matches.filter((m) => m.optional).map((m) => m.id));
const part = (match: number, suffix = "") => document.getElementById(`match${match}${suffix}`);

function renderRow(row: BracketRow) {
  const group = part(row.match);
  if (!group) return;
  if (optional.has(row.match)) {
    const display = row.top || row.bottom ? "" : "none";
    group.style.display = display;
    const line = part(row.match, "-bracket-line");
    if (line) line.style.display = display;
  }
  part(row.match, "-border")?.classList.toggle("active", row.active);
  for (const side of ["top", "bottom"] as const) {
    const name = part(row.match, `-${side}`);
    if (name) {
      name.textContent = side === "top" ? row.top : row.bottom;
      name.parentElement?.classList.toggle("winner", row.winner === side);
    }
    const score = part(row.match, `-score-${side}`);
    if (score) score.textContent = side === "top" ? row.topScore : row.bottomScore;
  }
}

nodecg.Replicant<BracketFinals>(REPLICANTS.bracketFinals).on("change", (value) => {
  for (const row of value?.rows ?? []) renderRow(row);
});
